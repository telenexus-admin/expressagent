const db = require('../src/db');
const { BASELINE_SOURCES } = require('../src/services/knowledgeBootstrap');

async function run() {
  const client = await db.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const checked = [];
    const skipped = [];
    for (const source of BASELINE_SOURCES) {
      const exists = await client.query(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [`public.${source.table}`]
      );
      if (!exists.rows[0]?.exists) {
        skipped.push(source.table);
        continue;
      }
      await client.query(`SELECT * FROM (${source.query}) AS baseline_source LIMIT 1`);
      checked.push(source.table);
    }
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ status: 'ok', checked, skipped }));
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
