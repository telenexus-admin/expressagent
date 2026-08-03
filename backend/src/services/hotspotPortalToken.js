const crypto = require('crypto');

function secret() {
  const value = process.env.HOTSPOT_PORTAL_SECRET || process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('HOTSPOT_PORTAL_SECRET must be configured with at least 32 characters');
  return value;
}

function createHotspotPortalToken(clientId) {
  const payload = Buffer.from(JSON.stringify({ client_id: Number(clientId), version: 1 }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyHotspotPortalToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const left = Buffer.from(signature); const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isInteger(decoded.client_id) && decoded.client_id > 0 ? decoded : null;
  } catch (_) { return null; }
}

module.exports = { createHotspotPortalToken, verifyHotspotPortalToken };