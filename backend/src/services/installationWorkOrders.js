const crypto = require('crypto');
const db = require('../db');
const { sendSMS, hasSMSConfig } = require('./sms');

async function ensureInstallationWorkOrderSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS installation_work_orders (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
      public_token VARCHAR(80) UNIQUE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      technician_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      installation_started_at TIMESTAMP WITH TIME ZONE,
      installation_completed_at TIMESTAMP WITH TIME ZONE,
      installation_time_minutes INTEGER,
      power_dcbs VARCHAR(120),
      signal_power VARCHAR(120),
      equipment_used JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      scheduled_for TIMESTAMP WITH TIME ZONE,
      schedule_note TEXT,
      last_rescheduled_at TIMESTAMP WITH TIME ZONE,
      submitted_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (ticket_id)
    )
  `);
  await db.query(`ALTER TABLE installation_work_orders DROP CONSTRAINT IF EXISTS installation_work_orders_status_check`);
  await db.query(`ALTER TABLE installation_work_orders ADD CONSTRAINT installation_work_orders_status_check CHECK (status IN ('open', 'submitted', 'closed'))`);
  await db.query(`ALTER TABLE installation_work_orders ADD COLUMN IF NOT EXISTS technician_status VARCHAR(20) NOT NULL DEFAULT 'pending'`);
  await db.query(`ALTER TABLE installation_work_orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE installation_work_orders ADD COLUMN IF NOT EXISTS schedule_note TEXT`);
  await db.query(`ALTER TABLE installation_work_orders ADD COLUMN IF NOT EXISTS last_rescheduled_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE installation_work_orders DROP CONSTRAINT IF EXISTS installation_work_orders_technician_status_check`);
  await db.query(`ALTER TABLE installation_work_orders ADD CONSTRAINT installation_work_orders_technician_status_check CHECK (technician_status IN ('done', 'pending', 'rescheduled'))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_installation_work_orders_client ON installation_work_orders(client_id, status, created_at DESC)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS installation_schedule_events (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      work_order_id INTEGER REFERENCES installation_work_orders(id) ON DELETE CASCADE,
      assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
      scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
      reason TEXT,
      customer_notify_status VARCHAR(20) NOT NULL DEFAULT 'skipped',
      customer_notify_error TEXT,
      technician_notify_status VARCHAR(20) NOT NULL DEFAULT 'skipped',
      technician_notify_error TEXT,
      created_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_installation_schedule_events_ticket ON installation_schedule_events(ticket_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_installation_schedule_events_client ON installation_schedule_events(client_id, scheduled_for DESC)`);
}

function buildInstallationWorkOrderUrl(token) {
  const base = String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return base && token ? `${base}/installation-work-order/${token}` : null;
}

async function getOrCreateInstallationWorkOrder(ticket, employeeId = null) {
  await ensureInstallationWorkOrderSchema();
  const existing = await db.query(
    `SELECT * FROM installation_work_orders WHERE ticket_id = $1 LIMIT 1`,
    [ticket.id]
  );
  if (existing.rows[0]) return existing.rows[0];

  const token = crypto.randomBytes(24).toString('hex');
  const inserted = await db.query(
    `INSERT INTO installation_work_orders (client_id, ticket_id, assigned_employee_id, public_token)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [ticket.client_id, ticket.id, employeeId || ticket.assigned_employee_id || null, token]
  );
  return inserted.rows[0];
}

function cleanText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeEquipmentItems(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => ({
      inventory_item_id: item.inventory_item_id ? Number(item.inventory_item_id) : null,
      name: cleanText(item.name, 180),
      quantity: Number(item.quantity || 0),
      unit: cleanText(item.unit, 40) || 'pcs',
      notes: cleanText(item.notes, 300) || null,
    }))
    .filter((item) => (item.inventory_item_id || item.name) && Number.isFinite(item.quantity) && item.quantity > 0)
    .slice(0, 80);
}

function normalizeTechnicianStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['done', 'pending', 'rescheduled'].includes(status) ? status : 'pending';
}

function customerStatusMessage(workOrder, technicianStatus) {
  const name = workOrder.customer_name || 'Customer';
  if (technicianStatus === 'done') {
    return `Hello ${name}, your installation has been marked as done. Thank you for choosing us.`;
  }
  if (technicianStatus === 'rescheduled') {
    return `Hello ${name}, your installation has been rescheduled. Our team will follow up with the next visit details.`;
  }
  return `Hello ${name}, your installation request is still pending. Our technician will continue following up.`;
}

