const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { logActivity } = require('../services/audit');

const ALL_PERMISSIONS = [
  'statistics', 'conversations', 'tickets', 'invoices', 'billing', 'communication',
  'escalations', 'installations', 'complaints', 'ai_health', 'admins', 'employees',
  'workflow', 'agent', 'settings', 'logs',
];
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_REQUEST_LIMIT = 3;
const RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const resetRateLimits = new Map();
let passwordSchemaReady;

function normalizePermissions(raw, role) {
  if (role === 'superadmin') return ALL_PERMISSIONS;
  if (!Array.isArray(raw) || raw.length === 0) return ALL_PERMISSIONS;
  const clean = [...new Set(raw.filter((p) => ALL_PERMISSIONS.includes(p)))];
  return clean.length > 0 ? clean : ['statistics'];
}

function cleanEmail(value) { return String(value || '').trim().toLowerCase(); }
function hashToken(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }

async function ensurePasswordSchema() {
  if (!passwordSchemaReady) {
    passwordSchemaReady = db.query(`
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE IF NOT EXISTS admin_password_resets (
        id BIGSERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        request_origin VARCHAR(500),
        requested_ip VARCHAR(80),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_password_resets_active ON admin_password_resets(admin_id, expires_at DESC) WHERE used_at IS NULL;
    `);
  }
  await passwordSchemaReady;
}

function requestKey(req, email) { return `${req.ip || 'unknown'}:${email}`; }
function allowedResetRequest(req, email) {
  const key = requestKey(req, email);
  const now = Date.now();
  const current = resetRateLimits.get(key);
  if (!current || current.expiresAt <= now) {
    resetRateLimits.set(key, { count: 1, expiresAt: now + RESET_REQUEST_WINDOW_MS });
    return true;
  }
  if (current.count >= RESET_REQUEST_LIMIT) return false;
  current.count += 1;
  return true;
}

function resetOrigin(req) {
  const origin = req.get('origin');
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' && (url.hostname === 'billing.polyizon.tech' || url.hostname.endsWith('.polyizon.tech'))) return url.origin;
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
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#151a33"><h1 style="margin:0 0 14px;color:#3524d9">POLYIZON BILLING SYSTEM</h1><p>Hello ${displayName},</p><p>We received a request to reset your administrator password. This secure link expires in 15 minutes and can only be used once.</p><p style="margin:26px 0"><a href="${resetUrl}" style="display:inline-block;background:#3535ff;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Reset password</a></p><p style="font-size:13px;color:#667085">If you did not request this, you can safely ignore this email. Your password will remain unchanged.</p></div>`,
  }, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 });
}

router.post('/forgot-password', [body('email').isEmail().normalizeEmail()], async (req, res) => {
  const generic = { message: 'If that email belongs to an active administrator, a reset link will arrive shortly.' };
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(200).json(generic);
  const email = cleanEmail(req.body.email);
  if (!allowedResetRequest(req, email)) return res.status(200).json(generic);
  try {
    await ensurePasswordSchema();
    const result = await db.query(`SELECT a.id, a.name, a.email, a.client_id, a.role, c.status AS client_status
      FROM admins a LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.email = $1 OR (a.role <> 'superadmin' AND c.contact_email = $1)
      ORDER BY CASE WHEN a.email = $1 THEN 0 ELSE 1 END, a.created_at ASC LIMIT 1`, [email]);
    const admin = result.rows[0];
    if (!admin || (admin.role !== 'superadmin' && admin.client_status === 'suspended')) return res.json(generic);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const requestOrigin = resetOrigin(req);
    await db.query('UPDATE admin_password_resets SET used_at = NOW() WHERE admin_id = $1 AND used_at IS NULL', [admin.id]);
    await db.query(`INSERT INTO admin_password_resets (admin_id, token_hash, request_origin, requested_ip, expires_at)
      VALUES ($1, $2, $3, $4, $5)`, [admin.id, hashToken(rawToken), requestOrigin, req.ip || null, new Date(Date.now() + RESET_TTL_MS)]);
    await sendPasswordResetEmail({ admin, recipient: email, resetUrl: `${requestOrigin}/reset-password?token=${encodeURIComponent(rawToken)}` });
    await logActivity({ req: { ...req, user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, client_id: admin.client_id } }, action: 'password_reset_requested', entityType: 'admin', entityId: admin.id, description: 'Password reset email requested.', metadata: { client_id: admin.client_id, request_origin: requestOrigin } });
  } catch (error) {
    console.error('Password reset request failed:', error.response?.status || error.message);
  }
  return res.json(generic);
});

router.get('/reset-password/validate', async (req, res) => {
  const token = String(req.query.token || '');
  if (token.length < 40 || token.length > 300) return res.status(400).json({ error: 'This reset link is invalid or has already been used. Request a new link.' });
  try {
    await ensurePasswordSchema();
    const result = await db.query(`SELECT id FROM admin_password_resets
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() LIMIT 1`, [hashToken(token)]);
    if (!result.rows[0]) return res.status(400).json({ error: 'This reset link is invalid or has already been used. Request a new link.' });
    return res.json({ valid: true });
  } catch (error) {
    console.error('Password reset validation failed:', error.message);
    return res.status(500).json({ error: 'Could not validate this reset link. Please try again.' });
  }
});

