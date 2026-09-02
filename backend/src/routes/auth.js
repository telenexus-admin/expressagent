const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { logActivity } = require('../services/audit');
const { authMiddleware } = require('../middleware/auth');
const {
  ensureSecuritySchema,
  adminView,
  createSession,
  rotateSession,
  revokeCurrentSession,
  revokeAdminSessions,
  createChallenge,
  verifyChallenge,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  verifyMfa,
  trustedOrigin,
  CSRF_COOKIE,
} = require('../security/adminSessions');
const {
  loginLimiter,
  mfaLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  refreshLimiter,
} = require('../security/rateLimits');

const router = express.Router();
const ALL_PERMISSIONS = [
  'statistics', 'conversations', 'tickets', 'invoices', 'billing', 'communication',
  'escalations', 'installations', 'complaints', 'ai_health', 'admins', 'employees',
  'workflow', 'agent', 'settings', 'logs',
];
const RESET_TTL_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('polyizon-invalid-password-placeholder', 12);
let passwordSchemaPromise;

function normalizePermissions(raw, role) {
  if (role === 'superadmin') return ALL_PERMISSIONS;
  if (!Array.isArray(raw) || raw.length === 0) return ALL_PERMISSIONS;
  const clean = [...new Set(raw.filter((permission) => ALL_PERMISSIONS.includes(permission)))];
  return clean.length > 0 ? clean : ['statistics'];
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function mfaRequired() {
  return String(process.env.AUTH_MFA_REQUIRED || 'true').toLowerCase() !== 'false';
}

function strongPassword(value) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) return false;
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length;
  return categories >= 3;
}

