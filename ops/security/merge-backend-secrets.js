'use strict';
const crypto = require('crypto');
const fs = require('fs');
const target = '/etc/nexa-platform/backend.env';
const legacy = '/var/www/nexa-platform/backend/.env';
const inline = '/etc/systemd/system/nexa-platform-backend.service.d/hotspot-mac-auth.conf';

function parse(text) {
  const values = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    values.set(line.slice(0, index).trim(), line.slice(index + 1));
  }
  return values;
}

const current = parse(fs.readFileSync(target, 'utf8'));
const old = fs.existsSync(legacy) ? parse(fs.readFileSync(legacy, 'utf8')) : new Map();
const allow = [
  'DATABASE_URL', 'FRONTEND_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI', 'HOTSPOT_PAYHERO_CHANNEL_ID', 'JWT_SECRET',
  'MIKROTIK_WG_ENDPOINT', 'MIKROTIK_WG_ENDPOINT_PORT', 'MIKROTIK_WG_INTERFACE',
  'MIKROTIK_WG_PUBLIC_KEY', 'MIKROTIK_WG_SERVER_IP', 'MIKROTIK_WG_SUBNET_PREFIX',
  'PORT', 'PUBLIC_API_URL', 'PUBLIC_BACKEND_URL', 'RADIUS_CREDENTIAL_ENCRYPTION_KEY',
  'RADIUS_DATABASE_URL', 'RADIUS_SYNC_ENABLED', 'RADIUS_WIREGUARD_HOST',
  'RESEND_API_KEY', 'RESEND_FROM', 'WIREGUARD_INTERFACE',
];
for (const key of allow) if (old.has(key)) current.set(key, old.get(key));

if (fs.existsSync(inline)) {
  const match = fs.readFileSync(inline, 'utf8').match(/HOTSPOT_MAC_AUTH_PASSWORD=([^"\r\n]+)/);
  if (match) current.set('HOTSPOT_MAC_AUTH_PASSWORD', match[1]);
}
for (const key of ['AUTH_DATA_ENCRYPTION_KEY', 'AUTH_CHALLENGE_SECRET', 'OAUTH_STATE_SECRET']) {
  if (!current.get(key) || current.get(key).length < 32) current.set(key, crypto.randomBytes(48).toString('base64url'));
}
current.set('AUTH_MFA_REQUIRED', 'true');
current.set('ALLOW_LEGACY_BEARER', 'false');
current.set('NEXA_NETWORK_EXECUTOR_SOCKET', '/run/nexa-network-executor/control.sock');

const body = [...current.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
const temporary = `${target}.phase2-${process.pid}`;
fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
fs.chownSync(temporary, 0, 0);
fs.renameSync(temporary, target);
fs.chmodSync(target, 0o600);
console.log(JSON.stringify({ ok: true, keys: current.size, generated_auth_secrets: true }));
