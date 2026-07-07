const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { getOperatorSettings, sendEvolutionText } = require('../services/evolution');
const {
  ensureEvoOnboardingTable,
  makeSessionToken,
  makeInstanceName,
  createInstance,
  requestPairingCode,
  refreshOnboarding,
  cleanProviderError,
} = require('../services/evoSelfOnboarding');

const router = express.Router();
const attempts = new Map();
const OTP_TTL_MINUTES = 10;

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
    qr_code: row.status === 'pending_qr' && row.connection_method !== 'pairing_code' ? row.qr_code : null,
    pairing_code: row.status === 'pending_qr' && row.connection_method === 'pairing_code' ? row.pairing_code : null,
    pairing_number: row.connection_method === 'pairing_code' ? row.pairing_number : null,
    connection_method: row.connection_method || 'qr',
    connection_state: row.connection_state,
    connected_at: row.connected_at,
    provider_error: row.status === 'failed' ? row.provider_error : null,
    phone: row.phone,
    phone_verified: Boolean(row.phone_verified_at),
    otp_required: !row.phone_verified_at,
    otp_sent_at: row.phone_otp_sent_at,
    otp_expires_at: row.phone_otp_expires_at,
    request_type: row.request_type || 'new_client',
    agent_label: row.agent_label || null,
  };
}

function cleanPhone(number) {
  return String(number || '').replace(/[^0-9]/g, '');
}

function makeOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(sessionToken, phone, code) {
  return crypto
    .createHash('sha256')
    .update(`${sessionToken}:${cleanPhone(phone)}:${code}`)
    .digest('hex');
}

async function sendOnboardingOtp(row) {
  const code = makeOtp();
  const settings = await getOperatorSettings({ includeKey: true });
  const agentName = settings.agent_name || 'Nexa';
  await sendEvolutionText(
    settings,
    row.phone,
    `${agentName} confirmation code: ${code}\n\nEnter this code to confirm your WhatsApp number and continue onboarding. It expires in ${OTP_TTL_MINUTES} minutes.`
  );
  const updated = await db.query(
    `UPDATE evo_client_onboardings
     SET phone_otp_hash = $1,
         phone_otp_expires_at = NOW() + ($2 || ' minutes')::interval,
         phone_otp_sent_at = NOW(),
         connection_state = 'otp_sent',
         provider_error = NULL,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [hashOtp(row.session_token, row.phone, code), OTP_TTL_MINUTES, row.id]
  );
  return updated.rows[0];
}

async function prepareQrAfterOtp(row) {
  const qrCode = await createInstance(row.instance_name);
  const updated = await db.query(
    `UPDATE evo_client_onboardings
     SET status = 'pending_qr', qr_code = $1, connection_method = 'qr',
         connection_state = 'waiting_scan', updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [qrCode, row.id]
  );
  return updated.rows[0];
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
    body('request_type').optional().isIn(['new_client', 'additional_agent']),
    body('parent_client_id').optional({ checkFalsy: true }).isInt({ min: 1 }),
    body('agent_label').optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
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
      const requestType = req.body.request_type === 'additional_agent' && req.body.parent_client_id ? 'additional_agent' : 'new_client';
      const parentClientId = requestType === 'additional_agent' ? Number(req.body.parent_client_id) : null;
      if (parentClientId) {
        const parent = await db.query(`SELECT id FROM clients WHERE id = $1 AND status = 'active' LIMIT 1`, [parentClientId]);
        if (!parent.rows[0]) return res.status(400).json({ error: 'The selected dashboard could not be linked to this agent request.' });
      }
      const insert = await db.query(
        `INSERT INTO evo_client_onboardings
          (business_name, owner_name, phone, email, location, service_interest, consent_accepted,
           session_token, instance_name, status, connection_method, connection_state,
           request_type, parent_client_id, agent_label)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, 'provisioning', 'qr', 'otp_pending', $9, $10, $11)
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
          requestType,
          parentClientId,
          String(req.body.agent_label || '').trim() || null,
        ]
      );
      const row = insert.rows[0];
      try {
        const updated = await sendOnboardingOtp(row);
        return res.status(201).json({ session_token: sessionToken, ...publicView(updated) });
      } catch (providerErr) {
        const error = cleanProviderError(providerErr);
        await db.query(
          `UPDATE evo_client_onboardings SET status = 'failed', provider_error = $1, updated_at = NOW() WHERE id = $2`,
          [error, row.id]
        );
        console.error('Nexa onboarding OTP failed:', error);
        return res.status(502).json({ error: 'We could not send the WhatsApp confirmation code from Nexa. Please try again shortly.' });
      }
    } catch (err) {
      console.error('POST /public/evo-onboarding/start error:', err.message);
      res.status(500).json({ error: 'Could not begin onboarding. Please try again.' });
    }
  }
);

router.post(
  '/verify-otp/:token',
  [body('otp').trim().matches(/^[0-9]{6}$/).withMessage('Enter the 6-digit confirmation code')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await ensureEvoOnboardingTable();
      const result = await db.query(`SELECT * FROM evo_client_onboardings WHERE session_token = $1 LIMIT 1`, [req.params.token]);
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Onboarding session not found' });
      if (row.phone_verified_at && row.qr_code) return res.json(publicView(row));
      if (['connected', 'reviewed', 'active', 'archived'].includes(row.status)) return res.json(publicView(row));
      if (row.phone_verified_at && !row.qr_code) {
        try {
          const updated = await prepareQrAfterOtp(row);
          return res.json(publicView(updated));
        } catch (providerErr) {
          const error = cleanProviderError(providerErr);
          await db.query(
            `UPDATE evo_client_onboardings SET status = 'failed', provider_error = $1, updated_at = NOW() WHERE id = $2`,
            [error, row.id]
          );
          console.error('Evolution instance creation after prior OTP verification failed:', error);
          return res.status(502).json({ error: 'Your number is confirmed, but we could not prepare the WhatsApp QR code. Please try again shortly.' });
        }
      }
      if (!row.phone_otp_hash || !row.phone_otp_expires_at) {
        return res.status(400).json({ error: 'No active confirmation code. Please resend the code.' });
      }
      if (new Date(row.phone_otp_expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: 'That confirmation code has expired. Please resend a new code.' });
      }
      const expected = hashOtp(row.session_token, row.phone, req.body.otp);
      if (expected !== row.phone_otp_hash) {
        return res.status(400).json({ error: 'That confirmation code is not correct.' });
      }

      const verified = await db.query(
        `UPDATE evo_client_onboardings
         SET phone_verified_at = NOW(), phone_otp_hash = NULL, phone_otp_expires_at = NULL,
             connection_state = 'creating', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [row.id]
      );
      try {
        const updated = await prepareQrAfterOtp(verified.rows[0]);
        return res.json(publicView(updated));
      } catch (providerErr) {
        const error = cleanProviderError(providerErr);
        await db.query(
          `UPDATE evo_client_onboardings SET status = 'failed', provider_error = $1, updated_at = NOW() WHERE id = $2`,
          [error, row.id]
        );
        console.error('Evolution instance creation after OTP failed:', error);
        return res.status(502).json({ error: 'Your number was confirmed, but we could not prepare the WhatsApp QR code. Please try again shortly.' });
      }
    } catch (err) {
      console.error('POST /public/evo-onboarding/verify-otp error:', err.message);
      res.status(500).json({ error: 'Could not verify the confirmation code.' });
    }
  }
);

