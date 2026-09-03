const assert = require('assert');

const {
  formatRadiusExpiration,
  normalizeAccountNumber,
  normalizePppoeUsername,
  rateLimitFromPlan,
} = require('../src/services/pppoeProvisioning');

assert.strictEqual(normalizeAccountNumber('  pz-00123 '), 'PZ-00123');
assert.strictEqual(normalizePppoeUsername('  john.123  '), 'john.123');

assert.strictEqual(
  rateLimitFromPlan({ radius_profile: '5M/10M', upload_speed_mbps: 3, download_speed_mbps: 8 }),
  '5M/10M'
);

assert.strictEqual(
  rateLimitFromPlan({ upload_speed_mbps: 10, download_speed_mbps: 20 }),
  '10M/20M'
);

assert.strictEqual(
  rateLimitFromPlan({ upload_speed_mbps: 2.5, download_speed_mbps: 7.25 }),
  '2.5M/7.25M'
);

assert.strictEqual(rateLimitFromPlan({ upload_speed_mbps: 10 }), null);

assert.strictEqual(
  formatRadiusExpiration(new Date('2026-09-03T20:15:09.000Z')),
  '03 Sep 2026 20:15:09'
);

console.log('PPPoE provisioning helper tests passed.');
