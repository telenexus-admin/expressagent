const express = require('express');
const db = require('../db');
const { createOrUpdateTicket } = require('../services/tickets');
const { notifyClientAdmins } = require('../services/pushNotifications');

const router = express.Router();

const MAX_ID_BYTES = 8 * 1024 * 1024;
const ALLOWED_ID_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
const DEFAULT_INSTALLATION_FORM = {
  title: 'Installation form',
  intro: 'Share your contact and location details so the installation team can prepare before calling you.',
  accent_color: '#3535FF',
  show_id: true,
  require_id: true,
  show_alternate_phone: true,
  show_email: true,
  show_plan: true,
  show_service_type: true,
  show_county: true,
  show_landmark: true,
  show_house_description: true,
  show_gps: true,
  show_schedule: true,
  show_notes: true,
};

async function ensureCustomerIntakeTable() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS installation_form_config JSONB NOT NULL DEFAULT '{}'::jsonb`);
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
      special_package_type VARCHAR(30),
      special_package_status VARCHAR(30) NOT NULL DEFAULT 'not_requested',
      special_document_mime_type VARCHAR(100),
      special_document_filename VARCHAR(255),
      special_document BYTEA,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_package_type VARCHAR(30)`);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_package_status VARCHAR(30) NOT NULL DEFAULT 'not_requested'`);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_document_mime_type VARCHAR(100)`);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_document_filename VARCHAR(255)`);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_document BYTEA`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_intake_client ON customer_intake_submissions(client_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_intake_phone ON customer_intake_submissions(customer_phone)`);
}

function normalizeInstallationFormConfig(raw = {}) {
  const source = typeof raw === 'object' && raw !== null ? raw : {};
  const pickBool = (key) => source[key] === undefined ? DEFAULT_INSTALLATION_FORM[key] : Boolean(source[key]);
  const accent = String(source.accent_color || DEFAULT_INSTALLATION_FORM.accent_color).trim();
  return {
    title: String(source.title || DEFAULT_INSTALLATION_FORM.title).trim().slice(0, 80),
    intro: String(source.intro || DEFAULT_INSTALLATION_FORM.intro).trim().slice(0, 300),
    accent_color: /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_INSTALLATION_FORM.accent_color,
    show_id: pickBool('show_id'),
    require_id: pickBool('show_id') ? pickBool('require_id') : false,
    show_alternate_phone: pickBool('show_alternate_phone'),
    show_email: pickBool('show_email'),
    show_plan: pickBool('show_plan'),
    show_service_type: pickBool('show_service_type'),
    show_county: pickBool('show_county'),
    show_landmark: pickBool('show_landmark'),
    show_house_description: pickBool('show_house_description'),
    show_gps: pickBool('show_gps'),
    show_schedule: pickBool('show_schedule'),
    show_notes: pickBool('show_notes'),
  };
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
    await ensureCustomerIntakeTable();
    const result = await db.query(
      `SELECT id, name, business_name, agent_name, installation_form_config
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
      installation_form: normalizeInstallationFormConfig(client.installation_form_config),
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
      `SELECT id, name, business_name, installation_form_config FROM clients WHERE id = $1 AND status = 'active' LIMIT 1`,
      [req.params.clientId]
    );
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Intake form is not available' });
    const formConfig = normalizeInstallationFormConfig(client.installation_form_config);

    const customerName = text(req.body.customer_name, 255);
    const customerPhone = cleanPhone(req.body.customer_phone);
    const area = text(req.body.area, 180);
    const consentAccepted = req.body.consent_accepted === true;
    const idUpload = parseDataUrl(req.body.identity_data);
    const mimeType = text(req.body.identity_mime_type || idUpload.mimeType, 100).toLowerCase();
    const idBuffer = idUpload.buffer;
    const specialType = ['student', 'disability'].includes(text(req.body.special_package_type, 30))
      ? text(req.body.special_package_type, 30)
      : '';
    const specialUpload = parseDataUrl(req.body.special_document_data);
    const specialMimeType = text(req.body.special_document_mime_type || specialUpload.mimeType, 100).toLowerCase();
    const specialBuffer = specialUpload.buffer;

    if (!customerName) return res.status(400).json({ error: 'Full name is required' });
    if (!customerPhone || customerPhone.length < 9) return res.status(400).json({ error: 'Valid phone number is required' });
    if (!area) return res.status(400).json({ error: 'Location or estate is required' });
    if (!consentAccepted) return res.status(400).json({ error: 'Consent is required before submitting' });
    if (formConfig.show_id && formConfig.require_id && (!idBuffer || idBuffer.length === 0)) {
      return res.status(400).json({ error: 'Upload an ID scan or clear ID photo' });
    }
    if (idBuffer && idBuffer.length > MAX_ID_BYTES) return res.status(400).json({ error: 'ID file must be 8 MB or smaller' });
    if (idBuffer && !ALLOWED_ID_MIME.has(mimeType)) return res.status(400).json({ error: 'ID file must be JPG, PNG, WEBP, HEIC or PDF' });
    if (specialType && (!specialBuffer || specialBuffer.length === 0)) {
      return res.status(400).json({ error: 'Upload a current verification document for the special package application' });
    }
    if (specialBuffer && specialBuffer.length > MAX_ID_BYTES) return res.status(400).json({ error: 'Verification document must be 8 MB or smaller' });
    if (specialBuffer && !ALLOWED_ID_MIME.has(specialMimeType)) return res.status(400).json({ error: 'Verification document must be JPG, PNG, WEBP, HEIC or PDF' });
    if (specialType === 'student' && (!text(req.body.institution_name, 180) || !text(req.body.student_number, 100))) {
      return res.status(400).json({ error: 'Institution name and student number are required for student verification' });
    }
    if (specialType === 'disability' && !text(req.body.disability_support_category, 120)) {
      return res.status(400).json({ error: 'Choose the support category required for the disability-support application' });
    }

    const duplicate = specialType ? await db.query(
      `SELECT id FROM customer_intake_submissions
       WHERE client_id = $1 AND customer_phone = $2 AND special_package_type = $3
       LIMIT 1`,
      [client.id, customerPhone, specialType]
    ) : { rows: [] };
    const details = {
      source: 'public_customer_intake',
      user_agent: text(req.headers['user-agent'], 300),
      ip: text(req.ip, 80),
      special_package: specialType ? {
        type: specialType,
        institution_name: text(req.body.institution_name, 180) || null,
        student_number: text(req.body.student_number, 100) || null,
        expected_graduation_year: text(req.body.expected_graduation_year, 10) || null,
        disability_support_category: text(req.body.disability_support_category, 120) || null,
        verification_consent: req.body.special_verification_consent === true,
        duplicate_application: duplicate.rows.length > 0,
        checks: {
          evidence_uploaded: Boolean(specialBuffer),
          identity_available: Boolean(idBuffer || text(req.body.id_number, 80)),
          contact_complete: Boolean(customerPhone && (text(req.body.email, 255) || cleanPhone(req.body.alternate_phone))),
          location_complete: Boolean(area && (text(req.body.landmark, 300) || optionalNumber(req.body.latitude))),
        },
      } : null,
    };
    if (specialType && req.body.special_verification_consent !== true) {
      return res.status(400).json({ error: 'Verification consent is required for a special package application' });
    }

    const inserted = await db.query(
      `INSERT INTO customer_intake_submissions
         (client_id, customer_name, customer_phone, alternate_phone, email, id_number, plan_interest,
          service_type, county, area, landmark, building_type, house_description, latitude, longitude,
          preferred_date, preferred_time, notes, consent_accepted, identity_mime_type, identity_filename,
          identity_document, special_package_type, special_package_status, special_document_mime_type,
          special_document_filename, special_document, metadata)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, TRUE, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb)
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
        formConfig.show_id && idBuffer ? mimeType : null,
        formConfig.show_id && idBuffer ? (text(req.body.identity_filename, 255) || 'identity-document') : null,
        formConfig.show_id ? idBuffer : null,
        specialType || null,
        specialType ? 'pending_review' : 'not_requested',
        specialType && specialBuffer ? specialMimeType : null,
        specialType && specialBuffer ? (text(req.body.special_document_filename, 255) || 'verification-document') : null,
        specialType ? specialBuffer : null,
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
      `Location: ${locationSummary || area}. ${formConfig.show_id && idBuffer ? 'ID scan uploaded.' : 'No ID scan requested.'}` +
      (specialType ? ` Special ${specialType} package application pending verification.` : '');

    try {
      await createOrUpdateTicket({
        clientId: client.id,
        customerPhone,
        customerName,
        title: 'Installation intake form submitted',
        category: 'installation',
        priority: specialType ? 'high' : 'normal',
        intent: 'new_installation',
        source: 'customer_intake_form',
        summary,
        messageText: summary,
      });
    } catch (ticketErr) {
      console.error('Customer intake ticket creation failed:', ticketErr.message);
    }

    notifyClientAdmins({
      clientId: client.id,
      customerName,
      customerPhone,
      messageText: summary,
    }).catch((err) => console.error('Customer intake push notification failed:', err.message));

    res.status(201).json({
      success: true,
      id: inserted.rows[0].id,
      message: specialType
        ? 'Application received. The verification team will review your evidence and contact you before activating a special package.'
        : 'Details received. Our team will review and contact you shortly.',
    });
  } catch (err) {
    console.error('POST /public/customer-intake error:', err.message);
    res.status(500).json({ error: 'Failed to submit installation details' });
  }
});

module.exports = router;
