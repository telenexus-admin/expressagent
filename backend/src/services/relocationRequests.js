const db = require('../db');
const { createOrUpdateTicket } = require('./tickets');
const { notifyClientAdmins } = require('./pushNotifications');

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const ALLOWED_PHOTO_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function cleanPublicBase() {
  return String(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function text(value, max = 800) {
  return String(value || '').trim().slice(0, max);
}

function cleanPhone(value) {
  return text(value, 80).replace(/[^\d+]/g, '').replace(/^\+/, '');
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDataUrl(value) {
  const raw = String(value || '');
  if (!raw) return { mimeType: '', buffer: null };
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/);
  if (match) return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
  return { mimeType: '', buffer: Buffer.from(raw, 'base64') };
}

async function ensureRelocationSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS relocation_requests (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(80) NOT NULL,
      alternate_phone VARCHAR(80),
      email VARCHAR(255),
      account_number VARCHAR(120),
      current_location TEXT,
      new_location TEXT NOT NULL,
      new_landmark TEXT,
      house_description TEXT,
      latitude NUMERIC,
      longitude NUMERIC,
      preferred_date VARCHAR(40),
      preferred_time VARCHAR(40),
      router_available BOOLEAN,
      router_condition VARCHAR(40),
      router_power_adapter BOOLEAN,
      ont_available BOOLEAN,
      cable_available BOOLEAN,
      reason TEXT,
      notes TEXT,
      consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
      photo_mime_type VARCHAR(100),
      photo_filename VARCHAR(255),
      photo BYTEA,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE relocation_requests ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending'`);
  await db.query(`ALTER TABLE relocation_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_relocation_requests_client ON relocation_requests(client_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_relocation_requests_phone ON relocation_requests(customer_phone)`);
}

function buildRelocationUrl(client, { phone, name } = {}) {
  const base = cleanPublicBase();
  if (!base || !client?.id) return '';
  const params = new URLSearchParams();
  if (phone) params.set('phone', String(phone).replace(/^\+/, ''));
  if (name) params.set('name', String(name).trim());
  const query = params.toString();
  return `${base}/relocation-request/${client.id}${query ? `?${query}` : ''}`;
}

async function createRelocationRequest(client, payload, source = 'public_relocation_form') {
  await ensureRelocationSchema();
  const customerName = text(payload.customer_name, 255);
  const customerPhone = cleanPhone(payload.customer_phone);
  const newLocation = text(payload.new_location, 1500);
  const consentAccepted = payload.consent_accepted === true;
  const photoUpload = parseDataUrl(payload.photo_data);
  const photoMimeType = text(payload.photo_mime_type || photoUpload.mimeType, 100).toLowerCase();
  const photoBuffer = photoUpload.buffer;
  const routerCondition = ['good', 'damaged', 'lost', 'not_sure'].includes(text(payload.router_condition, 40))
    ? text(payload.router_condition, 40)
    : 'not_sure';

  if (!customerName) {
    const error = new Error('Full name is required');
    error.statusCode = 400;
    throw error;
  }
  if (!customerPhone || customerPhone.length < 9) {
    const error = new Error('Valid phone number is required');
    error.statusCode = 400;
    throw error;
  }
  if (!newLocation) {
    const error = new Error('New relocation location is required');
    error.statusCode = 400;
    throw error;
  }
  if (!consentAccepted) {
    const error = new Error('Consent is required before submitting');
    error.statusCode = 400;
    throw error;
  }
  if (photoBuffer && photoBuffer.length > MAX_PHOTO_BYTES) {
    const error = new Error('Router photo must be 6 MB or smaller');
    error.statusCode = 400;
    throw error;
  }
  if (photoBuffer && !ALLOWED_PHOTO_MIME.has(photoMimeType)) {
    const error = new Error('Router photo must be JPG, PNG or WEBP');
    error.statusCode = 400;
    throw error;
  }

  const metadata = {
    source,
    user_agent: text(payload.user_agent, 300),
    ip: text(payload.ip, 80),
    checklist: {
      router_available: payload.router_available === true,
      power_adapter_available: payload.router_power_adapter === true,
      ont_available: payload.ont_available === true,
      cable_available: payload.cable_available === true,
      gps_pin_available: Boolean(optionalNumber(payload.latitude) && optionalNumber(payload.longitude)),
      photo_uploaded: Boolean(photoBuffer),
    },
  };

  const inserted = await db.query(
    `INSERT INTO relocation_requests
       (client_id, customer_name, customer_phone, alternate_phone, email, account_number,
        current_location, new_location, new_landmark, house_description, latitude, longitude,
        preferred_date, preferred_time, router_available, router_condition, router_power_adapter,
        ont_available, cable_available, reason, notes, consent_accepted, photo_mime_type,
        photo_filename, photo, metadata)
     VALUES
       ($1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, TRUE, $22,
        $23, $24, $25::jsonb)
     RETURNING *`,
    [
      client.id,
      customerName,
      customerPhone,
      cleanPhone(payload.alternate_phone) || null,
      text(payload.email, 255) || null,
      text(payload.account_number, 120) || null,
      text(payload.current_location, 1500) || null,
      newLocation,
      text(payload.new_landmark, 1000) || null,
      text(payload.house_description, 1000) || null,
      optionalNumber(payload.latitude),
      optionalNumber(payload.longitude),
      text(payload.preferred_date, 40) || null,
      text(payload.preferred_time, 40) || null,
      payload.router_available === true,
      routerCondition,
      payload.router_power_adapter === true,
      payload.ont_available === true,
      payload.cable_available === true,
      text(payload.reason, 1000) || null,
      text(payload.notes, 1200) || null,
      photoBuffer ? photoMimeType : null,
      photoBuffer ? (text(payload.photo_filename, 255) || 'router-photo') : null,
      photoBuffer || null,
      JSON.stringify(metadata),
    ]
  );

  const request = inserted.rows[0];
  const summary =
    `Relocation request submitted. Current location: ${request.current_location || 'not provided'}. ` +
    `New location: ${request.new_location}. Router condition: ${String(request.router_condition || 'not_sure').replaceAll('_', ' ')}. ` +
    `Preferred visit: ${[request.preferred_date, request.preferred_time].filter(Boolean).join(' ') || 'not specified'}.`;

  try {
    await createOrUpdateTicket({
      clientId: client.id,
      customerPhone,
      customerName,
      title: 'Relocation / transfer request',
      category: 'installation',
      priority: routerCondition === 'damaged' || routerCondition === 'lost' ? 'high' : 'normal',
      intent: 'relocation_request',
      source: source === 'public_relocation_form' ? 'customer_intake_form' : 'whatsapp_evolution',
      summary,
      messageText: summary,
      forceNew: true,
    });
  } catch (err) {
    console.error('Relocation ticket creation failed:', err.message);
  }

  notifyClientAdmins({
    clientId: client.id,
    customerName,
    customerPhone,
    messageText: summary,
  }).catch((err) => console.error('Relocation push notification failed:', err.message));

  return request;
}

module.exports = {
  ensureRelocationSchema,
  buildRelocationUrl,
  createRelocationRequest,
};
