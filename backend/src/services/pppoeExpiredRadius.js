const crypto = require('crypto');
const { Pool } = require('pg');
const db = require('../db');
const {
  EXPIRED_ADDRESS_LIST,
  expiredPaywallRateLimit,
  expiredPaywallSessionTimeout,
} = require('./pppoeExpiredPaywall');

let pool;

function radiusPool() {
  if (String(process.env.RADIUS_SYNC_ENABLED || '').toLowerCase() !== 'true') {
    throw new Error('RADIUS_SYNC_ENABLED is not enabled');
  }
  if (!process.env.RADIUS_DATABASE_URL) {
    throw new Error('RADIUS_DATABASE_URL is not configured');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.RADIUS_DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
      query_timeout: 5000,
    });
  }
  return pool;
}

function encryptionKey() {
  const raw = String(process.env.RADIUS_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('RADIUS_CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex key');
  }
  return Buffer.from(raw, 'hex');
}

function decryptPassword(payload) {
  const [ivValue, tagValue, ciphertextValue] = String(payload || '').split('.');
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Stored RADIUS credential is invalid');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivValue, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function syncExpiredSubscriberRadius(subscriber) {
  if (!subscriber?.radius_username) {
    throw new Error('Expired PPPoE paywall requires a RADIUS username');
  }
  if (!subscriber.radius_password_ciphertext) {
    throw new Error('Expired PPPoE paywall requires a stored RADIUS password');
  }

  const client = await radiusPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [subscriber.radius_username]
    );
    await client.query('DELETE FROM radcheck WHERE username=$1', [subscriber.radius_username]);
    await client.query('DELETE FROM radreply WHERE username=$1', [subscriber.radius_username]);

    const password = decryptPassword(subscriber.radius_password_ciphertext);
    await client.query(
      "INSERT INTO radcheck(username,attribute,op,value) VALUES($1,'Cleartext-Password',':=',$2)",
      [subscriber.radius_username, password]
    );

    await client.query(
      `INSERT INTO radreply(username,attribute,op,value)
       VALUES
         ($1,'Mikrotik-Rate-Limit',':=',$2),
         ($1,'Mikrotik-Address-List',':=',$3),
         ($1,'Session-Timeout',':=',$4)`,
      [
        subscriber.radius_username,
        expiredPaywallRateLimit(),
        EXPIRED_ADDRESS_LIST,
        String(expiredPaywallSessionTimeout()),
      ]
    );

    if (subscriber.access_mode === 'pppoe_static' && subscriber.static_ip) {
      await client.query(
        "INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Framed-IP-Address',':=',$2)",
        [subscriber.radius_username, String(subscriber.static_ip)]
      );
    }

    if (subscriber.vlan_id) {
      await client.query(
        `INSERT INTO radreply(username,attribute,op,value)
         VALUES
           ($1,'Tunnel-Type',':=','VLAN'),
           ($1,'Tunnel-Medium-Type',':=','IEEE-802'),
           ($1,'Tunnel-Private-Group-ID',':=',$2)`,
        [subscriber.radius_username, String(subscriber.vlan_id)]
      );
    }

    await client.query('COMMIT');

    await db.query(
      `UPDATE billing_subscribers
       SET radius_sync_status='synced',
           radius_sync_error=NULL,
           radius_last_synced_at=NOW(),
           updated_at=NOW()
       WHERE id=$1 AND client_id=$2`,
      [subscriber.id, subscriber.client_id]
    );

    return {
      status: 'paywall',
      username: subscriber.radius_username,
      address_list: EXPIRED_ADDRESS_LIST,
      rate_limit: expiredPaywallRateLimit(),
      session_timeout: expiredPaywallSessionTimeout(),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await db.query(
      `UPDATE billing_subscribers
       SET radius_sync_status='failed',
           radius_sync_error=$3,
           radius_last_synced_at=NOW(),
           updated_at=NOW()
       WHERE id=$1 AND client_id=$2`,
      [subscriber.id, subscriber.client_id, String(error.message || error).slice(0, 1000)]
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  syncExpiredSubscriberRadius,
};