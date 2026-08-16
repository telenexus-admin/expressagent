const crypto = require('crypto');

function secret() {
  const value = process.env.HOTSPOT_PORTAL_SECRET || process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('HOTSPOT_PORTAL_SECRET must be configured with at least 32 characters');
  return value;
}

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySignedToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const left = Buffer.from(signature); const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(decoded.client_id) || decoded.client_id <= 0 || !Number.isInteger(decoded.exp) || decoded.exp <= now) return null;
    return decoded;
  } catch (_) { return null; }
}

function createHotspotPortalToken(clientId, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.min(Math.max(Number(options.ttlSeconds) || 600, 60), 900);
  const payload = {
    client_id: Number(clientId), version: 2, purpose: options.purpose || 'portal', iat: now, exp: now + ttlSeconds,
  };
  if (Number.isInteger(Number(options.routerId)) && Number(options.routerId) > 0) payload.router_id = Number(options.routerId);
  if (options.mac) payload.mac = String(options.mac).toLowerCase();
  if (options.ip) payload.ip = String(options.ip);
  return sign(payload);
}

function createHotspotPortalBootstrapToken(clientId, routerId, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.min(Math.max(Number(options.ttlSeconds) || (30 * 24 * 60 * 60), 3600), 31 * 24 * 60 * 60);
  return sign({ client_id: Number(clientId), router_id: Number(routerId), version: 2, purpose: 'bootstrap', iat: now, exp: now + ttlSeconds });
}

function verifyHotspotPortalToken(token) {
  const decoded = verifySignedToken(token);
  return decoded && ['portal', 'preview'].includes(decoded.purpose) ? decoded : null;
}

function verifyHotspotPortalBootstrapToken(token) {
  const decoded = verifySignedToken(token);
  return decoded && decoded.purpose === 'bootstrap' && Number.isInteger(decoded.router_id) && decoded.router_id > 0 ? decoded : null;
}

module.exports = { createHotspotPortalToken, createHotspotPortalBootstrapToken, verifyHotspotPortalToken, verifyHotspotPortalBootstrapToken };
