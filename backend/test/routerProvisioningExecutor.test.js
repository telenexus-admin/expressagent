const assert = require('assert');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-thirty-two-characters';
const {
  confirmationPhrase,
  portalContent,
  provisioningFeatureState,
  selectorFor,
} = require('../src/services/routerProvisioningExecutor');

assert.strictEqual(confirmationPhrase('abcdef1234567890'), 'EXECUTE ABCDEF123456');
assert.deepStrictEqual(selectorFor({ args: { name: 'NEXA-HOTSPOT', comment: 'NEXA managed' } }), { name: 'NEXA-HOTSPOT' });
assert.deepStrictEqual(selectorFor({ args: { address: '10.20.0.1/24', interface: 'bridge' } }), { address: '10.20.0.1/24', interface: 'bridge' });
assert.deepStrictEqual(selectorFor({ selector: { comment: 'NEXA managed PPPoE server' }, args: {} }), { comment: 'NEXA managed PPPoE server' });
const login = portalContent('tenant-hotspot-login', 27);
assert.ok(login.includes('/hotspot?portalToken='));
assert.ok(login.includes('$(link-login-only)'));
assert.ok(login.includes('$(mac)'));
assert.ok(!login.includes('test-secret-that-is-at-least-thirty-two-characters'));
const status = portalContent('tenant-hotspot-status', 27);
assert.ok(status.includes('$(bytes-in-nice)'));
assert.ok(status.includes('$(session-time-left)'));
assert.throws(() => portalContent('unknown', 27), /Unknown captive portal/);
const state = provisioningFeatureState();
assert.strictEqual(state.automatic_execution, false);
assert.strictEqual(state.approval_required, true);
assert.strictEqual(state.plan_seal_required, true);
assert.strictEqual(state.pre_activation_radius_probe, true);
assert.strictEqual(state.structured_rollback, true);
console.log('Guarded RouterOS provisioning executor tests passed.');