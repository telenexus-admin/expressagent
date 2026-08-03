const crypto = require('crypto');
const db = require('../src/db');
const {
  buildNexaTwinContext,
  ensureDigitalTwinSchema,
  getTwinEntity,
  getTwinHealth,
  getTwinImpact,
  listTwinEntities,
  observeTwinEntities,
  observeTwinRelationship,
  projectDigitalTwinEvent,
} = require('../src/services/digitalTwin');

async function run() {
  await ensureDigitalTwinSchema(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tenants = await client.query(
      `INSERT INTO clients (name, account_type)
       VALUES ($1, 'billing'), ($2, 'billing') RETURNING id`,
      [`Twin Isolation A ${crypto.randomUUID()}`, `Twin Isolation B ${crypto.randomUUID()}`]
    );
    const tenantA = tenants.rows[0].id;
    const tenantB = tenants.rows[1].id;
    const routerAEvent = crypto.randomUUID();
    const subscriberAEvent = crypto.randomUUID();
    const routerBEvent = crypto.randomUUID();

    const events = await client.query(
      `INSERT INTO billing_events (
         id, client_id, event_type, event_category, source,
         entity_type, entity_id, severity, title, new_state, occurred_at
       ) VALUES
         ($1,$2,'router.online','network','test','router','shared-router','info',
          'Router A online','{"online":true,"name":"Router A"}',NOW()),
         ($3,$2,'subscriber.connected','radius','test','subscriber','subscriber-a','info',
          'Subscriber connected','{"online":true,"status":"active"}',NOW()),
         ($4,$5,'router.offline','network','test','router','shared-router','critical',
          'Router B offline','{"online":false,"name":"Router B"}',NOW())
       RETURNING *`,
      [routerAEvent, tenantA, subscriberAEvent, routerBEvent, tenantB]
    );
    await client.query(
      `INSERT INTO billing_event_entities (event_id, client_id, entity_type, entity_id, relationship)
       VALUES ($1,$2,'router','shared-router','served_by')`,
      [subscriberAEvent, tenantA]
    );

    await projectDigitalTwinEvent(client, events.rows[0]);
    await projectDigitalTwinEvent(client, events.rows[1]);
    await projectDigitalTwinEvent(client, events.rows[2]);
    const duplicate = await projectDigitalTwinEvent(client, events.rows[1]);
    if (!duplicate.duplicate) throw new Error('Digital twin projection was not idempotent');

    const tenantARouter = await getTwinEntity(tenantA, 'router', 'shared-router', { queryable: client });
    const tenantBRouter = await getTwinEntity(tenantB, 'router', 'shared-router', { queryable: client });
    if (tenantARouter.operational_status !== 'online') throw new Error('Tenant A router state is incorrect');
    if (tenantBRouter.operational_status !== 'offline') throw new Error('Tenant B router state is incorrect');
    if (tenantARouter.display_name === tenantBRouter.display_name) throw new Error('Twin state crossed tenants');

    const tenantAEntities = await listTwinEntities(tenantA, { queryable: client });
    if (tenantAEntities.some((entity) => entity.display_name === 'Router B')) {
      throw new Error('Tenant A can list Tenant B entities');
    }
    await observeTwinEntities([{
      clientId: tenantA,
      eventType: 'subscriber.connected',
      category: 'radius',
      source: 'test_live',
      entityType: 'subscriber',
      entityId: 'subscriber-a',
      state: { online: true, operational_status: 'online' },
    }], { queryable: client });
    const observedSubscriber = await getTwinEntity(tenantA, 'subscriber', 'subscriber-a', { queryable: client });
    if (observedSubscriber.operational_status !== 'online' || observedSubscriber.stale) {
      throw new Error('Live twin observation did not refresh subscriber state');
    }

    await observeTwinRelationship({
      clientId: tenantA,
      fromEntityType: 'subscriber',
      fromEntityId: 'subscriber-a',
      relationship: 'served_by',
      toEntityType: 'router',
      toEntityId: 'shared-router',
      active: false,
    }, { queryable: client });
    const endedImpact = await getTwinImpact(tenantA, 'router', 'shared-router', { queryable: client, depth: 3 });
    if (endedImpact.nodes.some((node) => node.entity_id === 'subscriber-a')) {
      throw new Error('Ended relationship remained in the live impact graph');
    }
    await observeTwinRelationship({
      clientId: tenantA,
      fromEntityType: 'subscriber',
      fromEntityId: 'subscriber-a',
      relationship: 'served_by',
      toEntityType: 'router',
      toEntityId: 'shared-router',
      active: true,
    }, { queryable: client });
    const impact = await getTwinImpact(tenantA, 'router', 'shared-router', { queryable: client, depth: 3 });
    if (!impact.nodes.some((node) => node.entity_id === 'subscriber-a')) {
      throw new Error('Impact traversal did not find the related subscriber');
    }
    if (impact.nodes.some((node) => node.display_name === 'Router B')) {
      throw new Error('Impact traversal crossed tenant boundaries');
    }
    const context = await buildNexaTwinContext(tenantA, 'Is shared-router online and who is affected?', {
      queryable: client,
      depth: 3,
    });
    if (!context.context.includes('Router A') || context.context.includes('Router B') || !context.impact) {
      throw new Error('Conversational twin context was incomplete or crossed tenants');
    }

    const health = await getTwinHealth(tenantA, { queryable: client });
    if (Number(health.entities) !== 2 || Number(health.pending_events) !== 0) {
      throw new Error('Digital twin health counts are incorrect');
    }

    await client.query('ROLLBACK');
    console.log('Digital twin schema, idempotency, impact and tenant-isolation tests passed and were rolled back.');
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
