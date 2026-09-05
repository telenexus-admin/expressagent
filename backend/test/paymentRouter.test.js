const assert = require('assert');

const {
  ADAPTERS,
  decisionForProfile,
  idempotencyKey,
} = require('../src/services/paymentRouter');

assert.deepStrictEqual(Object.keys(ADAPTERS).sort(), ['coop', 'equity', 'kcb', 'ncba']);
assert.ok(Object.values(ADAPTERS).every((adapter) => adapter.implemented === false));

assert.deepStrictEqual(
  decisionForProfile(null),
  { routeStatus: 'blocked', blockReason: 'settlement_profile_missing' }
);
assert.deepStrictEqual(
  decisionForProfile({ verification_status: 'pending', routing_status: 'disabled', institution_code: 'ncba' }),
  { routeStatus: 'blocked', blockReason: 'settlement_pending' }
);
assert.deepStrictEqual(
  decisionForProfile({ verification_status: 'verified', routing_status: 'ready', institution_code: 'kcb' }),
  { routeStatus: 'blocked', blockReason: 'settlement_routing_ready' }
);
assert.deepStrictEqual(
  decisionForProfile({ verification_status: 'verified', routing_status: 'active', institution_code: 'equity' }),
  { routeStatus: 'blocked', blockReason: 'settlement_adapter_not_connected' }
);

const first = idempotencyKey(42, 'MPESA-42-ABC');
const second = idempotencyKey(42, 'MPESA-42-ABC');
const otherTenant = idempotencyKey(43, 'MPESA-42-ABC');
assert.strictEqual(first, second);
assert.notStrictEqual(first, otherTenant);
assert.match(first, /^[a-f0-9]{64}$/);

console.log('Payment router unit tests passed');
