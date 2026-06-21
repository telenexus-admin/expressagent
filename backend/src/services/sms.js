const axios = require('axios');
const db = require('../db');

const BLESSED_DEFAULT_URL = 'https://sms.blessedtexts.com/api/sms/v1/sendsms';
const SAVVY_DEFAULT_URL = 'https://sms.savvybulksms.com/api/services/sendsms/';
const SMS_PROVIDERS = ['blessed', 'savvy'];
let schemaReady = false;

async function ensureSmsSchema() {
  if (schemaReady) return;

  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(20) NOT NULL DEFAULT 'blessed'`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_api_key TEXT`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(80)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_partner_id VARCHAR(80)`);
  await db.query(`ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_sms_provider_check`);
  await db.query(`ALTER TABLE clients ADD CONSTRAINT clients_sms_provider_check CHECK (sms_provider IN ('blessed', 'savvy'))`);

  schemaReady = true;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  return SMS_PROVIDERS.includes(value) ? value : 'blessed';
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

  const providerResponses = Array.isArray(response.data?.responses)
    ? response.data.responses
    : [];
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

async function sendOne(phone, message, explicitConfig) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) throw new Error('No recipient phone number');

  const config = explicitConfig || (await resolveClientSmsConfig(cleanPhone)) || {};
  const provider = normalizeProvider(config.sms_provider || process.env.SMS_PROVIDER || 'blessed');

  if (provider === 'savvy') {
    return sendSavvySms(cleanPhone, message, config);
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
};
