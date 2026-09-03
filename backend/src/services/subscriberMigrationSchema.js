const db = require('../db');
const { ensureMikrotikTables } = require('./mikrotik');

let schemaReady = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS billing_subscriber_migration_batches(
  id UUID PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  router_id INTEGER NOT NULL,
  service_type VARCHAR(30) NOT NULL DEFAULT 'pppoe',
  source_system VARCHAR(40) NOT NULL DEFAULT 'generic',
  file_name VARCHAR(255) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'validated',
  total_rows INTEGER NOT NULL DEFAULT 0,
  ready_rows INTEGER NOT NULL DEFAULT 0,
  warning_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  source_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_router_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  handover_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  handover_prepared_at TIMESTAMPTZ,
  handover_activated_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  FOREIGN KEY(client_id,router_id) REFERENCES mikrotik_routers(client_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_migration_batches_tenant
  ON billing_subscriber_migration_batches(client_id,created_at DESC);

CREATE TABLE IF NOT EXISTS billing_subscriber_migration_rows(
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES billing_subscriber_migration_batches(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  normalized JSONB NOT NULL DEFAULT '{}'::jsonb,
  password_ciphertext TEXT,
  validation_status VARCHAR(20) NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched_plan_id INTEGER REFERENCES billing_plans(id) ON DELETE SET NULL,
  matched_live_client_id INTEGER REFERENCES mikrotik_clients(id) ON DELETE SET NULL,
  created_subscriber_id INTEGER REFERENCES billing_subscribers(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  UNIQUE(batch_id,row_number)
);
ALTER TABLE billing_subscriber_migration_rows
  ADD COLUMN IF NOT EXISTS matched_hotspot_plan_id BIGINT;
ALTER TABLE billing_subscriber_migration_rows
  ADD COLUMN IF NOT EXISTS created_hotspot_member_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_migration_rows_batch
  ON billing_subscriber_migration_rows(client_id,batch_id,validation_status);

CREATE TABLE IF NOT EXISTS billing_hotspot_members (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL,
  router_id BIGINT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rate_limit TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id,username)
);
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS plan_id BIGINT;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS password_ciphertext TEXT;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS auth_source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS source_migration_batch_id UUID;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS radius_sync_status TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS radius_sync_error TEXT;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS radius_last_synced_at TIMESTAMPTZ;
ALTER TABLE billing_hotspot_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_hotspot_members_migration_batch
  ON billing_hotspot_members(client_id,source_migration_batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotspot_members_account_unique
  ON billing_hotspot_members(client_id,LOWER(account_number))
  WHERE account_number IS NOT NULL AND account_number <> '';
`;

async function ensureMigrationSchema() {
  if (schemaReady) return;
  await ensureMikrotikTables();
  await db.query(SCHEMA);
  schemaReady = true;
}

async function listBatches(clientId) {
  await ensureMigrationSchema();
  return (await db.query(
    `SELECT b.*,r.name router_name
     FROM billing_subscriber_migration_batches b
     JOIN mikrotik_routers r ON r.id=b.router_id AND r.client_id=b.client_id
     WHERE b.client_id=$1
     ORDER BY b.created_at DESC LIMIT 20`,
    [clientId]
  )).rows;
}

async function getBatch(clientId, id) {
  await ensureMigrationSchema();
  const batch = (await db.query(
    `SELECT b.*,r.name router_name
     FROM billing_subscriber_migration_batches b
     JOIN mikrotik_routers r ON r.id=b.router_id AND r.client_id=b.client_id
     WHERE b.client_id=$1 AND b.id=$2`,
    [clientId, id]
  )).rows[0];
  if (!batch) return null;
  batch.rows = (await db.query(
    `SELECT id,row_number,normalized,validation_status,errors,warnings,
            matched_plan_id,matched_hotspot_plan_id,matched_live_client_id,
            created_subscriber_id,created_hotspot_member_id,applied_at
     FROM billing_subscriber_migration_rows
     WHERE client_id=$1 AND batch_id=$2
     ORDER BY row_number LIMIT 5000`,
    [clientId, id]
  )).rows;
  return batch;
}

module.exports = { SCHEMA, ensureMigrationSchema, getBatch, listBatches };
