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

async function setClientWebhook(client, options = {}) {
  const { baseUrl, headers } = providerConfig();
  const instance = String(options.instanceName || client.evolution_instance_name || '').trim();
  const token = String(options.token || client.evolution_webhook_secret || '').trim();
  if (!instance) throw new Error('Evolution instance is missing for this client.');
  if (!token) throw new Error('Evolution webhook token is missing for this client.');
  const publicUrl = String(process.env.PUBLIC_BACKEND_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
  if (!publicUrl) throw new Error('PUBLIC_BACKEND_URL or FRONTEND_URL is required before activating Evolution routing.');
  const agentQuery = options.agentId ? `&agent=${encodeURIComponent(options.agentId)}` : '';
  const callback = `${publicUrl}/webhook/evolution/client/${client.id}?token=${encodeURIComponent(token)}${agentQuery}`;
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

async function sendClientButtons(client, number, { title, description, footer, buttons }) {
  const { baseUrl, headers, instance } = clientSettings(client);
  const phone = cleanNumber(number);
  if (!phone) throw new Error('A valid WhatsApp number is required.');
  const safeButtons = (buttons || []).slice(0, 3).map((button) => ({
    type: 'reply',
    title: String(button.title || button.displayText || '').slice(0, 20),
    displayText: String(button.displayText || button.title || '').slice(0, 20),
    id: String(button.id || button.buttonId || '').slice(0, 256),
  })).filter((button) => button.displayText && button.id);
  if (safeButtons.length === 0) throw new Error('At least one Evolution button is required.');
  return axios.post(
    `${baseUrl}/message/sendButtons/${encodeURIComponent(instance)}`,
    {
      number: phone,
      title: title || '',
      description: description || '',
      footer: footer || '',
      buttons: safeButtons,
    },
    { headers, timeout: 30000 }
  );
}

async function downloadClientMedia(client, messageKey, { convertToMp4 = false } = {}) {
  const { baseUrl, headers, instance } = clientSettings(client);
  if (!messageKey?.id) throw new Error('Incoming media message has no message id.');
  const key = { id: messageKey.id };
  if (messageKey.remoteJid) key.remoteJid = messageKey.remoteJid;
  if (typeof messageKey.fromMe === 'boolean') key.fromMe = messageKey.fromMe;
  const response = await axios.post(
    `${baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`,
    { message: { key }, convertToMp4 },
    { headers, timeout: 60000 }
  );
  let base64 = getBase64(response.data);
  if (!base64) throw new Error('Evolution returned no media for the message.');
  if (base64.includes(',')) base64 = base64.split(',', 2)[1];
  const mimeType = getMimeType(response.data) || 'application/octet-stream';
  return { buffer: Buffer.from(base64, 'base64'), mimeType };
}

function getBase64(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;
  for (const key of ['base64', 'media', 'file', 'buffer']) {
    if (typeof value[key] === 'string') return value[key];
  }
  for (const key of ['data', 'message', 'mediaMessage']) {
    const nested = getBase64(value[key]);
    if (nested) return nested;
  }
  return null;
}

function getMimeType(value) {
  if (!value || typeof value !== 'object') return null;
  const direct = value.mimetype || value.mimeType || value.mimetypeMessage || value.mediaType;
  if (typeof direct === 'string' && direct.includes('/')) return direct;
  for (const key of ['data', 'message', 'mediaMessage']) {
    const nested = getMimeType(value[key]);
    if (nested) return nested;
  }
  return null;
}

async function sendClientMedia(client, number, media) {
  const { baseUrl, headers, instance } = clientSettings(client);
  const phone = cleanNumber(number);
  if (!phone) throw new Error('A valid WhatsApp number is required.');
  const isImage = String(media.mime_type || '').startsWith('image/');
  return axios.post(
    `${baseUrl}/message/sendMedia/${encodeURIComponent(instance)}`,
    {
      number: phone,
      mediatype: isImage ? 'image' : 'document',
      mimetype: media.mime_type,
      caption: media.description || media.title || '',
      fileName: media.filename,
      media: media.data.toString('base64'),
    },
    { headers, timeout: 60000 }
  );
}

async function sendClientVoiceNote(client, number, audioBuffer) {
  const { baseUrl, headers, instance } = clientSettings(client);
  const phone = cleanNumber(number);
  if (!phone) throw new Error('A valid WhatsApp number is required.');
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) throw new Error('Audio buffer is empty.');
  const base64Audio = audioBuffer.toString('base64');
  const audioPayload = {
    number: phone,
    audio: base64Audio,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
    delay: 400,
  };
  try {
    return await axios.post(
      `${baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`,
      audioPayload,
      { headers, timeout: 60000 }
    );
  } catch (err) {
    const detail = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message);
    throw new Error(`Evolution voice note send failed via sendWhatsAppAudio. Refusing sendMedia fallback because it can deliver downloadable audio instead of a WhatsApp voice note. Details: ${detail}`);
  }
}

async function downloadClientAudio(client, messageKey, options = {}) {
  const media = await downloadClientMedia(client, messageKey, { convertToMp4: options.convertToMp4 === true });
  const fallbackMimeType = options.convertToMp4 === true ? 'audio/mp4' : 'audio/ogg';
  const mimeType = media.mimeType && media.mimeType !== 'application/octet-stream' ? media.mimeType : fallbackMimeType;
  return { ...media, mimeType };
}

async function downloadClientImage(client, messageKey) {
  const media = await downloadClientMedia(client, messageKey, { convertToMp4: false });
  return { ...media, mimeType: media.mimeType || 'image/jpeg' };
}

module.exports = { setClientWebhook, sendClientText, sendClientButtons, sendClientVoiceNote, sendClientMedia, downloadClientAudio, downloadClientImage };
