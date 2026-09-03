const assert = require('assert');
const {
  inventoryDrift,
  legacyControllerCandidates,
  safeRouterAccount,
} = require('../src/services/subscriberMigrationWispman');
const {
  desiredDisabledValue,
  desiredHotspotDisabledValue,
  effectiveHotspotLocalApiActive,
  effectiveLocalApiActive,
} = require('../src/services/subscriberLocalApiController');

const safe = safeRouterAccount({
  '.id': '*12',
  name: 'john',
  profile: 'HOME10',
  disabled: 'no',
  password: 'must-never-leak',
  comment: 'customer',
});
assert.strictEqual(safe.password, undefined);
assert.strictEqual(safe.name, 'john');
assert.strictEqual(safe.profile, 'HOME10');

const candidates = legacyControllerCandidates(
  [
    { '.id': '*1', name: 'polyizon-api', disabled: 'no' },
    { '.id': '*2', name: 'wispman-api', group: 'full', disabled: 'no', comment: 'Wispman billing' },
    { '.id': '*3', name: 'noc', group: 'read', disabled: 'no' },
  ],
  [
    { name: 'wispman-api', via: 'api', address: '10.0.0.5' },
    { name: 'noc', via: 'winbox', address: '10.0.0.6' },
  ],
  'polyizon-api'
);
assert.strictEqual(candidates.length, 1);
assert.strictEqual(candidates[0].name, 'wispman-api');
assert.strictEqual(candidates[0].confidence, 'high');
assert.strictEqual(candidates[0].active, true);

const drift = inventoryDrift(
  [{ normalized: { username: 'john', router_account_id: '*12', router_profile: 'HOME10', router_disabled: 'no' } }],
  { accounts: [{ id: '*12', name: 'john', profile: 'HOME20', disabled: 'no' }] }
);
assert.strictEqual(drift.length, 1);
assert.strictEqual(drift[0].reason, 'profile_changed');

const future = new Date(Date.now() + 3600000).toISOString();
const past = new Date(Date.now() - 3600000).toISOString();
assert.strictEqual(effectiveLocalApiActive({
  service_status: 'active',
  radius_status: 'active',
  expires_at: future,
  grace_period_days: 0,
}), true);
assert.strictEqual(desiredDisabledValue({
  service_status: 'active',
  radius_status: 'active',
  expires_at: future,
  grace_period_days: 0,
}), 'no');
assert.strictEqual(desiredDisabledValue({
  service_status: 'expired',
  radius_status: 'expired',
  expires_at: past,
  grace_period_days: 0,
}), 'yes');
assert.strictEqual(effectiveHotspotLocalApiActive({ is_active: true, expires_at: future }), true);
assert.strictEqual(desiredHotspotDisabledValue({ is_active: true, expires_at: future }), 'no');
assert.strictEqual(desiredHotspotDisabledValue({ is_active: false, expires_at: future }), 'yes');
assert.strictEqual(desiredHotspotDisabledValue({ is_active: true, expires_at: past }), 'yes');

console.log('subscriberMigrationWispman tests passed');
