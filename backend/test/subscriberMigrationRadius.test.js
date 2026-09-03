const assert = require('assert');
const crypto = require('crypto');

process.env.RADIUS_CREDENTIAL_ENCRYPTION_KEY = '11'.repeat(32);
const {
  decryptMigrationPassword,
  formatRadiusExpiration,
} = require('../src/services/subscriberMigrationRadius');

function encrypt(value) {
  const key = Buffer.from(process.env.RADIUS_CREDENTIAL_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.alloc(12, 7);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

assert.strictEqual(decryptMigrationPassword(encrypt('legacy-pass-123')), 'legacy-pass-123');
assert.strictEqual(
  formatRadiusExpiration(new Date('2026-09-03T16:30:45Z')),
  '03 Sep 2026 16:30:45'
);
assert.throws(() => decryptMigrationPassword('invalid'), /Stored migration credential is invalid/);
console.log('subscriberMigrationRadius tests passed');
