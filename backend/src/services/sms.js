const axios = require('axios');

const DEFAULT_URL = 'https://sms.blessedtexts.com/api/sms/v1/sendsms';

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

// Send an SMS via Blessed Texts. `phone` may be a single MSISDN or an array.
// Returns the provider response on success; throws on failure.
async function sendSMS(phone, message) {
  const apiKey = process.env.BLESSED_API_KEY;
  const senderId = process.env.BLESSED_SENDER_ID;
  const url = process.env.BLESSED_API_URL || DEFAULT_URL;

  if (!apiKey || !senderId) {
    throw new Error('SMS not configured: BLESSED_API_KEY and BLESSED_SENDER_ID required');
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

module.exports = { sendSMS };
