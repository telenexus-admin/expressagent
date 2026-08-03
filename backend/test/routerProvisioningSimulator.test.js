const assert = require('assert');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-thirty-two-characters';
const { compileBillingBlueprint } = require('../src/services/routerBillingBlueprint');
const { executeRouterOperation, preActivationCheck, rollback, verifyApplied } = require('../src/services/routerProvisioningExecutor');

function printPath(path) { return path.endsWith('/add') ? path.slice(0, -4) + '/print' : path; }

class RouterSimulator {
  constructor() {
    this.next = 1;
    this.rows = {
      '/system/identity/print': [{ '.id': '*identity', name: 'NEXA-LAB' }],
      '/system/resource/print': [{ '.id': '*resource', version: '7.18.2' }],
      '/ip/dns/print': [{ '.id': '*dns', 'allow-remote-requests': 'no', servers: '' }],
      '/ppp/aaa/print': [{ '.id': '*aaa', 'use-radius': 'no', accounting: 'no', 'interim-update': '0s' }],
      '/file/print': [],
    };
    this.backups = [];
  }
  async command(path, args = {}) {
    if (path.endsWith('/print')) return (this.rows[path] || []).map((row) => ({ ...row }));
    if (path === '/system/backup/save') { this.backups.push(args.name); return []; }
    if (path === '/file/make-directory') {
      this.rows['/file/print'].push({ '.id': '*' + this.next++, name: args.path, type: 'directory' }); return [];
    }
    if (path.endsWith('/add')) {
      const target = printPath(path);
      this.rows[target] = this.rows[target] || [];
      this.rows[target].push({ '.id': '*' + this.next++, ...args });
      return [];
    }
    if (path.endsWith('/set')) {
      const target = path.slice(0, -4) + '/print';
      this.rows[target] = this.rows[target] || [];
      let row = args['.id'] ? this.rows[target].find((item) => item['.id'] === args['.id']) : this.rows[target][0];
      if (!row) { row = { '.id': '*' + this.next++ }; this.rows[target].push(row); }
      Object.assign(row, Object.fromEntries(Object.entries(args).filter(([key]) => key !== '.id')));
      return [];
    }
    if (path.endsWith('/remove')) {
      const target = path.slice(0, -7) + '/print';
      this.rows[target] = (this.rows[target] || []).filter((row) => row['.id'] !== args['.id']);
      return [];
    }
    throw new Error('Simulator does not support ' + path);
  }
}

(async () => {
  const plan = compileBillingBlueprint({
    desired_services: { pppoe: true, hotspot: true, service_interface: 'bridge', wan_interface_list: 'WAN' },
    capability_profile: { adapter_version: 'routeros-v7.1', blockers: [] },
    current_config: { bridges: [{ name: 'bridge' }], interface_lists: [{ name: 'WAN' }] },
    fingerprint: { inventory: { interfaces: [{ name: 'bridge' }] } },
    nas_identifier: 'nexa-1-9-lab', nas_ip: '10.77.0.9', radius_host: '10.78.0.2',
  });
  const client = new RouterSimulator();
  const radiusState = { registered: false, probeCount: 0 };
  const context = {
    run: { id: '12345678-aaaa-bbbb-cccc-123456789012', client_id: 1, router_id: 9 },
    snapshots: {}, created: [], updated: [], fileSnapshots: [], radiusRegistered: false,
    radius: { host: '10.78.0.2', nas_ip: '10.77.0.9', nas_identifier: 'nexa-1-9-lab', secret: 'strong-router-radius-secret-1234' },
    radiusOps: {
      registerRouterNas: async () => { radiusState.registered = true; return { registered: true }; },
      testRouterNasRegistration: async () => ({ registered: radiusState.registered }),
      probeRouterRadius: async () => { radiusState.probeCount += 1; return { passed: true, access_accept: true, accounting_start: true, accounting_stop: true }; },
      unregisterRouterNas: async () => { radiusState.registered = false; return { removed: true }; },
    },
  };
  for (const stage of plan.stages) {
    if (stage.name === 'activate_after_validation') {
      const pre = await preActivationCheck(client, context);
      assert.strictEqual(pre.radius_probe.access_accept, true);
    }
    for (const operation of stage.operations) await executeRouterOperation(client, operation, context);
  }
  const verification = await verifyApplied(client, plan);
  assert.strictEqual(verification.passed, true);
  assert.strictEqual(radiusState.probeCount, 1);
  assert.strictEqual(client.rows['/ip/hotspot/print'][0].disabled, 'no');
  assert.strictEqual(client.rows['/ip/dhcp-server/print'][0].disabled, 'no');
  assert.strictEqual(client.rows['/interface/pppoe-server/server/print'][0].disabled, 'no');
  assert.strictEqual(client.rows['/file/print'].filter((row) => row.name.endsWith('.html')).length, 3);
  assert.ok(client.backups[0].includes('12345678'));
  const reverted = await rollback(client, context);
  assert.strictEqual(reverted.passed, true);
  assert.strictEqual(radiusState.registered, false);
  assert.strictEqual(client.rows['/ip/dns/print'][0]['allow-remote-requests'], 'no');
  assert.strictEqual(client.rows['/ppp/aaa/print'][0]['use-radius'], 'no');
  assert.strictEqual(client.rows['/ip/hotspot/print'].length, 0);
  assert.strictEqual(client.rows['/file/print'].length, 0);
  console.log('Full simulated RouterOS provisioning and rollback test passed.');
})().catch((error) => { console.error(error); process.exit(1); });