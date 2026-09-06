const assert = require('assert');

const {
  ADAPTERS,
  decisionForProfile,
  idempotencyKey,
  isDirectBankProfile,
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

const directEquity = {
  verification_status: 'verified',
  routing_status: 'active',
  institution_code: 'equity',
  rail_reference: 'daraja-direct-stk:247247',
};
const directCoop = {
  verification_status: 'verified',
  routing_status: 'active',
  institution_code: 'coop',
  rail_reference: 'daraja-direct-stk:400200',
};
assert.strictEqual(isDirectBankProfile(directEquity), true);
assert.strictEqual(isDirectBankProfile(directCoop), true);
assert.deepStrictEqual(
  decisionForProfile(directEquity, 'paid'),
  { routeStatus: 'settled', blockReason: null }
);
assert.deepStrictEqual(
  decisionForProfile(directCoop, 'failed'),
  { routeStatus: 'failed', blockReason: 'collection_failed' }
);
assert.deepStrictEqual(
  decisionForProfile({ ...directEquity, institution_code: 'kcb' }, 'paid'),
  { routeStatus: 'blocked', blockReason: 'settlement_adapter_not_connected' }
);

const first = idempotencyKey(42, 'MPESA-42-ABC');
const second = idempotencyKey(42, 'MPESA-42-ABC');
const otherTenant = idempotencyKey(43, 'MPESA-42-ABC');
assert.strictEqual(first, second);
assert.notStrictEqual(first, otherTenant);
assert.match(first, /^[a-f0-9]{64}$/);

console.log('Payment router unit tests passed');
