const crypto = require('crypto');
const db = require('../src/db');
const {
  observeTwinEntities,
  projectDigitalTwinEvent,
} = require('../src/services/digitalTwin');
const {
  collectTenantMetrics,
  ensureTwinStabilitySchema,
  reconcileTenantSources,
  sampleTenantStability,
} = require('../src/services/twinStability');

async function run() {
  await ensureTwinStabilitySchema(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(
      `INSERT INTO clients (name, account_type) VALUES ($1, 'billing') RETURNING id`,
      [`Twin Stability ${crypto.randomUUID()}`]
    );
    const clientId = tenant.rows[0].id;
    const plan = await client.query(
      `INSERT INTO billing_plans (client_id, name, price) VALUES ($1,$2,2000) RETURNING id`,
      [clientId, `Stable Plan ${crypto.randomUUID()}`]
    );
    const subscriber = await client.query(
      `INSERT INTO billing_subscribers (
         client_id, plan_id, full_name, account_number, radius_username
       ) VALUES ($1,$2,'Synthetic Stability Subscriber',$3,$4) RETURNING id`,
      [clientId, plan.rows[0].id, `STAB-${crypto.randomUUID()}`, `radius-${crypto.randomUUID()}`]
    );
    await observeTwinEntities([{
      clientId,
      eventType: 'subscriber.connected',
      category: 'radius',
      source: 'radius_accounting_live',
      entityType: 'subscriber',
      entityId: subscriber.rows[0].id,
      state: { online: true, operational_status: 'online' },
    }], { queryable: client });

    const healthy = await sampleTenantStability(clientId, { queryable: client, suppressEvents: true });
    if (healthy.status !== 'healthy' || Number(healthy.freshness_score) !== 100) {
      throw new Error('Fresh source coverage did not produce a healthy sample');
    }

    const eventId = crypto.randomUUID();
    const pending = await client.query(
      `INSERT INTO billing_events (
         id, client_id, event_type, event_category, source,
         entity_type, entity_id, title, recorded_at, occurred_at
       ) VALUES ($1,$2,'subscriber.updated','subscriber','stability_test',
         'subscriber',$3,'Delayed synthetic event',NOW() - INTERVAL '10 minutes',NOW() - INTERVAL '10 minutes')
       RETURNING *`,
      [eventId, clientId, subscriber.rows[0].id]
    );
    const critical = await sampleTenantStability(clientId, { queryable: client, suppressEvents: true });
    if (critical.status !== 'critical') throw new Error('Stalled projection did not produce a critical sample');
    const opened = await client.query(
      `SELECT status FROM billing_twin_alerts WHERE client_id = $1 AND alert_key = 'projection_stalled'`,
      [clientId]
    );
    if (opened.rows[0]?.status !== 'open') throw new Error('Projection alert did not open');

    await projectDigitalTwinEvent(client, pending.rows[0]);
    const recovered = await sampleTenantStability(clientId, { queryable: client, suppressEvents: true });
    if (recovered.status !== 'healthy') throw new Error('Stability did not recover after projection');
    const resolved = await client.query(
      `SELECT status FROM billing_twin_alerts WHERE client_id = $1 AND alert_key = 'projection_stalled'`,
      [clientId]
    );
    if (resolved.rows[0]?.status !== 'resolved') throw new Error('Projection alert did not resolve');

    const reconciliation = await reconcileTenantSources(clientId, client);
    if (reconciliation.relationships_reconciled < 1) throw new Error('Source reconciliation did not rebuild relationships');

    const load = Array.from({ length: 1000 }, (_, index) => ({
      clientId,
      eventType: 'load_entity.observed',
      category: 'synthetic_load',
      source: 'synthetic_load_test',
      entityType: 'load_entity',
      entityId: `entity-${index}`,
      state: { online: true, sequence: index },
    }));
    const startedAt = Date.now();
    await observeTwinEntities(load, { queryable: client });
    const durationMs = Date.now() - startedAt;
    const loadCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM billing_twin_source_observations
       WHERE client_id = $1 AND source = 'synthetic_load_test'`,
      [clientId]
    );
    if (Number(loadCount.rows[0].count) !== 1000 || durationMs > 10000) {
      throw new Error(`Batched observation benchmark failed (${durationMs}ms)`);
    }
    const finalMetrics = await collectTenantMetrics(clientId, client);
    if (finalMetrics.missing_relationship_endpoints !== 0) throw new Error('Reconciliation created broken graph endpoints');

    await client.query('ROLLBACK');
    console.log(`Twin stability fault recovery, reconciliation and 1000-observation benchmark passed in ${durationMs}ms and rolled back.`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction did not begin */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
