const assert = require('assert');
const db = require('../src/db');
const { ensureMikrotikTables } = require('../src/services/mikrotik');
const { ensureHotspotTvSchema } = require('../src/services/hotspotTv');

async function run() {
  await ensureMikrotikTables();
  await ensureHotspotTvSchema();

  const result = await db.query(`
    SELECT
      TO_REGCLASS('public.billing_hotspot_tv_plans') AS plans,
      TO_REGCLASS('public.billing_hotspot_tv_subscribers') AS subscribers,
      TO_REGCLASS('public.hotspot_tv_payment_fulfillments') AS fulfillments
  `);

  assert.strictEqual(result.rows[0].plans, 'billing_hotspot_tv_plans');
  assert.strictEqual(result.rows[0].subscribers, 'billing_hotspot_tv_subscribers');
  assert.strictEqual(result.rows[0].fulfillments, 'hotspot_tv_payment_fulfillments');

  const indexes = await db.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname='public'
      AND indexname IN (
        'idx_hotspot_tv_subscribers_expiry',
        'idx_hotspot_tv_subscribers_client',
        'idx_hotspot_tv_fulfillments_client'
      )
  `);
  assert.strictEqual(indexes.rows.length, 3, 'all TV package indexes should exist');

  console.log('Hotspot TV schema integration test passed.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
