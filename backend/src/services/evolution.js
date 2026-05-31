const axios = require('axios');
const crypto = require('crypto');
const db = require('../db');

let tablesReady = false;

const DEFAULT_NEXA_PROMPT = `You are Nexa, the official AI assistant for Telenexus Technologies in Kenya.
Use short sentences. Stay professional, calm and direct.
Write at most two short sentences per reply unless the user asks for details.
You speak naturally and warmly through WhatsApp.
Your role is to introduce Nexa's AI automation and ISP support capabilities, understand what an ISP or business needs, answer questions clearly, and capture serious leads for follow-up.
Keep messages concise and mobile-friendly. You may communicate in English or Kiswahili depending on the user's language.
Do not claim a feature is already active for a prospect unless it has been confirmed. When the user wants a demo, quotation or onboarding, ask for their company/ISP name, location and preferred contact details.`;

async function ensureOperatorAgentTables() {
  if (tablesReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS operator_agent_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      evolution_base_url TEXT,
      evolution_api_key TEXT,
      evolution_instance VARCHAR(120),
      webhook_secret VARCHAR(120) NOT NULL,
      agent_name VARCHAR(80) NOT NULL DEFAULT 'Nexa',
      system_prompt TEXT NOT NULL,
      owner_phone VARCHAR(50),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`
    INSERT INTO operator_agent_settings (id, webhook_secret, system_prompt)
    VALUES (1, $1, $2)
    ON CONFLICT (id) DO NOTHING
  `, [crypto.randomBytes(30).toString('hex'), DEFAULT_NEXA_PROMPT]);
  await db.query(`
    CREATE TABLE IF NOT EXISTS operator_conversations (
      id SERIAL PRIMARY KEY,
      customer_phone VARCHAR(80) NOT NULL UNIQUE,
      customer_name VARCHAR(255),
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      reply_mode VARCHAR(20) NOT NULL DEFAULT 'auto' CHECK (reply_mode IN ('auto', 'text', 'voice', 'silent')),
      preference_asked_at TIMESTAMP WITH TIME ZONE,
      preference_answered_at TIMESTAMP WITH TIME ZONE,
      follow_up_sent_at TIMESTAMP WITH TIME ZONE,
      call_schedule_requested_at TIMESTAMP WITH TIME ZONE,
      call_schedule_notified_at TIMESTAMP WITH TIME ZONE,
      internal_note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE operator_conversations ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE operator_conversations ADD COLUMN IF NOT EXISTS reply_mode VARCHAR(20) NOT NULL DEFAULT 'auto'`);
  await db.query(`ALTER TABLE operator_conversations ADD COLUMN IF NOT EXISTS preference_asked_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE operator_conversations ADD COLUMN IF NOT EXISTS preference_answered_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE operator_conversations ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE operator_conversations ADD COLUMN IF NOT EXISTS call_schedule_requested_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE operator_conversations ADD COLUMN IF NOT EXISTS call_schedule_notified_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE operator_conversations ADD COLUMN IF NOT EXISTS internal_note TEXT`);
  await db.query(`ALTER TABLE operator_conversations DROP CONSTRAINT IF EXISTS operator_conversations_reply_mode_check`);
  await db.query(`ALTER TABLE operator_conversations ADD CONSTRAINT operator_conversations_reply_mode_check CHECK (reply_mode IN ('auto', 'text', 'voice', 'silent'))`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS operator_messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES operator_conversations(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'admin')),
      content TEXT NOT NULL,
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_operator_messages_conversation ON operator_messages(conversation_id, timestamp)`);
  tablesReady = true;
}

async function getOperatorSettings({ includeKey = false } = {}) {
  await ensureOperatorAgentTables();
  const result = await db.query(`SELECT * FROM operator_agent_settings WHERE id = 1`);
  const settings = result.rows[0];
  if (!includeKey && settings) {
    settings.evolution_api_key_configured = Boolean(settings.evolution_api_key);
    delete settings.evolution_api_key;
  }
  return settings;
}

function cleanBaseUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function cleanNumber(number) {
  return String(number || '').replace(/@s\.whatsapp\.net$/i, '').replace(/[^0-9]/g, '');
}

function evolutionAuth(settings) {
  const baseUrl = cleanBaseUrl(settings.evolution_base_url);
  const instance = String(settings.evolution_instance || '').trim();
  const apiKey = settings.evolution_api_key;
  if (!baseUrl || !instance || !apiKey) throw new Error('Evolution API URL, instance and API key must be configured.');
  return { baseUrl, instance, headers: { apikey: apiKey, 'Content-Type': 'application/json' } };
}

async function sendEvolutionText(settings, number, text) {
  const { baseUrl, instance, headers } = evolutionAuth(settings);
  const phone = cleanNumber(number);
  if (!phone) throw new Error('A valid WhatsApp phone number is required.');
  const url = `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`;
  return axios.post(url, { number: phone, text }, { headers, timeout: 30000 });
}

async function sendEvolutionButtons(settings, number, { title, description, footer, buttons }) {
  const { baseUrl, instance, headers } = evolutionAuth(settings);
  const phone = cleanNumber(number);
  if (!phone) throw new Error('A valid WhatsApp phone number is required.');
  const safeButtons = (buttons || []).slice(0, 3).map((button) => ({
    type: 'reply',
    title: String(button.title || button.displayText || '').slice(0, 20),
    displayText: String(button.displayText || button.title || '').slice(0, 20),
    id: String(button.id || button.buttonId || '').slice(0, 256),
  })).filter((button) => button.displayText && button.id);
  if (safeButtons.length === 0) throw new Error('At least one Evolution button is required.');

  const url = `${baseUrl}/message/sendButtons/${encodeURIComponent(instance)}`;
  return axios.post(url, {
    number: phone,
    title,
    description,
    footer,
    buttons: safeButtons,
  }, { headers, timeout: 30000 });
}

async function sendEvolutionVoiceNote(settings, number, audioBuffer) {
  const { baseUrl, instance, headers } = evolutionAuth(settings);
  const phone = cleanNumber(number);
  if (!phone) throw new Error('A valid WhatsApp phone number is required.');
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) throw new Error('Audio buffer is empty.');
  const url = `${baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`;
  return axios.post(url, {
    number: phone,
    audio: audioBuffer.toString('base64'),
    delay: 400,
  }, { headers, timeout: 60000 });
}

function getMediaBase64(responseData) {
  if (typeof responseData === 'string') return responseData;
  return (
    responseData?.base64 ||
    responseData?.data?.base64 ||
    responseData?.media?.base64 ||
    responseData?.data?.media?.base64 ||
    null
  );
}

async function downloadEvolutionAudio(settings, messageKey) {
  const { baseUrl, instance, headers } = evolutionAuth(settings);
  if (!messageKey?.id) throw new Error('Incoming voice note has no Evolution message id.');
  const key = { id: messageKey.id };
  if (messageKey.remoteJid) key.remoteJid = messageKey.remoteJid;
  if (typeof messageKey.fromMe === 'boolean') key.fromMe = messageKey.fromMe;
  const url = `${baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`;
  const response = await axios.post(url, {
    message: { key },
    convertToMp4: false,
  }, { headers, timeout: 60000 });
  let base64 = getMediaBase64(response.data);
  if (!base64) throw new Error('Evolution returned no audio data for the voice note.');
  const mimeType = response.data?.mimetype || response.data?.mimeType || response.data?.data?.mimetype || 'audio/ogg';
  if (base64.includes(',')) base64 = base64.split(',', 2)[1];
  return { buffer: Buffer.from(base64, 'base64'), mimeType };
}

async function setEvolutionWebhook(settings, webhookUrl) {
  const { baseUrl, instance, headers } = evolutionAuth(settings);
  const url = `${baseUrl}/webhook/set/${encodeURIComponent(instance)}`;
  return axios.post(url, {
    webhook: {
      enabled: true,
      url: webhookUrl,
      webhookByEvents: false,
      webhookBase64: false,
      events: ['MESSAGES_UPSERT'],
    },
  }, { headers, timeout: 30000 });
}

function parseEvolutionInbound(payload) {
  const event = String(payload?.event || '').toLowerCase();
  if (event && !event.includes('messages.upsert') && !event.includes('messages_upsert')) return null;
  const data = payload?.data || payload;
  const key = data?.key || data?.data?.key || {};
  if (key.fromMe === true) return null;
  const remoteJid = key.remoteJid || data?.remoteJid || '';
  if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter')) return null;
  const message = data?.message || data?.data?.message || {};
  const isVoice = Boolean(message.audioMessage || message.voiceMessage);
  const isImage = Boolean(message.imageMessage);
  const mediaMimeType = message.imageMessage?.mimetype || message.audioMessage?.mimetype || message.voiceMessage?.mimetype || null;
  const buttonResponse = message.buttonsResponseMessage || message.templateButtonReplyMessage || message.interactiveResponseMessage;
  const selectedButtonId = (
    buttonResponse?.selectedButtonId ||
    buttonResponse?.selectedId ||
    buttonResponse?.id ||
    buttonResponse?.nativeFlowResponseMessage?.name ||
    ''
  );
  const selectedButtonText = (
    buttonResponse?.selectedDisplayText ||
    buttonResponse?.selectedButtonText?.displayText ||
    buttonResponse?.displayText ||
    buttonResponse?.title ||
    ''
  );
  const text = (
    selectedButtonText ||
    selectedButtonId ||
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    data?.body ||
    ''
  ).trim();
  if (!text && !isVoice && !isImage) return null;
  return {
    phone: cleanNumber(remoteJid),
    name: data?.pushName || data?.data?.pushName || payload?.senderName || null,
    text,
    isVoice,
    isImage,
    mediaMimeType,
    messageKey: key,
  };
}

async function findOrCreateOperatorConversation(phone, name) {
  await ensureOperatorAgentTables();
  const existing = await db.query(`SELECT * FROM operator_conversations WHERE customer_phone = $1 LIMIT 1`, [phone]);
  if (existing.rows.length) {
    if (name && name !== existing.rows[0].customer_name) {
      const updated = await db.query(`UPDATE operator_conversations SET customer_name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [name, existing.rows[0].id]);
      return updated.rows[0];
    }
    return existing.rows[0];
  }
  const inserted = await db.query(
    `INSERT INTO operator_conversations (customer_phone, customer_name) VALUES ($1, $2) RETURNING *`,
    [phone, name || null]
  );
  return inserted.rows[0];
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function followUpText(conversation) {
  const name = firstName(conversation.customer_name);
  const greeting = name ? `Hi ${name}.` : 'Hi.';
  return `${greeting} Just checking if you are still there. Would you like to continue here, or should I help schedule a call with Alex?`;
}

