const db = require('./index');

async function ensureCrmSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS crm_leads (
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

    CREATE TABLE IF NOT EXISTS crm_lead_activities (
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

    CREATE INDEX IF NOT EXISTS idx_crm_leads_client_stage ON crm_leads (client_id, stage, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_leads_client_status ON crm_leads (client_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_leads_client_followup ON crm_leads (client_id, next_follow_up_at);
    CREATE INDEX IF NOT EXISTS idx_crm_leads_client_phone ON crm_leads (client_id, phone);
    CREATE INDEX IF NOT EXISTS idx_crm_leads_client_email ON crm_leads (client_id, lower(email));
    CREATE INDEX IF NOT EXISTS idx_crm_lead_activities_lead ON crm_lead_activities (client_id, lead_id, activity_at DESC);
  `);
}

module.exports = { ensureCrmSchema };
