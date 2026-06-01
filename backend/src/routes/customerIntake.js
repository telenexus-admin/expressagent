const express = require('express');
const db = require('../db');
const { createOrUpdateTicket } = require('../services/tickets');
const { notifyClientAdmins } = require('../services/pushNotifications');

const router = express.Router();

const MAX_ID_BYTES = 8 * 1024 * 1024;
const ALLOWED_ID_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

async function ensureCustomerIntakeTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS customer_intake_submissions (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(80) NOT NULL,
      alternate_phone VARCHAR(80),
      email VARCHAR(255),
      id_number VARCHAR(80),
      plan_interest VARCHAR(140),
      service_type VARCHAR(80),
      county VARCHAR(120),
      area VARCHAR(180) NOT NULL,
      landmark TEXT,
      building_type VARCHAR(80),
      house_description TEXT,
      latitude NUMERIC,
      longitude NUMERIC,
      preferred_date VARCHAR(40),
      preferred_time VARCHAR(40),
      notes TEXT,
      consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
      identity_mime_type VARCHAR(100),
      identity_filename VARCHAR(255),
      identity_document BYTEA,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_intake_client ON customer_intake_submissions(client_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_intake_phone ON customer_intake_submissions(customer_phone)`);
}

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function parseDataUrl(value) {
  const raw = String(value || '');
  if (!raw) return { mimeType: '', buffer: null };
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/);
  if (match) return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
  return { mimeType: '', buffer: Buffer.from(raw, 'base64') };
}

function cleanPhone(value) {
  return text(value, 80).replace(/[^\d+]/g, '').replace(/^\+/, '');
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

router.get('/:clientId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, business_name, agent_name
       FROM clients
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [req.params.clientId]
    );
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Intake form is not available' });
    res.json({
      client_id: client.id,
      business_name: client.business_name || client.name || 'your ISP',
      agent_name: client.agent_name || 'AI assistant',
    });
  } catch (err) {
    console.error('GET /public/customer-intake error:', err.message);
    res.status(500).json({ error: 'Failed to load intake form' });
  }
});

router.post('/:clientId', async (req, res) => {
  try {
    await ensureCustomerIntakeTable();
    const clientResult = await db.query(
      `SELECT id, name, business_name FROM clients WHERE id = $1 AND status = 'active' LIMIT 1`,
      [req.params.clientId]
    );
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Intake form is not available' });

    const customerName = text(req.body.customer_name, 255);
    const customerPhone = cleanPhone(req.body.customer_phone);
    const area = text(req.body.area, 180);
    const consentAccepted = req.body.consent_accepted === true;
    const idUpload = parseDataUrl(req.body.identity_data);
    const mimeType = text(req.body.identity_mime_type || idUpload.mimeType, 100).toLowerCase();
    const idBuffer = idUpload.buffer;

    if (!customerName) return res.status(400).json({ error: 'Full name is required' });
    if (!customerPhone || customerPhone.length < 9) return res.status(400).json({ error: 'Valid phone number is required' });
    if (!area) return res.status(400).json({ error: 'Location or estate is required' });
    if (!consentAccepted) return res.status(400).json({ error: 'Consent is required before submitting' });
    if (!idBuffer || idBuffer.length === 0) return res.status(400).json({ error: 'Upload an ID scan or clear ID photo' });
    if (idBuffer.length > MAX_ID_BYTES) return res.status(400).json({ error: 'ID file must be 8 MB or smaller' });
    if (!ALLOWED_ID_MIME.has(mimeType)) return res.status(400).json({ error: 'ID file must be JPG, PNG, WEBP, HEIC or PDF' });

    const details = {
      source: 'public_customer_intake',
      user_agent: text(req.headers['user-agent'], 300),
      ip: text(req.ip, 80),
    };

    const inserted = await db.query(
      `INSERT INTO customer_intake_submissions
         (client_id, customer_name, customer_phone, alternate_phone, email, id_number, plan_interest,
          service_type, county, area, landmark, building_type, house_description, latitude, longitude,
          preferred_date, preferred_time, notes, consent_accepted, identity_mime_type, identity_filename,
          identity_document, metadata)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, TRUE, $19, $20, $21, $22::jsonb)
       RETURNING id, created_at`,
      [
        client.id,
        customerName,
        customerPhone,
        cleanPhone(req.body.alternate_phone) || null,
        text(req.body.email, 255) || null,
        text(req.body.id_number, 80) || null,
        text(req.body.plan_interest, 140) || null,
        text(req.body.service_type, 80) || null,
        text(req.body.county, 120) || null,
        area,
        text(req.body.landmark, 1000) || null,
        text(req.body.building_type, 80) || null,
        text(req.body.house_description, 1000) || null,
        optionalNumber(req.body.latitude),
        optionalNumber(req.body.longitude),
        text(req.body.preferred_date, 40) || null,
        text(req.body.preferred_time, 40) || null,
        text(req.body.notes, 1200) || null,
        mimeType,
        text(req.body.identity_filename, 255) || 'identity-document',
        idBuffer,
        JSON.stringify(details),
      ]
    );

    const locationSummary = [
      text(req.body.county, 120),
      area,
      text(req.body.landmark, 300),
    ].filter(Boolean).join(' | ');
    const summary =
      `Installation intake submitted. Plan: ${text(req.body.plan_interest, 140) || 'Not selected'}. ` +
      `Location: ${locationSummary || area}. ID scan uploaded.`;

    await createOrUpdateTicket({
      clientId: client.id,
      customerPhone,
      customerName,
      title: 'Installation intake form submitted',
      category: 'installation',
      priority: 'normal',
      intent: 'new_installation',
      source: 'customer_intake_form',
      summary,
      messageText: summary,
    });

    notifyClientAdmins({
      clientId: client.id,
      customerName,
      customerPhone,
      messageText: summary,
    }).catch((err) => console.error('Customer intake push notification failed:', err.message));

    res.status(201).json({
      success: true,
      id: inserted.rows[0].id,
      message: 'Details received. Our team will review and contact you shortly.',
    });
  } catch (err) {
    console.error('POST /public/customer-intake error:', err.message);
    res.status(500).json({ error: 'Failed to submit installation details' });
  }
});

module.exports = router;
