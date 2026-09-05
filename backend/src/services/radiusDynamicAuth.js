const crypto = require('crypto');
const dgram = require('dgram');
const { Pool } = require('pg');

let radiusPool;

const RADIUS_CODES = Object.freeze({
  DISCONNECT_REQUEST: 40,
  DISCONNECT_ACK: 41,
  DISCONNECT_NAK: 42,
  COA_REQUEST: 43,
  COA_ACK: 44,
  COA_NAK: 45,
});

const ATTR = Object.freeze({
  USER_NAME: 1,
  NAS_IP_ADDRESS: 4,
  FRAMED_IP_ADDRESS: 8,
  SESSION_TIMEOUT: 27,
  CALLING_STATION_ID: 31,
  ACCT_SESSION_ID: 44,
  VENDOR_SPECIFIC: 26,
});

const MIKROTIK_VENDOR_ID = 14988;
const MIKROTIK_RATE_LIMIT = 8;

function dynamicAuthEnabled() {
  return String(process.env.RADIUS_DYNAMIC_AUTH_ENABLED || 'true').toLowerCase() !== 'false';
}

function dynamicAuthPort() {
  const port = Number(process.env.RADIUS_DYNAMIC_AUTH_PORT || 1700);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('RADIUS_DYNAMIC_AUTH_PORT must be a valid UDP port');
  }
  return port;
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

function textAttribute(type, value) {
  const payload = Buffer.from(String(value ?? ''), 'utf8');
  if (payload.length > 253) throw new Error('RADIUS attribute is too large');
  return Buffer.concat([Buffer.from([type, payload.length + 2]), payload]);
}

function integerAttribute(type, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) {
    throw new Error(`Invalid integer RADIUS attribute: ${value}`);
  }
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(number >>> 0, 0);
  return Buffer.concat([Buffer.from([type, 6]), payload]);
}

