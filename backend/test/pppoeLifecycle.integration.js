const assert = require('assert');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-thirty-two-characters';
const db = require('../src/db');
const { ensurePppoeDeletionCapture } = require('../src/services/pppoeDeletionCapture');
const {
  accessIsActive,
  effectiveExpiry,
  ensurePppoeLifecycleSchema,
  secondsUntilExpiry,
} = require('../src/services/pppoeLifecycleController');
const { compileBillingBlueprint } = require('../src/services/routerBillingBlueprint');
const { rollback, verifyApplied } = require('../src/services/routerProvisioningExecutor');

const now = new Date('2026-09-05T12:00:00.000Z');
const active = {
  service_status: 'active',
  radius_status: 'active',
  expires_at: '2026-09-05T13:00:00.000Z',
  grace_period_days: 0,
};
assert.strictEqual(accessIsActive(active, now), true);
assert.strictEqual(secondsUntilExpiry(active, now), 3600);
assert.strictEqual(accessIsActive({ ...active, service_status: 'suspended' }, now), false);
assert.strictEqual(accessIsActive({ ...active, radius_status: 'suspended' }, now), false);
assert.strictEqual(accessIsActive({ ...active, expires_at: '2026-09-05T11:59:59.000Z' }, now), false);
assert.strictEqual(
  effectiveExpiry({ expires_at: '2026-09-05T12:00:00.000Z', grace_period_days: 2 }).toISOString(),
  '2026-09-07T12:00:00.000Z'
);

(async () => {
  await ensurePppoeLifecycleSchema();
  await ensurePppoeDeletionCapture();

  const table = await db.query("SELECT to_regclass('public.billing_pppoe_lifecycle_state') AS name");
  assert.strictEqual(table.rows[0]?.name, 'billing_pppoe_lifecycle_state');

  const columns = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='billing_pppoe_lifecycle_state'
  `);
  const names = new Set(columns.rows.map((row) => row.column_name));
  for (const required of [
    'subscriber_id', 'client_id', 'router_id', 'radius_username', 'plan_id',
    'plan_updated_at', 'rate_limit', 'access_active', 'effective_expires_at',
    'last_action', 'last_error',
  ]) {
    assert(names.has(required), `Missing lifecycle state column: ${required}`);
  }

  const trigger = await db.query(`
    SELECT tgname
    FROM pg_trigger
    WHERE tgname = 'billing_subscribers_capture_pppoe_delete'
      AND NOT tgisinternal
  `);
  assert.strictEqual(trigger.rows[0]?.tgname, 'billing_subscribers_capture_pppoe_delete');

  const blueprint = compileBillingBlueprint({
    desired_services: {
      pppoe: true,
      hotspot: false,
      service_interface: 'bridge-subscribers',
      wan_interface_list: 'WAN',
    },
    capability_profile: { adapter_version: 'routeros-v7.1', blockers: [] },
    current_config: {},
    nas_identifier: 'polyizon-ci-edge',
    nas_ip: '10.77.0.2',
    radius_host: '10.78.0.2',
    radius_dynamic_auth_port: 1700,
  });
  const operations = blueprint.stages.flatMap((stage) => stage.operations);
  const incoming = operations.find((item) => item.path === '/radius/incoming/set');
  assert(incoming, 'Router provisioning must enable RADIUS incoming');
  assert.deepStrictEqual(incoming.args, { accept: 'yes', port: '1700' });
  const incomingFirewall = operations.find((item) =>
    item.path === '/ip/firewall/filter/add' && item.args.comment === 'NEXA allow RADIUS dynamic auth'
  );
  assert(incomingFirewall, 'Router provisioning must add a scoped RADIUS dynamic auth input rule');
  assert.strictEqual(incomingFirewall.args.protocol, 'udp');
  assert.strictEqual(incomingFirewall.args['src-address'], '10.78.0.2');
  assert.strictEqual(incomingFirewall.args['dst-port'], '1700');
  const snapshot = blueprint.stages.find((stage) => stage.name === 'checkpoint').operations
    .find((item) => item.path === 'nexa://snapshot/capture');
  assert(snapshot.args.paths.includes('/radius/incoming/print'));

  const rollbackCommands = [];
  const rollbackResult = await rollback({
    async command(path, args = {}) {
      rollbackCommands.push({ path, args });
      return [];
    },
  }, {
    created: [],
    updated: [],
    fileSnapshots: [],
    snapshots: {
      '/radius/incoming/print': [{ accept: 'no', port: '1700' }],
    },
    radiusRegistered: false,
  });
  assert.strictEqual(rollbackResult.passed, true);
  const restoredIncoming = rollbackCommands.find((item) => item.path === '/radius/incoming/set');
  assert(restoredIncoming, 'Rollback must restore RADIUS incoming state');
  assert.deepStrictEqual(restoredIncoming.args, { accept: 'no', port: '1700' });

  const verification = await verifyApplied({
    async command(path) {
      if (path === '/radius/incoming/print') return [{ accept: 'yes', port: '1700' }];
      if (path === '/system/identity/print') return [{ name: 'polyizon-ci-edge' }];
      if (path === '/ip/firewall/filter/print') {
        return [{
          '.id': '*1',
          chain: 'input',
          action: 'accept',
          protocol: 'udp',
          'dst-port': '1700',
          'src-address': '10.78.0.2',
          comment: 'NEXA allow RADIUS dynamic auth',
        }];
      }
      return [];
    },
  }, {
    stages: [{ operations: [incomingFirewall, incoming] }],
  });
  assert.strictEqual(verification.passed, true);

  console.log('PPPoE lifecycle, deletion capture and RouterOS dynamic auth provisioning tests passed.');
  await db.end();
})().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => {});
  process.exit(1);
});
