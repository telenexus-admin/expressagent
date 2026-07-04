const db = require('../db');
const { sendSMS, hasSMSConfig } = require('./sms');
const { sendHighPriorityTicketEmail, sendWorkflowEmployeeEmail } = require('./email');
const { sendWhatsAppMessage } = require('./whatsapp');
const { sendClientText } = require('./clientEvolution');
const { buildInstallationWorkOrderUrl, getOrCreateInstallationWorkOrder } = require('./installationWorkOrders');

let schemaReady = false;

const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer'];
const PRIORITY_RANK = { low: 1, normal: 2, high: 3, urgent: 4 };
const URGENT_SIGNAL_RE = /\b(urgent|emergency|asap|immediately|critical|serious|down|offline|outage|no\s+internet|not\s+working|not\s+connecting|cannot\s+connect|can't\s+connect|los|red\s+light|business\s+is\s+down)\b/i;

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
    ALTER TABLE tickets ADD CONSTRAINT tickets_category_check
      CHECK (category IN ('technical', 'billing', 'installation', 'complaint', 'human_support', 'feedback', 'general', 'manually_added'));

    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_priority_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
      CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed'));

    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_source_check
      CHECK (source IN ('whatsapp_meta', 'whatsapp_evolution', 'customer_intake_form', 'admin', 'system'));

    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notify_status VARCHAR(20);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notify_error TEXT;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_notified_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assignment_notify_status_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_assignment_notify_status_check
      CHECK (assignment_notify_status IS NULL OR assignment_notify_status IN ('sent', 'skipped', 'failed'));

    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_sms_status VARCHAR(20);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_sms_error TEXT;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_sms_sent_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_email_status VARCHAR(20);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_email_error TEXT;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_alert_email_sent_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_client_alert_sms_status_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_client_alert_sms_status_check
      CHECK (client_alert_sms_status IS NULL OR client_alert_sms_status IN ('sent', 'skipped', 'failed'));
    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_client_alert_email_status_check;
    ALTER TABLE tickets ADD CONSTRAINT tickets_client_alert_email_status_check
      CHECK (client_alert_email_status IS NULL OR client_alert_email_status IN ('sent', 'skipped', 'failed'));

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

    ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS notification_channels JSONB NOT NULL DEFAULT '["sms"]'::jsonb;
    ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
    UPDATE workflow_routes SET employee_ids = jsonb_build_array(employee_id) WHERE employee_id IS NOT NULL AND employee_ids = '[]'::jsonb;
  `);
  schemaReady = true;
}

function clean(value, fallback = '') {
  return String(value || '').trim() || fallback;
}

function normalizeCategory(value) {
  const category = clean(value, 'general').toLowerCase();
  if (['technical', 'billing', 'installation', 'complaint', 'human_support', 'feedback', 'general', 'manually_added'].includes(category)) {
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

function priorityForSignal(category, messageText, fallback = 'normal') {
  const text = String(messageText || '');
  if (URGENT_SIGNAL_RE.test(text)) return 'urgent';
  if (category === 'technical' || category === 'human_support') return 'high';
  return normalizePriority(fallback);
}

function categoryFromIntent(intent) {
  const map = {
    new_installation: 'installation',
    relocation_request: 'installation',
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
  await ensureTicketSchema();
  const routeResult = await db.query(
    `SELECT employee_id, employee_ids, notification_channels
     FROM workflow_routes
     WHERE client_id = $1
       AND intent_key = $2
       AND is_enabled = TRUE
     LIMIT 1`,
    [clientId, intentKey]
  );
  const route = routeResult.rows[0];
  const employeeIds = normalizeWorkflowEmployeeIds(route?.employee_ids, route?.employee_id);
  if (employeeIds.length === 0) return null;

  const result = await db.query(
    `SELECT id, name, phone, email
     FROM employees
     WHERE client_id = $1
       AND is_active = TRUE
       AND id = ANY($2::int[])
     ORDER BY array_position($2::int[], id)`,
    [clientId, employeeIds]
  );
  const employees = result.rows;
  const employee = employees[0];
  return employee ? {
    employeeId: employee.id,
    employeeName: employee.name,
    employeePhone: employee.phone,
    employeeEmail: employee.email,
    employees: employees.map((item) => ({
      employeeId: item.id,
      employeeName: item.name,
      employeePhone: item.phone,
      employeeEmail: item.email,
    })),
    notificationChannels: normalizeWorkflowChannels(route.notification_channels),
    intentKey,
  } : null;
}

function normalizeWorkflowChannels(value) {
  const raw = Array.isArray(value) ? value : ['sms'];
  const allowed = new Set(['sms', 'email', 'whatsapp']);
  const clean = raw.map((item) => String(item || '').toLowerCase()).filter((item) => allowed.has(item));
  return [...new Set(clean)].length ? [...new Set(clean)] : ['sms'];
}

function normalizeWorkflowEmployeeIds(value, fallback = null) {
  const raw = Array.isArray(value) ? value : [];
  const ids = raw.map((item) => parseInt(item, 10)).filter((item) => Number.isInteger(item) && item > 0);
  if (ids.length === 0 && fallback) ids.push(parseInt(fallback, 10));
  return [...new Set(ids)].filter((item) => Number.isInteger(item) && item > 0);
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

async function loadClientSmsConfig(clientId) {
  if (!clientId) return null;
  try {
    await ensureClientSmsColumns();
    const result = await db.query(
      `SELECT id, sms_provider, sms_api_key, sms_sender_id FROM clients WHERE id = $1 LIMIT 1`,
      [clientId]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (err.code !== '42703') console.error('Load client SMS config failed:', err.message);
    return null;
  }
}

async function ensureClientSmsColumns() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(40)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_api_key TEXT`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(80)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_partner_id VARCHAR(80)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_configured_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_provider VARCHAR(40)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_from_name VARCHAR(160)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_from_address VARCHAR(180)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_reply_to VARCHAR(180)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_host VARCHAR(180)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_port INTEGER`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_secure BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_username VARCHAR(180)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_smtp_password TEXT`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_configured_at TIMESTAMP WITH TIME ZONE`);
}

async function notifyAssignedEmployee({ ticket, assignment, customerPhone, customerName, summary }) {
  if (!assignment?.employeeId) return { status: null, error: null };

  const customer = customerName ? `${customerName} (+${customerPhone})` : `+${customerPhone}`;
  const link = ticketLink(ticket.id);
  let installationFormLine = '';
  let locationLine = '';
  if (ticket.category === 'installation' && assignment.intentKey !== 'relocation_request') {
    const workOrder = await getOrCreateInstallationWorkOrder(ticket, assignment.employeeId);
    const formUrl = buildInstallationWorkOrderUrl(workOrder.public_token);
    const location = clean(summary).replace(/^Location:\s*/i, '') || 'Not provided';
    locationLine = `Location: ${location}\n`;
    installationFormLine = formUrl
      ? `\n\nTechnician installation form:\n${formUrl}\n\nRecord equipment used, installation time, power/DCBs and notes after the site visit.`
      : '\n\nTechnician installation form is ready, but PUBLIC_FRONTEND_URL is not configured.';
  }
  const message = ticket.category === 'installation'
    ? `${assignment.intentKey === 'relocation_request' ? 'NEW RELOCATION REQUEST' : 'NEW INSTALLATION REQUEST'}\n` +
      `Name: ${customerName || ticket.customer_name || 'Customer'}\n` +
      `Phone Number: ${customerPhone}\n` +
      (assignment.intentKey === 'relocation_request' ? `Details: ${summary || ticket.summary || ticket.last_message || 'Relocation details submitted'}\n` : locationLine) +
      (link ? `\nTicket: ${link}` : '') +
      installationFormLine
    : `New ticket assigned to you\n\n` +
      `Ticket #${ticket.id}: ${ticket.title}\n` +
      `Priority: ${ticket.priority}\n` +
      `Customer: ${customer}\n` +
      `Issue: ${summary || ticket.summary || ticket.last_message || 'No summary yet'}` +
      (link ? `\n\nOpen ticket: ${link}` : '');

  const client = await loadClientForWorkflowNotify(ticket.client_id);
  if (!client) return { status: 'failed', error: 'Client not found for workflow notification' };
  const channels = normalizeWorkflowChannels(assignment.notificationChannels);
  if (ticket.category === 'installation' && assignment.smsOnly) {
    channels.splice(0, channels.length, 'sms');
  } else if (ticket.category === 'installation' && !channels.includes('whatsapp')) {
    channels.push('whatsapp');
  }
  const recipients = Array.isArray(assignment.employees) && assignment.employees.length ? assignment.employees : [assignment];
  const recipientResults = await Promise.all(recipients.map(async (employee) => ({
    employee,
    results: await sendWorkflowAssignmentChannels({
      client,
      assignment: employee,
      channels,
      subject: `New ticket assigned: #${ticket.id}`,
      message,
    }),
  })));
  const sent = recipientResults.some(({ results }) => Object.values(results).some((result) => result.status === 'sent'));
  const errors = recipientResults.flatMap(({ employee, results }) =>
    Object.entries(results)
      .filter(([, result]) => result.status !== 'sent')
      .map(([channel, result]) => `${employee.employeeName || 'Employee'} ${channel}: ${result.error || result.status}`)
  ).join(' | ');
  return { status: sent ? 'sent' : 'failed', error: errors || null, channelResults: recipientResults };
}

