const db = require('../src/db');

async function main() {
  try {
    const tables = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM billing_events) AS events,
        (SELECT COUNT(*)::int FROM billing_event_entities) AS entities,
        (SELECT COUNT(*)::int FROM billing_event_outbox) AS outbox,
        (SELECT COUNT(*)::int
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename IN ('billing_events', 'billing_event_entities', 'billing_event_outbox')) AS indexes,
        (SELECT COUNT(*)::int
           FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name IN ('billing_events', 'billing_event_entities', 'billing_event_outbox')
            AND constraint_type = 'FOREIGN KEY') AS foreign_keys
    `);
    console.log(JSON.stringify(tables.rows[0]));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
