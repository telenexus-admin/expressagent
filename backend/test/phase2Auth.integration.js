'use strict';
const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { generate } = require('otplib');

process.env.AUTH_DATA_ENCRYPTION_KEY ||= crypto.randomBytes(48).toString('base64url');
process.env.AUTH_CHALLENGE_SECRET ||= crypto.randomBytes(48).toString('base64url');
process.env.OAUTH_STATE_SECRET ||= crypto.randomBytes(48).toString('base64url');
process.env.AUTH_MFA_REQUIRED = 'true';
process.env.ALLOW_LEGACY_BEARER = 'false';
process.env.FRONTEND_URL = 'https://billing.polyizon.tech';

const db = require('../src/db');
const authRoutes = require('../src/routes/auth');
const { authMiddleware } = require('../src/middleware/auth');

const origin = 'https://billing.polyizon.tech';
const cookieNames = ['__Host-polyizon_access', '__Host-polyizon_refresh', 'polyizon_csrf'];

function updateJar(response, jar) {
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  for (const header of values) {
    const pair = header.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).filter(([key]) => cookieNames.includes(key)).map(([key, value]) => `${key}=${value}`).join('; ');
}

async function jsonRequest(base, pathname, options = {}, jar = {}) {
  const headers = { Origin: origin, ...(options.headers || {}) };
  if (Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  updateJar(response, jar);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
}

async function main() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `phase2-${suffix}@polyizon.invalid`;
  const lockEmail = `phase2-lock-${suffix}@polyizon.invalid`;
  const password = 'Phase2-Test!9384';
  let clientId;
  let adminId;
  let lockAdminId;
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.post('/api/test/protected', authMiddleware, (req, res) => res.json({ ok: true, admin: req.user.id }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const client = await db.query(`INSERT INTO clients(name,business_name,status,account_type) VALUES($1,$2,'active','billing') RETURNING id`, [`Phase2 ${suffix}`, `Phase2 ${suffix}`]);
    clientId = client.rows[0].id;
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await db.query(`INSERT INTO admins(name,email,password_hash,role,client_id,permissions) VALUES($1,$2,$3,'admin',$4,'[]'::jsonb) RETURNING id`, ['Phase2 Test', email, passwordHash, clientId]);
    adminId = admin.rows[0].id;
    const lockAdmin = await db.query(`INSERT INTO admins(name,email,password_hash,role,client_id,permissions) VALUES($1,$2,$3,'admin',$4,'[]'::jsonb) RETURNING id`, ['Phase2 Lock Test', lockEmail, passwordHash, clientId]);
    lockAdminId = lockAdmin.rows[0].id;

    const jar = {};
    let result = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { email, password } }, jar);
    assert.equal(result.response.status, 202);
    assert.equal(result.data.mfa_setup_required, true);

    result = await jsonRequest(base, '/api/auth/mfa/setup', { method: 'POST', body: { challenge: result.data.challenge } }, jar);
    assert.equal(result.response.status, 200);
    assert.match(result.data.qr_data_url, /^data:image\/png;base64,/);
    const secret = result.data.secret;
    const setupCode = await generate({ secret });
    result = await jsonRequest(base, '/api/auth/mfa/setup/confirm', { method: 'POST', body: { challenge: result.data.confirmation_challenge, enrollment_token: result.data.enrollment_token, code: setupCode } }, jar);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.recovery_codes.length, 10);
    assert.ok(jar['__Host-polyizon_access'] && jar['__Host-polyizon_refresh'] && jar.polyizon_csrf);

    result = await jsonRequest(base, '/api/auth/me', { method: 'GET' }, jar);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.admin.id, adminId);

    result = await jsonRequest(base, '/api/test/protected', { method: 'POST', body: {} }, jar);
    assert.equal(result.response.status, 403);
    result = await jsonRequest(base, '/api/test/protected', { method: 'POST', headers: { 'X-CSRF-Token': jar.polyizon_csrf }, body: {} }, jar);
    assert.equal(result.response.status, 200);

    const oldJar = { ...jar };
    result = await jsonRequest(base, '/api/auth/refresh', { method: 'POST', headers: { 'X-CSRF-Token': jar.polyizon_csrf } }, jar);
    assert.equal(result.response.status, 200);
    assert.notEqual(jar['__Host-polyizon_refresh'], oldJar['__Host-polyizon_refresh']);
    result = await jsonRequest(base, '/api/auth/refresh', { method: 'POST', headers: { 'X-CSRF-Token': oldJar.polyizon_csrf } }, oldJar);
    assert.equal(result.response.status, 401);
    result = await jsonRequest(base, '/api/auth/me', { method: 'GET' }, jar);
    assert.equal(result.response.status, 401);

    const mfaJar = {};
    result = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { email, password } }, mfaJar);
    assert.equal(result.response.status, 202);
    const mfaChallenge = result.data.challenge;
    const mfaCode = await generate({ secret });
    result = await jsonRequest(base, '/api/auth/mfa/verify', { method: 'POST', body: { challenge: mfaChallenge, code: mfaCode } }, mfaJar);
    assert.equal(result.response.status, 200);
    result = await jsonRequest(base, '/api/auth/mfa/verify', { method: 'POST', body: { challenge: mfaChallenge, code: mfaCode } }, {});
    assert.equal(result.response.status, 401);

    const rawReset = crypto.randomBytes(32).toString('base64url');
    const resetHash = crypto.createHash('sha256').update(rawReset).digest('hex');
    await db.query(`INSERT INTO admin_password_resets(admin_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '15 minutes')`, [adminId, resetHash]);
    const newPassword = 'Phase2-New!73915';
    result = await jsonRequest(base, '/api/auth/reset-password', { method: 'POST', body: { token: rawReset, password: newPassword } }, {});
    assert.equal(result.response.status, 200);
    result = await jsonRequest(base, '/api/auth/reset-password', { method: 'POST', body: { token: rawReset, password: newPassword } }, {});
    assert.equal(result.response.status, 400);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      result = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { email: lockEmail, password: 'Definitely-Wrong!1' } }, {});
      assert.equal(result.response.status, 401);
    }
    result = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { email: lockEmail, password } }, {});
    assert.equal(result.response.status, 423);

    console.log(JSON.stringify({ ok: true, tests: ['forced_mfa', 'totp', 'recovery_codes', 'http_only_session', 'csrf', 'refresh_rotation', 'refresh_reuse_revocation', 'one_time_challenge', 'one_time_password_reset', 'account_lockout'] }));
  } finally {
    server.close();
    if (adminId || lockAdminId) await db.query('DELETE FROM admins WHERE id = ANY($1::int[])', [[adminId, lockAdminId].filter(Boolean)]).catch(() => {});
    if (clientId) await db.query('DELETE FROM clients WHERE id=$1', [clientId]).catch(() => {});
    await db.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
