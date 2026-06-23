const crypto = require('crypto');
const db = require('../db');

async function ensureInstallationWorkOrderSchema() {
  await db.query(`
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
    )
  `);
  await db.query(`ALTER TABLE installation_work_orders DROP CONSTRAINT IF EXISTS installation_work_orders_status_check`);
  await db.query(`ALTER TABLE installation_work_orders ADD CONSTRAINT installation_work_orders_status_check CHECK (status IN ('open', 'submitted', 'closed'))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_installation_work_orders_client ON installation_work_orders(client_id, status, created_at DESC)`);
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
       SET status = 'in_progress',
           summary = COALESCE(summary, $2),
           updated_at = NOW()
       WHERE id = $1`,
      [workOrder.ticket_id, `Installation site report submitted with ${equipment.length} equipment line(s).`]
    );

    await trx.query('COMMIT');
    await db.query(
      `INSERT INTO ticket_events (ticket_id, actor_type, event_type, body, metadata)
       VALUES ($1, 'system', 'note', $2, $3::jsonb)`,
      [
        workOrder.ticket_id,
        `Technician installation report submitted. Equipment lines: ${equipment.length}.`,
        JSON.stringify({
          work_order_id: workOrder.id,
          equipment_used: equipment,
          power_dcbs: cleanText(payload.power_dcbs, 120) || null,
          signal_power: cleanText(payload.signal_power, 120) || null,
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
  submitInstallationWorkOrder,
};