async function loadClientForWorkflowNotify(clientId) {
  await ensureClientSmsColumns();
  const result = await db.query(
    `SELECT id, name, business_name, contact_email, support_number, agent_name,
            connection_provider, meta_phone_number_id, meta_access_token, evolution_instance_name,
            sms_provider, sms_api_key, sms_sender_id,
            email_provider, email_enabled, email_from_name, email_from_address, email_reply_to,
            email_smtp_host, email_smtp_port, email_smtp_secure, email_smtp_username, email_smtp_password
     FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  return result.rows[0] || null;
}

async function sendWorkflowAssignmentChannels({ client, assignment, channels, subject, message }) {
  const results = {};
  await Promise.all(channels.map(async (channel) => {
    try {
      if (channel === 'sms') {
        if (!assignment.employeePhone) throw new Error('Assigned employee has no phone number');
        await sendSMS(assignment.employeePhone, message, { client });
      } else if (channel === 'email') {
        const result = await sendWorkflowEmployeeEmail(client, { email: assignment.employeeEmail }, { subject, message });
        if (result.status !== 'sent') throw new Error(result.error || result.status);
      } else if (channel === 'whatsapp') {
        if (!assignment.employeePhone) throw new Error('Assigned employee has no phone number');
        if (client?.connection_provider === 'evolution') await sendClientText(client, assignment.employeePhone, message);
        else await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, assignment.employeePhone, message);
      }
      results[channel] = { status: 'sent', error: null };
    } catch (err) {
      results[channel] = { status: 'failed', error: err.message || 'Failed to send workflow notification' };
    }
  }));
  return results;
}

async function loadClientForAlert(clientId) {
  return loadClientForWorkflowNotify(clientId);
}

async function sendClientHighPrioritySms(client, ticket) {
  if (!client?.support_number) return { status: 'skipped', error: 'Client support number is not set' };
  if (!hasSMSConfig({ client })) return { status: 'skipped', error: 'SMS provider is not configured' };

  const link = ticketLink(ticket.id);
  const message =
    `High priority ticket created\n\n` +
    `Ticket #${ticket.id}: ${ticket.title}\n` +
    `Priority: ${ticket.priority}\n` +
    `Customer: ${ticket.customer_name || 'Unknown'} (+${ticket.customer_phone})\n` +
    `Issue: ${ticket.summary || ticket.last_message || 'No summary yet'}` +
    (link ? `\n\nOpen: ${link}` : '');

  try {
    await sendSMS(client.support_number, message, { client });
    return { status: 'sent', error: null };
  } catch (err) {
    return { status: 'failed', error: err.message || 'Failed to send client SMS alert' };
  }
}

async function recordHighPriorityClientAlerts(ticket) {
  if (!['high', 'urgent'].includes(ticket.priority)) return ticket;
  if (ticket.client_alert_sms_status && ticket.client_alert_email_status) return ticket;

  const client = await loadClientForAlert(ticket.client_id);
  if (!client) return ticket;

  const [smsResult, emailResult] = await Promise.all([
    sendClientHighPrioritySms(client, ticket),
    sendHighPriorityTicketEmail(client, ticket),
  ]);

  const updated = await db.query(
    `UPDATE tickets
     SET client_alert_sms_status = $2,
         client_alert_sms_error = $3,
         client_alert_sms_sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE client_alert_sms_sent_at END,
         client_alert_email_status = $4,
         client_alert_email_error = $5,
         client_alert_email_sent_at = CASE WHEN $4 = 'sent' THEN NOW() ELSE client_alert_email_sent_at END
     WHERE id = $1
     RETURNING *`,
    [ticket.id, smsResult.status, smsResult.error, emailResult.status, emailResult.error]
  );

  await addTicketEvent(ticket.id, {
    actor_type: 'system',
    event_type: 'note',
    body: `Client high-priority alerts - SMS: ${smsResult.status}, Email: ${emailResult.status}`,
    metadata: {
      client_alert_sms_status: smsResult.status,
      client_alert_sms_error: smsResult.error,
      client_alert_email_status: emailResult.status,
      client_alert_email_error: emailResult.error,
    },
  });

  return updated.rows[0] || ticket;
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
  let notification;
  try {
    notification = await notifyAssignedEmployee({ ticket, assignment, ...details });
  } catch (err) {
    notification = {
      status: 'failed',
      error: err.message || 'Failed to send assignment notification',
    };
  }
  if (!notification.status) return ticket;

  try {
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
          ? `Assignment alert sent to ${assignment.employees?.length > 1 ? `${assignment.employees.length} employees` : assignment.employeeName}`
          : `Assignment alert ${notification.status}: ${notification.error}`,
      metadata: {
        employee_id: assignment.employeeId,
        notify_status: notification.status,
        notify_error: notification.error,
      },
    });

    return updated.rows[0] || ticket;
  } catch (err) {
    console.error('Failed to record assignment notification:', err.message);
    return {
      ...ticket,
      assignment_notify_status: notification.status,
      assignment_notify_error: notification.error,
    };
  }
}

