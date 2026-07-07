const axios = require('axios');
const FormData = require('form-data');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const DEFAULT_TIMEOUT_MS = 20000;

function requestTimeoutMs() {
  const parsed = Number.parseInt(process.env.WHATSAPP_API_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

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

function jsonHeaders(accessToken) {
  return authHeaders(accessToken, { 'Content-Type': 'application/json' });
}

async function sendWhatsAppMessage(phoneNumberId, accessToken, phoneNumber, message) {
  assertCreds(phoneNumberId, accessToken);
  const response = await axios.post(
    `${GRAPH_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'text',
      text: { body: message },
    },
    { headers: jsonHeaders(accessToken), timeout: requestTimeoutMs() }
  );
  return response.data;
}

// Send up to three Meta WhatsApp reply buttons. Each id is returned to the webhook when tapped.
async function sendWhatsAppButtons(phoneNumberId, accessToken, phoneNumber, bodyText, buttons, footerText = '') {
  assertCreds(phoneNumberId, accessToken);
  const safeButtons = (buttons || []).slice(0, 3).map((button) => ({
    type: 'reply',
    reply: {
      id: String(button.id).slice(0, 256),
      title: String(button.title).slice(0, 20),
    },
  }));
  if (safeButtons.length === 0) throw new Error('At least one WhatsApp reply button is required.');

  const interactive = {
    type: 'button',
    body: { text: String(bodyText).slice(0, 1024) },
    action: { buttons: safeButtons },
  };
  if (footerText) interactive.footer = { text: String(footerText).slice(0, 60) };

  const response = await axios.post(
    `${GRAPH_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'interactive',
      interactive,
    },
    { headers: jsonHeaders(accessToken), timeout: requestTimeoutMs() }
  );
  return response.data;
}

async function sendWhatsAppList(phoneNumberId, accessToken, phoneNumber, bodyText, buttonText, sections, footerText = '') {
  assertCreds(phoneNumberId, accessToken);
  const safeSections = (sections || []).map((section) => ({
    title: String(section.title || 'Options').slice(0, 24),
    rows: (section.rows || []).slice(0, 10).map((row) => ({
      id: String(row.id).slice(0, 200),
      title: String(row.title).slice(0, 24),
      description: row.description ? String(row.description).slice(0, 72) : undefined,
    })),
  })).filter((section) => section.rows.length > 0);
  if (safeSections.length === 0) throw new Error('At least one WhatsApp list row is required.');

  const interactive = {
    type: 'list',
    body: { text: String(bodyText).slice(0, 1024) },
    action: {
      button: String(buttonText || 'Choose option').slice(0, 20),
      sections: safeSections,
    },
  };
  if (footerText) interactive.footer = { text: String(footerText).slice(0, 60) };

  const response = await axios.post(
    `${GRAPH_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'interactive',
      interactive,
    },
    { headers: jsonHeaders(accessToken), timeout: requestTimeoutMs() }
  );
  return response.data;
}

// Fetch a media URL by ID, then download the bytes. Returns { buffer, mimeType }.
async function downloadWhatsAppMedia(accessToken, mediaId) {
  if (!accessToken) throw new Error('WhatsApp access token required to download media.');
  const meta = await axios.get(`${GRAPH_BASE}/${mediaId}`, {
    headers: authHeaders(accessToken),
    timeout: requestTimeoutMs(),
  });
  const mediaUrl = meta.data.url;
  const mimeType = meta.data.mime_type;

  const file = await axios.get(mediaUrl, {
    headers: authHeaders(accessToken),
    responseType: 'arraybuffer',
    timeout: requestTimeoutMs(),
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

  const response = await axios.post(`${GRAPH_BASE}/${phoneNumberId}/media`, form, {
    headers: authHeaders(accessToken, form.getHeaders()),
    maxBodyLength: Infinity,
    timeout: requestTimeoutMs(),
  });
  return response.data.id;
}

// Send an audio voice note (already uploaded) to a recipient.
async function sendWhatsAppVoiceNote(phoneNumberId, accessToken, phoneNumber, mediaId) {
  assertCreds(phoneNumberId, accessToken);
  const response = await axios.post(
    `${GRAPH_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'audio',
      audio: { id: mediaId },
    },
    { headers: jsonHeaders(accessToken), timeout: requestTimeoutMs() }
  );
  return response.data;
}

async function sendWhatsAppMediaMessage(phoneNumberId, accessToken, phoneNumber, media) {
  assertCreds(phoneNumberId, accessToken);
  const mediaId = await uploadWhatsAppMedia(
    phoneNumberId,
    accessToken,
    media.data,
    media.mime_type,
    media.filename
  );
  const isImage = String(media.mime_type || '').startsWith('image/');
  const type = isImage ? 'image' : 'document';
  const payload = isImage
    ? { id: mediaId, caption: media.description || media.title || undefined }
    : { id: mediaId, filename: media.filename, caption: media.description || media.title || undefined };

  const response = await axios.post(
    `${GRAPH_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type,
      [type]: payload,
    },
    { headers: jsonHeaders(accessToken), timeout: requestTimeoutMs() }
  );
  return response.data;
}

module.exports = {
  sendWhatsAppMessage,
  sendWhatsAppButtons,
  sendWhatsAppList,
  downloadWhatsAppMedia,
  uploadWhatsAppMedia,
  sendWhatsAppVoiceNote,
  sendWhatsAppMediaMessage,
};
