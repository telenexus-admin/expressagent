const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { generateSecret, generateURI, verify: verifyOtp } = require('otplib');
const db = require('../db');

const ACCESS_COOKIE = '__Host-polyizon_access';
const REFRESH_COOKIE = '__Host-polyizon_refresh';
const CSRF_COOKIE = 'polyizon_csrf';
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL = '5m';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
let schemaPromise;

function requiredSecret(name, fallbackName) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : '');
  if (!value || value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function requestFingerprint(req) {
  return {
    ipHash: hash(req.ip || req.socket?.remoteAddress || 'unknown'),
    userAgentHash: hash(req.get?.('user-agent') || 'unknown'),
  };
}

function encryptionKey() {
  return crypto.createHash('sha256').update(requiredSecret('AUTH_DATA_ENCRYPTION_KEY')).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value) {
  const [ivText, tagText, encryptedText] = String(value || '').split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('Encrypted authentication data is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function ensureSecuritySchema() {
  if (!schemaPromise) {
    schemaPromise = db.query(`
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS mfa_recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id UUID PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        access_token_hash CHAR(64) NOT NULL UNIQUE,
        refresh_token_hash CHAR(64) NOT NULL UNIQUE,
        csrf_token_hash CHAR(64) NOT NULL,
        session_version INTEGER NOT NULL,
        ip_hash CHAR(64) NOT NULL,
        user_agent_hash CHAR(64) NOT NULL,
        acting_role VARCHAR(32),
        acting_client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        parent_session_id UUID REFERENCES admin_sessions(id) ON DELETE SET NULL,
        access_expires_at TIMESTAMPTZ NOT NULL,
        refresh_expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        revoke_reason VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_sessions_active
        ON admin_sessions(admin_id, refresh_expires_at DESC) WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS admin_refresh_token_history (
        token_hash CHAR(64) PRIMARY KEY,
        session_id UUID NOT NULL REFERENCES admin_sessions(id) ON DELETE CASCADE,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS admin_mfa_enrollments (
        token_hash CHAR(64) PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        secret_encrypted TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_mfa_enrollments_expiry ON admin_mfa_enrollments(expires_at);

      CREATE TABLE IF NOT EXISTS admin_auth_challenges (
        jti_hash CHAR(64) PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        purpose VARCHAR(50) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_auth_challenges_expiry ON admin_auth_challenges(expires_at);
    `);
  }
  return schemaPromise;
}

function cookieBase(httpOnly = true) {
  return {
    httpOnly,
    secure: true,
    sameSite: 'strict',
    path: '/',
  };
}

function setSessionCookies(res, tokens) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...cookieBase(true),
    maxAge: ACCESS_TTL_MS,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieBase(true),
    maxAge: REFRESH_TTL_MS,
  });
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...cookieBase(false),
    maxAge: REFRESH_TTL_MS,
  });
}

function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, cookieBase(true));
  res.clearCookie(REFRESH_COOKIE, cookieBase(true));
  res.clearCookie(CSRF_COOKIE, cookieBase(false));
}

function permissionsFor(admin) {
  if (admin.role === 'superadmin') return admin.permissions || [];
  return Array.isArray(admin.permissions) ? admin.permissions : [];
}

function adminView(row) {
  const role = row.acting_role || row.role;
  const clientId = row.acting_client_id || row.client_id || null;
  return {
    id: row.id || row.admin_id,
    name: row.acting_role ? `${row.name || 'Operator'} · Operator Access` : row.name,
    email: row.email,
    role,
    client_id: clientId,
    account_type: row.client_account_type || 'ai',
    client_name: row.client_name || null,
    client_business_name: row.client_business_name || null,
    permissions: row.acting_role ? permissionsFor({ role, permissions: row.permissions }) : permissionsFor(row),
    session_version: row.session_version,
    mfa_enabled: Boolean(row.mfa_enabled),
    operator_impersonation: Boolean(row.acting_role),
    operator_id: row.acting_role ? (row.id || row.admin_id) : null,
  };
}

async function loadAdmin(adminId, client = db) {
  const result = await client.query(`
    SELECT a.*, c.name AS client_name, c.business_name AS client_business_name,
           c.status AS client_status, c.account_type AS client_account_type
      FROM admins a
      LEFT JOIN clients c ON c.id = a.client_id
     WHERE a.id = $1
     LIMIT 1`, [adminId]);
  return result.rows[0] || null;
}