async function ensurePasswordSchema() {
  await ensureSecuritySchema();
  if (!passwordSchemaPromise) {
    passwordSchemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS admin_password_resets (
        id BIGSERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        request_origin VARCHAR(500),
        requested_ip VARCHAR(80),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_password_resets_active
        ON admin_password_resets(admin_id, expires_at DESC) WHERE used_at IS NULL;
    `);
  }
  return passwordSchemaPromise;
}

function resetOrigin(req) {
  const origin = req.get('origin');
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' && (
      url.hostname === 'billing.polyizon.tech' || url.hostname.endsWith('.billing.polyizon.tech')
    )) return url.origin;
  } catch {}
  return 'https://billing.polyizon.tech';
}

async function sendPasswordResetEmail({ admin, resetUrl, recipient }) {
  if (!process.env.RESEND_API_KEY) throw new Error('Resend is not configured');
  const displayName = escapeHtml(admin.name || 'Administrator');
  await axios.post('https://api.resend.com/emails', {
    from: process.env.RESEND_FROM || 'POLYIZON Billing <no-reply@polyizon.tech>',
    to: [recipient || admin.email],
    subject: 'Reset your POLYIZON Billing password',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#151a33"><h1 style="margin:0 0 14px;color:#173b2d">POLYIZON BILLING SYSTEM</h1><p>Hello ${displayName},</p><p>We received a request to reset your administrator password. This secure link expires in 15 minutes and can only be used once.</p><p style="margin:26px 0"><a href="${resetUrl}" style="display:inline-block;background:#173b2d;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Reset password</a></p><p style="font-size:13px;color:#667085">If you did not request this, ignore this email. Your password will remain unchanged.</p></div>`,
  }, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

async function findAdminByEmail(email) {
  const result = await db.query(`
    SELECT a.*, c.name AS client_name, c.business_name AS client_business_name,
           c.status AS client_status, c.account_type AS client_account_type
      FROM admins a
      LEFT JOIN clients c ON c.id = a.client_id
     WHERE a.email = $1
     LIMIT 1`, [cleanEmail(email)]);
  const admin = result.rows[0] || null;
  if (admin) admin.permissions = normalizePermissions(admin.permissions, admin.role);
  return admin;
}

async function failedLogin(admin) {
  if (!admin) return;
  await db.query(`
    UPDATE admins
       SET failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= 5
                               THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END
     WHERE id = $1`, [admin.id]);
}

async function successfulLogin(admin) {
  await db.query(`UPDATE admins SET failed_login_count=0,locked_until=NULL,last_login_at=NOW() WHERE id=$1`, [admin.id]);
}

function publicAdmin(admin) {
  return adminView({ ...admin, permissions: normalizePermissions(admin.permissions, admin.role) });
}

async function beginAuthentication(admin, req, res) {
  if (admin.mfa_enabled) {
    return res.status(202).json({
      mfa_required: true,
      challenge: await createChallenge(admin, 'mfa_login'),
    });
  }
  if (mfaRequired()) {
    return res.status(202).json({
      mfa_setup_required: true,
      challenge: await createChallenge(admin, 'mfa_setup'),
    });
  }
  await createSession(admin, req, res);
  return res.json({ admin: publicAdmin(admin) });
}

router.post('/forgot-password', forgotPasswordLimiter,
  [body('email').isEmail().normalizeEmail()], async (req, res) => {
    const generic = { message: 'If that email belongs to an active administrator, a reset link will arrive shortly.' };
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(200).json(generic);
    const email = cleanEmail(req.body.email);
    try {
      await ensurePasswordSchema();
      const admin = await findAdminByEmail(email);
      if (!admin || (admin.role !== 'superadmin' && admin.client_status === 'suspended')) return res.json(generic);
      const rawToken = crypto.randomBytes(32).toString('base64url');
      const requestOrigin = resetOrigin(req);
      await db.query('UPDATE admin_password_resets SET used_at=NOW() WHERE admin_id=$1 AND used_at IS NULL', [admin.id]);
      await db.query(`INSERT INTO admin_password_resets(admin_id,token_hash,request_origin,requested_ip,expires_at)
                      VALUES($1,$2,$3,$4,$5)`, [
        admin.id, hashToken(rawToken), requestOrigin, req.ip || null,
        new Date(Date.now() + RESET_TTL_MS),
      ]);
      await sendPasswordResetEmail({
        admin, recipient: email,
        resetUrl: `${requestOrigin}/reset-password?token=${encodeURIComponent(rawToken)}`,
      });
      await logActivity({
        req: { ...req, user: publicAdmin(admin) }, action: 'password_reset_requested',
        entityType: 'admin', entityId: admin.id, description: 'Password reset email requested.',
        metadata: { client_id: admin.client_id, request_origin: requestOrigin },
      });
    } catch (error) {
      console.error('Password reset request failed:', error.response?.status || error.message);
    }
    return res.json(generic);
  });

router.get('/reset-password/validate', resetPasswordLimiter, async (req, res) => {
  const token = String(req.query.token || '');
  if (token.length < 40 || token.length > 300) return res.status(400).json({ error: 'This reset link is invalid or has already been used. Request a new link.' });
  try {
    await ensurePasswordSchema();
    const result = await db.query(`SELECT id FROM admin_password_resets
      WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW() LIMIT 1`, [hashToken(token)]);
    if (!result.rows[0]) return res.status(400).json({ error: 'This reset link is invalid or has already been used. Request a new link.' });
    return res.json({ valid: true });
  } catch (error) {
    console.error('Password reset validation failed:', error.message);
    return res.status(500).json({ error: 'Could not validate this reset link. Please try again.' });
  }
});

router.post('/reset-password', resetPasswordLimiter, [
  body('token').isString().isLength({ min: 40, max: 300 }),
  body('password').custom(strongPassword).withMessage('Use 12–128 characters and at least three of: uppercase, lowercase, number and symbol.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0]?.msg || 'Invalid reset request.' });
  const client = await db.connect();
  try {
    await ensurePasswordSchema();
    await client.query('BEGIN');
    const reset = await client.query(`SELECT r.id,r.admin_id,a.name,a.email,a.role,a.client_id
      FROM admin_password_resets r JOIN admins a ON a.id=r.admin_id
      WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at > NOW() FOR UPDATE`, [hashToken(req.body.token)]);
    if (!reset.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This reset link is invalid or expired. Request a new one.' });
    }
    const target = reset.rows[0];
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    await client.query(`UPDATE admins SET password_hash=$1,session_version=session_version+1,
      failed_login_count=0,locked_until=NULL WHERE id=$2`, [passwordHash, target.admin_id]);
    await client.query('UPDATE admin_password_resets SET used_at=NOW() WHERE id=$1', [target.id]);
    await client.query(`UPDATE admin_sessions SET revoked_at=NOW(),revoke_reason='password_reset'
                         WHERE admin_id=$1 AND revoked_at IS NULL`, [target.admin_id]);
    await client.query('COMMIT');
    await logActivity({
      req: { ...req, user: { ...target, id: target.admin_id } }, action: 'password_reset_completed', entityType: 'admin',
      entityId: target.admin_id, description: 'Password was reset and all sessions were revoked.',
      metadata: { client_id: target.client_id },
    });
    return res.json({ message: 'Password updated. Sign in again and complete secure verification.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Password reset failed:', error.message);
    return res.status(500).json({ error: 'Could not reset password. Request a new link.' });
  } finally {
    client.release();
  }
});

router.post('/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 1, max: 256 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Enter a valid email address and password.' });
  try {
    await ensurePasswordSchema();
    const admin = await findAdminByEmail(req.body.email);
    const validPassword = await bcrypt.compare(req.body.password, admin?.password_hash || DUMMY_PASSWORD_HASH);
    if (!admin || !validPassword) {
      await failedLogin(admin);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
      return res.status(423).json({ error: 'This account is temporarily locked after repeated failed sign-in attempts. Try again later.' });
    }
    if (admin.role !== 'superadmin' && admin.client_status === 'suspended') {
      return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
    }
    await successfulLogin(admin);
    return beginAuthentication(admin, req, res);
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ error: 'Sign-in could not be completed.' });
  }
});

