const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64url(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function secret() {
  return process.env.NOC_PUBLIC_LINK_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET || 'nexa-noc-public-link-secret';
}

function sign(payload) {
  return base64url(crypto.createHmac('sha256', secret()).update(payload).digest());
}

function createNocLiveToken({ clientId, routerId, ttlHours = 12 }) {
  const body = base64url(JSON.stringify({
    c: Number(clientId),
    r: routerId ? Number(routerId) : null,
    exp: Date.now() + Number(ttlHours || 12) * 60 * 60 * 1000,
  }));
  return `${body}.${sign(body)}`;
}

function verifyNocLiveToken(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature || sign(body) !== signature) throw new Error('Invalid NOC link');
  const payload = JSON.parse(fromBase64url(body));
  if (!payload.c || Number(payload.exp || 0) < Date.now()) throw new Error('NOC link has expired');
  return {
    clientId: Number(payload.c),
    routerId: payload.r ? Number(payload.r) : null,
  };
}

function publicFrontendBase() {
  return String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
}

function createNocLiveUrl({ clientId, routerId, ttlHours }) {
  const base = publicFrontendBase();
  if (!base || !clientId) return '';
  return `${base}/public/noc/${createNocLiveToken({ clientId, routerId, ttlHours })}`;
}

module.exports = {
  createNocLiveToken,
  createNocLiveUrl,
  verifyNocLiveToken,
};
