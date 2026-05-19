require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const schema = `
  CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    business_name VARCHAR(255),
    contact_email VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    meta_phone_number_id VARCHAR(64) UNIQUE,
    meta_access_token TEXT,
    meta_business_account_id VARCHAR(64),
    meta_verify_token VARCHAR(128) UNIQUE,
    support_number VARCHAR(50),
    system_prompt TEXT NOT NULL DEFAULT 'You are a helpful customer support agent.',
    agent_name VARCHAR(80),
    voice_id VARCHAR(20) DEFAULT 'alloy',
    opening_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin')),
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  ALTER TABLE admins ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE;
  ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;

  CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    customer_phone VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'human_takeover')),
    assigned_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    opted_out_at TIMESTAMP WITH TIME ZONE,
    disclosure_sent_at TIMESTAMP WITH TIME ZONE
  );

  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS disclosure_sent_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS installation_state VARCHAR(20);
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE;

  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'admin')),
    content TEXT NOT NULL,
    sender_name VARCHAR(255),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS escalations (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    customer_phone VARCHAR(50) NOT NULL,
    customer_name VARCHAR(255),
    trigger_message TEXT NOT NULL,
    support_number VARCHAR(50),
    notify_status VARCHAR(20) NOT NULL CHECK (notify_status IN ('sent', 'failed', 'no_support_number', 'logged')),
    notify_error TEXT,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    type VARCHAR(20) NOT NULL DEFAULT 'human' CHECK (type IN ('human', 'installation', 'complaint')),
    summary TEXT
  );

  ALTER TABLE escalations ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'human';
  ALTER TABLE escalations ADD COLUMN IF NOT EXISTS summary TEXT;
  ALTER TABLE escalations ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE;
  ALTER TABLE escalations DROP CONSTRAINT IF EXISTS escalations_type_check;
  ALTER TABLE escalations ADD CONSTRAINT escalations_type_check CHECK (type IN ('human', 'installation', 'complaint'));
  ALTER TABLE escalations DROP CONSTRAINT IF EXISTS escalations_notify_status_check;
  ALTER TABLE escalations ADD CONSTRAINT escalations_notify_status_check CHECK (notify_status IN ('sent', 'failed', 'no_support_number', 'logged'));

  CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'technician' CHECK (role IN ('technician', 'support', 'manager', 'other')),
    location VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (client_id, email)
  );

  CREATE INDEX IF NOT EXISTS idx_employees_client ON employees(client_id);
  CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(client_id, is_active);

  CREATE TABLE IF NOT EXISTS workflow_routes (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    intent_key VARCHAR(50) NOT NULL,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (client_id, intent_key)
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_routes_client ON workflow_routes(client_id);

  CREATE TABLE IF NOT EXISTS workflow_dispatches (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    intent_key VARCHAR(50) NOT NULL,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    customer_phone VARCHAR(50) NOT NULL,
    trigger_message TEXT,
    notify_status VARCHAR(20) NOT NULL CHECK (notify_status IN ('sent', 'failed', 'skipped')),
    notify_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (conversation_id, intent_key)
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_dispatches_client ON workflow_dispatches(client_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(customer_phone);
  CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
  CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_escalations_created ON escalations(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_escalations_client ON escalations(client_id);
  CREATE INDEX IF NOT EXISTS idx_admins_client ON admins(client_id);
`;

async function bootstrapDefaultClient() {
  const orphanCheck = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM conversations WHERE client_id IS NULL) AS conv_orphans,
      (SELECT COUNT(*)::int FROM admins WHERE client_id IS NULL AND role = 'admin') AS admin_orphans,
      (SELECT COUNT(*)::int FROM escalations WHERE client_id IS NULL) AS esc_orphans
  `);
  const { conv_orphans, admin_orphans, esc_orphans } = orphanCheck.rows[0];

  if (conv_orphans === 0 && admin_orphans === 0 && esc_orphans === 0) {
    console.log('No orphaned single-tenant data to migrate.');
    return;
  }

  console.log(
    `Backfilling client_id for ${conv_orphans} conversations, ${admin_orphans} admins, ${esc_orphans} escalations.`
  );

  const settingsRes = await pool.query(
    `SELECT key, value FROM settings WHERE key IN ('system_prompt', 'support_number', 'agent_name', 'voice_id')`
  );
  const oldSettings = {};
  settingsRes.rows.forEach((r) => (oldSettings[r.key] = r.value));

  const metaPhoneNumberId = process.env.META_PHONE_NUMBER_ID || null;
  const metaAccessToken = process.env.META_ACCESS_TOKEN || null;
  const metaVerifyToken = process.env.META_VERIFY_TOKEN || null;
  const metaBusinessAccountId = process.env.META_BUSINESS_ACCOUNT_ID || null;

  let defaultClient = await pool.query(
    `SELECT id FROM clients WHERE name = 'Default Client' LIMIT 1`
  );

  let clientId;
  if (defaultClient.rows.length > 0) {
    clientId = defaultClient.rows[0].id;
  } else {
    const inserted = await pool.query(
      `INSERT INTO clients (
        name, business_name, status,
        meta_phone_number_id, meta_access_token, meta_business_account_id, meta_verify_token,
        support_number, system_prompt, agent_name, voice_id
      ) VALUES (
        'Default Client', 'Default Client', 'active',
        $1, $2, $3, $4,
        $5, $6, $7, $8
      ) RETURNING id`,
      [
        metaPhoneNumberId,
        metaAccessToken,
        metaBusinessAccountId,
        metaVerifyToken,
        (oldSettings.support_number || '').trim() || null,
        oldSettings.system_prompt || 'You are a helpful customer support agent.',
        (oldSettings.agent_name || '').trim() || null,
        (oldSettings.voice_id || '').trim() || 'alloy',
      ]
    );
    clientId = inserted.rows[0].id;
    console.log(`Created Default Client (id=${clientId}) from environment variables.`);
  }

  await pool.query(`UPDATE conversations SET client_id = $1 WHERE client_id IS NULL`, [clientId]);
  await pool.query(`UPDATE escalations SET client_id = $1 WHERE client_id IS NULL`, [clientId]);
  await pool.query(
    `UPDATE admins SET client_id = $1 WHERE client_id IS NULL AND role = 'admin'`,
    [clientId]
  );
}

async function init() {
  console.log('Initializing database schema...');
  try {
    await pool.query(schema);
    await bootstrapDefaultClient();
    console.log('Database schema initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize schema:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
