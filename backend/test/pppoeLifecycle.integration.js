const assert = require('assert');
const db = require('../src/db');
const {
  accessIsActive,
  effectiveExpiry,
  ensurePppoeLifecycleSchema,
  secondsUntilExpiry,
} = require('../src/services/pppoeLifecycleController');

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

  console.log('PPPoE lifecycle policy and schema tests passed.');
  await db.end();
})().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => {});
  process.exit(1);
});
