const express = require('express');
const db = require('../db');
const { generateAIResponse, analyzeSupportImage, transcribeAudio, synthesizeVoice, classifyComplaint, classifyIntent } = require('../services/openai');
const { parseEvolutionInbound } = require('../services/evolution');
const { sendClientText, sendClientVoiceNote, sendClientMedia, downloadClientAudio, downloadClientImage } = require('../services/clientEvolution');
const { createOrUpdateTicket, ticketFromComplaint, ticketFromIntent } = require('../services/tickets');
const { notifyClientAdmins } = require('../services/pushNotifications');
const { answerBillingQuestion, buildBillingContext } = require('../services/billing');
const { claimWelcomeMediaRecipient, matchingMedia, mediaByTags, stripMediaTags, uniqueMediaItems, welcomeMedia } = require('../services/mediaLibrary');
const { buildCustomerIntakeUrl } = require('../services/customerIntake');
const { markHumanTakeover } = require('../services/humanTakeoverRecovery');
const { answerPayHeroPrompt } = require('../services/payhero');

const router = express.Router();
const OPT_OUT = new Set(['stop', 'unsubscribe', 'cancel', 'quit', 'end', 'acha', 'simama', 'koma']);
const RESUME = new Set(['start', 'resume', 'subscribe', 'anza', 'endelea']);
const HUMAN_RE = /\b(human|agent|person|representative|support|mtu|mwakilishi|msaada)\b/i;
const INSTALL_RE = /\b(install|installation|connect|connection|subscribe|register|fibre|fiber|niunganish|kuunganishwa)\b/i;

function safeError(err) {
  return typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message || 'unknown error');
}

function fallbackAiReply(client) {
  const name = String(client.agent_name || 'the assistant').trim();
  return `Hi, this is ${name}. I have received your message. Please tell me what you need help with.`;
}

