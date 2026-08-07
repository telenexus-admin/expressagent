const crypto = require('crypto');
const dgram = require('dgram');
const { Pool } = require('pg');
const db = require('../db');

let radiusPool;
const retryTimers = new Map();

function radiusEnabled() {
  return String(process.env.RADIUS_SYNC_ENABLED || '').toLowerCase() === 'true';
}

function encryptionKey() {
  const raw = String(process.env.RADIUS_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error('RADIUS_CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex key');
  return Buffer.from(raw, 'hex');
}

function getRadiusPool() {
  if (!radiusEnabled()) throw new Error('RADIUS_SYNC_ENABLED is not enabled');
  if (!process.env.RADIUS_DATABASE_URL) throw new Error('RADIUS_DATABASE_URL is not configured');
  if (!radiusPool) radiusPool = new Pool({
    connectionString: process.env.RADIUS_DATABASE_URL,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 5000,
  });
  return radiusPool;
}

function encryptPassword(password) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

function decryptPassword(payload) {
  const [ivValue, tagValue, ciphertextValue] = String(payload || '').split('.');
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Stored RADIUS credential is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64')), decipher.final()]).toString('utf8');
}

async function markSync(subscriberId, status, error = null) {
  await db.query(
    `UPDATE billing_subscribers
     SET radius_sync_status = $2, radius_sync_error = $3, radius_last_synced_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [subscriberId, status, error]
  );
}

async function loadSubscriber(subscriberId, clientId) {
  const result = await db.query(
    `SELECT s.*, p.radius_profile, p.validity_days, p.fup_enabled, p.fup_threshold_mb,
            p.fup_download_speed_mbps, p.fup_upload_speed_mbps
     FROM billing_subscribers s
     LEFT JOIN billing_plans p ON p.id = s.plan_id AND p.client_id = s.client_id
     WHERE s.id = $1 AND s.client_id = $2 LIMIT 1`,
    [subscriberId, clientId]
  );
  return result.rows[0] || null;
}

async function resolveFupRate(radiusClient, username, subject) {
  const enabled = Boolean(subject.fup_enabled);
  const thresholdMb = Number(subject.fup_threshold_mb || 0);
  if (!enabled || !(thresholdMb > 0)) {
    return { enabled: false, applied: false, usage_bytes: 0, threshold_bytes: 0, rate_limit: null };
  }
  const cycleStart = subject.activated_at
    ? new Date(subject.activated_at)
    : subject.expires_at && Number(subject.validity_days || 0) > 0
      ? new Date(new Date(subject.expires_at).getTime() - Number(subject.validity_days) * 86400000)
      : new Date(0);
  const usageResult = await radiusClient.query(
    `SELECT COALESCE(SUM(COALESCE(acctinputoctets, 0) + COALESCE(acctoutputoctets, 0)), 0)::bigint AS usage_bytes
     FROM radacct WHERE username = $1 AND COALESCE(acctstarttime, acctupdatetime, NOW()) >= $2`,
    [username, cycleStart]
  );
  const usageBytes = Number(usageResult.rows[0]?.usage_bytes || 0);
  const thresholdBytes = thresholdMb * 1024 * 1024;
  const applied = usageBytes >= thresholdBytes;
  const reducedDownload = Number(subject.fup_download_speed_mbps || 0);
  const reducedUpload = Number(subject.fup_upload_speed_mbps || 0);
  const rateLimit = applied && reducedDownload > 0 && reducedUpload > 0
    ? `${reducedUpload}M/${reducedDownload}M`
    : null;
  return { enabled, applied, usage_bytes: usageBytes, threshold_bytes: thresholdBytes, rate_limit: rateLimit };
}

async function getOnlineUsernames(usernames = []) {
  if (!radiusEnabled() || !usernames.length) return new Set();
  const result = await getRadiusPool().query(
    `SELECT DISTINCT username FROM radacct
     WHERE acctstoptime IS NULL AND username = ANY($1::text[])`,
    [usernames]
  );
  return new Set(result.rows.map((row) => String(row.username)));
}

async function listRecentRadiusSessions(usernames = [], lookbackMinutes = 15) {
  if (!radiusEnabled() || !usernames.length) return [];
  const safeMinutes = Math.min(1440, Math.max(1, Number(lookbackMinutes) || 15));
  const result = await getRadiusPool().query(
    `SELECT radacctid, username, acctstarttime, acctupdatetime, acctstoptime,
            acctsessiontime, acctinputoctets, acctoutputoctets, framedipaddress,
            nasipaddress, callingstationid, calledstationid, acctterminatecause
     FROM radacct
     WHERE username = ANY($1::text[])
       AND GREATEST(
         COALESCE(acctupdatetime, '-infinity'::timestamptz),
         COALESCE(acctstoptime, '-infinity'::timestamptz),
         COALESCE(acctstarttime, '-infinity'::timestamptz)
       ) >= NOW() - ($2 * INTERVAL '1 minute')
     ORDER BY GREATEST(
       COALESCE(acctupdatetime, acctstarttime),
       COALESCE(acctstoptime, acctstarttime)
     ) DESC
     LIMIT 500`,
    [usernames, safeMinutes]
  );
  return result.rows;
}

function formatRadiusExpiration(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

async function syncSubscriberRadius(subscriber) {
  if (!subscriber.radius_username) throw new Error('Set a RADIUS username before syncing');
  const radius = getRadiusPool();
  const radiusClient = await radius.connect();
  try {
    await radiusClient.query('BEGIN');
    await radiusClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [subscriber.radius_username]);
    const previousRateResult = await radiusClient.query(
      "SELECT value FROM radreply WHERE username = $1 AND attribute = 'Mikrotik-Rate-Limit' ORDER BY id DESC LIMIT 1",
      [subscriber.radius_username]
    );
    const previousRateLimit = previousRateResult.rows[0]?.value || null;
    await radiusClient.query('DELETE FROM radcheck WHERE username = $1', [subscriber.radius_username]);
    await radiusClient.query('DELETE FROM radreply WHERE username = $1', [subscriber.radius_username]);

    const effectiveExpiry = subscriber.expires_at
      ? new Date(new Date(subscriber.expires_at).getTime() + Number(subscriber.grace_period_days || 0) * 86400000)
      : null;
    const accessActive = subscriber.service_status === 'active' && subscriber.radius_status === 'active' && (!effectiveExpiry || effectiveExpiry > new Date());
    const fup = await resolveFupRate(radiusClient, subscriber.radius_username, subscriber);
    fup.rate_changed = Boolean(fup.rate_limit && fup.rate_limit !== previousRateLimit);
    if (accessActive) {
      if (!subscriber.radius_password_ciphertext) throw new Error('Set a RADIUS password before activating this subscriber');
      const password = decryptPassword(subscriber.radius_password_ciphertext);
      await radiusClient.query(
        "INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, 'Cleartext-Password', ':=', $2)",
        [subscriber.radius_username, password]
      );
      if (effectiveExpiry) {
        const expiryValue = formatRadiusExpiration(effectiveExpiry);
        const sessionTimeout = Math.max(1, Math.ceil((effectiveExpiry.getTime() - Date.now()) / 1000));
        await radiusClient.query(
          "INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, 'Expiration', ':=', $2)",
          [subscriber.radius_username, expiryValue]
        );
        await radiusClient.query(
          "INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Session-Timeout', ':=', $2)",
          [subscriber.radius_username, String(sessionTimeout)]
        );
      }
      const effectiveRateLimit = fup.rate_limit || subscriber.radius_profile;
      if (effectiveRateLimit) {
        await radiusClient.query(
          "INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Mikrotik-Rate-Limit', ':=', $2)",
          [subscriber.radius_username, effectiveRateLimit]
        );
      }
      if (subscriber.access_mode === 'pppoe_static' && subscriber.static_ip) {
        await radiusClient.query(
          "INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Framed-IP-Address', ':=', $2)",
          [subscriber.radius_username, String(subscriber.static_ip)]
        );
      }
    }
      if (subscriber.vlan_id) {
        await radiusClient.query("INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Tunnel-Type', ':=', 'VLAN'), ($1, 'Tunnel-Medium-Type', ':=', 'IEEE-802'), ($1, 'Tunnel-Private-Group-ID', ':=', $2)", [subscriber.radius_username, String(subscriber.vlan_id)]);
      }
    await radiusClient.query('COMMIT');
    return { status: accessActive ? 'synced' : 'disabled', expires_at: effectiveExpiry?.toISOString() || null, fup };
  } catch (err) {
    await radiusClient.query('ROLLBACK');
    await markSync(subscriber.id, 'failed', err.message);
    throw err;
  } finally {
    radiusClient.release();
  }
}

function normalizeHotspotMac(value) {
  const compact = String(value || '')
    .replace(/[^A-Fa-f0-9]/g, '')
    .toUpperCase();

  if (compact.length !== 12) {
    return null;
  }

  return compact
    .match(/.{2}/g)
    .join(':');
}

async function syncHotspotMacRadius({
  macAddress,
  expiresAt,
  rateLimit = null,
  dataLimitMb = null,
}) {
  if (!radiusEnabled()) {
    throw new Error(
      'RADIUS synchronization is not enabled'
    );
  }

  const username =
    normalizeHotspotMac(macAddress);

  if (!username) {
    throw new Error(
      'A valid hotspot device MAC address is required'
    );
  }

  const password = String(
    process.env.HOTSPOT_MAC_AUTH_PASSWORD || ''
  ).trim();

  if (!password) {
    throw new Error(
      'HOTSPOT_MAC_AUTH_PASSWORD is not configured'
    );
  }

  const expiry = new Date(expiresAt);

  if (
    !Number.isFinite(expiry.getTime()) ||
    expiry <= new Date()
  ) {
    throw new Error(
      'The hotspot package has already expired'
    );
  }

  const radiusClient =
    await getRadiusPool().connect();

  try {
    await radiusClient.query('BEGIN');

    await radiusClient.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [username]
    );

    await radiusClient.query(
      'DELETE FROM radcheck WHERE username = $1',
      [username]
    );

    await radiusClient.query(
      'DELETE FROM radreply WHERE username = $1',
      [username]
    );

    const expiration =
      formatRadiusExpiration(expiry);

    const sessionTimeout = Math.max(
      1,
      Math.ceil(
        (
          expiry.getTime() -
          Date.now()
        ) / 1000
      )
    );

    await radiusClient.query(
      `INSERT INTO radcheck
         (
           username,
           attribute,
           op,
           value
         )
       VALUES
         (
           $1,
           'Cleartext-Password',
           ':=',
           $2
         ),
         (
           $1,
           'Expiration',
           ':=',
           $3
         )`,
      [
        username,
        password,
        expiration,
      ]
    );

    await radiusClient.query(
      `INSERT INTO radreply
         (
           username,
           attribute,
           op,
           value
         )
       VALUES
         (
           $1,
           'Session-Timeout',
           ':=',
           $2
         )`,
      [
        username,
        String(sessionTimeout),
      ]
    );

    if (rateLimit) {
      await radiusClient.query(
        `INSERT INTO radreply
           (
             username,
             attribute,
             op,
             value
           )
         VALUES
           (
             $1,
             'Mikrotik-Rate-Limit',
             ':=',
             $2
           )`,
        [
          username,
          String(rateLimit),
        ]
      );
    }

    if (
      Number.isFinite(
        Number(dataLimitMb)
      ) &&
      Number(dataLimitMb) > 0
    ) {
      await radiusClient.query(
        `INSERT INTO radreply
           (
             username,
             attribute,
             op,
             value
           )
         VALUES
           (
             $1,
             'Mikrotik-Total-Limit',
             ':=',
             $2
           )`,
        [
          username,
          String(
            Number(dataLimitMb) *
            1024 *
            1024
          ),
        ]
      );
    }

    await radiusClient.query('COMMIT');

    return {
      status: 'synced',
      username,
      expires_at: expiry.toISOString(),
    };
  } catch (error) {
    await radiusClient.query(
      'ROLLBACK'
    ).catch(() => {});

    throw error;
  } finally {
    radiusClient.release();
  }
}

async function syncHotspotVoucherRadius(voucher) {
  if (!voucher?.code) throw new Error('Hotspot voucher code is required');
  const radius = getRadiusPool();
  const radiusClient = await radius.connect();
  try {
    await radiusClient.query('BEGIN');
    await radiusClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [voucher.code]);
    const previousRateResult = await radiusClient.query(
      "SELECT value FROM radreply WHERE username = $1 AND attribute = 'Mikrotik-Rate-Limit' ORDER BY id DESC LIMIT 1",
      [voucher.code]
    );
    const previousRateLimit = previousRateResult.rows[0]?.value || null;
    await radiusClient.query('DELETE FROM radcheck WHERE username = $1', [voucher.code]);
    await radiusClient.query('DELETE FROM radreply WHERE username = $1', [voucher.code]);
    const expiresAt = voucher.expires_at ? new Date(voucher.expires_at) : null;
    const accessActive = voucher.status === 'active' && expiresAt && expiresAt > new Date();
    const fup = await resolveFupRate(radiusClient, voucher.code, voucher);
    fup.rate_changed = Boolean(fup.rate_limit && fup.rate_limit !== previousRateLimit);
    if (accessActive) {
      const expiryValue = formatRadiusExpiration(expiresAt);
      const sessionTimeout = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
      await radiusClient.query("INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, 'Cleartext-Password', ':=', $2), ($1, 'Expiration', ':=', $3)", [voucher.code, voucher.code, expiryValue]);
      await radiusClient.query("INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Session-Timeout', ':=', $2)", [voucher.code, String(sessionTimeout)]);
      const effectiveRateLimit = fup.rate_limit || voucher.mikrotik_rate_limit;
      if (effectiveRateLimit) await radiusClient.query("INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Mikrotik-Rate-Limit', ':=', $2)", [voucher.code, effectiveRateLimit]);
      if (voucher.data_limit_mb) await radiusClient.query("INSERT INTO radreply (username, attribute, op, value) VALUES ($1, 'Mikrotik-Total-Limit', ':=', $2)", [voucher.code, String(Number(voucher.data_limit_mb) * 1024 * 1024)]);
      if (
        Number.isInteger(
          Number(voucher.max_devices)
        ) &&
        Number(voucher.max_devices) > 0
      ) {
        await radiusClient.query(
          "INSERT INTO radcheck (username, attribute, op, value) VALUES ($1, 'Simultaneous-Use', ':=', $2)",
          [
            voucher.code,
            String(
              Number(
                voucher.max_devices
              )
            ),
          ]
        );
      }
    }
    await radiusClient.query('COMMIT');
    return { status: accessActive ? 'synced' : 'disabled', expires_at: expiresAt?.toISOString() || null, fup };
  } catch (err) {
    await radiusClient.query('ROLLBACK');
    throw err;
  } finally {
    radiusClient.release();
  }
}
function scheduleSubscriberRadiusSync(subscriberId, clientId, attempt = 0) {
  const key = `${clientId}:${subscriberId}`;
  if (retryTimers.has(key)) return;
  const delays = [5000, 30000, 120000];
  if (attempt >= delays.length) return;
  const timer = setTimeout(async () => {
    retryTimers.delete(key);
    try {
      const subscriber = await loadSubscriber(subscriberId, clientId);
      if (!subscriber?.radius_username) return;
      await syncSubscriberRadius(subscriber);
    } catch (error) {
      console.error(`Deferred RADIUS sync attempt ${attempt + 1} failed:`, error.message);
      scheduleSubscriberRadiusSync(subscriberId, clientId, attempt + 1);
    }
  }, delays[attempt]);
  timer.unref?.();
  retryTimers.set(key, timer);
}

async function getSubscriberUsage(radiusUsername, days = 30) {
  if (!radiusEnabled() || !radiusUsername) return { available: false, total: {}, daily: [], sessions: [] };
  const safeDays = Math.min(365, Math.max(1, Number(days) || 30));
  const radius = getRadiusPool();
  const [summary, daily, sessions] = await Promise.all([
    radius.query(`SELECT COALESCE(SUM(acctinputoctets), 0)::bigint AS upload_bytes, COALESCE(SUM(acctoutputoctets), 0)::bigint AS download_bytes, COUNT(*)::int AS session_count, COALESCE(SUM(COALESCE(acctsessiontime, EXTRACT(EPOCH FROM (COALESCE(acctupdatetime, NOW()) - acctstarttime))::bigint)), 0)::bigint AS session_seconds, MIN(acctstarttime) AS first_seen, MAX(COALESCE(acctstoptime, acctupdatetime, acctstarttime)) AS last_seen FROM radacct WHERE username = $1 AND COALESCE(acctstarttime, acctupdatetime, NOW()) >= NOW() - ($2::text || ' days')::interval`, [radiusUsername, safeDays]),
    radius.query(`SELECT TO_CHAR(DATE_TRUNC('day', COALESCE(acctstarttime, acctupdatetime, NOW())), 'YYYY-MM-DD') AS day, COALESCE(SUM(acctinputoctets), 0)::bigint AS upload_bytes, COALESCE(SUM(acctoutputoctets), 0)::bigint AS download_bytes FROM radacct WHERE username = $1 AND COALESCE(acctstarttime, acctupdatetime, NOW()) >= NOW() - ($2::text || ' days')::interval GROUP BY 1 ORDER BY 1`, [radiusUsername, safeDays]),
    radius.query(`SELECT acctstarttime, acctstoptime, acctsessiontime, acctinputoctets AS upload_bytes, acctoutputoctets AS download_bytes, framedipaddress, nasipaddress, acctterminatecause, (acctstoptime IS NULL) AS is_active FROM radacct WHERE username = $1 ORDER BY acctstarttime DESC NULLS LAST LIMIT 50`, [radiusUsername]),
  ]);
  return { available: true, days: safeDays, total: summary.rows[0] || {}, daily: daily.rows, sessions: sessions.rows };
}

function radiusAttribute(type, value) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (payload.length > 253) throw new Error('RADIUS attribute is too large');
  return Buffer.concat([Buffer.from([type, payload.length + 2]), payload]);
}

function radiusInteger(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(Number(value) >>> 0);
  return result;
}

function radiusIpv4(value) {
  const parts = String(value).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error('Invalid RADIUS NAS IPv4 address');
  }
  return Buffer.from(parts);
}

function encryptRadiusPassword(password, secret, authenticator) {
  const source = Buffer.from(String(password), 'utf8');
  const padded = Buffer.alloc(Math.max(16, Math.ceil(source.length / 16) * 16));
  source.copy(padded);
  const output = Buffer.alloc(padded.length);
  let previous = authenticator;
  for (let offset = 0; offset < padded.length; offset += 16) {
    const digest = crypto.createHash('md5').update(Buffer.concat([Buffer.from(secret), previous])).digest();
    for (let index = 0; index < 16; index += 1) output[offset + index] = padded[offset + index] ^ digest[index];
    previous = output.subarray(offset, offset + 16);
  }
  return output;
}

function sendRadiusPacket({ host, port, code, secret, attributes, requestAuthenticator, expectedCode, timeoutMs = 3500 }) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomBytes(1)[0];
    const attrs = Buffer.concat(attributes);
    const length = 20 + attrs.length;
    const header = Buffer.alloc(4);
    header[0] = code; header[1] = id; header.writeUInt16BE(length, 2);
    let authenticator = requestAuthenticator || Buffer.alloc(16);
    if (code === 4) {
      authenticator = crypto.createHash('md5').update(Buffer.concat([header, Buffer.alloc(16), attrs, Buffer.from(secret)])).digest();
    }
    const packet = Buffer.concat([header, authenticator, attrs]);
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => { socket.close(); reject(new Error('RADIUS probe timed out')); }, timeoutMs);
    socket.once('error', (error) => { clearTimeout(timer); socket.close(); reject(error); });
    socket.once('message', (message) => {
      clearTimeout(timer); socket.close();
      if (message.length < 20 || message[1] !== id || message[0] !== expectedCode) {
        return reject(new Error('Unexpected RADIUS probe response'));
      }
      const responseHeader = message.subarray(0, 4);
      const responseAttrs = message.subarray(20);
      const expected = crypto.createHash('md5').update(Buffer.concat([
        responseHeader, authenticator, responseAttrs, Buffer.from(secret),
      ])).digest();
      if (!crypto.timingSafeEqual(expected, message.subarray(4, 20))) return reject(new Error('Invalid RADIUS response signature'));
      resolve({ code: message[0], bytes: message.length });
    });
    socket.send(packet, Number(port), host);
  });
}

async function probeRouterRadius(input, options = {}) {
  const host = String(input?.host || '').trim();
  const secret = String(input?.secret || '');
  const username = 'nexa-probe-' + Number(input.clientId) + '-' + Number(input.routerId) + '-' + crypto.randomBytes(4).toString('hex');
  const password = crypto.randomBytes(18).toString('base64url');
  const nasIp = String(input?.nasIp || '').trim();
  const pool = options.queryable || getRadiusPool();
  await pool.query("INSERT INTO radcheck(username,attribute,op,value)VALUES($1,'Cleartext-Password',':=',$2)", [username, password]);
  try {
    const accessAuthenticator = crypto.randomBytes(16);
    const access = await sendRadiusPacket({
      host, port: Number(input.authPort || 1812), code: 1, secret, expectedCode: 2,
      requestAuthenticator: accessAuthenticator,
      attributes: [
        radiusAttribute(1, username),
        radiusAttribute(2, encryptRadiusPassword(password, secret, accessAuthenticator)),
        radiusAttribute(4, radiusIpv4(nasIp)),
        radiusAttribute(32, String(input.nasIdentifier || 'nexa-probe')),
      ],
    });
    const sessionId = 'nexa-' + crypto.randomBytes(8).toString('hex');
    const accountingAttributes = (status) => [
      radiusAttribute(1, username), radiusAttribute(4, radiusIpv4(nasIp)),
      radiusAttribute(40, radiusInteger(status)), radiusAttribute(44, sessionId),
      radiusAttribute(32, String(input.nasIdentifier || 'nexa-probe')),
    ];
    const start = await sendRadiusPacket({
      host, port: Number(input.acctPort || 1813), code: 4, secret, expectedCode: 5,
      attributes: accountingAttributes(1),
    });
    const stop = await sendRadiusPacket({
      host, port: Number(input.acctPort || 1813), code: 4, secret, expectedCode: 5,
      attributes: accountingAttributes(2),
    });
    return { passed: true, access_accept: access.code === 2, accounting_start: start.code === 5, accounting_stop: stop.code === 5 };
  } finally {
    await pool.query('DELETE FROM radcheck WHERE username=$1', [username]).catch(() => {});
    await pool.query('DELETE FROM radreply WHERE username=$1', [username]).catch(() => {});
  }
}
function radiusNasDescription(clientId, routerId) {
  return 'Nexa tenant ' + Number(clientId) + ' router ' + Number(routerId);
}

async function registerRouterNas(input, options = {}) {
  const nasname = String(input?.nasIp || '').trim();
  const shortname = String(input?.nasIdentifier || '').trim().slice(0, 32);
  const secret = String(input?.secret || '');
  const clientId = Number(input?.clientId);
  const routerId = Number(input?.routerId);
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(nasname)) throw new Error('A valid RADIUS NAS IPv4 address is required');
  if (!/^[a-z0-9-]{3,32}$/i.test(shortname)) throw new Error('A safe RADIUS NAS identifier is required');
  if (secret.length < 24) throw new Error('A strong per-router RADIUS secret is required');
  if (!Number.isInteger(clientId) || !Number.isInteger(routerId)) throw new Error('Tenant router identity is required');
  const pool = options.queryable || getRadiusPool();
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const description = radiusNasDescription(clientId, routerId);
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id,nasname,shortname,description FROM nas WHERE nasname=$1 FOR UPDATE', [nasname]);
    if (existing.rows[0] && existing.rows[0].description !== description) {
      throw new Error('The private NAS address is already owned by another router');
    }
    if (existing.rows[0]) {
      await client.query("UPDATE nas SET shortname=$2,type='other',secret=$3,description=$4 WHERE id=$1",
        [existing.rows[0].id, shortname, secret, description]);
    } else {
      await client.query("INSERT INTO nas(nasname,shortname,type,secret,description)VALUES($1,$2,'other',$3,$4)",
        [nasname, shortname, secret, description]);
    }
    await client.query("INSERT INTO nexa_nas_sync(nasname,shortname,secret,operation,status,attempts,last_error,updated_at)VALUES($1,$2,$3,'register','pending',0,NULL,NOW()) ON CONFLICT(nasname)DO UPDATE SET shortname=EXCLUDED.shortname,secret=EXCLUDED.secret,operation='register',status='pending',attempts=0,last_error=NULL,updated_at=NOW()", [nasname, shortname, secret]);
    await client.query('COMMIT');
    return { registered: true, activation_status: 'pending', nasname, shortname, description };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== pool) client.release();
  }
}

async function unregisterRouterNas(input, options = {}) {
  const nasname = String(input?.nasIp || '').trim();
  const description = radiusNasDescription(input?.clientId, input?.routerId);
  const pool = options.queryable || getRadiusPool();
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO nexa_nas_sync(nasname,operation,status,attempts,last_error,updated_at)VALUES($1,'unregister','pending',0,NULL,NOW()) ON CONFLICT(nasname)DO UPDATE SET operation='unregister',status='pending',attempts=0,last_error=NULL,updated_at=NOW()", [nasname]);
    const result = await client.query('DELETE FROM nas WHERE nasname=$1 AND description=$2 RETURNING id', [nasname, description]);
    await client.query('COMMIT');
    return { removed: result.rowCount > 0, activation_status: 'pending' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== pool) client.release();
  }
}

async function testRouterNasRegistration(input, options = {}) {
  const nasname = String(input?.nasIp || '').trim();
  const description = radiusNasDescription(input?.clientId, input?.routerId);
  const pool = options.queryable || getRadiusPool();
  const result = await pool.query("SELECT n.id,n.shortname,s.status activation_status,s.last_error FROM nas n LEFT JOIN nexa_nas_sync s ON s.nasname=n.nasname WHERE n.nasname=$1 AND n.description=$2 LIMIT 1", [nasname, description]);
  return {
    registered: Boolean(result.rows[0]) && result.rows[0].activation_status === 'applied',
    shortname: result.rows[0]?.shortname || null,
    activation_status: result.rows[0]?.activation_status || 'missing',
    error: result.rows[0]?.last_error || null,
  };
}
async function revokeHotspotRadiusAccess({
  macAddress = null,
  voucherCode = null,
}) {
  if (!radiusEnabled()) {
    return {
      status: 'not_configured',
      removed: 0,
    };
  }

  const usernames =
    [
      normalizeHotspotMac(
        macAddress
      ),

      String(
        voucherCode || ''
      ).trim(),
    ]
      .filter(Boolean)
      .filter(
        (
          value,
          index,
          values
        ) =>
          values.indexOf(value) ===
          index
      );

  if (!usernames.length) {
    return {
      status: 'nothing_to_remove',
      removed: 0,
    };
  }

  const radiusClient =
    await getRadiusPool().connect();

  try {
    await radiusClient.query(
      'BEGIN'
    );

    const checkResult =
      await radiusClient.query(
        `DELETE FROM radcheck
         WHERE username =
           ANY($1::text[])`,
        [
          usernames,
        ]
      );

    const replyResult =
      await radiusClient.query(
        `DELETE FROM radreply
         WHERE username =
           ANY($1::text[])`,
        [
          usernames,
        ]
      );

    await radiusClient.query(
      'COMMIT'
    );

    return {
      status: 'revoked',
      usernames,
      removed:
        checkResult.rowCount +
        replyResult.rowCount,
    };
  } catch (error) {
    await radiusClient.query(
      'ROLLBACK'
    ).catch(() => {});

    throw error;
  } finally {
    radiusClient.release();
  }
}

module.exports = { encryptPassword, getOnlineUsernames, getSubscriberUsage, listRecentRadiusSessions, loadSubscriber, radiusEnabled, registerRouterNas, revokeHotspotRadiusAccess, probeRouterRadius, resolveFupRate, scheduleSubscriberRadiusSync, syncHotspotMacRadius, syncHotspotVoucherRadius, syncSubscriberRadius, testRouterNasRegistration, unregisterRouterNas };
