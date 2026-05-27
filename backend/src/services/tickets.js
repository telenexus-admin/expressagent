const db = require('../db');
const { sendSMS } = require('./sms');

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
      assignment_notify_status VARCHAR(20),
      assignment_notify_error TEXT,
      assignment_notified_at TIMESTAMP WITH TIME ZONE,
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

    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notify_status VARCHAR(20);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notify_error TEXT;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notified_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assignment_notify_status_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_assignment_notify_status_check
      CHECK (assignment_notify_status IS NULL OR assignment_notify_status IN ('sent', 'skipped', 'failed'));

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

function intentFromCategory(category) {
  const map = {
    technical: 'technical_issue',
    billing: 'payment_billing',
    installation: 'new_installation',
    human_support: 'human_request',
  };
  return map[category] || null;
}

function categoryFromComplaint(complaint) {
  const category = clean(complaint?.category, 'complaint').toLowerCase();
  if (['connectivity', 'speed', 'hardware'].includes(category)) return 'technical';
  if (category === 'billing') return 'billing';
  if (category === 'support') return 'human_support';
  return 'complaint';
}

async function findWorkflowAssignment(clientId, category, intent) {
  const intentKey = intent || intentFromCategory(category);
  if (!intentKey) return null;
  const result = await db.query(
    `SELECT e.id, e.name, e.phone
     FROM workflow_routes wr
     JOIN employees e ON e.id = wr.employee_id
     WHERE wr.client_id = $1
       AND wr.intent_key = $2
       AND wr.is_enabled = TRUE
       AND e.is_active = TRUE
     LIMIT 1`,
    [clientId, intentKey]
  );
  const employee = result.rows[0];
  return employee ? { employeeId: employee.id, employeeName: employee.name, employeePhone: employee.phone, intentKey } : null;
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

function ticketLink(ticketId) {
  const base = String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return base ? `${base}/dashboard/tickets?ticket=${ticketId}` : null;
}

function notificationEnabled() {
  return String(process.env.TICKET_ASSIGNMENT_SMS_ENABLED || '').toLowerCase() === 'true';
}

async function notifyAssignedEmployee({ ticket, assignment, customerPhone, customerName, summary }) {
  if (!assignment?.employeeId) return { status: null, error: null };
  if (!notificationEnabled()) return { status: 'skipped', error: 'Ticket assignment SMS is disabled' };
  if (!assignment.employeePhone) return { status: 'skipped', error: 'Assigned employee has no phone number' };

  const customer = customerName ? `${customerName} (+${customerPhone})` : `+${customerPhone}`;
  const link = ticketLink(ticket.id);
  const message =
    `New ticket assigned to you\n\n` +
    `Ticket #${ticket.id}: ${ticket.title}\n` +
    `Priority: ${ticket.priority}\n` +
    `Customer: ${customer}\n` +
    `Issue: ${summary || ticket.summary || ticket.last_message || 'No summary yet'}` +
    (link ? `\n\nOpen: ${link}` : '');

  try {
    await sendSMS(assignment.employeePhone, message);
    return { status: 'sent', error: null };
  } catch (err) {
    return { status: 'failed', error: err.message || 'Failed to send assignment SMS' };
  }
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

async function recordAssignmentNotification(ticket, assignment, details) {
  const notification = await notifyAssignedEmployee({ ticket, assignment, ...details });
  if (!notification.status) return ticket;

  const updated = await db.query(
    `UPDATE tickets
     SET assignment_notify_status = $2,
         assignment_notify_error = $3,
         assignment_notified_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE assignment_notified_at END
     WHERE id = $1
     RETURNING *`,
    [ticket.id, notification.status, notification.error]
  );

  await addTicketEvent(ticket.id, {
    actor_type: 'system',
    event_type: 'assigned',
    body:
      notification.status === 'sent'
        ? `Assignment SMS sent to ${assignment.employeeName}`
        : `Assignment SMS ${notification.status}: ${notification.error}`,
    metadata: {
      employee_id: assignment.employeeId,
      notify_status: notification.status,
      notify_error: notification.error,
    },
  });

  return updated.rows[0] || ticket;
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
  const assignment = await findWorkflowAssignment(clientId, category, signal.intent);

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
           assigned_employee_id = COALESCE(assigned_employee_id, $6),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [ticket.id, signal.customerName || signal.customer_name || null, nextPriority, summary || null, body || null, assignment?.employeeId || null]
    );
    let latestTicket = updated.rows[0];
    if (assignment?.employeeId && !ticket.assigned_employee_id) {
      await addTicketEvent(ticket.id, {
        actor_type: 'system',
        event_type: 'assigned',
        body: `Assigned to ${assignment.employeeName}`,
        metadata: { employee_id: assignment.employeeId, intent_key: assignment.intentKey },
      });
      latestTicket = await recordAssignmentNotification(latestTicket, assignment, {
        customerPhone,
        customerName: signal.customerName || signal.customer_name || null,
        summary,
      });
    }
    if (body) {
      await addTicketEvent(ticket.id, {
        actor_type: 'customer',
        event_type: 'message',
        body,
        metadata: { source, category },
      });
    }
    return latestTicket;
  }

  const inserted = await db.query(
    `INSERT INTO tickets
       (client_id, conversation_id, customer_phone, customer_name, title, category, priority, status, source, summary, last_message, assigned_employee_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $10, $11)
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
      assignment?.employeeId || null,
    ]
  );
  const ticket = inserted.rows[0];
  await addTicketEvent(ticket.id, {
    actor_type: 'system',
    event_type: 'created',
    body,
    metadata: { source, category, priority },
  });
  if (assignment?.employeeId) {
    await addTicketEvent(ticket.id, {
      actor_type: 'system',
      event_type: 'assigned',
      body: `Assigned to ${assignment.employeeName}`,
      metadata: { employee_id: assignment.employeeId, intent_key: assignment.intentKey },
    });
    return recordAssignmentNotification(ticket, assignment, {
      customerPhone,
      customerName: signal.customerName || signal.customer_name || null,
      summary,
    });
  }
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
    intent,
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
    intent: intentFromCategory(category),
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
  intentFromCategory,
};