async function createOrUpdateTicket(signal) {
  await ensureTicketSchema();

  const clientId = Number(signal.clientId || signal.client_id);
  const rawConversationId = signal.conversationId || signal.conversation_id || null;
  const parsedConversationId = rawConversationId ? Number(rawConversationId) : null;
  const conversationId = Number.isFinite(parsedConversationId) ? parsedConversationId : null;
  const customerPhone = clean(signal.customerPhone || signal.customer_phone);
  if (!clientId || !customerPhone) return null;

  const category = normalizeCategory(signal.category);
  const priority = normalizePriority(signal.priority);
  const title = clean(signal.title, titleForCategory(category));
  const body = clean(signal.messageText || signal.last_message || signal.summary);
  const source = clean(signal.source, 'system');
  const summary = clean(signal.summary, body || title);
  const assignment = await findWorkflowAssignment(clientId, category, signal.intent);
  const forcedAssignment = signal.assignedEmployeeId || signal.assigned_employee_id
    ? await loadAssignedEmployee(clientId, signal.assignedEmployeeId || signal.assigned_employee_id, signal.smsOnly || signal.sms_only)
    : null;
  const selectedAssignment = forcedAssignment || assignment;

  const params = [clientId, category];
  let lookup = `client_id = $1::int AND category = $2::text AND status = ANY($${params.length + 1}::text[])`;
  params.push(OPEN_STATUSES);
  if (conversationId) {
    params.push(conversationId);
    lookup += ` AND conversation_id = $${params.length}::int`;
  } else {
    params.push(customerPhone);
    lookup += ` AND customer_phone = $${params.length}::text`;
  }

  const existing = signal.forceNew
    ? { rows: [] }
    : await db.query(
      `SELECT * FROM tickets WHERE ${lookup} ORDER BY updated_at DESC LIMIT 1`,
      params
    );

  if (existing.rows[0]) {
    const ticket = existing.rows[0];
    const nextPriority = strongerPriority(ticket.priority, priority);
    const updated = await db.query(
      `UPDATE tickets
       SET customer_name = COALESCE($2::text, customer_name),
           priority = $3::text,
           summary = COALESCE($4::text, summary),
           last_message = COALESCE($5::text, last_message),
           assigned_employee_id = COALESCE(assigned_employee_id, $6::int),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        Number(ticket.id),
        signal.customerName || signal.customer_name || null,
        nextPriority,
        summary || null,
        body || null,
        selectedAssignment?.employeeId ? Number(selectedAssignment.employeeId) : null,
      ]
    );
    let latestTicket = updated.rows[0];
    if (selectedAssignment?.employeeId && !ticket.assigned_employee_id) {
      await addTicketEvent(ticket.id, {
        actor_type: 'system',
        event_type: 'assigned',
        body: `Assigned to ${selectedAssignment.employeeName}`,
        metadata: { employee_id: selectedAssignment.employeeId, intent_key: selectedAssignment.intentKey },
      });
      latestTicket = await recordAssignmentNotification(latestTicket, selectedAssignment, {
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
    latestTicket = await recordHighPriorityClientAlerts(latestTicket);
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
      selectedAssignment?.employeeId ? Number(selectedAssignment.employeeId) : null,
    ]
  );
  const ticket = inserted.rows[0];
  await addTicketEvent(ticket.id, {
    actor_type: 'system',
    event_type: 'created',
    body,
    metadata: { source, category, priority },
  });
  if (selectedAssignment?.employeeId) {
    await addTicketEvent(ticket.id, {
      actor_type: 'system',
      event_type: 'assigned',
      body: `Assigned to ${selectedAssignment.employeeName}`,
      metadata: { employee_id: selectedAssignment.employeeId, intent_key: selectedAssignment.intentKey },
    });
    const notified = await recordAssignmentNotification(ticket, selectedAssignment, {
      customerPhone,
      customerName: signal.customerName || signal.customer_name || null,
      summary,
    });
    return recordHighPriorityClientAlerts(notified);
  }
  return recordHighPriorityClientAlerts(ticket);
}

async function loadAssignedEmployee(clientId, employeeId, smsOnly = false) {
  const result = await db.query(
    `SELECT id, name, phone, email
     FROM employees
     WHERE id = $1 AND client_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [employeeId, clientId]
  );
  const employee = result.rows[0];
  if (!employee) return null;
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeePhone: employee.phone,
    employeeEmail: employee.email,
    employees: [{
      employeeId: employee.id,
      employeeName: employee.name,
      employeePhone: employee.phone,
      employeeEmail: employee.email,
    }],
    notificationChannels: ['sms'],
    smsOnly: Boolean(smsOnly),
    intentKey: 'manual_installation',
  };
}

async function ticketFromIntent({ client, conversation, intent, messageText, source }) {
  const category = categoryFromIntent(intent);
  if (!category || category === 'feedback') return null;
  const priority = priorityForSignal(category, messageText);
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
  const priority = priorityForSignal(category, messageText, category === 'complaint' ? 'high' : 'normal');
  return createOrUpdateTicket({
    clientId: client.id,
    conversationId: conversation.id,
    customerPhone: conversation.customer_phone,
    customerName: conversation.customer_name,
    title: titleForCategory(category),
    category,
    priority,
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
