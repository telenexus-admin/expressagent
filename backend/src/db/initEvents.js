const db = require('./index');
const { EVENT_SCHEMA_SQL } = require('../services/events');

async function main() {
  try {
    await db.query(EVENT_SCHEMA_SQL);
    const result = await db.query(`
      SELECT
        to_regclass('public.billing_events')::text AS events_table,
        to_regclass('public.billing_event_entities')::text AS entities_table,
        to_regclass('public.billing_event_outbox')::text AS outbox_table
    `);
    const tables = result.rows[0] || {};
    if (!tables.events_table || !tables.entities_table || !tables.outbox_table) {
      throw new Error('One or more event tables were not created');
    }
    console.log('Billing event schema initialized successfully.');
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error('Billing event schema initialization failed:', error.message);
  process.exit(1);
});
