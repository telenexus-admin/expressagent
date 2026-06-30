const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { ensureTicketSchema, addTicketEvent, createOrUpdateTicket } = require('../services/tickets');

router.use(authMiddleware, scopeMiddleware);

function applyScope(req, params, alias = 't') {
  if (!req.scope.isSuperadmin || req.scope.clientId) {
    params.push(req.scope.clientId);
    return `${alias}.client_id = $${params.length}`;
  }
  if (req.query.clientId) {
    params.push(req.query.clientId);
    return `${alias}.client_id = $${params.length}`;
  }
  return 'TRUE';
}

async function loadScopedTicket(req, id) {
  const params = [id];
  let where = 't.id = $1';
  if (!req.scope.isSuperadmin || req.scope.clientId) {
    params.push(req.scope.clientId);
    where += ` AND t.client_id = $${params.length}`;
  }
  const result = await db.query(
    `SELECT t.*, c.status AS conversation_status, cl.name AS client_name, cl.business_name AS client_business_name
     FROM tickets t
     LEFT JOIN conversations c ON c.id = t.conversation_id
     LEFT JOIN clients cl ON cl.id = t.client_id
     WHERE ${where}
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

router.get('/summary', async (req, res) => {
  try {
    await ensureTicketSchema();
    const params = [];
    const scoped = applyScope(req, params, 't');
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('open', 'in_progress', 'waiting_customer'))::int AS active,
         COUNT(*) FILTER (WHERE status = 'open')::int AS open,
         COUNT(*) FILTER (WHERE priority IN ('high', 'urgent') AND status IN ('open', 'in_progress', 'waiting_customer'))::int AS priority,
         COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int AS closed
       FROM tickets t
       WHERE ${scoped}`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /tickets/summary error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    await ensureTicketSchema();
    const { status, category, priority, search } = req.query;
    const params = [];
    const conditions = [applyScope(req, params, 't')];

    if (status && status !== 'all') {
      if (status === 'active') conditions.push(`t.status IN ('open', 'in_progress', 'waiting_customer')`);
      else {
        params.push(status);
        conditions.push(`t.status = $${params.length}`);
      }
    }
    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`t.category = $${params.length}`);
    }
    if (priority && priority !== 'all') {
      params.push(priority);
      conditions.push(`t.priority = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(t.title ILIKE $${params.length} OR t.customer_phone ILIKE $${params.length} OR t.customer_name ILIKE $${params.length} OR t.summary ILIKE $${params.length})`);
    }

    const result = await db.query(
      `SELECT
         t.*,
         c.status AS conversation_status,
         cl.name AS client_name,
         cl.business_name AS client_business_name,
         e.name AS assigned_employee_name,
         a.name AS assigned_admin_name
       FROM tickets t
       LEFT JOIN conversations c ON c.id = t.conversation_id
       LEFT JOIN clients cl ON cl.id = t.client_id
       LEFT JOIN employees e ON e.id = t.assigned_employee_id
       LEFT JOIN admins a ON a.id = t.assigned_admin_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         t.updated_at DESC
       LIMIT 250`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /tickets error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await ensureTicketSchema();
    const ticket = await loadScopedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const events = await db.query(
      `SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticket.id]
    );
    res.json({ ticket, events: events.rows });
  } catch (err) {
    console.error('GET /tickets/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    await ensureTicketSchema();
    const clientId = req.scope.isSuperadmin ? (req.body.client_id || req.scope.clientId) : req.scope.clientId;
    if (!clientId) return res.status(400).json({ error: 'client_id is required' });
    const ticket = await createOrUpdateTicket({
      clientId,
      conversationId: req.body.conversation_id || null,
      customerPhone: req.body.customer_phone,
      customerName: req.body.customer_name,
      title: req.body.title,
      category: req.body.category || 'general',
      priority: req.body.priority || 'normal',
      source: 'admin',
      summary: req.body.summary,
      messageText: req.body.summary,
    });
    if (!ticket) return res.status(400).json({ error: 'customer_phone is required' });
    res.status(201).json(ticket);
  } catch (err) {
    console.error('POST /tickets error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/installations', async (req, res) => {
  try {
    await ensureTicketSchema();
    const clientId = req.scope.isSuperadmin ? (req.body.client_id || req.scope.clientId) : req.scope.clientId;
    if (!clientId) return res.status(400).json({ error: 'client_id is required' });

    const customerName = String(req.body.customer_name || '').trim();
    const customerPhone = String(req.body.customer_phone || '').trim();
    const location = String(req.body.location || '').trim();
    const assignedEmployeeId = req.body.assigned_employee_id ? Number(req.body.assigned_employee_id) : null;
    if (!customerName || !customerPhone || !location || !assignedEmployeeId) {
      return res.status(400).json({ error: 'Client name, phone number, location and technician are required' });
    }

    const employee = await db.query(
      `SELECT id FROM employees WHERE id = $1 AND client_id = $2 AND role = 'technician' AND is_active = TRUE LIMIT 1`,
      [assignedEmployeeId, clientId]
    );
    if (!employee.rows[0]) return res.status(400).json({ error: 'Select an active technician for this account' });

    const ticket = await createOrUpdateTicket({
      clientId,
      customerPhone,
      customerName,
      title: `New installation request - ${customerName}`,
      category: 'installation',
      priority: req.body.priority || 'normal',
      source: 'admin',
      summary: `Location: ${location}`,
      messageText: `Manual installation request for ${customerName}. Location: ${location}`,
      assignedEmployeeId,
      smsOnly: true,
      forceNew: true,
    });
    res.status(201).json(ticket);
  } catch (err) {
    console.error('POST /tickets/installations error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    await ensureTicketSchema();
    const current = await loadScopedTicket(req, req.params.id);
    if (!current) return res.status(404).json({ error: 'Ticket not found' });

    const allowed = {
      status: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
      priority: ['low', 'normal', 'high', 'urgent'],
      category: ['technical', 'billing', 'installation', 'complaint', 'human_support', 'feedback', 'general'],
    };
    const updates = [];
    const params = [];

    for (const field of ['title', 'summary', 'customer_name']) {
      if (req.body[field] !== undefined) {
        params.push(String(req.body[field] || '').trim() || null);
        updates.push(`${field} = $${params.length}`);
      }
    }
    for (const field of ['status', 'priority', 'category']) {
      if (req.body[field] !== undefined) {
        if (!allowed[field].includes(req.body[field])) {
          return res.status(400).json({ error: `Invalid ${field}` });
        }
        params.push(req.body[field]);
        updates.push(`${field} = $${params.length}`);
      }
    }
    if (req.body.assigned_employee_id !== undefined) {
      if (req.body.assigned_employee_id) {
        const employee = await db.query(`SELECT id FROM employees WHERE id = $1 AND client_id = $2`, [req.body.assigned_employee_id, current.client_id]);
        if (!employee.rows[0]) return res.status(400).json({ error: 'Assigned employee is not available for this client' });
      }
      params.push(req.body.assigned_employee_id || null);
      updates.push(`assigned_employee_id = $${params.length}`);
    }
    if (req.body.assigned_admin_id !== undefined) {
      if (req.body.assigned_admin_id) {
        const admin = await db.query(`SELECT id FROM admins WHERE id = $1 AND client_id = $2`, [req.body.assigned_admin_id, current.client_id]);
        if (!admin.rows[0]) return res.status(400).json({ error: 'Assigned admin is not available for this client' });
      }
      params.push(req.body.assigned_admin_id || null);
      updates.push(`assigned_admin_id = $${params.length}`);
    }
    if (req.body.status === 'resolved' || req.body.status === 'closed') updates.push('resolved_at = COALESCE(resolved_at, NOW())');
    if (['open', 'in_progress', 'waiting_customer'].includes(req.body.status)) updates.push('resolved_at = NULL');
    updates.push('updated_at = NOW()');

    params.push(current.id);
    const result = await db.query(
      `UPDATE tickets SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (req.body.status && req.body.status !== current.status) {
      await addTicketEvent(current.id, {
        actor_type: 'admin',
        actor_id: req.user.id,
        actor_name: req.user.name,
        event_type: req.body.status === 'resolved' || req.body.status === 'closed' ? 'resolved' : 'status_changed',
        body: `Status changed from ${current.status} to ${req.body.status}`,
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /tickets/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/events', async (req, res) => {
  try {
    await ensureTicketSchema();
    const ticket = await loadScopedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Note is required' });
    await addTicketEvent(ticket.id, {
      actor_type: 'admin',
      actor_id: req.user.id,
      actor_name: req.user.name,
      event_type: 'note',
      body,
    });
    const events = await db.query(`SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticket.id]);
    res.status(201).json(events.rows);
  } catch (err) {
    console.error('POST /tickets/:id/events error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await ensureTicketSchema();
    const ticket = await loadScopedTicket(req, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    await db.query(`DELETE FROM tickets WHERE id = $1`, [ticket.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /tickets/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
