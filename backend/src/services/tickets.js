const db = require('../db');

let schemaReady = false;

const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer'];
const PRIORITY_RANK = { low: 1, normal: 2, high: 3, urgent: 4 };

async function ensureTicketSchema() {
  if (schemaReady) return;
  await db.query(`
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
      opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      resolved_at TIMESTAMP WITH TIME ZONE
    );

    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_category_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_category_check
      CHECK (category IN ('technical', 'billing', 'installation', 'complaint', 'human_support', 'feedback', 'general'));

    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_priority_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
      CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed'));

    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_source_check
      CHECK (source IN ('whatsapp_meta', 'whatsapp_evolution', 'admin', 'system'));

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
    ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_actor_type_check
      CHECK (actor_type IN ('system', 'admin', 'customer', 'ai'));

    ALTER TABLE ticket_events DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;
    ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_event_type_check
      CHECK (event_type IN ('created', 'message', 'status_changed', 'assigned', 'note', 'resolved'));

    CREATE INDEX IF NOT EXISTS idx_tickets_client_status ON tickets(client_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_client_category ON tickets(client_id, category, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_conversation ON tickets(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id, created_at ASC);
  `);
  schemaReady = true;
}

function clean(value, fallback = '') {
  return String(value || '').trim() || fallback;
}

function normalizeCategory(value) {
  const category = clean(value, 'general').toLowerCase();
  if (['technical', 'billing', 'installation', 'complaint', 'human_support', 'feedback', 'general'].includes(category)) {
    return category;
  }
  return 'general';
}

function normalizePriority(value) {
  const priority = clean(value, 'normal').toLowerCase();
  return PRIORITY_RANK[priority] ? priority : 'normal';
}

function strongerPriority(current, next) {
  const currentValue = normalizePriority(current);
  const nextValue = normalizePriority(next);
  return PRIORITY_RANK[nextValue] > PRIORITY_RANK[currentValue] ? nextValue : currentValue;
}

function categoryFromIntent(intent) {
  const map = {
    new_installation: 'installation',
    payment_billing: 'billing',
    technical_issue: 'technical',
    human_request: 'human_support',
    compliment_feedback: 'feedback',
  };
  return map[intent] || null;
}

function categoryFromComplaint(complaint) {
  const category = clean(complaint?.category, 'complaint').toLowerCase();
  if (['connectivity', 'speed', 'hardware'].includes(category)) return 'technical';
  if (category === 'billing') return 'billing';
  if (category === 'support') return 'human_support';
  return 'complaint';
}

function titleForCategory(category) {
  const titles = {
    technical: 'Technical support issue',
    billing: 'Billing or payment issue',
    installation: 'Installation request',
    complaint: 'Customer complaint',
    human_support: 'Human support requested',
    feedback: 'Customer feedback',
    general: 'Customer support ticket',
  };
  return titles[category] || titles.general;
}

async function addTicketEvent(ticketId, event) {
  await ensureTicketSchema();
  await db.query(
    `INSERT INTO ticket_events (ticket_id, actor_type, actor_id, actor_name, event_type, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      ticketId,
      event.actor_type || 'system',
      event.actor_id || null,
      event.actor_name || null,
      event.event_type || 'message',
      event.body || null,
      JSON.stringify(event.metadata || {}),
    ]
  );
}

async function createOrUpdateTicket(signal) {
  await ensureTicketSchema();

  const clientId = Number(signal.clientId || signal.client_id);
  const conversationId = signal.conversationId || signal.conversation_id || null;
  const customerPhone = clean(signal.customerPhone || signal.customer_phone);
  if (!clientId || !customerPhone) return null;

  const category = normalizeCategory(signal.category);
  const priority = normalizePriority(signal.priority);
  const title = clean(signal.title, titleForCategory(category));
  const body = clean(signal.messageText || signal.last_message || signal.summary);
  const source = clean(signal.source, 'system');
  const summary = clean(signal.summary, body || title);

  const params = [clientId, category];
  let lookup = `client_id = $1 AND category = $2 AND status = ANY($${params.length + 1}::text[])`;
  params.push(OPEN_STATUSES);
  if (conversationId) {
    params.push(conversationId);
    lookup += ` AND conversation_id = $${params.length}`;
  } else {
    params.push(customerPhone);
    lookup += ` AND customer_phone = $${params.length}`;
  }

  const existing = await db.query(
    `SELECT * FROM tickets WHERE ${lookup} ORDER BY updated_at DESC LIMIT 1`,
    params
  );

  if (existing.rows[0]) {
    const ticket = existing.rows[0];
    const nextPriority = strongerPriority(ticket.priority, priority);
    const updated = await db.query(
      `UPDATE tickets
       SET customer_name = COALESCE($2, customer_name),
           priority = $3,
           summary = COALESCE($4, summary),
           last_message = COALESCE($5, last_message),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [ticket.id, signal.customerName || signal.customer_name || null, nextPriority, summary || null, body || null]
    );
    if (body) {
      await addTicketEvent(ticket.id, {
        actor_type: 'customer',
        event_type: 'message',
        body,
        metadata: { source, category },
      });
    }
    return updated.rows[0];
  }

  const inserted = await db.query(
    `INSERT INTO tickets
       (client_id, conversation_id, customer_phone, customer_name, title, category, priority, status, source, summary, last_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $10)
     RETURNING *`,
    [
      clientId,
      conversationId,
      customerPhone,
      signal.customerName || signal.customer_name || null,
      title,
      category,
      priority,
      source,
      summary || null,
      body || null,
    ]
  );
  const ticket = inserted.rows[0];
  await addTicketEvent(ticket.id, {
    actor_type: 'system',
    event_type: 'created',
    body,
    metadata: { source, category, priority },
  });
  return ticket;
}

async function ticketFromIntent({ client, conversation, intent, messageText, source }) {
  const category = categoryFromIntent(intent);
  if (!category || category === 'feedback') return null;
  const priority = category === 'human_support' ? 'high' : 'normal';
  return createOrUpdateTicket({
    clientId: client.id,
    conversationId: conversation.id,
    customerPhone: conversation.customer_phone,
    customerName: conversation.customer_name,
    title: titleForCategory(category),
    category,
    priority,
    source,
    summary: messageText,
    messageText,
  });
}

async function ticketFromComplaint({ client, conversation, complaint, messageText, source }) {
  if (!complaint?.isComplaint) return null;
  const category = categoryFromComplaint(complaint);
  return createOrUpdateTicket({
    clientId: client.id,
    conversationId: conversation.id,
    customerPhone: conversation.customer_phone,
    customerName: conversation.customer_name,
    title: titleForCategory(category),
    category,
    priority: category === 'technical' || category === 'human_support' ? 'high' : 'normal',
    source,
    summary: complaint.summary || messageText,
    messageText,
  });
}

module.exports = {
  ensureTicketSchema,
  addTicketEvent,
  createOrUpdateTicket,
  ticketFromIntent,
  ticketFromComplaint,
  categoryFromIntent,
};