async function createSession(admin, req, res, options = {}) {
  await ensureSecuritySchema();
  const accessToken = randomToken(32);
  const refreshToken = randomToken(48);
  const csrfToken = randomToken(32);
  const id = crypto.randomUUID();
  const fingerprint = requestFingerprint(req);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await db.query(`
    INSERT INTO admin_sessions (
      id, admin_id, access_token_hash, refresh_token_hash, csrf_token_hash,
      session_version, ip_hash, user_agent_hash, acting_role, acting_client_id,
      parent_session_id, access_expires_at, refresh_expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
    id,
    admin.id,
    hash(accessToken),
    hash(refreshToken),
    hash(csrfToken),
    admin.session_version || 1,
    fingerprint.ipHash,
    fingerprint.userAgentHash,
    options.actingRole || null,
    options.actingClientId || null,
    options.parentSessionId || null,
    accessExpiresAt,
    refreshExpiresAt,
  ]);
  await db.query(`
    UPDATE admin_sessions SET revoked_at = NOW(), revoke_reason = 'session_limit'
     WHERE id IN (
       SELECT id FROM admin_sessions
        WHERE admin_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC OFFSET 5
     )`, [admin.id]);
  setSessionCookies(res, { accessToken, refreshToken, csrfToken });
  return { sessionId: id, csrfToken };
}

async function authenticateAccessCookie(req) {
  await ensureSecuritySchema();
  const raw = req.cookies?.[ACCESS_COOKIE];
  if (!raw || raw.length < 40 || raw.length > 200) return null;
  const result = await db.query(`
    SELECT s.id AS auth_session_id, s.csrf_token_hash, s.user_agent_hash, s.ip_hash, s.acting_role, s.acting_client_id,
           s.parent_session_id, a.*, c.name AS client_name,
           c.business_name AS client_business_name, c.status AS client_status,
           c.account_type AS client_account_type
      FROM admin_sessions s
      JOIN admins a ON a.id = s.admin_id
      LEFT JOIN clients c ON c.id = COALESCE(s.acting_client_id, a.client_id)
     WHERE s.access_token_hash = $1
       AND s.revoked_at IS NULL
       AND s.access_expires_at > NOW()
       AND s.session_version = a.session_version
     LIMIT 1`, [hash(raw)]);
  const row = result.rows[0];
  if (!row) return null;
  if ((row.acting_role || row.role) !== 'superadmin' && row.client_status === 'suspended') return null;
  const fingerprint = requestFingerprint(req);
  if (row.user_agent_hash !== fingerprint.userAgentHash) {
    await db.query(`UPDATE admin_sessions SET revoked_at=NOW(), revoke_reason='fingerprint_mismatch'
                     WHERE id=$1 AND revoked_at IS NULL`, [row.auth_session_id]);
    return null;
  }
  db.query(`UPDATE admin_sessions SET last_seen_at = NOW()
             WHERE id = $1 AND last_seen_at < NOW() - INTERVAL '5 minutes'`, [row.auth_session_id]).catch(() => {});
  return { row, user: adminView(row) };
}

function trustedOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (
      url.hostname === 'billing.polyizon.tech' ||
      url.hostname === 'demo.polyizon.tech'
    );
  } catch {
    return false;
  }
}

function verifyCsrf(req, auth) {
  if (SAFE_METHODS.has(req.method)) return true;
  if (!trustedOrigin(req)) return false;
  const header = String(req.get('x-csrf-token') || '');
  const cookie = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!header || header !== cookie || hash(header) !== auth.row.csrf_token_hash) return false;
  return true;
}

async function rotateSession(req, res) {
  await ensureSecuritySchema();
  const rawRefresh = String(req.cookies?.[REFRESH_COOKIE] || '');
  const csrf = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!rawRefresh || !csrf || !trustedOrigin(req) || req.get('x-csrf-token') !== csrf) return null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`
      SELECT s.*, a.session_version AS current_session_version
        FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
       WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL
         AND s.refresh_expires_at > NOW()
         AND s.last_seen_at > NOW() - INTERVAL '12 hours' FOR UPDATE`, [hash(rawRefresh)]);
    const session = current.rows[0];
    if (!session) {
      const reused = await client.query(`SELECT admin_id FROM admin_refresh_token_history WHERE token_hash = $1 LIMIT 1`, [hash(rawRefresh)]);
      if (reused.rows[0]) {
        await client.query(`UPDATE admin_sessions SET revoked_at = NOW(), revoke_reason = 'refresh_reuse' WHERE admin_id = $1 AND revoked_at IS NULL`, [reused.rows[0].admin_id]);
      }
      await client.query('COMMIT');
      clearSessionCookies(res);
      return null;
    }
    if (session.session_version !== session.current_session_version || hash(csrf) !== session.csrf_token_hash) {
      await client.query(`UPDATE admin_sessions SET revoked_at = NOW(), revoke_reason = 'session_mismatch' WHERE id = $1`, [session.id]);
      await client.query('COMMIT');
      clearSessionCookies(res);
      return null;
    }
    const accessToken = randomToken(32);
    const refreshToken = randomToken(48);
    const csrfToken = randomToken(32);
    const fingerprint = requestFingerprint(req);
    await client.query(`INSERT INTO admin_refresh_token_history(token_hash, session_id, admin_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [hash(rawRefresh), session.id, session.admin_id]);
    await client.query(`
      UPDATE admin_sessions
         SET access_token_hash=$1, refresh_token_hash=$2, csrf_token_hash=$3,
             access_expires_at=$4, refresh_expires_at=$5, ip_hash=$6,
             user_agent_hash=$7, last_seen_at=NOW()
       WHERE id=$8`, [
      hash(accessToken), hash(refreshToken), hash(csrfToken),
      new Date(Date.now() + ACCESS_TTL_MS), session.refresh_expires_at,
      fingerprint.ipHash, fingerprint.userAgentHash, session.id,
    ]);
    const admin = await loadAdmin(session.admin_id, client);
    await client.query('COMMIT');
    setSessionCookies(res, { accessToken, refreshToken, csrfToken });
    return {
      admin: adminView({ ...admin, acting_role: session.acting_role, acting_client_id: session.acting_client_id }),
      csrfToken,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function revokeCurrentSession(req, res, reason = 'logout') {
  const access = req.cookies?.[ACCESS_COOKIE];
  const refresh = req.cookies?.[REFRESH_COOKIE];
  if (access || refresh) {
    await db.query(`UPDATE admin_sessions SET revoked_at=NOW(), revoke_reason=$1
                     WHERE revoked_at IS NULL AND (access_token_hash=$2 OR refresh_token_hash=$3)`, [
      reason, hash(access || ''), hash(refresh || ''),
    ]);
  }
  clearSessionCookies(res);
}

async function revokeAdminSessions(adminId, reason = 'security_change') {
  await ensureSecuritySchema();
  await db.query(`UPDATE admin_sessions SET revoked_at=NOW(), revoke_reason=$2 WHERE admin_id=$1 AND revoked_at IS NULL`, [adminId, reason]);
}

async function createChallenge(admin, purpose) {
  await ensureSecuritySchema();
  const jti = crypto.randomUUID();
  await db.query(`INSERT INTO admin_auth_challenges(jti_hash,admin_id,purpose,expires_at)
                  VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes')`, [hash(jti), admin.id, purpose]);
  return jwt.sign({ sub: String(admin.id), purpose, session_version: admin.session_version || 1, jti },
    requiredSecret('AUTH_CHALLENGE_SECRET'),
    { expiresIn: CHALLENGE_TTL, issuer: 'polyizon-billing', audience: 'polyizon-auth' });
}

async function verifyChallenge(token, expectedPurpose, options = {}) {
  const consume = options.consume !== false;
  const payload = jwt.verify(String(token || ''), requiredSecret('AUTH_CHALLENGE_SECRET'), {
    issuer: 'polyizon-billing', audience: 'polyizon-auth',
  });
  if (payload.purpose !== expectedPurpose || !payload.jti) throw new Error('Authentication challenge purpose is invalid');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const challenge = consume
      ? await client.query(`UPDATE admin_auth_challenges
          SET used_at=NOW() WHERE jti_hash=$1 AND admin_id=$2 AND purpose=$3
          AND used_at IS NULL AND expires_at > NOW() RETURNING admin_id`,
        [hash(payload.jti), Number(payload.sub), expectedPurpose])
      : await client.query(`SELECT admin_id FROM admin_auth_challenges
          WHERE jti_hash=$1 AND admin_id=$2 AND purpose=$3
          AND used_at IS NULL AND expires_at > NOW() FOR SHARE`,
        [hash(payload.jti), Number(payload.sub), expectedPurpose]);
    if (!challenge.rows[0]) throw new Error('Authentication challenge was already used or expired');
    const admin = await loadAdmin(Number(payload.sub), client);
    if (!admin || Number(payload.session_version) !== Number(admin.session_version || 1)) throw new Error('Authentication challenge has expired');
    await client.query('COMMIT');
    return admin;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function beginMfaEnrollment(admin) {
  await ensureSecuritySchema();
  const secret = generateSecret();
  const token = randomToken(32);
  const issuer = 'POLYIZON Billing';
  const uri = generateURI({ issuer, label: admin.email, secret });
  await db.query(`DELETE FROM admin_mfa_enrollments WHERE admin_id=$1 OR expires_at <= NOW()`, [admin.id]);
  await db.query(`INSERT INTO admin_mfa_enrollments(token_hash,admin_id,secret_encrypted,expires_at)
                  VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')`, [hash(token), admin.id, encrypt(secret)]);
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return { enrollmentToken: token, secret, uri, qrDataUrl };
}

async function confirmMfaEnrollment(enrollmentToken, code) {
  await ensureSecuritySchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT * FROM admin_mfa_enrollments
      WHERE token_hash=$1 AND expires_at > NOW() FOR UPDATE`, [hash(enrollmentToken)]);
    const enrollment = result.rows[0];
    if (!enrollment) throw new Error('MFA enrollment has expired. Start again.');
    const secret = decrypt(enrollment.secret_encrypted);
    const verified = await verifyOtp({ secret, token: String(code || ''), epochTolerance: 30 });
    if (!verified.valid) throw new Error('The verification code is incorrect.');
    const recoveryCodes = Array.from({ length: 10 }, () => `${randomToken(5).slice(0, 5)}-${randomToken(5).slice(0, 5)}`.toUpperCase());
    const recoveryHashes = recoveryCodes.map(hash);
    await client.query(`UPDATE admins SET mfa_enabled=TRUE,mfa_secret_encrypted=$1,
      mfa_recovery_hashes=$2::jsonb,mfa_enrolled_at=NOW(),failed_login_count=0,locked_until=NULL
      WHERE id=$3`, [encrypt(secret), JSON.stringify(recoveryHashes), enrollment.admin_id]);
    await client.query(`DELETE FROM admin_mfa_enrollments WHERE admin_id=$1`, [enrollment.admin_id]);
    const admin = await loadAdmin(enrollment.admin_id, client);
    await client.query('COMMIT');
    return { admin, recoveryCodes };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyMfa(admin, code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!admin.mfa_enabled || !admin.mfa_secret_encrypted) return false;
  if (/^\d{6}$/.test(normalized)) {
    const verified = await verifyOtp({ secret: decrypt(admin.mfa_secret_encrypted), token: normalized, epochTolerance: 30 });
    if (verified.valid) return true;
  }
  if (/^[A-Z0-9_-]{5}-[A-Z0-9_-]{5}$/.test(normalized)) {
    const codeHash = hash(normalized);
    const hashes = Array.isArray(admin.mfa_recovery_hashes) ? admin.mfa_recovery_hashes : [];
    if (hashes.includes(codeHash)) {
      await db.query(`UPDATE admins SET mfa_recovery_hashes = $1::jsonb WHERE id=$2`, [JSON.stringify(hashes.filter((item) => item !== codeHash)), admin.id]);
      return true;
    }
  }
  return false;
}

async function startImpersonation(req, res, clientId) {
  const admin = await loadAdmin(req.user.id);
  return createSession(admin, req, res, {
    actingRole: 'admin',
    actingClientId: clientId,
    parentSessionId: req.authSessionId,
  });
}

async function returnFromImpersonation(req, res) {
  if (!req.authRow?.parent_session_id) return null;
  const parent = await db.query(`SELECT admin_id FROM admin_sessions WHERE id=$1 AND revoked_at IS NULL LIMIT 1`, [req.authRow.parent_session_id]);
  if (!parent.rows[0]) return null;
  await revokeCurrentSession(req, res, 'impersonation_complete');
  const admin = await loadAdmin(parent.rows[0].admin_id);
  await db.query(`UPDATE admin_sessions SET revoked_at=NOW(),revoke_reason='parent_rotated' WHERE id=$1`, [req.authRow.parent_session_id]);
  await createSession(admin, req, res);
  return adminView(admin);
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  ensureSecuritySchema,
  adminView,
  loadAdmin,
  createSession,
  authenticateAccessCookie,
  verifyCsrf,
  rotateSession,
  revokeCurrentSession,
  revokeAdminSessions,
  createChallenge,
  verifyChallenge,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  verifyMfa,
  startImpersonation,
  returnFromImpersonation,
  trustedOrigin,
};
