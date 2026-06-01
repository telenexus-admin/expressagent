const express = require('express');
const db = require('../db');
const { generateAIResponse, analyzeSupportImage, transcribeAudio, classifyComplaint, classifyIntent } = require('../services/openai');
const { parseEvolutionInbound } = require('../services/evolution');
const { sendClientText, downloadClientAudio, downloadClientImage } = require('../services/clientEvolution');
const { createOrUpdateTicket, ticketFromComplaint, ticketFromIntent } = require('../services/tickets');
const { notifyClientAdmins } = require('../services/pushNotifications');
const { answerBillingQuestion, buildBillingContext } = require('../services/billing');

const router = express.Router();
const OPT_OUT = new Set(['stop', 'unsubscribe', 'cancel', 'quit', 'end', 'acha', 'simama', 'koma']);
const RESUME = new Set(['start', 'resume', 'subscribe', 'anza', 'endelea']);
const HUMAN_RE = /\b(human|agent|person|representative|support|mtu|mwakilishi|msaada)\b/i;

function safeError(err) {
  return typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message || 'unknown error');
}

function runAfterReply(label, task) {
  setImmediate(() => {
    task().catch((err) => {
      console.error(`${label} failed:`, safeError(err));
    });
  });
}

function audioFilename(mimeType) {
  if (String(mimeType || '').includes('mpeg')) return 'voice-note.mp3';
  if (String(mimeType || '').includes('mp4')) return 'voice-note.m4a';
  if (String(mimeType || '').includes('wav')) return 'voice-note.wav';
  return 'voice-note.ogg';
}

function imageFilename(mimeType) {
  const subtype = String(mimeType || 'image/jpeg').split('/')[1]?.split(';')[0] || 'jpg';
  const safeSubtype = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  return `whatsapp-image.${safeSubtype === 'jpeg' ? 'jpg' : safeSubtype}`;
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
  const inserted = await db.query(
    `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, $2, $3, NOW()) RETURNING id`,
    [conversationId, role, content]
  );
  await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
  return inserted.rows[0];
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
    let inboundImageBuffer = null;
    let inboundImageMimeType = null;
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
    if (incoming.isImage && client.photo_troubleshooting_enabled !== false) {
      try {
        const { buffer, mimeType } = await downloadClientImage(client, incoming.messageKey);
        const resolvedMimeType = String(mimeType || incoming.mediaMimeType || 'image/jpeg');
        if (!resolvedMimeType.startsWith('image/') && !String(incoming.mediaMimeType || '').startsWith('image/')) {
          throw new Error('Received media is not an image.');
        }
        inboundImageBuffer = buffer;
        inboundImageMimeType = resolvedMimeType.startsWith('image/') ? resolvedMimeType : incoming.mediaMimeType || 'image/jpeg';
        storedText = `[Image received] ${userText || 'Customer sent a router/support photo for checking.'}`;
        userText = userText || '[Customer sent a router/support photo for checking]';
      } catch (err) {
        console.error(`[evo client ${client.id}] Image download failed:`, safeError(err));
        return;
      }
    }
    if (!userText) return;

    const conversation = await findOrCreateConversation(client.id, incoming.phone, incoming.name);
    const savedUserMessage = await saveMessage(conversation.id, 'user', storedText);
    if (inboundImageBuffer) {
      if (savedUserMessage?.id) {
        await db.query(
          `INSERT INTO message_attachments (message_id, media_type, mime_type, filename, data)
           VALUES ($1, 'image', $2, $3, $4)`,
          [savedUserMessage.id, inboundImageMimeType, imageFilename(inboundImageMimeType), inboundImageBuffer]
        );
      }
    }
    runAfterReply('Push notification for inbound Evolution message', () => notifyClientAdmins({
      clientId: client.id,
      conversationId: conversation.id,
      customerName: conversation.customer_name,
      customerPhone: incoming.phone,
      messageText: storedText,
    }));
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

    if (!incoming.isImage) {
      const billingReply = await answerBillingQuestion({ clientId: client.id, customerPhone: incoming.phone, messageText: userText });
      if (billingReply) {
        await reply(client, conversation.id, incoming.phone, billingReply);
        console.log(`[evo client ${client.id}] Billing reply sent to ${incoming.phone}.`);
        return;
      }
    }

    if (HUMAN_RE.test(userText)) {
      await db.query(`UPDATE conversations SET status = 'human_takeover', updated_at = NOW() WHERE id = $1`, [conversation.id]);
      await db.query(
        `INSERT INTO escalations (conversation_id, client_id, customer_phone, customer_name, trigger_message, support_number, notify_status, notify_error, type)
         VALUES ($1, $2, $3, $4, $5, $6, 'logged', NULL, 'human')`,
        [conversation.id, client.id, incoming.phone, conversation.customer_name, userText, client.support_number || null]
      );
      runAfterReply('Evolution human support ticket creation', () => createOrUpdateTicket({
        clientId: client.id,
        conversationId: conversation.id,
        customerPhone: incoming.phone,
        customerName: conversation.customer_name,
        title: 'Human support requested',
        category: 'human_support',
        priority: 'high',
        intent: 'human_request',
        source: 'whatsapp_evolution',
        summary: userText,
        messageText: userText,
      }));
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
    if (!incoming.isImage) {
      const billingContext = await buildBillingContext({ clientId: client.id, customerPhone: incoming.phone, messageText: userText });
      if (billingContext) prompt += billingContext;
    }
    const aiReply = incoming.isImage && inboundImageBuffer
      ? await analyzeSupportImage(prompt, recent.rows, inboundImageBuffer, inboundImageMimeType, incoming.text || '')
      : await generateAIResponse(prompt, recent.rows);
    if (!aiReply || !aiReply.trim()) return;
    await reply(client, conversation.id, incoming.phone, aiReply.trim());
    console.log(`[evo client ${client.id}] AI reply sent to ${incoming.phone}.`);
    runAfterReply('Evolution post-reply ticket workflow', async () => {
      const [complaint, intentResult] = await Promise.all([
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
    });
  } catch (err) {
    console.error('Evolution client webhook processing failed:', safeError(err));
  }
});

module.exports = router;