async function notifyCustomerInstallationStatus(workOrder, technicianStatus) {
  const phone = String(workOrder.customer_phone || '').trim();
  if (!phone) return { status: 'skipped', error: 'Customer phone missing' };

  const clientRes = await db.query(
    `SELECT id, sms_provider, sms_api_key, sms_sender_id, sms_partner_id
     FROM clients WHERE id = $1 LIMIT 1`,
    [workOrder.client_id]
  );
  const client = clientRes.rows[0];
  if (!client || !hasSMSConfig({ client })) return { status: 'skipped', error: 'SMS provider is not configured' };

  try {
    await sendSMS(phone, customerStatusMessage(workOrder, technicianStatus), { client });
    return { status: 'sent', error: null };
  } catch (err) {
    return { status: 'failed', error: err.message || 'Failed to send customer installation SMS' };
  }
}

function formatScheduleTime(value) {
  if (!value) return 'not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-KE', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Nairobi',
  });
}

async function sendInstallationScheduleNotice({ client, phone, message }) {
  if (!phone) return { status: 'skipped', error: 'Phone number missing' };
  if (!client || !hasSMSConfig({ client })) return { status: 'skipped', error: 'SMS provider is not configured' };
  try {
    await sendSMS(phone, message, { client });
    return { status: 'sent', error: null };
  } catch (err) {
    return { status: 'failed', error: err.message || 'Failed to send installation schedule SMS' };
  }
}

async function listInstallationWorkOrders({ clientId, status = 'all' } = {}) {
  await ensureInstallationWorkOrderSchema();
  const params = [];
  const conditions = [`t.category = 'installation'`];
  if (clientId) {
    params.push(clientId);
    conditions.push(`t.client_id = $${params.length}`);
  }
  if (status === 'open') conditions.push(`t.status NOT IN ('resolved', 'closed')`);
  if (status === 'resolved') conditions.push(`t.status IN ('resolved', 'closed')`);

  const result = await db.query(
    `SELECT
       wo.id, wo.public_token, wo.status AS work_order_status, wo.technician_status,
       wo.installation_started_at, wo.installation_completed_at, wo.installation_time_minutes,
       wo.power_dcbs, wo.signal_power, wo.equipment_used, wo.notes, wo.scheduled_for,
       wo.schedule_note, wo.last_rescheduled_at, wo.submitted_at, wo.created_at AS work_order_created_at,
       t.id AS ticket_id, t.client_id, t.customer_name, t.customer_phone, t.title, t.summary,
       t.status AS ticket_status, t.priority AS ticket_priority, t.assigned_employee_id,
       e.name AS technician_name, e.phone AS technician_phone,
       latest.reason AS latest_schedule_reason,
       latest.customer_notify_status AS latest_customer_notify_status,
       latest.customer_notify_error AS latest_customer_notify_error,
       latest.technician_notify_status AS latest_technician_notify_status,
       latest.technician_notify_error AS latest_technician_notify_error,
       latest.created_at AS latest_schedule_created_at
     FROM installation_work_orders wo
     JOIN tickets t ON t.id = wo.ticket_id
     LEFT JOIN employees e ON e.id = COALESCE(wo.assigned_employee_id, t.assigned_employee_id)
     LEFT JOIN LATERAL (
       SELECT reason, customer_notify_status, customer_notify_error, technician_notify_status, technician_notify_error, created_at
       FROM installation_schedule_events se
       WHERE se.ticket_id = t.id
       ORDER BY se.created_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE ${conditions.join(' AND ')}
     ORDER BY COALESCE(wo.scheduled_for, wo.updated_at, wo.created_at) DESC
     LIMIT 250`,
    params
  );
  return result.rows;
}

async function getInstallationScheduleEvents(ticketId, clientId = null) {
  await ensureInstallationWorkOrderSchema();
  const params = [ticketId];
  let where = `se.ticket_id = $1`;
  if (clientId) {
    params.push(clientId);
    where += ` AND se.client_id = $${params.length}`;
  }
  const result = await db.query(
    `SELECT se.*, e.name AS technician_name, e.phone AS technician_phone, a.name AS created_by_admin_name
     FROM installation_schedule_events se
     LEFT JOIN employees e ON e.id = se.assigned_employee_id
     LEFT JOIN admins a ON a.id = se.created_by_admin_id
     WHERE ${where}
     ORDER BY se.created_at DESC
     LIMIT 100`,
    params
  );
  return result.rows;
}

