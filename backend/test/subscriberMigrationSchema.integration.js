const assert = require('assert');
const db = require('../src/db');
const { ensureMigrationSchema } = require('../src/services/subscriberMigration');

(async () => {
  try {
    await ensureMigrationSchema();
    const migrationColumns = await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='billing_subscriber_migration_rows'`
    );
    const migrationSet = new Set(migrationColumns.rows.map((row) => row.column_name));
    for (const column of ['matched_hotspot_plan_id', 'created_hotspot_member_id', 'password_ciphertext']) {
      assert(migrationSet.has(column), `missing migration column ${column}`);
    }

    const memberColumns = await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='billing_hotspot_members'`
    );
    const memberSet = new Set(memberColumns.rows.map((row) => row.column_name));
    for (const column of [
      'account_number',
      'plan_id',
      'password_ciphertext',
      'expires_at',
      'auth_source',
      'source_migration_batch_id',
      'radius_sync_status',
    ]) {
      assert(memberSet.has(column), `missing hotspot migration column ${column}`);
    }

    const indexResult = await db.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname='public'
         AND indexname IN ('idx_migration_rows_batch','idx_hotspot_members_migration_batch','idx_hotspot_members_account_unique')`
    );
    assert.strictEqual(indexResult.rowCount, 3, 'expected migration indexes were not created');
    console.log('subscriberMigration schema integration tests passed');
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
