const assert = require('assert');
const {
  migrationDestinationFor,
  missingActiveSessions,
  normalizeServiceType,
  planTableFor,
  radiusCommentFor,
  radiusServiceFor,
  safeHotspotSnapshot,
  safePppSnapshot,
  targetHotspotProfileIds,
} = require('../src/services/subscriberMigrationPolicy');

assert.strictEqual(normalizeServiceType('PPPoE'), 'pppoe');
assert.strictEqual(normalizeServiceType(' hotspot '), 'hotspot');
assert.throws(() => normalizeServiceType('dhcp'), /PPPoE or Hotspot/);
assert.strictEqual(radiusServiceFor('pppoe'), 'ppp');
assert.strictEqual(radiusServiceFor('hotspot'), 'hotspot');
assert.strictEqual(radiusCommentFor('hotspot'), 'POLYIZON migration RADIUS hotspot');
assert.strictEqual(migrationDestinationFor('pppoe'), 'billing_subscribers');
assert.strictEqual(migrationDestinationFor('hotspot'), 'billing_hotspot_members');
assert.strictEqual(planTableFor('pppoe'), 'billing_plans');
assert.strictEqual(planTableFor('hotspot'), 'billing_hotspot_plans');

assert.deepStrictEqual(
  targetHotspotProfileIds([
    { profile: 'hsprof1', disabled: 'no' },
    { profile: 'hsprof1', disabled: 'no' },
    { profile: 'hsprof2', disabled: 'yes' },
    { profile: 'hsprof3' },
  ]),
  ['hsprof1', 'hsprof3']
);

const pppBefore = [
  { '.id': '*1', name: 'alice', address: '10.0.0.2' },
  { '.id': '*2', name: 'bob', address: '10.0.0.3' },
];
assert.deepStrictEqual(missingActiveSessions('pppoe', pppBefore, [pppBefore[0]]), [pppBefore[1]]);

const hotspotBefore = [
  { '.id': '*A', user: 'alice', address: '10.5.0.2', 'mac-address': 'AA:BB:CC:DD:EE:FF' },
];
assert.deepStrictEqual(missingActiveSessions('hotspot', hotspotBefore, [{ ...hotspotBefore[0], uptime: '5m' }]), []);

const pppSnapshot = safePppSnapshot({
  secrets: [{ '.id': '*9', name: 'alice', password: 'must-not-leak', disabled: 'no' }],
});
assert.strictEqual(pppSnapshot.local_pppoe_credentials[0].password, undefined);

const hotspotSnapshot = safeHotspotSnapshot({
  users: [{ '.id': '*8', name: 'alice', password: 'must-not-leak', profile: 'default' }],
});
assert.strictEqual(hotspotSnapshot.local_hotspot_credentials[0].password, undefined);

console.log('subscriberMigrationPolicy tests passed');