let followUpTimer = null;
let followUpRunning = false;

async function runOperatorFollowUps() {
  if (followUpRunning) return;
  followUpRunning = true;
  try {
    const settings = await getOperatorSettings({ includeKey: true });
    if (!settings?.enabled) return;

    const result = await db.query(`
      WITH last_assistant AS (
        SELECT conversation_id, MAX(timestamp) AS last_assistant_at
        FROM operator_messages
        WHERE role = 'assistant'
          AND content NOT LIKE '[Auto follow-up]%'
        GROUP BY conversation_id
      )
      SELECT c.*, la.last_assistant_at
      FROM operator_conversations c
      JOIN last_assistant la ON la.conversation_id = c.id
      WHERE c.ai_enabled = TRUE
        AND c.reply_mode <> 'silent'
        AND la.last_assistant_at <= NOW() - INTERVAL '4 minutes'
        AND (c.follow_up_sent_at IS NULL OR c.follow_up_sent_at < la.last_assistant_at)
        AND NOT EXISTS (
          SELECT 1 FROM operator_messages m
          WHERE m.conversation_id = c.id
            AND m.timestamp > la.last_assistant_at
            AND m.role IN ('user', 'admin')
        )
      ORDER BY la.last_assistant_at ASC
      LIMIT 20
    `);

    for (const conversation of result.rows) {
      const message = followUpText(conversation);
      try {
        await sendEvolutionText(settings, conversation.customer_phone, message);
        await db.query(
          `INSERT INTO operator_messages (conversation_id, role, content, timestamp)
           VALUES ($1, 'assistant', $2, NOW())`,
          [conversation.id, `[Auto follow-up] ${message}`]
        );
        await db.query(
          `UPDATE operator_conversations SET follow_up_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [conversation.id]
        );
      } catch (err) {
        console.error(`Nexus auto follow-up failed for conversation ${conversation.id}:`, err.response?.data || err.message);
      }
    }
  } catch (err) {
    console.error('Nexus auto follow-up scanner failed:', err.message);
  } finally {
    followUpRunning = false;
  }
}

function startOperatorFollowUpScheduler() {
  if (followUpTimer) return;
  runOperatorFollowUps();
  followUpTimer = setInterval(runOperatorFollowUps, 60 * 1000);
  console.log('Nexus operator follow-up scheduler started.');
}

module.exports = {
  DEFAULT_NEXA_PROMPT,
  ensureOperatorAgentTables,
  getOperatorSettings,
  sendEvolutionText,
  sendEvolutionButtons,
  sendEvolutionVoiceNote,
  downloadEvolutionAudio,
  setEvolutionWebhook,
  parseEvolutionInbound,
  findOrCreateOperatorConversation,
  startOperatorFollowUpScheduler,
};
