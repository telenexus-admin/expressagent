const assert = require('assert');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-thirty-two-characters';
const {
  confirmationPhrase,
  portalContent,
  provisioningFeatureState,
  rollback,
  selectorFor,
  verifyApplied,
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

(async () => {
  const rollbackCommands = [];
  const rollbackClient = {
    async command(path, args = {}) {
      rollbackCommands.push({ path, args });
      return [];
    },
  };
  const rollbackResult = await rollback(rollbackClient, {
    created: [],
    updated: [],
    fileSnapshots: [],
    snapshots: {
      '/ip/dns/print': [{ 'allow-remote-requests': 'no', servers: '1.1.1.1' }],
      '/ppp/aaa/print': [{ 'use-radius': 'no', accounting: 'no', 'interim-update': '0s' }],
      '/radius/incoming/print': [{ accept: 'no', port: '1700' }],
    },
    radiusRegistered: false,
  });
  assert.strictEqual(rollbackResult.passed, true);
  const restoreIncoming = rollbackCommands.find((item) => item.path === '/radius/incoming/set');
  assert(restoreIncoming, 'RADIUS incoming settings must be restored during rollback');
  assert.deepStrictEqual(restoreIncoming.args, { accept: 'no', port: '1700' });

  const verificationCommands = [];
  const verificationClient = {
    async command(path) {
      verificationCommands.push(path);
      if (path === '/radius/incoming/print') return [{ accept: 'yes', port: '1700' }];
      if (path === '/system/identity/print') return [{ name: 'edge-1' }];
      if (path === '/ip/firewall/filter/print') {
        return [{
          '.id': '*1', chain: 'input', action: 'accept', protocol: 'udp',
          'dst-port': '1700', 'src-address': '10.78.0.2', comment: 'NEXA allow RADIUS dynamic auth',
        }];
      }
      return [];
    },
  };
  const verification = await verifyApplied(verificationClient, {
    stages: [{ operations: [
      {
        path: '/radius/incoming/set',
        args: { accept: 'yes', port: '1700' },
      },
      {
        path: '/ip/firewall/filter/add',
        args: {
          chain: 'input', action: 'accept', protocol: 'udp', 'dst-port': '1700',
          'src-address': '10.78.0.2', comment: 'NEXA allow RADIUS dynamic auth',
        },
      },
    ] }],
  });
  assert.strictEqual(verification.passed, true);
  assert(verificationCommands.includes('/radius/incoming/print'));

  console.log('Guarded RouterOS provisioning executor tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