function ipv4Attribute(type, value) {
  const parts = String(value || '').trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 RADIUS attribute: ${value}`);
  }
  return Buffer.concat([Buffer.from([type, 6]), Buffer.from(parts)]);
}

function vendorStringAttribute(vendorId, vendorType, value) {
  const valueBuffer = Buffer.from(String(value ?? ''), 'utf8');
  if (valueBuffer.length > 247) throw new Error('RADIUS vendor attribute is too large');
  const vendorPayload = Buffer.alloc(4);
  vendorPayload.writeUInt32BE(Number(vendorId) >>> 0, 0);
  const vendorAttr = Buffer.concat([
    Buffer.from([Number(vendorType), valueBuffer.length + 2]),
    valueBuffer,
  ]);
  const payload = Buffer.concat([vendorPayload, vendorAttr]);
  return Buffer.concat([Buffer.from([ATTR.VENDOR_SPECIFIC, payload.length + 2]), payload]);
}

function requestAuthenticator({ code, identifier, attributes, secret }) {
  const attrs = Buffer.concat(attributes || []);
  const header = Buffer.alloc(4);
  header[0] = code;
  header[1] = identifier;
  header.writeUInt16BE(20 + attrs.length, 2);
  return crypto.createHash('md5').update(Buffer.concat([
    header,
    Buffer.alloc(16),
    attrs,
    Buffer.from(String(secret || ''), 'utf8'),
  ])).digest();
}

function buildDynamicAuthorizationPacket({ code, identifier, secret, attributes }) {
  if (![RADIUS_CODES.DISCONNECT_REQUEST, RADIUS_CODES.COA_REQUEST].includes(code)) {
    throw new Error('Unsupported RADIUS dynamic authorization request code');
  }
  const attrs = Buffer.concat(attributes || []);
  const header = Buffer.alloc(4);
  header[0] = code;
  header[1] = identifier;
  header.writeUInt16BE(20 + attrs.length, 2);
  const authenticator = requestAuthenticator({ code, identifier, attributes, secret });
  return {
    packet: Buffer.concat([header, authenticator, attrs]),
    authenticator,
  };
}

function verifyResponse({ message, identifier, requestAuth, secret, acceptedCodes }) {
  if (!Buffer.isBuffer(message) || message.length < 20) throw new Error('Invalid RADIUS dynamic authorization response');
  if (message[1] !== identifier) throw new Error('Mismatched RADIUS dynamic authorization response');
  if (!acceptedCodes.includes(message[0])) throw new Error(`Unexpected RADIUS dynamic authorization response code ${message[0]}`);
  const responseHeader = message.subarray(0, 4);
  const responseAttrs = message.subarray(20);
  const expected = crypto.createHash('md5').update(Buffer.concat([
    responseHeader,
    requestAuth,
    responseAttrs,
    Buffer.from(String(secret || ''), 'utf8'),
  ])).digest();
  if (!crypto.timingSafeEqual(expected, message.subarray(4, 20))) {
    throw new Error('Invalid RADIUS dynamic authorization response signature');
  }
  return { code: message[0], bytes: message.length };
}

function sendDynamicAuthorizationPacket({ host, port = dynamicAuthPort(), code, secret, attributes, timeoutMs = 3500 }) {
  return new Promise((resolve, reject) => {
    const identifier = crypto.randomBytes(1)[0];
    const { packet, authenticator } = buildDynamicAuthorizationPacket({ code, identifier, secret, attributes });
    const acceptedCodes = code === RADIUS_CODES.COA_REQUEST
      ? [RADIUS_CODES.COA_ACK, RADIUS_CODES.COA_NAK]
      : [RADIUS_CODES.DISCONNECT_ACK, RADIUS_CODES.DISCONNECT_NAK];
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('RADIUS dynamic authorization timed out')), timeoutMs);
    socket.once('error', (error) => finish(reject, error));
    socket.once('message', (message) => {
      try {
        const response = verifyResponse({
          message,
          identifier,
          requestAuth: authenticator,
          secret,
          acceptedCodes,
        });
        finish(resolve, response);
      } catch (error) {
        finish(reject, error);
      }
    });
    socket.send(packet, Number(port), host, (error) => {
      if (error) finish(reject, error);
    });
  });
}

async function activeRadiusSessions(username, queryable = getRadiusPool()) {
  const cleanUsername = String(username || '').trim();
  if (!cleanUsername) return [];
  const result = await queryable.query(
    `SELECT radacctid, username, acctsessionid, framedipaddress, nasipaddress,
            callingstationid, acctstarttime, acctupdatetime
     FROM radacct
     WHERE LOWER(username) = LOWER($1)
       AND acctstoptime IS NULL
     ORDER BY COALESCE(acctupdatetime, acctstarttime) DESC`,
    [cleanUsername]
  );
  return result.rows;
}

async function resolveNasSecret(nasIpAddress, queryable = getRadiusPool()) {
  const result = await queryable.query(
    `SELECT nasname, shortname, secret
     FROM nas
     WHERE nasname = $1
     LIMIT 1`,
    [String(nasIpAddress || '').trim()]
  );
  return result.rows[0] || null;
}

async function currentSubscriberRate(username, queryable = getRadiusPool()) {
  const cleanUsername = String(username || '').trim();
  if (!cleanUsername) return null;
  const result = await queryable.query(
    `SELECT value
     FROM radreply
     WHERE LOWER(username) = LOWER($1)
       AND attribute = 'Mikrotik-Rate-Limit'
     ORDER BY id DESC
     LIMIT 1`,
    [cleanUsername]
  );
  return result.rows[0]?.value || null;
}

function sessionIdentityAttributes(session) {
  const attrs = [textAttribute(ATTR.USER_NAME, session.username)];
  if (session.acctsessionid) attrs.push(textAttribute(ATTR.ACCT_SESSION_ID, session.acctsessionid));
  if (session.nasipaddress) attrs.push(ipv4Attribute(ATTR.NAS_IP_ADDRESS, session.nasipaddress));
  if (session.framedipaddress) attrs.push(ipv4Attribute(ATTR.FRAMED_IP_ADDRESS, session.framedipaddress));
  if (session.callingstationid) attrs.push(textAttribute(ATTR.CALLING_STATION_ID, session.callingstationid));
  return attrs;
}

async function applyToSessions({
  username,
  code,
  extraAttributes = [],
  queryable = getRadiusPool(),
  sender = sendDynamicAuthorizationPacket,
  port = dynamicAuthPort(),
}) {
  if (!dynamicAuthEnabled()) {
    return { status: 'disabled', username, attempted: 0, succeeded: 0, failed: 0, results: [] };
  }
  const sessions = await activeRadiusSessions(username, queryable);
  if (!sessions.length) {
    return { status: 'no_active_session', username, attempted: 0, succeeded: 0, failed: 0, results: [] };
  }
  const results = [];
  for (const session of sessions) {
    const nas = await resolveNasSecret(session.nasipaddress, queryable);
    if (!nas?.secret) {
      results.push({
        radacctid: session.radacctid,
        nas_ip: session.nasipaddress,
        ok: false,
        error: 'The active session NAS is not registered in central RADIUS',
      });
      continue;
    }
    try {
      const response = await sender({
        host: session.nasipaddress,
        port,
        code,
        secret: nas.secret,
        attributes: [...sessionIdentityAttributes(session), ...extraAttributes],
      });
      const ackCode = code === RADIUS_CODES.COA_REQUEST ? RADIUS_CODES.COA_ACK : RADIUS_CODES.DISCONNECT_ACK;
      results.push({
        radacctid: session.radacctid,
        nas_ip: session.nasipaddress,
        session_id: session.acctsessionid || null,
        ok: response.code === ackCode,
        response_code: response.code,
        error: response.code === ackCode ? null : 'NAS rejected the dynamic authorization request',
      });
    } catch (error) {
      results.push({
        radacctid: session.radacctid,
        nas_ip: session.nasipaddress,
        session_id: session.acctsessionid || null,
        ok: false,
        error: error.message,
      });
    }
  }
  const succeeded = results.filter((item) => item.ok).length;
  const failed = results.length - succeeded;
  return {
    status: failed ? (succeeded ? 'partial' : 'failed') : 'applied',
    username,
    attempted: results.length,
    succeeded,
    failed,
    results,
  };
}

async function disconnectSubscriberSessions(username, options = {}) {
  return applyToSessions({
    username,
    code: RADIUS_CODES.DISCONNECT_REQUEST,
    ...options,
  });
}

async function updateSubscriberPolicy(username, { rateLimit = null, sessionTimeout = null } = {}, options = {}) {
  const attributes = [];
  const cleanRate = String(rateLimit || '').trim();
  if (cleanRate) {
    attributes.push(vendorStringAttribute(MIKROTIK_VENDOR_ID, MIKROTIK_RATE_LIMIT, cleanRate));
  }
  if (sessionTimeout != null) {
    const seconds = Math.max(1, Math.ceil(Number(sessionTimeout)));
    attributes.push(integerAttribute(ATTR.SESSION_TIMEOUT, seconds));
  }
  if (!attributes.length) throw new Error('At least one live RADIUS policy value is required for CoA');
  return applyToSessions({
    username,
    code: RADIUS_CODES.COA_REQUEST,
    extraAttributes: attributes,
    ...options,
  });
}

async function updateSubscriberRate(username, rateLimit, options = {}) {
  return updateSubscriberPolicy(username, { rateLimit }, options);
}

module.exports = {
  ATTR,
  MIKROTIK_RATE_LIMIT,
  MIKROTIK_VENDOR_ID,
  RADIUS_CODES,
  activeRadiusSessions,
  buildDynamicAuthorizationPacket,
  currentSubscriberRate,
  disconnectSubscriberSessions,
  dynamicAuthEnabled,
  dynamicAuthPort,
  integerAttribute,
  sessionIdentityAttributes,
  updateSubscriberPolicy,
  updateSubscriberRate,
  vendorStringAttribute,
  verifyResponse,
};
