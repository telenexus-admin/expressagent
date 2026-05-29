const express = require('express');
const db = require('../db');
const { generateAIResponse, transcribeAudio, synthesizeVoice } = require('../services/openai');
const { notifyOperatorAdmins } = require('../services/pushNotifications');
const {
  getOperatorSettings,
  parseEvolutionInbound,
  findOrCreateOperatorConversation,
  sendEvolutionText,
  sendEvolutionVoiceNote,
  downloadEvolutionAudio,
} = require('../services/evolution');

const router = express.Router();

function safeError(err) {
  return typeof err.response?.data === 'object'
    ? JSON.stringify(err.response.data)
    : (err.response?.data || err.message || 'unknown error');
}

function audioFilename(mimeType) {
  if (String(mimeType || '').includes('mpeg')) return 'voice-note.mp3';
  if (String(mimeType || '').includes('mp4')) return 'voice-note.m4a';
  if (String(mimeType || '').includes('wav')) return 'voice-note.wav';
  return 'voice-note.ogg';
}

function runAfterReply(label, task) {
  setImmediate(async () => {
    try {
      await task();
    } catch (err) {
      console.error(`${label} failed:`, safeError(err));
    }
  });
}

async function storeMessage(conversationId, role, content) {
  await db.query(
    `INSERT INTO operator_messages (conversation_id, role, content, timestamp)
     VALUES ($1, $2, $3, NOW())`,
    [conversationId, role, content]
  );
  await db.query(`UPDATE operator_conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
}

async function getRecentOperatorMessages(conversationId, limit = 7) {
  const result = await db.query(
    `SELECT role, content FROM (
       SELECT role, content, timestamp FROM operator_messages
       WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT $2
     ) messages ORDER BY timestamp ASC`,
    [conversationId, limit]
  );
  return result.rows;
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
    if (!incoming || !incoming.phone) return;

    let userText = incoming.text;
    if (incoming.isVoice) {
      try {
        const { buffer, mimeType } = await downloadEvolutionAudio(settings, incoming.messageKey);
        userText = (await transcribeAudio(buffer, audioFilename(mimeType))).trim();
        if (!userText) return;
        console.log(`Nexa transcribed voice note from ${incoming.phone}: "${userText}"`);
      } catch (err) {
        console.error(`Nexa voice note transcription failed for ${incoming.phone}:`, safeError(err));
        await sendEvolutionText(settings, incoming.phone, "Sorry, I couldn't understand that voice note. Please try again or type your message.");
        return;
      }
    }
    if (!userText || !userText.trim()) return;

    const conversation = await findOrCreateOperatorConversation(incoming.phone, incoming.name);
    const previousMessages = await getRecentOperatorMessages(conversation.id, 7);
    const alexControlled = previousMessages.some((message) => message.role === 'admin');
    await storeMessage(conversation.id, 'user', incoming.isVoice ? `[Voice note] ${userText}` : userText);
    runAfterReply('Nexus operator push notification', () => notifyOperatorAdmins({
      conversationId: conversation.id,
      customerName: conversation.customer_name,
      customerPhone: incoming.phone,
      messageText: userText,
    }));

    if (!conversation.ai_enabled || conversation.reply_mode === 'silent') {
      console.log(`Nexa reply paused for conversation ${conversation.id} (${incoming.phone}). Message saved for manual follow-up.`);
      return;
    }

    const recent = await db.query(
      `SELECT role, content FROM (
         SELECT role, content, timestamp FROM operator_messages
         WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 7
       ) messages ORDER BY timestamp ASC`,
      [conversation.id]
    );

    let prompt = `${settings.system_prompt}

Core behavior:
- Use short sentences only.
- Stay professional, calm and direct.
- Before answering, consider the last 7 messages in this chat.
- If the recent messages are only between the AI and the client, continue helping normally.
- If any recent message was from Alex/the operator/admin, acknowledge it respectfully once.
- In that case say you noticed Alex was handling the conversation, you respect that, and you can continue chatting only if the client wants while they wait for Alex.
- Do not override promises, prices or decisions Alex made.
- Do not use long lists unless the client asks.`;
    if (settings.agent_name) {
      prompt = `Your name is ${settings.agent_name}. When asked who you are, say you are ${settings.agent_name}, the Telenexus Technologies AI assistant.\n\n${prompt}`;
    }
    if (conversation.customer_name) {
      prompt += `\n\nThe person's WhatsApp display name is "${conversation.customer_name}". Use their first name naturally when helpful, but do not greet repeatedly in every message.`;
    }
    if (alexControlled) {
      prompt += `\n\nImportant: One of the last 7 messages was written by Alex/the operator. Your next reply must begin by acknowledging that Alex was handling this conversation and that you respect it. Then offer to keep the client company or answer simple questions while they wait for Alex.`;
    }

    const voiceReply = conversation.reply_mode === 'voice' || (conversation.reply_mode === 'auto' && incoming.isVoice);
    if (voiceReply) {
      prompt += `\n\nYour response will be spoken aloud as a WhatsApp voice note. Keep this reply natural, concise and easy to listen to. Avoid long lists unless necessary.`;
    }

    const reply = await generateAIResponse(prompt, recent.rows);
    if (!reply || !reply.trim()) return;
    const cleanReply = reply.trim();

    if (voiceReply) {
      try {
        const audio = await synthesizeVoice(cleanReply, 'alloy');
        await sendEvolutionVoiceNote(settings, incoming.phone, audio);
        console.log(`Nexa Evolution voice reply sent to ${incoming.phone} using mode=${conversation.reply_mode}.`);
      } catch (err) {
        console.error(`Nexa Evolution voice reply failed for ${incoming.phone}, falling back to text:`, safeError(err));
        await sendEvolutionText(settings, incoming.phone, cleanReply);
      }
    } else {
      await sendEvolutionText(settings, incoming.phone, cleanReply);
      console.log(`Nexa Evolution text reply sent to ${incoming.phone} using mode=${conversation.reply_mode}.`);
    }

    await storeMessage(conversation.id, 'assistant', voiceReply ? `[Voice reply] ${cleanReply}` : cleanReply);
  } catch (err) {
    console.error('Nexa Evolution webhook processing failed:', safeError(err));
  }
});

module.exports = router;