async function rescheduleInstallation({ ticketId, clientId, scheduledFor, reason, assignedEmployeeId = null, adminId = null }) {
  await ensureInstallationWorkOrderSchema();
  const ticketRes = await db.query(
    `SELECT t.*, e.name AS technician_name, e.phone AS technician_phone
     FROM tickets t
     LEFT JOIN employees e ON e.id = COALESCE($3::int, t.assigned_employee_id)
     WHERE t.id = $1 AND t.client_id = $2 AND t.category = 'installation'
     LIMIT 1`,
    [ticketId, clientId, assignedEmployeeId]
  );
  const ticket = ticketRes.rows[0];
  if (!ticket) return null;

  const scheduledDate = new Date(scheduledFor);
  if (!scheduledFor || Number.isNaN(scheduledDate.getTime())) {
    const error = new Error('A valid schedule date and time is required');
    error.statusCode = 400;
    throw error;
  }

  const workOrder = await getOrCreateInstallationWorkOrder(ticket, assignedEmployeeId || ticket.assigned_employee_id || null);
  const employeeId = assignedEmployeeId || workOrder.assigned_employee_id || ticket.assigned_employee_id || null;
  let employee = null;
  if (employeeId) {
    const employeeRes = await db.query(
      `SELECT id, name, phone FROM employees WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1`,
      [employeeId, clientId]
    );
    employee = employeeRes.rows[0] || null;
  }

  const clientRes = await db.query(
    `SELECT id, name, business_name, sms_provider, sms_api_key, sms_sender_id, sms_partner_id FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  const client = clientRes.rows[0];
  const when = formatScheduleTime(scheduledDate);
  const cleanReason = cleanText(reason, 1200) || 'Schedule updated by admin.';
  const company = client?.business_name || client?.name || 'your ISP';

  const customerMessage =
    `Hello ${ticket.customer_name || 'Customer'}, your installation has been rescheduled.\n\n` +
    `New time: ${when}\n` +
    (employee?.name ? `Technician: ${employee.name}\n` : '') +
    `Reason: ${cleanReason}\n\n` +
    `Thank you for your patience. - ${company}`;
  const technicianMessage =
    `INSTALLATION RESCHEDULED\n\n` +
    `Client: ${ticket.customer_name || 'Customer'}\n` +
    `Phone: ${ticket.customer_phone}\n` +
    `New time: ${when}\n` +
    `Reason: ${cleanReason}\n` +
    `Ticket: #${ticket.id}`;

  const customerResult = await sendInstallationScheduleNotice({ client, phone: ticket.customer_phone, message: customerMessage });
  const technicianResult = await sendInstallationScheduleNotice({ client, phone: employee?.phone, message: technicianMessage });

  const trx = await db.connect();
  try {
    await trx.query('BEGIN');
    const updatedWorkOrder = await trx.query(
      `UPDATE installation_work_orders
       SET technician_status = 'rescheduled',
           scheduled_for = $2,
           schedule_note = $3,
           assigned_employee_id = COALESCE($4, assigned_employee_id),
           last_rescheduled_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [workOrder.id, scheduledDate.toISOString(), cleanReason, employeeId]
    );
    await trx.query(
      `UPDATE tickets
       SET status = 'waiting_customer',
           assigned_employee_id = COALESCE($2, assigned_employee_id),
           summary = COALESCE(summary, $3),
           updated_at = NOW()
       WHERE id = $1`,
      [ticket.id, employeeId, `Installation rescheduled for ${when}. ${cleanReason}`]
    );
    const event = await trx.query(
      `INSERT INTO installation_schedule_events
         (client_id, ticket_id, work_order_id, assigned_employee_id, scheduled_for, reason,
          customer_notify_status, customer_notify_error, technician_notify_status, technician_notify_error, created_by_admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        clientId,
        ticket.id,
        workOrder.id,
        employeeId,
        scheduledDate.toISOString(),
        cleanReason,
        customerResult.status,
        customerResult.error,
        technicianResult.status,
        technicianResult.error,
        adminId,
      ]
    );
    await trx.query(
      `INSERT INTO ticket_events (ticket_id, actor_type, actor_id, event_type, body, metadata)
       VALUES ($1, 'admin', $2, 'note', $3, $4::jsonb)`,
      [
        ticket.id,
        adminId,
        `Installation rescheduled for ${when}. Customer SMS: ${customerResult.status}. Technician SMS: ${technicianResult.status}.`,
        JSON.stringify({
          scheduled_for: scheduledDate.toISOString(),
          reason: cleanReason,
          work_order_id: workOrder.id,
          customer_notify_status: customerResult.status,
          customer_notify_error: customerResult.error,
          technician_notify_status: technicianResult.status,
          technician_notify_error: technicianResult.error,
        }),
      ]
    );
    await trx.query('COMMIT');
    return {
      work_order: updatedWorkOrder.rows[0],
      schedule_event: event.rows[0],
      customer_notification: customerResult,
      technician_notification: technicianResult,
    };
  } catch (err) {
    await trx.query('ROLLBACK');
    throw err;
  } finally {
    trx.release();
  }
}

async function submitInstallationWorkOrder(token, payload) {
  await ensureInstallationWorkOrderSchema();
  const currentRes = await db.query(
    `SELECT wo.*, t.title, t.customer_phone, t.customer_name
     FROM installation_work_orders wo
     JOIN tickets t ON t.id = wo.ticket_id
     WHERE wo.public_token = $1
     LIMIT 1`,
    [token]
  );
  const workOrder = currentRes.rows[0];
  if (!workOrder) return null;

  const equipment = normalizeEquipmentItems(payload.equipment_used);
  const technicianStatus = normalizeTechnicianStatus(payload.technician_status || payload.status);
  const startedAt = payload.installation_started_at ? new Date(payload.installation_started_at) : null;
  const completedAt = payload.installation_completed_at ? new Date(payload.installation_completed_at) : null;
  const minutes = Number(payload.installation_time_minutes || 0);
  const safeMinutes = Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : null;

  const trx = await db.connect();
  try {
    await trx.query('BEGIN');
    const updated = await trx.query(
      `UPDATE installation_work_orders
       SET status = 'submitted',
           technician_status = $9,
           installation_started_at = $1,
           installation_completed_at = $2,
           installation_time_minutes = $3,
           power_dcbs = $4,
           signal_power = $5,
           equipment_used = $6::jsonb,
           notes = $7,
           submitted_at = NOW(),
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt.toISOString() : null,
        completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt.toISOString() : null,
        safeMinutes,
        cleanText(payload.power_dcbs, 120) || null,
        cleanText(payload.signal_power, 120) || null,
        JSON.stringify(equipment),
        cleanText(payload.notes, 2000) || null,
        workOrder.id,
        technicianStatus,
      ]
    );

    for (const item of equipment) {
      if (!item.inventory_item_id) continue;
      await trx.query(
        `UPDATE inventory_items
         SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
         WHERE id = $2 AND client_id = $3 AND status = 'active'`,
        [item.quantity, item.inventory_item_id, workOrder.client_id]
      );
    }

    await trx.query(
      `UPDATE tickets
       SET status = $3,
           summary = COALESCE(summary, $2),
           updated_at = NOW()
       WHERE id = $1`,
      [
        workOrder.ticket_id,
        `Installation ${technicianStatus}. Site report submitted with ${equipment.length} equipment line(s).`,
        technicianStatus === 'done' ? 'resolved' : 'in_progress',
      ]
    );

    await trx.query('COMMIT');
    const smsResult = await notifyCustomerInstallationStatus(workOrder, technicianStatus);
    await db.query(
      `INSERT INTO ticket_events (ticket_id, actor_type, event_type, body, metadata)
       VALUES ($1, 'system', 'note', $2, $3::jsonb)`,
      [
        workOrder.ticket_id,
        `Technician marked installation ${technicianStatus}. Equipment lines: ${equipment.length}. Customer SMS: ${smsResult.status}.`,
        JSON.stringify({
          work_order_id: workOrder.id,
          technician_status: technicianStatus,
          equipment_used: equipment,
          power_dcbs: cleanText(payload.power_dcbs, 120) || null,
          signal_power: cleanText(payload.signal_power, 120) || null,
          customer_sms_status: smsResult.status,
          customer_sms_error: smsResult.error,
        }),
      ]
    );
    return updated.rows[0];
  } catch (err) {
    await trx.query('ROLLBACK');
    throw err;
  } finally {
    trx.release();
  }
}

module.exports = {
  ensureInstallationWorkOrderSchema,
  buildInstallationWorkOrderUrl,
  getOrCreateInstallationWorkOrder,
  getInstallationScheduleEvents,
  listInstallationWorkOrders,
  rescheduleInstallation,
  submitInstallationWorkOrder,
};
