require('dotenv').config();
const { Pool } = require('pg');
const { DEFAULT_SYSTEM_PROMPT } = require('../services/ispKnowledge');

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
    system_prompt TEXT NOT NULL DEFAULT 'You are a helpful and professional ISP customer support agent.',
    agent_name VARCHAR(80),
    voice_id VARCHAR(20) DEFAULT 'alloy',
    opening_message TEXT,
    welcome_menu_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    welcome_menu_config JSONB,
    photo_troubleshooting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    billing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    billing_provider VARCHAR(40),
    billing_api_base_url TEXT,
    billing_api_key TEXT,
    billing_configured_at TIMESTAMP WITH TIME ZONE,
    sms_provider VARCHAR(40),
    sms_api_key TEXT,
    sms_sender_id VARCHAR(80),
    sms_partner_id VARCHAR(80),
    sms_configured_at TIMESTAMP WITH TIME ZONE,
    email_provider VARCHAR(40),
    email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    email_from_name VARCHAR(160),
    email_from_address VARCHAR(180),
    email_reply_to VARCHAR(180),
    email_smtp_host VARCHAR(180),
    email_smtp_port INTEGER,
    email_smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,
    email_smtp_username VARCHAR(180),
    email_smtp_password TEXT,
    email_configured_at TIMESTAMP WITH TIME ZONE,
    connection_provider VARCHAR(20) NOT NULL DEFAULT 'meta' CHECK (connection_provider IN ('meta', 'evolution', 'website')),
    evolution_instance_name VARCHAR(120) UNIQUE,
    evolution_webhook_secret VARCHAR(96),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  ALTER TABLE clients ADD COLUMN IF NOT EXISTS welcome_menu_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS welcome_menu_config JSONB;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS photo_troubleshooting_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE clients ALTER COLUMN photo_troubleshooting_enabled SET DEFAULT TRUE;
  ALTER TABLE clients ALTER COLUMN system_prompt SET DEFAULT 'You are a helpful and professional ISP customer support agent.';
  UPDATE clients SET photo_troubleshooting_enabled = TRUE WHERE photo_troubleshooting_enabled = FALSE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(40);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_api_base_url TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_api_key TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_configured_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(40);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_api_key TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(80);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_partner_id VARCHAR(80);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_configured_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_provider VARCHAR(40);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_from_name VARCHAR(160);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_from_address VARCHAR(180);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_reply_to VARCHAR(180);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_host VARCHAR(180);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_port INTEGER;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_secure BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_username VARCHAR(180);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_password TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_configured_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS connection_provider VARCHAR(20) NOT NULL DEFAULT 'meta';
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS evolution_instance_name VARCHAR(120);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS evolution_webhook_secret VARCHAR(96);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_basic_auth TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_channel_id INTEGER;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_provider VARCHAR(30) NOT NULL DEFAULT 'm-pesa';
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_callback_secret VARCHAR(96);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_prompt_provider VARCHAR(30) NOT NULL DEFAULT 'payhero';
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_consumer_key TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_consumer_secret TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_shortcode VARCHAR(30);
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_passkey TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_environment VARCHAR(20) NOT NULL DEFAULT 'production';
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_transaction_type VARCHAR(40) NOT NULL DEFAULT 'CustomerPayBillOnline';
  ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_connection_provider_check;
  ALTER TABLE clients ADD CONSTRAINT clients_connection_provider_check CHECK (connection_provider IN ('meta', 'evolution', 'website'));
  CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_evolution_instance_unique ON clients(evolution_instance_name) WHERE evolution_instance_name IS NOT NULL;

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
    reply_mode VARCHAR(20) NOT NULL DEFAULT 'auto' CHECK (reply_mode IN ('auto', 'text', 'voice', 'silent')),
    assigned_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    opted_out_at TIMESTAMP WITH TIME ZONE,
    disclosure_sent_at TIMESTAMP WITH TIME ZONE,
    latest_image_analysis TEXT,
    latest_image_analyzed_at TIMESTAMP WITH TIME ZONE
  );

  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reply_mode VARCHAR(20) NOT NULL DEFAULT 'auto';
  ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_reply_mode_check;
  ALTER TABLE conversations ADD CONSTRAINT conversations_reply_mode_check CHECK (reply_mode IN ('auto', 'text', 'voice', 'silent'));
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS disclosure_sent_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS installation_state VARCHAR(20);
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS payhero_state JSONB;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS latest_image_analysis TEXT;
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS latest_image_analyzed_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS installation_form_config JSONB NOT NULL DEFAULT '{}'::jsonb;

  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'admin')),
    content TEXT NOT NULL,
    sender_name VARCHAR(255),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS message_attachments (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    media_type VARCHAR(30) NOT NULL CHECK (media_type IN ('image', 'audio')),
    mime_type VARCHAR(100) NOT NULL,
    filename VARCHAR(255),
    data BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  ALTER TABLE message_attachments DROP CONSTRAINT IF EXISTS message_attachments_media_type_check;
  ALTER TABLE message_attachments ADD CONSTRAINT message_attachments_media_type_check CHECK (media_type IN ('image', 'audio'));

  CREATE TABLE IF NOT EXISTS media_library (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    title VARCHAR(140) NOT NULL,
    tag VARCHAR(80),
    description TEXT,
    media_type VARCHAR(30) NOT NULL CHECK (media_type IN ('image', 'document')),
    mime_type VARCHAR(100) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    trigger_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    attach_on_welcome BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    data BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  ALTER TABLE media_library ADD COLUMN IF NOT EXISTS tag VARCHAR(80);
  UPDATE media_library
  SET tag = CASE WHEN media_type = 'image' THEN 'image' || id ELSE 'doc' || id END
  WHERE tag IS NULL OR tag = '';
  ALTER TABLE media_library DROP CONSTRAINT IF EXISTS media_library_media_type_check;
  ALTER TABLE media_library ADD CONSTRAINT media_library_media_type_check CHECK (media_type IN ('image', 'document'));
  CREATE INDEX IF NOT EXISTS idx_media_library_client ON media_library(client_id, is_active, attach_on_welcome);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_media_library_client_tag_unique ON media_library(client_id, LOWER(tag)) WHERE tag IS NOT NULL AND tag <> '';

  CREATE TABLE IF NOT EXISTS invoice_profiles (
    client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
    company_name VARCHAR(180),
    logo_url TEXT,
    logo_mime_type VARCHAR(100),
    logo_data BYTEA,
    phone VARCHAR(80),
    email VARCHAR(180),
    address TEXT,
    website VARCHAR(180),
    payment_method VARCHAR(120),
    account_name VARCHAR(160),
    account_number VARCHAR(120),
    branch_name VARCHAR(120),
    signature_name VARCHAR(160),
    signature_title VARCHAR(120),
    signature_image_url TEXT,
    signature_mime_type VARCHAR(100),
    signature_data BYTEA,
    terms TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS logo_mime_type VARCHAR(100);
  ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS logo_data BYTEA;
  ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS signature_mime_type VARCHAR(100);
  ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS signature_data BYTEA;

  CREATE TABLE IF NOT EXISTS invoice_products (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    invoice_number VARCHAR(40) NOT NULL,
    customer_name VARCHAR(180) NOT NULL,
    customer_phone VARCHAR(80),
    customer_email VARCHAR(180),
    customer_address TEXT,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    public_token VARCHAR(80) UNIQUE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (client_id, invoice_number)
  );
  ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
  ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled'));

  CREATE TABLE IF NOT EXISTS invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES invoice_products(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    line_total NUMERIC(12,2) NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_invoice_products_client ON invoice_products(client_id, is_active, name);
  CREATE INDEX IF NOT EXISTS idx_invoices_client_due ON invoices(client_id, status, due_date DESC);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

  CREATE TABLE IF NOT EXISTS inventory_items (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(180) NOT NULL,
    sku VARCHAR(80),
    category VARCHAR(120),
    quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
    reorder_level NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    location VARCHAR(160),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_status_check;
  ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_status_check CHECK (status IN ('active', 'archived'));
  CREATE INDEX IF NOT EXISTS idx_inventory_items_client_status ON inventory_items(client_id, status, name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_client_sku_unique ON inventory_items(client_id, LOWER(sku)) WHERE sku IS NOT NULL AND sku <> '';

  CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS customer_intake_submissions (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(80) NOT NULL,
    alternate_phone VARCHAR(80),
    email VARCHAR(255),
    id_number VARCHAR(80),
    plan_interest VARCHAR(140),
    service_type VARCHAR(80),
    county VARCHAR(120),
    area VARCHAR(180) NOT NULL,
    landmark TEXT,
    building_type VARCHAR(80),
    house_description TEXT,
    latitude NUMERIC,
    longitude NUMERIC,
    preferred_date VARCHAR(40),
    preferred_time VARCHAR(40),
    notes TEXT,
    consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    identity_mime_type VARCHAR(100),
    identity_filename VARCHAR(255),
    identity_document BYTEA,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_customer_intake_client ON customer_intake_submissions(client_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_customer_intake_phone ON customer_intake_submissions(customer_phone);

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
    employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    notification_channels JSONB NOT NULL DEFAULT '["sms"]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (client_id, intent_key)
  );

  ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS notification_channels JSONB NOT NULL DEFAULT '["sms"]'::jsonb;
  ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
  UPDATE workflow_routes SET employee_ids = jsonb_build_array(employee_id) WHERE employee_id IS NOT NULL AND employee_ids = '[]'::jsonb;
  CREATE INDEX IF NOT EXISTS idx_workflow_routes_client ON workflow_routes(client_id);

  CREATE TABLE IF NOT EXISTS workflow_dispatches (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    intent_key VARCHAR(50) NOT NULL,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    customer_phone VARCHAR(50) NOT NULL,
    trigger_message TEXT,
    notify_status VARCHAR(20) NOT NULL CHECK (notify_status IN ('sent', 'failed', 'skipped')),
    notify_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (conversation_id, intent_key)
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_dispatches_client ON workflow_dispatches(client_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    customer_phone VARCHAR(50) NOT NULL,
    customer_name VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    category VARCHAR(40) NOT NULL DEFAULT 'general',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    source VARCHAR(40) NOT NULL DEFAULT 'system',
    summary TEXT,
    last_message TEXT,
    assigned_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    assignment_notify_status VARCHAR(20),
    assignment_notify_error TEXT,
    assignment_notified_at TIMESTAMP WITH TIME ZONE,
    client_alert_sms_status VARCHAR(20),
    client_alert_sms_error TEXT,
    client_alert_sms_sent_at TIMESTAMP WITH TIME ZONE,
    client_alert_email_status VARCHAR(20),
    client_alert_email_error TEXT,
    client_alert_email_sent_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
  );

  ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_category_check;
  ALTER TABLE tickets ADD CONSTRAINT tickets_category_check CHECK (category IN ('technical', 'billing', 'installation', 'complaint', 'human_support', 'feedback', 'general'));
  ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_priority_check;
  ALTER TABLE tickets ADD CONSTRAINT tickets_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
  ALTER TABLE tickets ADD CONSTRAINT tickets_status_check CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed'));
  ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
  ALTER TABLE tickets ADD CONSTRAINT tickets_source_check CHECK (source IN ('whatsapp_meta', 'whatsapp_evolution', 'customer_intake_form', 'admin', 'system'));
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notify_status VARCHAR(20);
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notify_error TEXT;
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notified_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assignment_notify_status_check;
  ALTER TABLE tickets ADD CONSTRAINT tickets_assignment_notify_status_check CHECK (assignment_notify_status IS NULL OR assignment_notify_status IN ('sent', 'skipped', 'failed'));
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_sms_status VARCHAR(20);
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_sms_error TEXT;
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_sms_sent_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_email_status VARCHAR(20);
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_email_error TEXT;
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_email_sent_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_client_alert_sms_status_check;
  ALTER TABLE tickets ADD CONSTRAINT tickets_client_alert_sms_status_check CHECK (client_alert_sms_status IS NULL OR client_alert_sms_status IN ('sent', 'skipped', 'failed'));
  ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_client_alert_email_status_check;
  ALTER TABLE tickets ADD CONSTRAINT tickets_client_alert_email_status_check CHECK (client_alert_email_status IS NULL OR client_alert_email_status IN ('sent', 'skipped', 'failed'));

  CREATE TABLE IF NOT EXISTS ticket_events (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor_type VARCHAR(30) NOT NULL DEFAULT 'system',
    actor_id INTEGER,
    actor_name VARCHAR(255),
    event_type VARCHAR(40) NOT NULL,
    body TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  ALTER TABLE ticket_events DROP CONSTRAINT IF EXISTS ticket_events_actor_type_check;
  ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_actor_type_check CHECK (actor_type IN ('system', 'admin', 'customer', 'ai'));
  ALTER TABLE ticket_events DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;
  ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_event_type_check CHECK (event_type IN ('created', 'message', 'status_changed', 'assigned', 'note', 'resolved'));

  CREATE INDEX IF NOT EXISTS idx_tickets_client_status ON tickets(client_id, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tickets_client_category ON tickets(client_id, category, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tickets_conversation ON tickets(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS installation_work_orders (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    public_token VARCHAR(80) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    installation_started_at TIMESTAMP WITH TIME ZONE,
    installation_completed_at TIMESTAMP WITH TIME ZONE,
    installation_time_minutes INTEGER,
    power_dcbs VARCHAR(120),
    signal_power VARCHAR(120),
    equipment_used JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (ticket_id)
  );
  ALTER TABLE installation_work_orders DROP CONSTRAINT IF EXISTS installation_work_orders_status_check;
  ALTER TABLE installation_work_orders ADD CONSTRAINT installation_work_orders_status_check CHECK (status IN ('open', 'submitted', 'closed'));
  CREATE INDEX IF NOT EXISTS idx_installation_work_orders_client ON installation_work_orders(client_id, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    subscription JSONB NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_admin ON admin_push_subscriptions(admin_id);
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_client ON admin_push_subscriptions(client_id);

  CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(customer_phone);
  CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
  CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
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

  console.log(`Backfilling client_id for ${conv_orphans} conversations, ${admin_orphans} admins, ${esc_orphans} escalations.`);

  const settingsRes = await pool.query(`SELECT key, value FROM settings WHERE key IN ('system_prompt', 'support_number', 'agent_name', 'voice_id')`);
  const oldSettings = {};
  settingsRes.rows.forEach((r) => (oldSettings[r.key] = r.value));

  const metaPhoneNumberId = process.env.META_PHONE_NUMBER_ID || null;
  const metaAccessToken = process.env.META_ACCESS_TOKEN || null;
  const metaVerifyToken = process.env.META_VERIFY_TOKEN || null;
  const metaBusinessAccountId = process.env.META_BUSINESS_ACCOUNT_ID || null;

  let defaultClient = await pool.query(`SELECT id FROM clients WHERE name = 'Default Client' LIMIT 1`);
  let clientId;
  if (defaultClient.rows.length > 0) {
    clientId = defaultClient.rows[0].id;
  } else {
    const inserted = await pool.query(
      `INSERT INTO clients (
        name, business_name, status, connection_provider,
        meta_phone_number_id, meta_access_token, meta_business_account_id, meta_verify_token,
        support_number, system_prompt, agent_name, voice_id
      ) VALUES (
        'Default Client', 'Default Client', 'active', 'meta',
        $1, $2, $3, $4,
        $5, $6, $7, $8
      ) RETURNING id`,
      [metaPhoneNumberId, metaAccessToken, metaBusinessAccountId, metaVerifyToken, (oldSettings.support_number || '').trim() || null, oldSettings.system_prompt || DEFAULT_SYSTEM_PROMPT, (oldSettings.agent_name || '').trim() || null, (oldSettings.voice_id || '').trim() || 'alloy']
    );
    clientId = inserted.rows[0].id;
    console.log(`Created Default Client (id=${clientId}) from environment variables.`);
  }

  await pool.query(`UPDATE conversations SET client_id = $1 WHERE client_id IS NULL`, [clientId]);
  await pool.query(`UPDATE escalations SET client_id = $1 WHERE client_id IS NULL`, [clientId]);
  await pool.query(`UPDATE admins SET client_id = $1 WHERE client_id IS NULL AND role = 'admin'`, [clientId]);
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
