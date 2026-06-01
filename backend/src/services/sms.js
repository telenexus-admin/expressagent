const axios = require('axios');

const DEFAULT_URL = 'https://sms.blessedtexts.com/api/sms/v1/sendsms';

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function envConfig() {
  return {
    provider: 'blessed_text',
    apiKey: process.env.BLESSED_API_KEY,
    senderId: process.env.BLESSED_SENDER_ID,
    url: process.env.BLESSED_API_URL || DEFAULT_URL,
  };
}

function normalizeProvider(value) {
  const provider = String(value || 'blessed_text').trim().toLowerCase();
  if (provider === 'blessed' || provider === 'blessedtexts') return 'blessed_text';
  return provider;
}

function resolveConfig(options = {}) {
  const fallback = envConfig();
  const client = options.client || {};
  return {
    provider: normalizeProvider(options.provider || client.sms_provider || fallback.provider),
    apiKey: options.apiKey || client.sms_api_key || fallback.apiKey,
    senderId: options.senderId || client.sms_sender_id || fallback.senderId,
    url: options.url || process.env.BLESSED_API_URL || DEFAULT_URL,
  };
}

function hasSMSConfig(options = {}) {
  const config = resolveConfig(options);
  return config.provider === 'blessed_text' && Boolean(config.apiKey && config.senderId);
}

// Send an SMS via Blessed Texts. `phone` may be a single MSISDN or an array.
// Returns the provider response on success; throws on failure.
async function sendSMS(phone, message, options = {}) {
  const { provider, apiKey, senderId, url } = resolveConfig(options);

  if (provider !== 'blessed_text') {
    throw new Error('Unsupported SMS provider');
  }

  if (!apiKey || !senderId) {
    throw new Error('SMS not configured: Blessed Text API key and sender ID required');
  }

  const phones = Array.isArray(phone)
    ? phone.map(normalizePhone).filter(Boolean).join(',')
    : normalizePhone(phone);

  if (!phones) throw new Error('No recipient phone number');
  if (!message || !message.trim()) throw new Error('SMS message is empty');

  const res = await axios.post(
    url,
    {
      api_key: apiKey,
      sender_id: senderId,
      message,
      phone: phones,
    },
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
    }
  );

  return res.data;
}

module.exports = { sendSMS, hasSMSConfig, DEFAULT_URL };
