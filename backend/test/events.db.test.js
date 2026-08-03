const db = require('../src/db');
const crypto = require('crypto');
const { appendBillingEvent, EVENT_SCHEMA_SQL } = require('../src/services/events');

async function main() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(EVENT_SCHEMA_SQL);
    const result = await client.query(`
      SELECT
        to_regclass('public.billing_events')::text AS events_table,
        to_regclass('public.billing_event_entities')::text AS entities_table,
        to_regclass('public.billing_event_outbox')::text AS outbox_table
    `);
    const tables = result.rows[0] || {};
    if (!tables.events_table || !tables.entities_table || !tables.outbox_table) {
      throw new Error('One or more event tables were not created');
    }
    const account = await client.query('SELECT id FROM clients ORDER BY id ASC LIMIT 1');
    if (!account.rows[0]) throw new Error('No account is available for the transactional event test');

    const eventId = crypto.randomUUID();
    await appendBillingEvent(client, {
      id: eventId,
      clientId: account.rows[0].id,
      eventType: 'system.schema_tested',
      category: 'system',
      source: 'event_schema_test',
      entityType: 'account',
      entityId: account.rows[0].id,
      actorType: 'system',
      payload: { password: 'must-be-redacted', result: 'passed' },
      relatedEntities: [{ entityType: 'schema', entityId: 'billing_events', relationship: 'validated' }],
      deduplicationKey: `schema-test:${eventId}`,
    });
    const eventRows = await client.query('SELECT payload FROM billing_events WHERE id = $1', [eventId]);
    const entityRows = await client.query('SELECT COUNT(*)::int AS count FROM billing_event_entities WHERE event_id = $1', [eventId]);
    const outboxRows = await client.query('SELECT COUNT(*)::int AS count FROM billing_event_outbox WHERE event_id = $1', [eventId]);
    if (eventRows.rows[0]?.payload?.password !== '[REDACTED]') throw new Error('Sensitive event payload was not redacted');
    if (entityRows.rows[0]?.count !== 2) throw new Error('Primary and related event entities were not written');
    if (outboxRows.rows[0]?.count !== 1) throw new Error('Event outbox record was not written');

    await client.query('ROLLBACK');
    const persisted = await client.query('SELECT COUNT(*)::int AS count FROM billing_events WHERE id = $1', [eventId]);
    if (persisted.rows[0]?.count !== 0) throw new Error('Rollback did not remove the schema test event');
    console.log('Event schema PostgreSQL transaction, redaction, entity, and outbox tests passed and were rolled back.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction did not start */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