router.post('/resend-otp/:token', async (req, res) => {
  try {
    await ensureEvoOnboardingTable();
    const result = await db.query(`SELECT * FROM evo_client_onboardings WHERE session_token = $1 LIMIT 1`, [req.params.token]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Onboarding session not found' });
    if (row.phone_verified_at) return res.status(400).json({ error: 'This WhatsApp number is already confirmed.' });
    if (['connected', 'reviewed', 'active', 'archived'].includes(row.status)) {
      return res.status(400).json({ error: 'This onboarding session can no longer resend a confirmation code.' });
    }
    if (row.phone_otp_sent_at && Date.now() - new Date(row.phone_otp_sent_at).getTime() < 60 * 1000) {
      return res.status(429).json({ error: 'Please wait a minute before requesting another confirmation code.' });
    }
    const updated = await sendOnboardingOtp(row);
    res.json(publicView(updated));
  } catch (err) {
    const error = cleanProviderError(err);
    console.error('POST /public/evo-onboarding/resend-otp error:', error);
    res.status(502).json({ error: 'We could not resend the WhatsApp confirmation code. Please try again shortly.' });
  }
});

router.post(
  '/pairing-code/:token',
  [body('phone').trim().matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Enter a valid WhatsApp number with country code')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await ensureEvoOnboardingTable();
      const result = await db.query(`SELECT * FROM evo_client_onboardings WHERE session_token = $1 LIMIT 1`, [req.params.token]);
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Onboarding session not found' });
      if (['connected', 'reviewed', 'active', 'archived'].includes(row.status)) {
        return res.status(400).json({ error: 'This onboarding session can no longer request a pairing code.' });
      }
      if (!row.phone_verified_at) {
        return res.status(403).json({ error: 'Confirm your WhatsApp number before requesting a pairing code.' });
      }
      const paired = await requestPairingCode(row.instance_name, req.body.phone);
      const updated = await db.query(
        `UPDATE evo_client_onboardings
         SET pairing_code = $1, pairing_number = $2, connection_method = 'pairing_code',
             status = 'pending_qr', connection_state = 'waiting_pairing_code', provider_error = NULL, updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [paired.pairingCode, paired.number, row.id]
      );
      return res.json(publicView(updated.rows[0]));
    } catch (err) {
      const error = cleanProviderError(err);
      console.error('POST /public/evo-onboarding/pairing-code error:', error);
      return res.status(502).json({ error: 'We could not generate a pairing code right now. Please retry or use the QR code.' });
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
