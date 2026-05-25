const axios = require('axios');

function providerConfig() {
  const baseUrl = String(process.env.EVOLUTION_API_URL || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env.EVOLUTION_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Platform Evolution API URL and API key are not configured.');
  }
  return { baseUrl, headers: { apikey: apiKey, 'Content-Type': 'application/json' } };
}

function cleanNumber(number) {
  return String(number || '').replace(/@s\.whatsapp\.net$/i, '').replace(/[^0-9]/g, '');
}

function clientSettings(client) {
  const { baseUrl, headers } = providerConfig();
  const instance = String(client.evolution_instance_name || '').trim();
  if (!instance) throw new Error('Evolution instance is missing for this client.');
  return { baseUrl, headers, instance };
}

async function setClientWebhook(client) {
  const { baseUrl, headers, instance } = clientSettings(client);
  const publicUrl = String(process.env.PUBLIC_BACKEND_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
  if (!publicUrl) throw new Error('PUBLIC_BACKEND_URL or FRONTEND_URL is required before activating Evolution routing.');
  const callback = `${publicUrl}/webhook/evolution/client/${client.id}?token=${encodeURIComponent(client.evolution_webhook_secret)}`;
  await axios.post(
    `${baseUrl}/webhook/set/${encodeURIComponent(instance)}`,
    {
      webhook: {
        enabled: true,
        url: callback,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['MESSAGES_UPSERT'],
      },
    },
    { headers, timeout: 30000 }
  );
  return callback;
}

async function sendClientText(client, number, text) {
  const { baseUrl, headers, instance } = clientSettings(client);
  const phone = cleanNumber(number);
  if (!phone) throw new Error('A valid WhatsApp number is required.');
  return axios.post(
    `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`,
    { number: phone, text },
    { headers, timeout: 30000 }
  );
}

async function downloadClientAudio(client, messageKey) {
  const { baseUrl, headers, instance } = clientSettings(client);
  if (!messageKey?.id) throw new Error('Incoming voice note has no message id.');
  const key = { id: messageKey.id };
  if (messageKey.remoteJid) key.remoteJid = messageKey.remoteJid;
  if (typeof messageKey.fromMe === 'boolean') key.fromMe = messageKey.fromMe;
  const response = await axios.post(
    `${baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`,
    { message: { key }, convertToMp4: false },
    { headers, timeout: 60000 }
  );
  let base64 = response.data?.base64 || response.data?.data?.base64 || response.data?.media?.base64 || response.data?.data?.media?.base64;
  if (!base64) throw new Error('Evolution returned no audio for the voice note.');
  if (base64.includes(',')) base64 = base64.split(',', 2)[1];
  const mimeType = response.data?.mimetype || response.data?.mimeType || response.data?.data?.mimetype || 'audio/ogg';
  return { buffer: Buffer.from(base64, 'base64'), mimeType };
}

module.exports = { setClientWebhook, sendClientText, downloadClientAudio };
