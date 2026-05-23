const axios = require('axios');
const crypto = require('crypto');
const db = require('../db');

let tablesReady = false;

const DEFAULT_NEXA_PROMPT = `You are Nexa, the official AI assistant for Telenexus Technologies in Kenya.
You speak naturally, professionally and warmly through WhatsApp.
Your role is to introduce Nexa's AI automation and ISP support capabilities, understand what an ISP or business needs, answer questions clearly, and capture serious leads for follow-up.
Keep messages concise and mobile-friendly. You may communicate in English or Kiswahili depending on the user's language.
Do not claim a feature is already active for a prospect unless it has been confirmed. When the user wants a demo, quotation or onboarding, ask for their name, company/ISP name, location and preferred contact details.`;

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
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
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

async function sendEvolutionText(settings, number, text) {
  const baseUrl = cleanBaseUrl(settings.evolution_base_url);
  const instance = String(settings.evolution_instance || '').trim();
  const apiKey = settings.evolution_api_key;
  if (!baseUrl || !instance || !apiKey) throw new Error('Evolution API URL, instance and API key must be configured.');
  const phone = cleanNumber(number);
  if (!phone) throw new Error('A valid WhatsApp phone number is required.');
  const url = `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`;
  return axios.post(url, { number: phone, text }, {
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

function parseEvolutionInbound(payload) {
  const event = String(payload?.event || '').toLowerCase();
  if (event && !event.includes('messages.upsert') && !event.includes('messages_upsert')) return null;
  const data = payload?.data || payload;
  const key = data?.key || data?.data?.key || {};
  if (key.fromMe === true) return null;
  const remoteJid = key.remoteJid || data?.remoteJid || '';
  if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) return null;
  const message = data?.message || data?.data?.message || {};
  const text = (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    data?.body ||
    ''
  ).trim();
  if (!text) return null;
  return {
    phone: cleanNumber(remoteJid),
    name: data?.pushName || data?.data?.pushName || payload?.senderName || null,
    text,
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

module.exports = {
  DEFAULT_NEXA_PROMPT,
  ensureOperatorAgentTables,
  getOperatorSettings,
  sendEvolutionText,
  parseEvolutionInbound,
  findOrCreateOperatorConversation,
};
