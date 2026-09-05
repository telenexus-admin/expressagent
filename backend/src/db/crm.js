const db = require('./index');

const REQUIRED_INDEXES = [
  'idx_crm_leads_client_stage',
  'idx_crm_leads_client_status',
  'idx_crm_leads_client_followup',
  'idx_crm_leads_client_phone',
  'idx_crm_leads_client_email',
  'idx_crm_lead_activities_lead',
];

async function inspectCrmSchema() {
  const tables = await db.query(`
    SELECT
      to_regclass('public.crm_leads') AS crm_leads,
      to_regclass('public.crm_lead_activities') AS crm_lead_activities
  `);

  const tableState = tables.rows[0] || {};
  const existingTables = [
    tableState.crm_leads ? 'crm_leads' : null,
    tableState.crm_lead_activities ? 'crm_lead_activities' : null,
  ].filter(Boolean);

  if (existingTables.length !== 2) {
    return {
      ready: false,
      existingTables,
      missingIndexes: [...REQUIRED_INDEXES],
    };
  }

  const indexes = await db.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])`,
    [REQUIRED_INDEXES]
  );
  const existingIndexes = new Set(indexes.rows.map((row) => row.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !existingIndexes.has(name));

  return {
    ready: missingIndexes.length === 0,
    existingTables,
    missingIndexes,
  };
}

async function ensureCrmSchema() {
  const state = await inspectCrmSchema();

  // Production runs with a least-privilege application role. When the CRM
  // schema has already been migrated by the database owner, do not issue DDL
  // at application startup: PostgreSQL requires table ownership even for
  // CREATE INDEX IF NOT EXISTS on an index that already exists.
  if (state.ready) return { ready: true, created: false };

  // If a CRM table already exists, the database is partially migrated. Do not
  // let the application role try to repair owner-managed objects. Surface an
  // actionable migration error instead and leave ownership unchanged.
  if (state.existingTables.length > 0) {
    const missingTables = ['crm_leads', 'crm_lead_activities']
      .filter((name) => !state.existingTables.includes(name));
    const details = [
      missingTables.length ? `missing tables: ${missingTables.join(', ')}` : null,
      state.missingIndexes.length ? `missing indexes: ${state.missingIndexes.join(', ')}` : null,
    ].filter(Boolean).join('; ');
    const error = new Error(`CRM schema requires an owner-managed migration (${details || 'incomplete schema'})`);
    error.code = 'CRM_SCHEMA_MIGRATION_REQUIRED';
    throw error;
  }

  await db.query(`
    CREATE TABLE crm_leads (
      id BIGSERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      full_name VARCHAR(255) NOT NULL,
      company_name VARCHAR(255),
      phone VARCHAR(80),
      alternative_phone VARCHAR(80),
      email VARCHAR(255),
      lead_source VARCHAR(50) NOT NULL DEFAULT 'other',
      stage VARCHAR(40) NOT NULL DEFAULT 'new',
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      interested_plan_id INTEGER,
      interested_plan_name VARCHAR(255),
      expected_monthly_value NUMERIC(12,2),
      county VARCHAR(120),
      town VARCHAR(120),
      area VARCHAR(180),
      installation_address TEXT,
      latitude NUMERIC(10,7),
      longitude NUMERIC(10,7),
      assigned_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      assigned_agent_id BIGINT REFERENCES billing_agents(id) ON DELETE SET NULL,
      lead_score INTEGER NOT NULL DEFAULT 0 CHECK (lead_score BETWEEN 0 AND 100),
      notes TEXT,
      next_follow_up_at TIMESTAMP WITH TIME ZONE,
      converted_subscriber_id INTEGER REFERENCES billing_subscribers(id) ON DELETE SET NULL,
      lost_reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT crm_leads_stage_check CHECK (stage IN ('new','contacted','qualified','site_survey','proposal','negotiation','won','lost')),
      CONSTRAINT crm_leads_status_check CHECK (status IN ('open','won','lost','converted'))
    );

    CREATE TABLE crm_lead_activities (
      id BIGSERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      lead_id BIGINT NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
      activity_type VARCHAR(40) NOT NULL,
      subject VARCHAR(255),
      description TEXT,
      activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_by_agent_id BIGINT REFERENCES billing_agents(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_crm_leads_client_stage ON crm_leads (client_id, stage, created_at DESC);
    CREATE INDEX idx_crm_leads_client_status ON crm_leads (client_id, status, created_at DESC);
    CREATE INDEX idx_crm_leads_client_followup ON crm_leads (client_id, next_follow_up_at);
    CREATE INDEX idx_crm_leads_client_phone ON crm_leads (client_id, phone);
    CREATE INDEX idx_crm_leads_client_email ON crm_leads (client_id, lower(email));
    CREATE INDEX idx_crm_lead_activities_lead ON crm_lead_activities (client_id, lead_id, activity_at DESC);
  `);

  return { ready: true, created: true };
}

module.exports = { ensureCrmSchema, inspectCrmSchema };
