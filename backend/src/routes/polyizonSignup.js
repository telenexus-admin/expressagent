const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { sendEmail } = require('../services/email');

const router = express.Router();

function text(value, limit = 500) {
  return String(value || '').trim().slice(0, limit);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanPhone(value) {
  return text(value, 80).replace(/[^\d+()\-\s]/g, '');
}

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS polyizon_signup_requests (
      id SERIAL PRIMARY KEY,
      business_name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(80) NOT NULL,
      business_type VARCHAR(40) NOT NULL DEFAULT 'isp',
      service_interest VARCHAR(120),
      message TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'received',
      confirmation_email_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      confirmation_email_id VARCHAR(255),
      confirmation_email_error TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_polyizon_signup_requests_email ON polyizon_signup_requests (LOWER(email), created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_polyizon_signup_requests_status ON polyizon_signup_requests (status, created_at DESC)`);
}

router.post('/', [
  body('business_name').trim().isLength({ min: 2, max: 255 }).withMessage('Business name is required.'),
  body('contact_name').trim().isLength({ min: 2, max: 255 }).withMessage('Your full name is required.'),
  body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('phone').trim().isLength({ min: 9, max: 80 }).withMessage('Enter a valid phone number.'),
  body('business_type').optional().isIn(['isp', 'business', 'other']),
  body('service_interest').optional().isLength({ max: 120 }),
  body('message').optional().isLength({ max: 2000 }),
], async (req, res) => {
  try {
    await ensureSchema();
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const businessName = text(req.body.business_name, 255);
    const contactName = text(req.body.contact_name, 255);
    const email = text(req.body.email, 255).toLowerCase();
    const phone = cleanPhone(req.body.phone);
    const businessType = ['isp', 'business', 'other'].includes(text(req.body.business_type, 40)) ? text(req.body.business_type, 40) : 'isp';
    const serviceInterest = text(req.body.service_interest, 120) || null;
    const message = text(req.body.message, 2000) || null;

    if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Enter a valid phone number.' });

    const recent = await db.query(
      `SELECT id FROM polyizon_signup_requests
       WHERE LOWER(email) = $1 AND created_at > NOW() - INTERVAL '10 minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    if (recent.rows[0]) {
      return res.status(202).json({ success: true, message: 'Your request is already with the Polyizon team. Please check your email.' });
    }

    const inserted = await db.query(
      `INSERT INTO polyizon_signup_requests
       (business_name, contact_name, email, phone, business_type, service_interest, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [businessName, contactName, email, phone, businessType, serviceInterest, message]
    );
    const requestId = inserted.rows[0].id;
    const firstName = contactName.split(/\s+/)[0] || 'there';
    const from = process.env.RESEND_FROM || 'POLYIZON <no-reply@polyizon.tech>';
    const emailResult = await sendEmail(null, {
      from,
      to: [email],
      reply_to: 'hello@polyizon.tech',
      subject: 'We received your Polyizon request',
      text: `Hello ${firstName},\n\nThank you for registering ${businessName} with Polyizon. We have received your request${serviceInterest ? ` for ${serviceInterest}` : ''}. Our support team will reach you shortly to learn about your business and the systems you need.\n\nThis request does not create a live account yet; it lets our team prepare the right next steps for you.\n\nRegards,\nPolyizon Support\nhello@polyizon.tech`,
      html: `<div style="font-family:Arial,sans-serif;max-width:620px;color:#162033;line-height:1.6"><div style="background:#06182d;padding:28px 32px;border-radius:16px 16px 0 0"><div style="font-size:24px;font-weight:700;color:#fff">Poly<span style="color:#f23832">izon</span></div></div><div style="border:1px solid #e4e7ec;border-top:0;border-radius:0 0 16px 16px;padding:32px"><h1 style="margin:0 0 18px;font-size:25px;color:#06182d">Your request is in.</h1><p>Hello ${escapeHtml(firstName)},</p><p>Thank you for registering <strong>${escapeHtml(businessName)}</strong> with Polyizon. We have received your request${serviceInterest ? ` for <strong>${escapeHtml(serviceInterest)}</strong>` : ''}.</p><div style="background:#f7f8fb;border-radius:12px;padding:18px 20px;margin:22px 0"><strong>What happens next</strong><p style="margin:8px 0 0">Our support team will reach you shortly to understand your business and recommend the right systems.</p></div><p>This request does not create a live account yet—it helps us prepare the right next steps for you.</p><p>Regards,<br><strong>Polyizon Support</strong><br><a href="mailto:hello@polyizon.tech" style="color:#f23832">hello@polyizon.tech</a></p></div></div>`,
    });

    await db.query(
      `UPDATE polyizon_signup_requests
       SET confirmation_email_status = $2, confirmation_email_id = $3, confirmation_email_error = $4, updated_at = NOW()
       WHERE id = $1`,
      [requestId, emailResult.status || 'failed', emailResult.id || null, emailResult.error || null]
    );
    if (emailResult.status !== 'sent') console.error(`Polyizon signup confirmation failed for request ${requestId}:`, emailResult.error || 'Unknown email error');

    res.status(201).json({
      success: true,
      message: 'Thanks — your request has been received. Please check your email; the Polyizon support team will reach you shortly.',
    });
  } catch (error) {
    console.error('POST /api/public/polyizon-signup error:', error.message);
    res.status(500).json({ error: 'We could not submit your request. Please try again shortly.' });
  }
});

router.ensureSchema = ensureSchema;
module.exports = router;
