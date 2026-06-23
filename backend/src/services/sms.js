const axios = require('axios');
const db = require('../db');

const BLESSED_DEFAULT_URL = 'https://sms.blessedtexts.com/api/sms/v1/sendsms';
const SAVVY_DEFAULT_URL = 'https://sms.savvybulksms.com/api/services/sendsms/';
const TALK_SASA_DEFAULT_URL = 'https://api.talksasa.com/v1/sms/send';
const SMS_PROVIDERS = ['blessed', 'blessed_text', 'savvy', 'talksasa', 'talk_sasa'];
const SAVVY_MARKER = 'savvy__';
let schemaPromise = null;

async function ensureSmsSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(40) NOT NULL DEFAULT 'blessed'`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_api_key TEXT`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(80)`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_partner_id VARCHAR(80)`);
      await db.query(`ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_sms_provider_check`);
      await db.query(`ALTER TABLE clients ADD CONSTRAINT clients_sms_provider_check CHECK (sms_provider IN ('blessed', 'blessed_text', 'savvy', 'talksasa', 'talk_sasa'))`);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function normalizeProvider(value) {
  const provider = String(value || 'blessed').trim().toLowerCase();
  if (provider === 'blessedtexts' || provider === 'blessed_text') return 'blessed';
  if (provider === 'savvy_bulk_sms' || provider === 'savvybulksms') return 'savvy';
  if (provider === 'talk_sasa' || provider === 'talk-sasa' || provider === 'talk sasa') return 'talksasa';
  return SMS_PROVIDERS.includes(provider) ? provider : 'blessed';
}

function parseSavvySender(value) {
  const sender = String(value || '');
  if (!sender.startsWith(SAVVY_MARKER)) return null;
  const encoded = sender.slice(SAVVY_MARKER.length);
  const separator = encoded.indexOf('__');
  if (separator <= 0) return null;
  const partnerId = encoded.slice(0, separator).trim();
  const senderId = encoded.slice(separator + 2).trim();
  if (!partnerId || !senderId) return null;
  return { partnerId, senderId };
}

function normalizeExplicitConfig(config = {}) {
  const source = config.client || config;
  const encodedSavvy = parseSavvySender(config.senderId || source.sms_sender_id);
  const provider = encodedSavvy ? 'savvy' : normalizeProvider(config.provider || source.sms_provider || process.env.SMS_PROVIDER);

  return {
    sms_provider: provider,
    sms_api_key: config.apiKey || source.sms_api_key,
    sms_sender_id: encodedSavvy?.senderId || config.senderId || source.sms_sender_id,
    sms_partner_id: config.partnerId || source.sms_partner_id || encodedSavvy?.partnerId,
  };
}

async function resolveClientSmsConfig(phone) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) return null;

  await ensureSmsSchema();

  const result = await db.query(
    `WITH matches AS (
       SELECT c.sms_provider, c.sms_api_key, c.sms_sender_id, c.sms_partner_id,
              1 AS priority, c.created_at AS matched_at
       FROM clients c
       WHERE regexp_replace(COALESCE(c.support_number, ''), '[^0-9]', '', 'g') = $1

       UNION ALL

       SELECT c.sms_provider, c.sms_api_key, c.sms_sender_id, c.sms_partner_id,
              2 AS priority, e.created_at AS matched_at
       FROM employees e
       JOIN clients c ON c.id = e.client_id
       WHERE regexp_replace(COALESCE(e.phone, ''), '[^0-9]', '', 'g') = $1

       UNION ALL

       SELECT c.sms_provider, c.sms_api_key, c.sms_sender_id, c.sms_partner_id,
              3 AS priority, conv.updated_at AS matched_at
       FROM conversations conv
       JOIN clients c ON c.id = conv.client_id
       WHERE regexp_replace(COALESCE(conv.customer_phone, ''), '[^0-9]', '', 'g') = $1
     )
     SELECT sms_provider, sms_api_key, sms_sender_id, sms_partner_id
     FROM matches
     ORDER BY priority ASC, matched_at DESC
     LIMIT 1`,
    [cleanPhone]
  );

  return result.rows[0] || null;
}

function requireMessage(message) {
  if (!message || !String(message).trim()) {
    throw new Error('SMS message is empty');
  }
}

function hasSMSConfig(options = {}) {
  const config = normalizeExplicitConfig(options);
  if (config.sms_provider === 'savvy') {
    return Boolean(config.sms_api_key || process.env.SAVVY_API_KEY)
      && Boolean(config.sms_partner_id || process.env.SAVVY_PARTNER_ID)
      && Boolean(config.sms_sender_id || process.env.SAVVY_SENDER_ID);
  }
  if (config.sms_provider === 'talksasa') {
    return Boolean(config.sms_api_key || process.env.TALK_SASA_API_TOKEN || process.env.TALKSASA_API_TOKEN)
      && Boolean(config.sms_sender_id || process.env.TALK_SASA_SENDER_ID || process.env.TALKSASA_SENDER_ID);
  }
  return Boolean(config.sms_api_key || process.env.BLESSED_API_KEY)
    && Boolean(config.sms_sender_id || process.env.BLESSED_SENDER_ID);
}

function blessedTextAccepted(data) {
  if (!data || typeof data !== 'object') return true;
  if (data.success === false) return false;
  if (data.status === false) return false;
  if (typeof data.status === 'string' && /fail|error|invalid/i.test(data.status)) return false;
  if (data.status_code != null) {
    const code = String(data.status_code);
    return ['1000', '1001', '200', '201'].includes(code);
  }
  return true;
}

