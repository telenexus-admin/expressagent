const { Pool } = require('pg');

let radiusPool;

function normalizeAccountNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizePppoeUsername(value) {
  return String(value || '').trim();
}

function formatRate(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
}

function rateLimitFromPlan(plan = {}) {
  const configured = String(plan.radius_profile || '').trim();
  if (configured) return configured;

  const upload = formatRate(plan.upload_speed_mbps);
  const download = formatRate(plan.download_speed_mbps);
  if (!upload || !download) return null;

  return `${upload}M/${download}M`;
}

function formatRadiusExpiration(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) throw new Error('A valid PPPoE expiry time is required');

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (part) => String(part).padStart(2, '0');

  return `${pad(value.getUTCDate())} ${months[value.getUTCMonth()]} ${value.getUTCFullYear()} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}

function getRadiusPool() {
  if (String(process.env.RADIUS_SYNC_ENABLED || '').toLowerCase() !== 'true') {
    const error = new Error('Polyizon RADIUS synchronization is not enabled');
    error.code = 'RADIUS_NOT_CONFIGURED';
    throw error;
  }

  if (!process.env.RADIUS_DATABASE_URL) {
    const error = new Error('Polyizon RADIUS database is not configured');
    error.code = 'RADIUS_NOT_CONFIGURED';
    throw error;
  }

  if (!radiusPool) {
    radiusPool = new Pool({
      connectionString: process.env.RADIUS_DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
      query_timeout: 5000,
    });
  }

  return radiusPool;
}

async function provisionRadiusCredential({ username, password, expiresAt, rateLimit }) {
  const cleanUsername = normalizePppoeUsername(username);
  const cleanPassword = String(password || '');
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);

  if (!cleanUsername) throw new Error('PPPoE username is required');
  if (!cleanPassword) throw new Error('PPPoE password is required');
  if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) throw new Error('PPPoE expiry must be in the future');
  if (!String(rateLimit || '').trim()) throw new Error('The selected package has no RADIUS speed profile');

  const client = await getRadiusPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [cleanUsername.toLowerCase()]);

    const existing = await client.query(
      `SELECT 1
       FROM (
         SELECT username FROM radcheck WHERE LOWER(username) = LOWER($1)
         UNION ALL
         SELECT username FROM radreply WHERE LOWER(username) = LOWER($1)
       ) existing
       LIMIT 1`,
      [cleanUsername]
    );

    if (existing.rows[0]) {
      const error = new Error('That PPPoE username already exists in the central RADIUS server');
      error.code = 'RADIUS_USERNAME_EXISTS';
      throw error;
    }

    const expiration = formatRadiusExpiration(expiry);
    const sessionTimeout = Math.max(1, Math.ceil((expiry.getTime() - Date.now()) / 1000));

    await client.query(
      `INSERT INTO radcheck (username, attribute, op, value)
       VALUES
         ($1, 'Cleartext-Password', ':=', $2),
         ($1, 'Expiration', ':=', $3)`,
      [cleanUsername, cleanPassword, expiration]
    );

    await client.query(
      `INSERT INTO radreply (username, attribute, op, value)
       VALUES
         ($1, 'Session-Timeout', ':=', $2),
         ($1, 'Mikrotik-Rate-Limit', ':=', $3)`,
      [cleanUsername, String(sessionTimeout), String(rateLimit).trim()]
    );

    await client.query('COMMIT');

    return {
      status: 'synced',
      username: cleanUsername,
      expires_at: expiry.toISOString(),
      rate_limit: String(rateLimit).trim(),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function removeRadiusCredential(username) {
  const cleanUsername = normalizePppoeUsername(username);
  if (!cleanUsername) return;

  const client = await getRadiusPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [cleanUsername.toLowerCase()]);
    await client.query('DELETE FROM radcheck WHERE LOWER(username) = LOWER($1)', [cleanUsername]);
    await client.query('DELETE FROM radreply WHERE LOWER(username) = LOWER($1)', [cleanUsername]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  formatRadiusExpiration,
  normalizeAccountNumber,
  normalizePppoeUsername,
  provisionRadiusCredential,
  rateLimitFromPlan,
  removeRadiusCredential,
};
