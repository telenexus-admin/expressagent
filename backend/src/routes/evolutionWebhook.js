const express = require('express');
const db = require('../db');
const { generateAIResponse } = require('../services/openai');
const {
  getOperatorSettings,
  parseEvolutionInbound,
  findOrCreateOperatorConversation,
  sendEvolutionText,
} = require('../services/evolution');

const router = express.Router();

function safeError(err) {
  return typeof err.response?.data === 'object'
    ? JSON.stringify(err.response.data)
    : (err.response?.data || err.message || 'unknown error');
}

router.post('/nexa', async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const settings = await getOperatorSettings({ includeKey: true });
    const suppliedToken = String(req.query.token || req.headers['x-webhook-token'] || '');
    if (!settings || suppliedToken !== settings.webhook_secret) {
      console.warn('Nexa Evolution webhook ignored: invalid token.');
      return;
    }
    if (!settings.enabled) {
      console.log('Nexa Evolution webhook received while operator agent is disabled.');
      return;
    }

    const incoming = parseEvolutionInbound(req.body);
    if (!incoming || !incoming.phone || !incoming.text) return;

    const conversation = await findOrCreateOperatorConversation(incoming.phone, incoming.name);
    await db.query(
      `INSERT INTO operator_messages (conversation_id, role, content, timestamp)
       VALUES ($1, 'user', $2, NOW())`,
      [conversation.id, incoming.text]
    );
    await db.query(`UPDATE operator_conversations SET updated_at = NOW() WHERE id = $1`, [conversation.id]);

    const recent = await db.query(
      `SELECT role, content FROM (
         SELECT role, content, timestamp FROM operator_messages
         WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20
       ) messages ORDER BY timestamp ASC`,
      [conversation.id]
    );

    let prompt = settings.system_prompt;
    if (settings.agent_name) {
      prompt = `Your name is ${settings.agent_name}. When asked who you are, say you are ${settings.agent_name}, the Telenexus Technologies AI assistant.\n\n${prompt}`;
    }
    if (conversation.customer_name) {
      prompt += `\n\nThe person's WhatsApp display name is "${conversation.customer_name}". Use their first name naturally when helpful, but do not greet repeatedly in every message.`;
    }

    const reply = await generateAIResponse(prompt, recent.rows);
    if (!reply || !reply.trim()) return;
    await sendEvolutionText(settings, incoming.phone, reply.trim());
    await db.query(
      `INSERT INTO operator_messages (conversation_id, role, content, timestamp)
       VALUES ($1, 'assistant', $2, NOW())`,
      [conversation.id, reply.trim()]
    );
    await db.query(`UPDATE operator_conversations SET updated_at = NOW() WHERE id = $1`, [conversation.id]);
    console.log(`Nexa Evolution reply sent to ${incoming.phone}.`);
  } catch (err) {
    console.error('Nexa Evolution webhook processing failed:', safeError(err));
  }
});

module.exports = router;
