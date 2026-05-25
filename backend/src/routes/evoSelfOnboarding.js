const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const {
  ensureEvoOnboardingTable,
  makeSessionToken,
  makeInstanceName,
  createInstance,
  refreshOnboarding,
  cleanProviderError,
} = require('../services/evoSelfOnboarding');

const router = express.Router();
const attempts = new Map();

function allowStart(req) {
  const now = Date.now();
  const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < 60 * 60 * 1000);
  if (recent.length >= 4) return false;
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}

function publicView(row) {
  return {
    business_name: row.business_name,
    owner_name: row.owner_name,
    status: row.status,
    qr_code: row.status === 'pending_qr' ? row.qr_code : null,
    connection_state: row.connection_state,
    connected_at: row.connected_at,
    provider_error: row.status === 'failed' ? row.provider_error : null,
  };
}

router.post(
  '/start',
  [
    body('business_name').trim().isLength({ min: 2, max: 255 }).withMessage('Business name is required'),
    body('owner_name').trim().isLength({ min: 2, max: 255 }).withMessage('Your name is required'),
    body('phone').trim().matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Enter a valid WhatsApp phone number'),
    body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address'),
    body('location').optional().trim().isLength({ max: 255 }),
    body('service_interest').optional().isIn(['customer_support', 'isp_support', 'sales_support', 'full_automation']),
    body('consent_accepted').equals('true').withMessage('You must agree before connecting WhatsApp'),
  ],
  async (req, res) => {
    if (!allowStart(req)) {
      return res.status(429).json({ error: 'Too many onboarding attempts. Please try again later or contact Telenexus.' });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await ensureEvoOnboardingTable();
      const sessionToken = makeSessionToken();
      const instanceName = makeInstanceName(req.body.business_name);
      const insert = await db.query(
        `INSERT INTO evo_client_onboardings
          (business_name, owner_name, phone, email, location, service_interest, consent_accepted,
           session_token, instance_name, status, connection_state)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, 'provisioning', 'creating')
         RETURNING *`,
        [
          req.body.business_name.trim(),
          req.body.owner_name.trim(),
          req.body.phone.trim(),
          req.body.email,
          String(req.body.location || '').trim() || null,
          req.body.service_interest || 'customer_support',
          sessionToken,
          instanceName,
        ]
      );
      const row = insert.rows[0];
      try {
        const qrCode = await createInstance(instanceName);
        const updated = await db.query(
          `UPDATE evo_client_onboardings
           SET status = 'pending_qr', qr_code = $1, connection_state = 'waiting_scan', updated_at = NOW()
           WHERE id = $2 RETURNING *`,
          [qrCode, row.id]
        );
        return res.status(201).json({ session_token: sessionToken, ...publicView(updated.rows[0]) });
      } catch (providerErr) {
        const error = cleanProviderError(providerErr);
        await db.query(
          `UPDATE evo_client_onboardings SET status = 'failed', provider_error = $1, updated_at = NOW() WHERE id = $2`,
          [error, row.id]
        );
        console.error('Evolution instance creation failed:', error);
        return res.status(502).json({ error: 'We could not prepare the WhatsApp QR code. Your request has been recorded for assistance.' });
      }
    } catch (err) {
      console.error('POST /public/evo-onboarding/start error:', err.message);
      res.status(500).json({ error: 'Could not begin onboarding. Please try again.' });
    }
  }
);

router.get('/status/:token', async (req, res) => {
  try {
    await ensureEvoOnboardingTable();
    const result = await db.query(
      `SELECT * FROM evo_client_onboardings WHERE session_token = $1 LIMIT 1`,
      [req.params.token]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Onboarding session not found' });
    const refreshed = await refreshOnboarding(result.rows[0]);
    res.json(publicView(refreshed));
  } catch (err) {
    console.error('GET /public/evo-onboarding/status error:', err.message);
    res.status(500).json({ error: 'Could not refresh connection status.' });
  }
});

module.exports = router;