function blessedTextError(data) {
  if (!data || typeof data !== 'object') return 'SMS provider rejected the message';
  return data.status_desc || data.message || data.error || JSON.stringify(data);
}

async function sendBlessedSms(phone, message, config = {}) {
  const apiKey = config.sms_api_key || process.env.BLESSED_API_KEY;
  const senderId = config.sms_sender_id || process.env.BLESSED_SENDER_ID;
  const url = process.env.BLESSED_API_URL || BLESSED_DEFAULT_URL;

  if (!apiKey || !senderId) {
    throw new Error('Blessed Text is not configured: API key and sender ID are required');
  }

  const response = await axios.post(
    url,
    {
      api_key: apiKey,
      sender_id: senderId,
      message: String(message),
      phone,
    },
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
    }
  );

  if (!blessedTextAccepted(response.data)) {
    throw new Error(blessedTextError(response.data));
  }
  return response.data;
}

async function sendSavvySms(phone, message, config = {}) {
  const apiKey = config.sms_api_key || process.env.SAVVY_API_KEY;
  const partnerId = config.sms_partner_id || process.env.SAVVY_PARTNER_ID;
  const senderId = config.sms_sender_id || process.env.SAVVY_SENDER_ID;
  const url = process.env.SAVVY_API_URL || SAVVY_DEFAULT_URL;

  if (!apiKey || !partnerId || !senderId) {
    throw new Error('Savvy Bulk SMS is not configured: API key, Partner ID and Sender ID are required');
  }

  const response = await axios.post(
    url,
    {
      apikey: apiKey,
      partnerID: partnerId,
      message: String(message),
      shortcode: senderId,
      mobile: phone,
    },
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
    }
  );

  const providerResponses = Array.isArray(response.data?.responses) ? response.data.responses : [];
  const failed = providerResponses.find((item) => {
    const code = Number(item?.['respose-code'] ?? item?.['response-code']);
    return code !== 200;
  });

  if (!providerResponses.length) {
    throw new Error(`Savvy Bulk SMS returned an unexpected response: ${JSON.stringify(response.data)}`);
  }
  if (failed) {
    throw new Error(failed['response-description'] || `Savvy Bulk SMS failed with code ${failed['respose-code'] ?? failed['response-code']}`);
  }

  return response.data;
}

function genericProviderAccepted(data) {
  if (!data || typeof data !== 'object') return true;
  if (data.success === false || data.status === false || data.ok === false) return false;
  const status = String(data.status || data.code || data.status_code || '').toLowerCase();
  return !/fail|error|invalid|reject/.test(status);
}

function genericProviderError(data) {
  if (!data || typeof data !== 'object') return 'SMS provider rejected the message';
  return data.message || data.error || data.error_message || data.description || JSON.stringify(data);
}

async function sendTalkSasaSms(phone, message, config = {}) {
  const apiToken = config.sms_api_key || process.env.TALK_SASA_API_TOKEN || process.env.TALKSASA_API_TOKEN;
  const senderId = config.sms_sender_id || process.env.TALK_SASA_SENDER_ID || process.env.TALKSASA_SENDER_ID;
  const url = process.env.TALK_SASA_API_URL || process.env.TALKSASA_API_URL || TALK_SASA_DEFAULT_URL;

  if (!apiToken || !senderId) {
    throw new Error('Talk Sasa is not configured: API token and Sender ID are required');
  }

  const response = await axios.post(
    url,
    {
      sender_id: senderId,
      sender: senderId,
      from: senderId,
      recipient: phone,
      phone,
      mobile: phone,
      to: phone,
      message: String(message),
    },
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15000,
    }
  );

  if (!genericProviderAccepted(response.data)) {
    throw new Error(genericProviderError(response.data));
  }
  return response.data;
}

async function sendOne(phone, message, explicitConfig) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) throw new Error('No recipient phone number');

  const config = explicitConfig
    ? normalizeExplicitConfig(explicitConfig)
    : (await resolveClientSmsConfig(cleanPhone)) || {};
  const provider = normalizeProvider(config.sms_provider || process.env.SMS_PROVIDER || 'blessed');

  if (provider === 'savvy') {
    return sendSavvySms(cleanPhone, message, config);
  }
  if (provider === 'talksasa') {
    return sendTalkSasaSms(cleanPhone, message, config);
  }
  return sendBlessedSms(cleanPhone, message, config);
}

// Sends an SMS using the provider selected for the Nexa client.
// When a client config is not supplied, Nexa resolves it from the recipient number.
async function sendSMS(phone, message, clientConfig = null) {
  requireMessage(message);
  await ensureSmsSchema();

  const recipients = (Array.isArray(phone) ? phone : [phone])
    .map(normalizePhone)
    .filter(Boolean);

  if (!recipients.length) throw new Error('No recipient phone number');

  const results = await Promise.all(
    recipients.map((recipient) => sendOne(recipient, message, clientConfig))
  );

  return Array.isArray(phone) ? results : results[0];
}

module.exports = {
  SMS_PROVIDERS,
  ensureSmsSchema,
  sendSMS,
  hasSMSConfig,
  normalizeProvider,
  parseSavvySender,
  BLESSED_DEFAULT_URL,
  SAVVY_DEFAULT_URL,
  TALK_SASA_DEFAULT_URL,
};
