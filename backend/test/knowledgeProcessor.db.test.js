const crypto = require('crypto');
const db = require('../src/db');
const {
  ensureKnowledgeSchema,
  listKnowledgeEntities,
  projectKnowledgeEvent,
  searchKnowledge,
  updateWorkerState,
} = require('../src/services/knowledgeProcessor');

async function run() {
  await ensureKnowledgeSchema(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tenants = await client.query(
      `INSERT INTO clients (name, account_type)
       VALUES ($1, 'billing'), ($2, 'billing')
       RETURNING id`,
      [`Knowledge Isolation A ${crypto.randomUUID()}`, `Knowledge Isolation B ${crypto.randomUUID()}`]
    );
    const tenantA = tenants.rows[0].id;
    const tenantB = tenants.rows[1].id;
    const eventA = crypto.randomUUID();
    const eventB = crypto.randomUUID();

    await updateWorkerState('running', {}, client);
    await updateWorkerState('idle', { processedCount: 2 }, client);

    const events = await client.query(
      `INSERT INTO billing_events (
         id, client_id, event_type, event_category, source,
         entity_type, entity_id, title, new_state, occurred_at
       ) VALUES
         ($1,$2,'subscriber.updated','subscriber','test','subscriber','shared-id','Tenant alpha marker','{"display_name":"Alpha Subscriber","status":"active"}',NOW()),
         ($3,$4,'subscriber.updated','subscriber','test','subscriber','shared-id','Tenant beta marker','{"display_name":"Beta Subscriber","status":"active"}',NOW())
       RETURNING *`,
      [eventA, tenantA, eventB, tenantB]
    );
    const outbox = await client.query(
      `INSERT INTO billing_event_outbox (
         event_id, client_id, topic, event_envelope, status, attempts, locked_at, locked_by
       ) VALUES
         ($1,$2,'test.alpha','{}','processing',1,NOW(),'test-worker'),
         ($3,$4,'test.beta','{}','processing',1,NOW(),'test-worker')
       RETURNING *`,
      [eventA, tenantA, eventB, tenantB]
    );
    await projectKnowledgeEvent(client, events.rows[0], outbox.rows[0]);
    await projectKnowledgeEvent(client, events.rows[1], outbox.rows[1]);

    const alphaFacts = await searchKnowledge(tenantA, 'alpha marker', { queryable: client });
    const betaFactsFromAlpha = await searchKnowledge(tenantA, 'beta marker', { queryable: client });
    const betaFacts = await searchKnowledge(tenantB, 'beta marker', { queryable: client });
    if (alphaFacts.length !== 1 || alphaFacts[0].client_id !== undefined) {
      throw new Error('Tenant A fact search did not return the expected safe projection');
    }
    if (betaFactsFromAlpha.length !== 0) {
      throw new Error('Tenant A could search Tenant B knowledge');
    }
    if (betaFacts.length !== 1) {
      throw new Error('Tenant B fact search did not return its own knowledge');
    }

    const alphaEntities = await listKnowledgeEntities(tenantA, {
      entityType: 'subscriber',
      query: 'Subscriber',
      queryable: client,
    });
    if (alphaEntities.length !== 1 || alphaEntities[0].current_state.status !== 'active') {
      throw new Error('Entity retrieval crossed the tenant boundary');
    }
    const projectedOutbox = await client.query(
      `SELECT client_id, status FROM billing_event_outbox
       WHERE event_id IN ($1, $2) ORDER BY client_id`,
      [eventA, eventB]
    );
    if (projectedOutbox.rows.some((row) => row.status !== 'published')) {
      throw new Error('Projected outbox events were not marked as published');
    }

    await client.query('ROLLBACK');
    console.log('Knowledge schema and tenant-isolation database tests passed and were rolled back.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction did not start */ }
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