router.post('/mfa/setup', mfaLimiter, async (req, res) => {
  try {
    const admin = await verifyChallenge(req.body.challenge, 'mfa_setup');
    const enrollment = await beginMfaEnrollment(admin);
    return res.json({
      enrollment_token: enrollment.enrollmentToken,
      secret: enrollment.secret,
      otpauth_uri: enrollment.uri,
      qr_data_url: enrollment.qrDataUrl,
      confirmation_challenge: await createChallenge(admin, 'mfa_setup_confirm'),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'MFA setup could not be started.' });
  }
});

router.post('/mfa/setup/confirm', mfaLimiter, async (req, res) => {
  try {
    const challengeAdmin = await verifyChallenge(req.body.challenge, 'mfa_setup_confirm');
    const result = await confirmMfaEnrollment(req.body.enrollment_token, req.body.code);
    if (result.admin.id !== challengeAdmin.id) throw new Error('MFA enrollment does not match this account.');
    await revokeAdminSessions(result.admin.id, 'mfa_enrolled');
    await createSession(result.admin, req, res);
    await logActivity({ req: { ...req, user: publicAdmin(result.admin) }, action: 'mfa_enabled', entityType: 'admin', entityId: result.admin.id, description: 'Multi-factor authentication was enabled.', metadata: { client_id: result.admin.client_id } });
    return res.json({ admin: publicAdmin(result.admin), recovery_codes: result.recoveryCodes });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'MFA setup could not be confirmed.' });
  }
});

router.post('/mfa/verify', mfaLimiter, async (req, res) => {
  try {
    const candidate = await verifyChallenge(req.body.challenge, 'mfa_login', { consume: false });
    if (!(await verifyMfa(candidate, req.body.code))) return res.status(401).json({ error: 'The verification code is incorrect.' });
    const admin = await verifyChallenge(req.body.challenge, 'mfa_login');
    await createSession(admin, req, res);
    await successfulLogin(admin);
    return res.json({ admin: publicAdmin(admin) });
  } catch (error) {
    return res.status(401).json({ error: 'The verification challenge is invalid or expired. Sign in again.' });
  }
});

router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const result = await rotateSession(req, res);
    if (!result) return res.status(401).json({ error: 'Session refresh failed. Sign in again.' });
    return res.json(result);
  } catch (error) {
    console.error('Session refresh failed:', error.message);
    return res.status(401).json({ error: 'Session refresh failed. Sign in again.' });
  }
});

router.get('/me', authMiddleware, (req, res) => res.json({ admin: req.user }));

router.post('/logout', async (req, res) => {
  const csrf = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!trustedOrigin(req) || !csrf || req.get('x-csrf-token') !== csrf) {
    return res.status(403).json({ error: 'Security validation failed.' });
  }
  await revokeCurrentSession(req, res, 'logout');
  return res.status(204).end();
});

function googleReturnTo(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname === 'billing.polyizon.tech' || url.hostname.endsWith('.billing.polyizon.tech')
    ) ? url.origin : null;
  } catch {
    return null;
  }
}

function oauthSecret() {
  const value = process.env.OAUTH_STATE_SECRET;
  if (!value || value.length < 32) throw new Error('OAUTH_STATE_SECRET is not configured securely');
  return value;
}

router.get('/google/start', loginLimiter, (req, res) => {
  const returnTo = googleReturnTo(req.query.return_to);
  if (!returnTo || !process.env.GOOGLE_OAUTH_CLIENT_ID) return res.status(400).send('Google sign-in is unavailable.');
  const state = jwt.sign({ return_to: returnTo, nonce: crypto.randomBytes(16).toString('hex') }, oauthSecret(), {
    expiresIn: '5m', issuer: 'polyizon-billing', audience: 'google-oauth',
  });
  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account',
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  try {
    await ensurePasswordSchema();
    const state = jwt.verify(String(req.query.state || ''), oauthSecret(), {
      issuer: 'polyizon-billing', audience: 'google-oauth',
    });
    const returnTo = googleReturnTo(state.return_to);
    if (!returnTo || !req.query.code) throw new Error('Invalid Google sign-in request.');
    const token = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code: String(req.query.code), client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI, grant_type: 'authorization_code',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
    const profile = (await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.data.access_token}` }, timeout: 15000,
    })).data;
    if (!profile.email_verified) throw new Error('Google email is not verified.');
    const admin = await findAdminByEmail(profile.email);
    if (!admin || (admin.role !== 'superadmin' && admin.client_status === 'suspended')) {
      throw new Error('This Google account is not authorized.');
    }
    let mode;
    let challenge;
    if (admin.mfa_enabled) {
      mode = 'mfa';
      challenge = await createChallenge(admin, 'mfa_login');
    } else if (mfaRequired()) {
      mode = 'setup';
      challenge = await createChallenge(admin, 'mfa_setup');
    } else {
      await createSession(admin, req, res);
      return res.redirect(`${returnTo}/login?google=success`);
    }
    return res.redirect(`${returnTo}/login#auth_mode=${mode}&auth_challenge=${encodeURIComponent(challenge)}`);
  } catch (error) {
    console.error('Google sign-in failed:', error.response?.data || error.message);
    return res.status(400).send('Google sign-in could not be completed. Return to the billing login and try again.');
  }
});

module.exports = router;
