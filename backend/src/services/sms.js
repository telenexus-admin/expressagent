const axios = require('axios');

const BLESSED_DEFAULT_URL = 'https://sms.blessedtexts.com/api/sms/v1/sendsms';
const SAVVY_DEFAULT_URL = 'https://sms.savvybulksms.com/api/services/sendsms/';

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function normalizeProvider(value) {
  const provider = String(value || 'blessed_text').trim().toLowerCase();
  if (provider === 'blessed' || provider === 'blessedtexts' || provider === 'blessed_text') return 'blessed_text';
  if (provider === 'savvy' || provider === 'savvy_bulk_sms' || provider === 'savvybulksms') return 'savvy';
  return provider;
}

function resolveConfig(options = {}) {
  const client = options.client || {};
  const provider = normalizeProvider(
    options.provider || client.sms_provider || process.env.SMS_PROVIDER || 'blessed_text'
  );
  const isSavvy = provider === 'savvy';
  return {
    provider,
    apiKey: options.apiKey || client.sms_api_key || (isSavvy ? process.env.SAVVY_API_KEY : process.env.BLESSED_API_KEY),
    senderId: options.senderId || client.sms_sender_id || (isSavvy ? process.env.SAVVY_SENDER_ID : process.env.BLESSED_SENDER_ID),
    partnerId: options.partnerId || client.sms_partner_id || process.env.SAVVY_PARTNER_ID,
    url: options.url || (isSavvy
      ? (process.env.SAVVY_API_URL || SAVVY_DEFAULT_URL)
      : (process.env.BLESSED_API_URL || BLESSED_DEFAULT_URL)),
  };
}

function hasSMSConfig(options = {}) {
  const config = resolveConfig(options);
  if (config.provider === 'savvy') {
    return Boolean(config.apiKey && config.partnerId && config.senderId);
  }
  return config.provider === 'blessed_text' && Boolean(config.apiKey && config.senderId);
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

async function sendBlessedText(recipients, message, config) {
  if (!config.apiKey || !config.senderId) {
    throw new Error('SMS not configured: Blessed Text API key and sender ID required');
  }

  const response = await axios.post(
    config.url,
    {
      api_key: config.apiKey,
      sender_id: config.senderId,
      message: String(message),
      phone: recipients.join(','),
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

function savvyResponseError(data) {
  const responses = Array.isArray(data?.responses) ? data.responses : [];
  if (!responses.length) return `Savvy Bulk SMS returned an unexpected response: ${JSON.stringify(data)}`;
  const failed = responses.find((item) => {
    const code = Number(item?.['respose-code'] ?? item?.['response-code']);
    return code !== 200;
  });
  if (!failed) return null;
  return failed['response-description'] || `Savvy Bulk SMS failed with code ${failed['respose-code'] ?? failed['response-code']}`;
}

async function sendSavvyOne(recipient, message, config) {
  if (!config.apiKey || !config.partnerId || !config.senderId) {
    throw new Error('SMS not configured: Savvy API key, Partner ID and Sender ID / Shortcode required');
  }

  const response = await axios.post(
    config.url,
    {
      apikey: config.apiKey,
      partnerID: config.partnerId,
      message: String(message),
      shortcode: config.senderId,
      mobile: recipient,
    },
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
    }
  );

  const error = savvyResponseError(response.data);
  if (error) throw new Error(error);
  return response.data;
}

// Sends through the provider selected for the client.
// Existing Blessed Text callers remain compatible.
async function sendSMS(phone, message, options = {}) {
  if (!message || !String(message).trim()) throw new Error('SMS message is empty');

  const config = resolveConfig(options);
  const recipients = (Array.isArray(phone) ? phone : [phone])
    .map(normalizePhone)
    .filter(Boolean);

  if (!recipients.length) throw new Error('No recipient phone number');

  if (config.provider === 'savvy') {
    const results = await Promise.all(
      recipients.map((recipient) => sendSavvyOne(recipient, message, config))
    );
    return Array.isArray(phone) ? results : results[0];
  }

  if (config.provider !== 'blessed_text') {
    throw new Error(`Unsupported SMS provider: ${config.provider}`);
  }

  return sendBlessedText(recipients, message, config);
}

module.exports = {
  sendSMS,
  hasSMSConfig,
  normalizeProvider,
  BLESSED_DEFAULT_URL,
  SAVVY_DEFAULT_URL,
};
