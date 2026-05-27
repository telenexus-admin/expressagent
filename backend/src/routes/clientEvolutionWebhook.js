const express = require('express');
const db = require('../db');
const { generateAIResponse, transcribeAudio, classifyComplaint, classifyIntent } = require('../services/openai');
const { parseEvolutionInbound } = require('../services/evolution');
const { sendClientText, downloadClientAudio } = require('../services/clientEvolution');
const { createOrUpdateTicket, ticketFromComplaint, ticketFromIntent } = require('../services/tickets');

const router = express.Router();
const OPT_OUT = new Set(['stop', 'unsubscribe', 'cancel', 'quit', 'end', 'acha', 'simama', 'koma']);
const RESUME = new Set(['start', 'resume', 'subscribe', 'anza', 'endelea']);
const HUMAN_RE = /\b(human|agent|person|representative|support|mtu|mwakilishi|msaada)\b/i;

function safeError(err) {
  return typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message || 'unknown error');
}

function audioFilename(mimeType) {
  if (String(mimeType || '').includes('mpeg')) return 'voice-note.mp3';
  if (String(mimeType || '').includes('mp4')) return 'voice-note.m4a';
  if (String(mimeType || '').includes('wav')) return 'voice-note.wav';
  return 'voice-note.ogg';
}

async function loadClient(id, token) {
  const result = await db.query(
    `SELECT * FROM clients
     WHERE id = $1 AND connection_provider = 'evolution' AND status = 'active'
       AND evolution_webhook_secret = $2 AND evolution_routing_active = TRUE
     LIMIT 1`,
    [id, token]
  );
  return result.rows[0] || null;
}

async function findOrCreateConversation(clientId, phone, name) {
  const existing = await db.query(
    `SELECT * FROM conversations
     WHERE client_id = $1 AND customer_phone = $2 AND status != 'resolved'
     ORDER BY created_at DESC LIMIT 1`,
    [clientId, phone]
  );
  if (existing.rows[0]) {
    if (name && name !== existing.rows[0].customer_name) {
      const updated = await db.query(
        `UPDATE conversations SET customer_name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [name, existing.rows[0].id]
      );
      return updated.rows[0];
    }
    return existing.rows[0];
  }
  const inserted = await db.query(
    `INSERT INTO conversations (customer_phone, customer_name, status, client_id)
     VALUES ($1, $2, 'active', $3) RETURNING *`,
    [phone, name || null, clientId]
  );
  return inserted.rows[0];
}

async function saveMessage(conversationId, role, content) {
  await db.query(
    `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, $2, $3, NOW())`,
    [conversationId, role, content]
  );
  await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
}

async function reply(client, conversationId, phone, text) {
  await sendClientText(client, phone, text);
  await saveMessage(conversationId, 'assistant', text);
}

router.post('/client/:clientId', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const token = String(req.query.token || req.headers['x-webhook-token'] || '');
    const client = await loadClient(req.params.clientId, token);
    if (!client) {
      console.warn(`Evolution client webhook ignored for client ${req.params.clientId}: invalid token or routing inactive.`);
      return;
    }

    const incoming = parseEvolutionInbound(req.body);
    if (!incoming || !incoming.phone) return;

    let userText = String(incoming.text || '').trim();
    let storedText = userText;
    if (incoming.isVoice) {
      try {
        const { buffer, mimeType } = await downloadClientAudio(client, incoming.messageKey);
        userText = (await transcribeAudio(buffer, audioFilename(mimeType))).trim();
        if (!userText) return;
        storedText = `[Voice note] ${userText}`;
      } catch (err) {
        console.error(`[evo client ${client.id}] Voice transcription failed:`, safeError(err));
        return;
      }
    }
    if (!userText) return;

    const conversation = await findOrCreateConversation(client.id, incoming.phone, incoming.name);
    await saveMessage(conversation.id, 'user', storedText);
    console.log(`[evo client ${client.id}] Incoming from ${incoming.phone}: "${userText}"`);

    const normalized = userText.toLowerCase();
    if (conversation.opted_out_at && RESUME.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NULL WHERE id = $1`, [conversation.id]);
      await reply(client, conversation.id, incoming.phone, "You're resubscribed. How can I help you today?");
      return;
    }
    if (conversation.opted_out_at) return;
    if (OPT_OUT.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NOW() WHERE id = $1`, [conversation.id]);
      await reply(client, conversation.id, incoming.phone, "You've been unsubscribed. Reply START at any time to resume.");
      return;
    }
    if (conversation.status === 'human_takeover') return;

    if (HUMAN_RE.test(userText)) {
      await db.query(`UPDATE conversations SET status = 'human_takeover', updated_at = NOW() WHERE id = $1`, [conversation.id]);
      await db.query(
        `INSERT INTO escalations (conversation_id, client_id, customer_phone, customer_name, trigger_message, support_number, notify_status, notify_error, type)
         VALUES ($1, $2, $3, $4, $5, $6, 'logged', NULL, 'human')`,
        [conversation.id, client.id, incoming.phone, conversation.customer_name, userText, client.support_number || null]
      );
      await createOrUpdateTicket({
        clientId: client.id,
        conversationId: conversation.id,
        customerPhone: incoming.phone,
        customerName: conversation.customer_name,
        title: 'Human support requested',
        category: 'human_support',
        priority: 'high',
        source: 'whatsapp_evolution',
        summary: userText,
        messageText: userText,
      });
      const answer = client.support_number
        ? `Thanks — I've forwarded your request for human support. You may also reach the team on ${client.support_number}.`
        : "Thanks — I've flagged your request for the support team. Someone will follow up shortly.";
      await reply(client, conversation.id, incoming.phone, answer);
      return;
    }

    const recent = await db.query(
      `SELECT role, content FROM (
         SELECT role, content, timestamp FROM messages
         WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20
       ) history ORDER BY timestamp ASC`,
      [conversation.id]
    );
    let prompt = client.system_prompt || 'You are a helpful customer support agent.';
    if (client.agent_name) {
      prompt = `Your name is ${client.agent_name}. You are the official AI assistant for ${client.business_name || client.name}.\n\n${prompt}`;
    }
    if (conversation.customer_name) {
      prompt += `\n\nThe customer's WhatsApp display name is "${conversation.customer_name}". Use their name naturally when useful, without repeating a greeting in every reply.`;
    }
    if (client.support_number) {
      prompt += `\n\nWhen a human is required, tell the customer they can reach support at ${client.support_number}.`;
    }
    const [aiReply, complaint, intentResult] = await Promise.all([
      generateAIResponse(prompt, recent.rows),
      classifyComplaint(userText),
      classifyIntent(userText),
    ]);
    if (intentResult?.intent) {
      await ticketFromIntent({
        client,
        conversation,
        intent: intentResult.intent,
        messageText: userText,
        source: 'whatsapp_evolution',
      });
    }
    if (complaint?.isComplaint) {
      await ticketFromComplaint({
        client,
        conversation,
        complaint,
        messageText: userText,
        source: 'whatsapp_evolution',
      });
    }
    if (!aiReply || !aiReply.trim()) return;
    await reply(client, conversation.id, incoming.phone, aiReply.trim());
    console.log(`[evo client ${client.id}] AI reply sent to ${incoming.phone}.`);
  } catch (err) {
    console.error('Evolution client webhook processing failed:', safeError(err));
  }
});

module.exports = router;