router.post('/reset-password', [body('token').isString().isLength({ min: 40, max: 300 }), body('password').isLength({ min: 10 }).withMessage('Use at least 10 characters.')], async (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0]?.msg || 'Invalid reset request.' });
  const client = await db.connect();
  try {
    await ensurePasswordSchema();
    await client.query('BEGIN');
    const reset = await client.query(`SELECT r.id, r.admin_id, a.name, a.email, a.role, a.client_id
      FROM admin_password_resets r JOIN admins a ON a.id = r.admin_id
      WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > NOW() FOR UPDATE`, [hashToken(req.body.token)]);
    if (!reset.rows[0]) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' }); }
    const target = reset.rows[0];
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    await client.query('UPDATE admins SET password_hash = $1, session_version = session_version + 1 WHERE id = $2', [passwordHash, target.admin_id]);
    await client.query('UPDATE admin_password_resets SET used_at = NOW() WHERE id = $1', [target.id]);
    await client.query('COMMIT');
    await logActivity({ req: { ...req, user: { id: target.admin_id, name: target.name, email: target.email, role: target.role, client_id: target.client_id } }, action: 'password_reset_completed', entityType: 'admin', entityId: target.admin_id, description: 'Password was reset through a one-time email link.', metadata: { client_id: target.client_id } });
    return res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Password reset failed:', error.message);
    return res.status(500).json({ error: 'Could not reset password. Please request a new link.' });
  } finally { client.release(); }
});

router.post('/login', [body('email').isEmail().normalizeEmail(), body('password').notEmpty().withMessage('Password is required')], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { email, password } = req.body;
  try {
    await ensurePasswordSchema();
    const result = await db.query(`SELECT a.*, c.name AS client_name, c.business_name AS client_business_name, c.status AS client_status, c.account_type AS client_account_type
      FROM admins a LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.email = $1 OR (a.role <> 'superadmin' AND c.contact_email = $1)
      ORDER BY CASE WHEN a.email = $1 THEN 0 ELSE 1 END, a.created_at ASC`, [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const admin = result.rows[0];
    if (!(await bcrypt.compare(password, admin.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
    if (admin.role !== 'superadmin' && admin.client_status === 'suspended') return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
    const permissions = normalizePermissions(admin.permissions, admin.role);
    const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role, name: admin.name, client_id: admin.client_id || null, account_type: admin.client_account_type || 'ai', permissions, session_version: admin.session_version || 1 }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, client_id: admin.client_id || null, account_type: admin.client_account_type || 'ai', client_name: admin.client_name || null, client_business_name: admin.client_business_name || null, permissions } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

function googleReturnTo(value) { try { const u=new URL(value); return u.protocol==='https:' && (u.hostname==='billing.polyizon.tech' || u.hostname.endsWith('.polyizon.tech')) ? u.origin : null; } catch { return null; } }
router.get('/google/start', (req,res) => {
  const returnTo=googleReturnTo(req.query.return_to); if(!returnTo || !process.env.GOOGLE_OAUTH_CLIENT_ID) return res.status(400).send('Google sign-in is unavailable.');
  const state=jwt.sign({ return_to:returnTo, nonce:crypto.randomBytes(16).toString('hex') }, process.env.JWT_SECRET, { expiresIn:'10m' });
  const q=new URLSearchParams({ client_id:process.env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri:process.env.GOOGLE_OAUTH_REDIRECT_URI, response_type:'code', scope:'openid email profile', state, prompt:'select_account' });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+q.toString());
});
router.get('/google/callback', async (req,res) => {
  try {
    const state=jwt.verify(String(req.query.state||''),process.env.JWT_SECRET); const returnTo=googleReturnTo(state.return_to); if(!returnTo || !req.query.code) throw new Error('Invalid Google sign-in request.');
    const token=await axios.post('https://oauth2.googleapis.com/token',new URLSearchParams({ code:String(req.query.code), client_id:process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirect_uri:process.env.GOOGLE_OAUTH_REDIRECT_URI, grant_type:'authorization_code' }).toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:15000});
    const profile=(await axios.get('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.data.access_token},timeout:15000})).data; if(!profile.email_verified) throw new Error('Google email is not verified.');
    const result=await db.query("SELECT a.*, c.name AS client_name, c.business_name AS client_business_name, c.status AS client_status, c.account_type AS client_account_type FROM admins a LEFT JOIN clients c ON c.id=a.client_id WHERE a.email=$1 OR (a.role <> 'superadmin' AND c.contact_email=$1) ORDER BY CASE WHEN a.email=$1 THEN 0 ELSE 1 END, a.created_at ASC LIMIT 1",[cleanEmail(profile.email)]);
    const admin=result.rows[0]; if(!admin || (admin.role!=='superadmin' && admin.client_status==='suspended')) throw new Error('This Google account is not authorized for a billing account.');
    const permissions=normalizePermissions(admin.permissions,admin.role); const appToken=jwt.sign({id:admin.id,email:admin.email,role:admin.role,name:admin.name,client_id:admin.client_id||null,account_type:admin.client_account_type||'ai',permissions,session_version:admin.session_version||1},process.env.JWT_SECRET,{expiresIn:'24h'});
    res.redirect(returnTo+'/login#google_token='+encodeURIComponent(appToken));
  } catch(error) { console.error('Google sign-in failed:',error.response?.data||error.message); res.status(400).send('Google sign-in could not be completed. Return to the billing login and try again.'); }
});

module.exports = router;