function payloadShape(payload) {
  const data = payload?.data || payload;
  const firstMessage = Array.isArray(data?.messages) ? data.messages[0] : null;
  const message = data?.message || data?.data?.message || firstMessage?.message || {};
  return JSON.stringify({
    event: payload?.event || payload?.type || null,
    topKeys: Object.keys(payload || {}).slice(0, 10),
    dataKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : [],
    messageKeys: message && typeof message === 'object' ? Object.keys(message).slice(0, 12) : [],
    hasMessagesArray: Array.isArray(data?.messages),
  });
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

async function transcribeClientVoice(client, messageKey) {
  const first = await downloadClientAudio(client, messageKey);
  try {
    const text = (await transcribeAudio(first.buffer, audioFilename(first.mimeType), first.mimeType)).trim();
    if (text) return { text, buffer: first.buffer, mimeType: first.mimeType };
    throw new Error('Voice note transcription was empty.');
  } catch (err) {
    console.warn(`[evo client ${client.id}] Original voice transcription failed, retrying as MP4:`, safeError(err));
    const fallback = await downloadClientAudio(client, messageKey, { convertToMp4: true });
    const text = (await transcribeAudio(fallback.buffer, audioFilename(fallback.mimeType || 'audio/mp4'), fallback.mimeType || 'audio/mp4')).trim();
    if (!text) throw new Error('Voice note transcription was empty after MP4 retry.');
    return { text, buffer: fallback.buffer, mimeType: fallback.mimeType || 'audio/mp4' };
  }
}

function shouldReplyAsVoice(replyMode, inboundIsVoice) {
  if (replyMode === 'voice') return true;
  if (replyMode === 'text' || replyMode === 'silent') return false;
  return Boolean(inboundIsVoice);
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
  await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reply_mode VARCHAR(20) NOT NULL DEFAULT 'auto'`);
  const previous = await db.query(
    `SELECT id FROM conversations WHERE client_id = $1 AND customer_phone = $2 LIMIT 1`,
    [clientId, phone]
  );
  const isNewNumber = previous.rows.length === 0;
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
      return { conversation: updated.rows[0], isNewNumber: false };
    }
    return { conversation: existing.rows[0], isNewNumber: false };
  }
  const inserted = await db.query(
    `INSERT INTO conversations (customer_phone, customer_name, status, client_id)
     VALUES ($1, $2, 'active', $3) RETURNING *`,
    [phone, name || null, clientId]
  );
  return { conversation: inserted.rows[0], isNewNumber };
}

async function saveMessage(conversationId, role, content) {
  const inserted = await db.query(
    `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, $2, $3, NOW()) RETURNING id`,
    [conversationId, role, content]
  );
  await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
  return inserted.rows[0];
}

async function reply(client, conversationId, phone, text, asVoice = false) {
  if (asVoice) {
    try {
      const audio = await synthesizeVoice(text, client.voice_id || 'alloy');
      await sendClientVoiceNote(client, phone, audio);
      await saveMessage(conversationId, 'assistant', text);
      return;
    } catch (err) {
      console.error(`[evo client ${client.id}] Voice reply failed, falling back to text:`, safeError(err));
    }
  }
  try {
    await sendClientText(client, phone, text);
  } catch (err) {
    console.error(`[evo client ${client.id}] Text reply failed to ${phone}:`, safeError(err));
    throw err;
  }
  await saveMessage(conversationId, 'assistant', text);
}

async function sendMatchedMedia(client, conversationId, phone, text) {
  const tagged = await mediaByTags(client.id, text);
  const matches = await matchingMedia(client.id, text);
  for (const item of uniqueMediaItems(tagged, matches)) {
    try {
      await sendClientMedia(client, phone, item);
      await saveMessage(conversationId, 'assistant', `[Sent ${item.media_type}: ${item.title}]`);
      console.log(`[evo client ${client.id}] Sent media "${item.title}" to ${phone}.`);
    } catch (err) {
      console.error(`[evo client ${client.id}] Media send failed:`, safeError(err));
    }
  }
}

async function sendWelcomeMedia(client, conversationId, phone) {
  if (!await claimWelcomeMediaRecipient(client.id, phone)) return;
  for (const item of await welcomeMedia(client.id)) {
    try {
      await sendClientMedia(client, phone, item);
      await saveMessage(conversationId, 'assistant', `[Sent ${item.media_type}: ${item.title}]`);
      console.log(`[evo client ${client.id}] Sent welcome media "${item.title}" to new number ${phone}.`);
    } catch (err) {
      console.error(`[evo client ${client.id}] Welcome media send failed:`, safeError(err));
    }
  }
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
    if (!incoming || !incoming.phone) {
      console.log(`[evo client ${client.id}] Webhook received but no customer message was parsed. Shape: ${payloadShape(req.body)}`);
      return;
    }

    const { conversation, isNewNumber } = await findOrCreateConversation(client.id, incoming.phone, incoming.name);
    if (isNewNumber) {
      await sendWelcomeMedia(client, conversation.id, incoming.phone);
    }

    let userText = String(incoming.text || '').trim();
    let storedText = userText;
    let inboundImageBuffer = null;
    let inboundImageMimeType = null;
    if (incoming.isVoice) {
      try {
        const voice = await transcribeClientVoice(client, incoming.messageKey);
        userText = voice.text;
        storedText = `[Voice note] ${userText}`;
      } catch (err) {
        console.error(`[evo client ${client.id}] Voice transcription failed:`, safeError(err));
        await sendClientText(client, incoming.phone, "Sorry, I had trouble processing that voice note. Please send it again or type your message.");
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
    if (!userText) {
      console.log(`[evo client ${client.id}] Ignored empty message from ${incoming.phone}.`);
      return;
    }

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
    console.log(
      `[evo client ${client.id}] Conversation state for ${incoming.phone}: ` +
      `id=${conversation.id}, status=${conversation.status}, reply_mode=${conversation.reply_mode || 'auto'}, opted_out=${Boolean(conversation.opted_out_at)}`
    );

    const normalized = userText.toLowerCase();
    if (conversation.opted_out_at && RESUME.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NULL WHERE id = $1`, [conversation.id]);
      await reply(client, conversation.id, incoming.phone, "You're resubscribed. How can I help you today?");
      return;
    }
    if (conversation.opted_out_at) {
      console.log(`[evo client ${client.id}] Reply skipped for ${incoming.phone}: conversation is opted out.`);
      return;
    }
    if (OPT_OUT.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NOW() WHERE id = $1`, [conversation.id]);
      await reply(client, conversation.id, incoming.phone, "You've been unsubscribed. Reply START at any time to resume.");
      return;
    }
    if (conversation.status === 'human_takeover') {
      console.log(`[evo client ${client.id}] Reply skipped for ${incoming.phone}: conversation is in human takeover.`);
      return;
    }
    const replyMode = conversation.reply_mode || 'auto';
    if (replyMode === 'silent') {
      console.log(`[evo client ${client.id}] Reply skipped for ${incoming.phone}: reply mode is silent.`);
      return;
    }
    const replyAsVoice = shouldReplyAsVoice(replyMode, incoming.isVoice);

    if (!incoming.isImage) {
      const paymentPromptReply = await answerPayHeroPrompt({
        client,
        conversationId: conversation.id,
        customerPhone: incoming.phone,
        customerName: conversation.customer_name,
        messageText: userText,
      });
      if (paymentPromptReply) {
        await reply(client, conversation.id, incoming.phone, paymentPromptReply, false);
        return;
      }
    }

    if (!incoming.isImage && INSTALL_RE.test(userText)) {
      const intakeUrl = buildCustomerIntakeUrl(client, { phone: incoming.phone, name: conversation.customer_name });
      if (intakeUrl) {
        const answer =
          `Please complete this installation form:\n${intakeUrl}\n\n` +
          `It collects your ID scan, location and contact details for the setup team.`;
        await reply(client, conversation.id, incoming.phone, answer, replyAsVoice);
        console.log(`[evo client ${client.id}] Installation intake form link sent to ${incoming.phone}.`);
        return;
      }
    }

    if (!incoming.isImage) {
      console.log(`[evo client ${client.id}] Billing direct check for ${incoming.phone}.`);
      let billingReply = await answerBillingQuestion({ clientId: client.id, customerPhone: incoming.phone, messageText: userText });
      if (billingReply) {
        const mediaText = `${userText}\n${billingReply}`;
        billingReply = stripMediaTags(billingReply) || 'Here is the media I found for you.';
        await reply(client, conversation.id, incoming.phone, billingReply, replyAsVoice);
        await sendMatchedMedia(client, conversation.id, incoming.phone, mediaText);
        console.log(`[evo client ${client.id}] Billing reply sent to ${incoming.phone}.`);
        return;
      }
      console.log(`[evo client ${client.id}] No direct billing reply for ${incoming.phone}.`);
    }

    if (HUMAN_RE.test(userText)) {
      await markHumanTakeover(conversation.id);
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
      await reply(client, conversation.id, incoming.phone, answer, replyAsVoice);
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
    const intakeUrl = buildCustomerIntakeUrl(client, { phone: incoming.phone, name: conversation.customer_name });
    if (intakeUrl) {
      prompt += `\n\nFor new installation requests, send this intake form link: ${intakeUrl}. It collects ID scan, location and contact details.`;
    }
    if (!incoming.isImage) {
      console.log(`[evo client ${client.id}] Building billing context for ${incoming.phone}.`);
      const billingContext = await buildBillingContext({ clientId: client.id, customerPhone: incoming.phone, messageText: userText });
      if (billingContext) prompt += billingContext;
    }
    console.log(`[evo client ${client.id}] Generating AI reply for ${incoming.phone}.`);
    let aiReply;
    try {
      aiReply = incoming.isImage && inboundImageBuffer
        ? await analyzeSupportImage(prompt, recent.rows, inboundImageBuffer, inboundImageMimeType, incoming.text || '')
        : await generateAIResponse(prompt, recent.rows);
    } catch (err) {
      console.error(`[evo client ${client.id}] AI generation failed for ${incoming.phone}:`, safeError(err));
      aiReply = fallbackAiReply(client);
    }
    if (!aiReply || !aiReply.trim()) {
      console.warn(`[evo client ${client.id}] AI returned empty reply for ${incoming.phone}.`);
      return;
    }
    const mediaText = `${userText}\n${aiReply}`;
    const cleanReply = stripMediaTags(aiReply).trim() || 'Here is the media I found for you.';
    console.log(`[evo client ${client.id}] Sending AI reply to ${incoming.phone}.`);
    await reply(client, conversation.id, incoming.phone, cleanReply, replyAsVoice);
    if (!incoming.isImage) await sendMatchedMedia(client, conversation.id, incoming.phone, mediaText);
    else await sendMatchedMedia(client, conversation.id, incoming.phone, aiReply);
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
