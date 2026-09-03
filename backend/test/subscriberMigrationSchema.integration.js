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

    const subscriberColumns = await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='billing_subscribers'`
    );
    const subscriberSet = new Set(subscriberColumns.rows.map((row) => row.column_name));
    for (const column of [
      'control_mode',
      'legacy_source',
      'source_migration_batch_id',
      'mikrotik_local_id',
      'mikrotik_local_profile',
      'local_api_sync_status',
      'local_api_sync_error',
      'local_api_last_synced_at',
    ]) {
      assert(subscriberSet.has(column), `missing local API subscriber column ${column}`);
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
      'mikrotik_local_id',
      'mikrotik_local_profile',
      'local_api_sync_status',
    ]) {
      assert(memberSet.has(column), `missing hotspot migration column ${column}`);
    }

    const indexResult = await db.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname='public'
         AND indexname IN (
           'idx_migration_rows_batch',
           'idx_hotspot_members_migration_batch',
           'idx_hotspot_members_account_unique',
           'idx_billing_subscribers_local_api',
           'idx_billing_subscribers_migration_batch'
         )`
    );
    assert.strictEqual(indexResult.rowCount, 5, 'expected migration indexes were not created');
    console.log('subscriberMigration schema integration tests passed');
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
