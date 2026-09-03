const crypto = require('crypto');
const { Pool } = require('pg');

let radiusPool;

function encryptionKey() {
  const raw = String(process.env.RADIUS_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('RADIUS_CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex key');
  }
  return Buffer.from(raw, 'hex');
}

function decryptMigrationPassword(payload) {
  const [ivValue, tagValue, ciphertextValue] = String(payload || '').split('.');
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Stored migration credential is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function getRadiusPool() {
  if (String(process.env.RADIUS_SYNC_ENABLED || '').toLowerCase() !== 'true') {
    throw new Error('RADIUS_SYNC_ENABLED is not enabled');
  }
  if (!process.env.RADIUS_DATABASE_URL) throw new Error('RADIUS_DATABASE_URL is not configured');
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

function formatRadiusExpiration(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

async function syncHotspotMigrationMember(member) {
  const username = String(member?.username || '').trim();
  if (!username) throw new Error('Hotspot migration username is required');
  const expiresAt = member?.expires_at ? new Date(member.expires_at) : null;
  const active = member?.is_active !== false && expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt > new Date();
  const radius = getRadiusPool();
  const client = await radius.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [username]);
    await client.query('DELETE FROM radcheck WHERE username=$1', [username]);
    await client.query('DELETE FROM radreply WHERE username=$1', [username]);
    if (active) {
      const password = decryptMigrationPassword(member.password_ciphertext);
      const expiration = formatRadiusExpiration(expiresAt);
      const sessionTimeout = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
      await client.query(
        "INSERT INTO radcheck(username,attribute,op,value) VALUES($1,'Cleartext-Password',':=',$2),($1,'Expiration',':=',$3)",
        [username, password, expiration]
      );
      if (member.router_address) {
        await client.query(
          "INSERT INTO radcheck(username,attribute,op,value) VALUES($1,'NAS-IP-Address','==',$2)",
          [username, String(member.router_address).split('/')[0]]
        );
      }
      await client.query(
        "INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Session-Timeout',':=',$2)",
        [username, String(sessionTimeout)]
      );
      if (member.rate_limit) {
        await client.query(
          "INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Mikrotik-Rate-Limit',':=',$2)",
          [username, String(member.rate_limit)]
        );
      }
    }
    await client.query('COMMIT');
    return { status: active ? 'synced' : 'disabled', expires_at: expiresAt?.toISOString() || null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function verifyMigrationCredentials(usernames = []) {
  const unique = [...new Set(usernames.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!unique.length) return { expected: 0, ready: 0, missing: [] };
  const result = await getRadiusPool().query(
    `SELECT username,
            BOOL_OR(attribute='Cleartext-Password') AS has_password,
            BOOL_OR(attribute='Expiration') AS has_expiration
     FROM radcheck
     WHERE username=ANY($1::text[])
     GROUP BY username`,
    [unique]
  );
  const byUsername = new Map(result.rows.map((row) => [String(row.username), row]));
  const missing = unique.filter((username) => {
    const row = byUsername.get(username);
    return !row || row.has_password !== true || row.has_expiration !== true;
  });
  return { expected: unique.length, ready: unique.length - missing.length, missing };
}

module.exports = {
  decryptMigrationPassword,
  formatRadiusExpiration,
  syncHotspotMigrationMember,
  verifyMigrationCredentials,
};
