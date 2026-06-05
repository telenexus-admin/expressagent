const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { generateAIResponse, openAIModelSummary } = require('../services/openai');
const { answerBillingQuestion, buildBillingContext } = require('../services/billing');
const { notifyClientAdmins } = require('../services/pushNotifications');

const router = express.Router();
const attempts = new Map();

function rateKey(req, clientId) {
  const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  return `${clientId}:${ip}`;
}

function allowMessage(req, clientId) {
  const key = rateKey(req, clientId);
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < 60 * 1000);
  if (recent.length >= 20) return false;
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

function cleanText(value, max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanSession(value) {
  const raw = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return raw || crypto.randomBytes(8).toString('hex');
}

function visitorPhone(clientId, sessionId) {
  return `site:${clientId}:${sessionId}`.slice(0, 50);
}

function fallbackReply(messageText = '') {
  const text = String(messageText || '').toLowerCase();
  if (/\b(install|installation|get connected|connect me|new connection)\b/.test(text)) {
    return 'I can help with installation. Please share your name, phone number and exact location or estate.';
  }
  if (/\b(package|packages|price|plan|speed|mbps|cost)\b/.test(text)) {
    return 'I can help with packages. Please share your location so I can guide you on available plans.';
  }
  if (/\b(no internet|not working|down|slow|los|router|wifi|wi-fi)\b/.test(text)) {
    return 'Sorry about that. Please share your registered phone number and what lights you see on the router.';
  }
  return 'I am here to help. Please share your phone number and what you need help with.';
}

async function loadConversation(clientId, sessionId, visitorName) {
  const phone = visitorPhone(clientId, sessionId);
  const existing = await db.query(
    `SELECT * FROM conversations WHERE client_id = $1 AND customer_phone = $2 LIMIT 1`,
    [clientId, phone]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await db.query(
    `INSERT INTO conversations (customer_phone, customer_name, status, client_id)
     VALUES ($1, $2, 'active', $3)
     RETURNING *`,
    [phone, visitorName || 'Website visitor', clientId]
  );
  return created.rows[0];
}

router.get('/:clientId/config', async (req, res) => {
  try {
    const clientId = Number.parseInt(req.params.clientId, 10);
    if (!Number.isInteger(clientId)) return res.status(400).json({ error: 'Invalid client' });
    const result = await db.query(
      `SELECT id, name, business_name, agent_name, status FROM clients WHERE id = $1 AND status = 'active'`,
      [clientId]
    );
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Agent not found' });
    res.json({
      client_id: client.id,
      business_name: client.business_name || client.name || 'Support',
      agent_name: client.agent_name || 'AI Support',
    });
  } catch (err) {
    console.error('GET /site-chat/config error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:clientId/message', async (req, res) => {
  try {
    const clientId = Number.parseInt(req.params.clientId, 10);
    if (!Number.isInteger(clientId)) return res.status(400).json({ error: 'Invalid client' });
    if (!allowMessage(req, clientId)) return res.status(429).json({ error: 'Too many messages. Please wait a moment.' });

    const messageText = cleanText(req.body.message);
    if (!messageText) return res.status(400).json({ error: 'Message is required' });
    const sessionId = cleanSession(req.body.session_id);
    const visitorName = cleanText(req.body.name, 80) || 'Website visitor';

    const clientResult = await db.query(`SELECT * FROM clients WHERE id = $1 AND status = 'active'`, [clientId]);
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Agent not found' });

    const conversation = await loadConversation(clientId, sessionId, visitorName);
    if (conversation.status === 'human_takeover' || conversation.reply_mode === 'silent') {
      return res.json({
        session_id: sessionId,
        reply: 'A human team member is reviewing this conversation. Please leave your phone number and we will follow up.',
      });
    }

    await db.query(
      `INSERT INTO messages (conversation_id, role, content, sender_name, timestamp)
       VALUES ($1, 'user', $2, $3, NOW())`,
      [conversation.id, `[Website chat] ${messageText}`, visitorName]
    );
    await db.query(`UPDATE conversations SET updated_at = NOW(), customer_name = COALESCE(NULLIF($1, ''), customer_name) WHERE id = $2`, [
      visitorName,
      conversation.id,
    ]);

    const syntheticPhone = visitorPhone(clientId, sessionId);
    const billingReply = await answerBillingQuestion({ clientId, customerPhone: syntheticPhone, messageText });
    if (billingReply) {
      await db.query(
        `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'assistant', $2, NOW())`,
        [conversation.id, billingReply]
      );
      return res.json({ session_id: sessionId, reply: billingReply });
    }

    const recent = await db.query(
      `SELECT role, content FROM (
         SELECT role, content, timestamp FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20
       ) recent ORDER BY timestamp ASC`,
      [conversation.id]
    );
    const agentName = (client.agent_name || '').trim();
    let systemPrompt = client.system_prompt || 'You are a helpful customer support agent.';
    systemPrompt = `You are ${agentName || 'the AI support agent'} for ${client.business_name || client.name || 'this ISP'}.\n\n${systemPrompt}`;
    systemPrompt +=
      `\n\nWEBSITE CHAT RULES:\n` +
      `The customer is chatting from the Neema website, not WhatsApp. Keep replies short and helpful. ` +
      `If they need account-specific help, ask for their registered phone number. ` +
      `If they ask for installation, coverage, packages, payment or technical support, guide them naturally and ask only for the next needed detail. ` +
      `Do not claim you have called, visited, reconnected, or changed an account unless the system context confirms it.`;
    const billingContext = await buildBillingContext({ clientId, customerPhone: syntheticPhone, messageText });
    if (billingContext) systemPrompt += billingContext;

    console.log(`[client ${client.id}] Generating website chat reply for ${syntheticPhone}. OpenAI config: ${JSON.stringify(openAIModelSummary())}`);
    let reply;
    try {
      reply = await generateAIResponse(systemPrompt, recent.rows);
    } catch (err) {
      console.error(`[client ${client.id}] Website chat AI failed for ${syntheticPhone}:`, err.message);
      reply = fallbackReply(messageText);
    }
    await db.query(
      `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'assistant', $2, NOW())`,
      [conversation.id, reply]
    );
    notifyClientAdmins({
      clientId: client.id,
      conversationId: conversation.id,
      customerName: visitorName,
      customerPhone: syntheticPhone,
      messageText,
    }).catch((err) => console.error('Website chat push notification failed:', err.message));
    res.json({ session_id: sessionId, reply });
  } catch (err) {
    console.error('POST /site-chat/message error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
