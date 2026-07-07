const express = require('express');
const OpenAI = require('openai');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

const router = express.Router();
let openai = null;

router.use(authMiddleware, scopeMiddleware);

function getOpenAI() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

function canChangeAgent(req) {
  if (req.user.role === 'superadmin') return true;
  const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
  return permissions.length === 0 || permissions.includes('agent');
}

function systemManual(client) {
  return `
You are Nexa Help Bot, an in-dashboard assistant for admins using the Nexa AI support platform.
Be short, practical and confident. Use simple steps.

What this system does:
- Handles WhatsApp customer conversations using an AI agent.
- Keeps conversation history in Conversations.
- Creates and tracks Tickets for customer issues.
- Sends phone push notifications to installed dashboard apps when customers message.
- Supports employee workflow routing for installation, billing, technical issues, human requests, feedback and general enquiries.
- Has Employees, Workflow, Agent Configuration, Knowledge Base, AI Health, Billing Usage, Communication, Settings, Activity Logs and admin permissions.
- Communication configures Blessed Text SMS API key and sender ID for alerts, reports and customer notifications.
- Knowledge Base contains billing CSV account uploads and Agent Media Library assets.
- Settings contains Install App, Theme, Phone Alerts and Billing System integration.
- Billing System currently supports Wispman. It lets the agent read client status, plans, payments and recharge details when the client connects their own API key.
- The Billing tab shows monthly AI message usage: 500 messages included at KSh 800, then every 2 extra AI messages costs KSh 1 unless env pricing is changed.
- The Agent Configuration tab controls the customer-facing AI name, voice and system prompt.

Safe automation rules:
- You may update the customer-facing agent prompt only when the admin clearly asks you to change the AI's behavior, tone, wording, rules, or what it should/should not say.
- Prefer appending a clear instruction to the current prompt instead of replacing the whole prompt.
- Do not change credentials, API keys, billing URLs, passwords or webhook settings.
- Do not claim you changed something unless the JSON action says to change it.

Current client:
- Business: ${client.business_name || client.name || 'this client'}
- Agent name: ${client.agent_name || 'not set'}
- Support number: ${client.support_number || 'not set'}
- Billing enabled: ${client.billing_enabled ? 'yes' : 'no'}

Reply with JSON only:
{
  "reply": "what to show the admin",
  "action": "none" | "append_agent_prompt",
  "instruction": "only for append_agent_prompt, the exact short instruction to append"
}
`;
}

async function loadClient(clientId) {
  const result = await db.query(
    `SELECT id, name, business_name, agent_name, support_number, system_prompt, billing_enabled
     FROM clients
     WHERE id = $1`,
    [clientId]
  );
  return result.rows[0] || null;
}

async function askHelpBot({ client, message }) {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemManual(client) },
      { role: 'user', content: message },
    ],
    temperature: 0.2,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(response.choices[0].message.content || '{}');
  return {
    reply: String(parsed.reply || 'I can help with dashboard setup, billing, notifications, tickets and agent behavior.').trim(),
    action: parsed.action === 'append_agent_prompt' ? 'append_agent_prompt' : 'none',
    instruction: String(parsed.instruction || '').trim(),
  };
}

router.post('/chat', async (req, res) => {
  const targetClient = req.scope.clientId;
  if (!targetClient) return res.status(400).json({ error: 'clientId is required' });

  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (message.length > 2000) return res.status(400).json({ error: 'Message is too long' });

  try {
    const client = await loadClient(targetClient);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const answer = await askHelpBot({ client, message });
    let applied = null;

    if (answer.action === 'append_agent_prompt' && answer.instruction) {
      if (!canChangeAgent(req)) {
        return res.json({
          reply: `${answer.reply}\n\nI can explain the change, but this admin does not have Agent Configuration permission to apply it.`,
          applied: null,
        });
      }

      const currentPrompt = client.system_prompt || 'You are a helpful customer support agent.';
      const instruction = answer.instruction.slice(0, 500);
      const marker = `\n\nDashboard help bot instruction:\n- ${instruction}`;
      const nextPrompt = currentPrompt.includes(instruction) ? currentPrompt : `${currentPrompt}${marker}`;

      await db.query(
        `UPDATE clients SET system_prompt = $1 WHERE id = $2`,
        [nextPrompt, targetClient]
      );
      applied = { type: 'agent_prompt', instruction };
    }

    res.json({ reply: answer.reply, applied });
  } catch (err) {
    console.error('POST /help-bot/chat error:', err.message);
    res.status(500).json({ error: 'Help bot is unavailable right now' });
  }
});

module.exports = router;
