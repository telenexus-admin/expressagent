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

async function transcribeEvolutionVoice(settings, messageKey, phone) {
  const first = await downloadEvolutionAudio(settings, messageKey);
  try {
    const text = (await transcribeAudio(first.buffer, audioFilename(first.mimeType), first.mimeType)).trim();
    if (text) return text;
    throw new Error('Voice note transcription was empty.');
  } catch (err) {
    console.warn(`Nexa original voice transcription failed for ${phone}, retrying as MP4:`, safeError(err));
    const fallback = await downloadEvolutionAudio(settings, messageKey, { convertToMp4: true });
    const text = (await transcribeAudio(fallback.buffer, audioFilename(fallback.mimeType || 'audio/mp4'), fallback.mimeType || 'audio/mp4')).trim();
    if (!text) throw new Error('Voice note transcription was empty after MP4 retry.');
    return text;
  }
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

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function detectReplyPreference(text) {
  const value = String(text || '').trim().toLowerCase();
  if (/\b(voice|voice note|vn|audio)\b/.test(value)) return 'voice';
  if (/\b(text|message|chat|typing|type)\b/.test(value)) return 'text';
  return null;
}

function wantsAlexCall(text) {
  const value = String(text || '').toLowerCase();
  return /\b(call|phone|ring|meeting|schedule|book|appointment|talk to alex|speak to alex)\b/.test(value)
    && /\b(alex|call|meeting|schedule|book|appointment)\b/.test(value);
}

function extractPhone(text) {
  const match = String(text || '').match(/(?:\+?\d[\d\s().-]{6,}\d)/);
  if (!match) return null;
  return match[0].replace(/[^\d+]/g, '');
}

function extractTimeHint(text) {
  const match = String(text || '').match(/\b(today|tomorrow|morning|afternoon|evening|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  return match ? match[0] : null;
}

function confirmsCurrentNumber(text) {
  return /\b(yes|yeah|yep|sure|okay|ok|use it|that number|this number|same number|whatsapp number|my whatsapp)\b/i.test(String(text || ''));
}

async function handleCallScheduleRequest({ settings, conversation, userText, incomingPhone }) {
  const schedulingInProgress = Boolean(conversation.call_schedule_requested_at && !conversation.call_schedule_notified_at);
  if (!wantsAlexCall(userText) && !schedulingInProgress) return false;

  const givenPhone = extractPhone(userText) || (schedulingInProgress && confirmsCurrentNumber(userText) ? incomingPhone : null);
  if (!givenPhone) {
    const reply = `Should Alex call you on this WhatsApp number, +${incomingPhone}, or another number? What time works best?`;
    await sendEvolutionText(settings, incomingPhone, reply);
    await storeMessage(conversation.id, 'assistant', reply);
    await db.query(
      `UPDATE operator_conversations SET call_schedule_requested_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conversation.id]
    );
    return true;
  }

  const timeHint = extractTimeHint(userText);
  const notificationBody = `${conversation.customer_name ? `${conversation.customer_name} ` : ''}requested a call. Number: ${givenPhone}${timeHint ? `. Time: ${timeHint}` : ''}`;
  if (settings.owner_phone && !conversation.call_schedule_notified_at) {
    const nameLine = conversation.customer_name ? `Name: ${conversation.customer_name}\n` : '';
    const timeLine = timeHint ? `Preferred time: ${timeHint}\n` : '';
    await sendEvolutionText(
      settings,
      settings.owner_phone,
      `Nexus call request for Alex.\n\n${nameLine}Client WhatsApp: +${incomingPhone}\nCall number: ${givenPhone}\n${timeLine}Message: ${userText}`
    );
    await db.query(
      `UPDATE operator_conversations SET call_schedule_notified_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conversation.id]
    );
  }
  runAfterReply('Nexus call schedule push notification', () => notifyOperatorAdmins({
    conversationId: conversation.id,
    customerName: conversation.customer_name,
    customerPhone: incomingPhone,
    messageText: userText,
    title: 'Nexus call scheduled',
    body: notificationBody,
    tag: `operator-call-schedule-${conversation.id}`,
  }));

  const reply = timeHint
    ? `Done. I have shared +${givenPhone} and your preferred time with Alex.`
    : `Done. I have shared +${givenPhone} with Alex.`;
  await sendEvolutionText(settings, incomingPhone, reply);
  await storeMessage(conversation.id, 'assistant', reply);
  return true;
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
        userText = await transcribeEvolutionVoice(settings, incoming.messageKey, incoming.phone);
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
    const preferredMode = detectReplyPreference(userText);
    if (preferredMode && conversation.reply_mode !== preferredMode) {
      const updated = await db.query(
        `UPDATE operator_conversations
         SET reply_mode = $1, preference_answered_at = NOW(), updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [preferredMode, conversation.id]
      );
      Object.assign(conversation, updated.rows[0]);
    }
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

    if (await handleCallScheduleRequest({ settings, conversation, userText, incomingPhone: incoming.phone })) {
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
- Write at most two short sentences per reply unless the client asks for details.
- Stay professional, calm and direct.
- Before answering, consider the last 7 messages in this chat.
- If the recent messages are only between the AI and the client, continue helping normally.
- If any recent message was from Alex/the operator/admin, acknowledge it respectfully once.
- In that case say you noticed Alex was handling the conversation, you respect that, and you can continue chatting only if the client wants while they wait for Alex.
- When the client shows interest, ask if they would like you to schedule a call with Alex.
- If they want a call, ask for the phone number Alex should call and a preferred time.
- Do not override promises, prices or decisions Alex made.
- Do not use long lists unless the client asks.`;
    if (settings.agent_name) {
      prompt = `Your name is ${settings.agent_name}. When asked who you are, say you are ${settings.agent_name}, the Telenexus Technologies AI assistant.\n\n${prompt}`;
    }
    if (conversation.customer_name) {
      const name = firstName(conversation.customer_name);
      prompt += `\n\nThe person's WhatsApp display name is "${conversation.customer_name}". Address them as "${name}" naturally when it fits. Do not overuse the name. Never ask for their name because WhatsApp already provided it. If you need lead details, ask for company/ISP name, location or preferred contact only.`;
    } else {
      prompt += `\n\nDo not ask for a personal name unless it is truly needed. Prioritize company/ISP name, location and contact details.`;
    }
    if (alexControlled) {
      prompt += `\n\nImportant: One of the last 7 messages was written by Alex/the operator. Your next reply must begin by acknowledging that Alex was handling this conversation and that you respect it. Then offer to keep the client company or answer simple questions while they wait for Alex.`;
    }
    if (!conversation.preference_asked_at && !conversation.preference_answered_at) {
      prompt += `\n\nAt the end of this reply, ask one short question: "Do you prefer text messages or voice notes?"`;
    } else if (conversation.reply_mode === 'text') {
      prompt += `\n\nThe person prefers text messages. Reply by text unless they ask otherwise.`;
    } else if (conversation.reply_mode === 'voice') {
      prompt += `\n\nThe person prefers voice notes. Reply by voice unless they ask otherwise.`;
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
    if (!conversation.preference_asked_at && !conversation.preference_answered_at) {
      await db.query(
        `UPDATE operator_conversations SET preference_asked_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [conversation.id]
      );
    }
  } catch (err) {
    console.error('Nexa Evolution webhook processing failed:', safeError(err));
  }
});

module.exports = router;
