const axios = require('axios');
const FormData = require('form-data');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

function authHeaders(accessToken, extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function assertCreds(phoneNumberId, accessToken) {
  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp credentials missing (phone_number_id and access_token required).');
  }
}

async function sendWhatsAppMessage(phoneNumberId, accessToken, phoneNumber, message) {
  assertCreds(phoneNumberId, accessToken);
  const url = `${GRAPH_BASE}/${phoneNumberId}/messages`;

  await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'text',
      text: { body: message },
    },
    {
      headers: authHeaders(accessToken, { 'Content-Type': 'application/json' }),
    }
  );
}

// Fetch a media URL by ID, then download the bytes. Returns { buffer, mimeType }.
async function downloadWhatsAppMedia(accessToken, mediaId) {
  if (!accessToken) throw new Error('WhatsApp access token required to download media.');
  const meta = await axios.get(`${GRAPH_BASE}/${mediaId}`, {
    headers: authHeaders(accessToken),
  });
  const mediaUrl = meta.data.url;
  const mimeType = meta.data.mime_type;

  const file = await axios.get(mediaUrl, {
    headers: authHeaders(accessToken),
    responseType: 'arraybuffer',
  });

  return { buffer: Buffer.from(file.data), mimeType };
}

// Upload a media buffer to WhatsApp and return the media id.
async function uploadWhatsAppMedia(phoneNumberId, accessToken, buffer, mimeType, filename) {
  assertCreds(phoneNumberId, accessToken);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', buffer, { filename, contentType: mimeType });

  const url = `${GRAPH_BASE}/${phoneNumberId}/media`;
  const res = await axios.post(url, form, {
    headers: authHeaders(accessToken, form.getHeaders()),
    maxBodyLength: Infinity,
  });
  return res.data.id;
}

// Send an audio voice note (already uploaded) to a recipient.
async function sendWhatsAppVoiceNote(phoneNumberId, accessToken, phoneNumber, mediaId) {
  assertCreds(phoneNumberId, accessToken);
  const url = `${GRAPH_BASE}/${phoneNumberId}/messages`;
  await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'audio',
      audio: { id: mediaId },
    },
    {
      headers: authHeaders(accessToken, { 'Content-Type': 'application/json' }),
    }
  );
}

module.exports = {
  sendWhatsAppMessage,
  downloadWhatsAppMedia,
  uploadWhatsAppMedia,
  sendWhatsAppVoiceNote,
};
