const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { ensureActivityTable } = require('../services/audit');

router.use(authMiddleware, scopeMiddleware);

function scopedClient(req) {
  if (!req.scope.isSuperadmin || req.scope.clientId) return req.scope.clientId;
  return null;
}

function normalizeSeverity(value, fallback = 'info') {
  const text = String(value || fallback).toLowerCase();
  if (['critical', 'warning', 'success', 'failed', 'info'].includes(text)) return text;
  if (['error', 'urgent', 'high'].includes(text)) return 'critical';
  if (['sent', 'completed', 'resolved', 'paid'].includes(text)) return 'success';
  return fallback;
}

function normalizeActor(row = {}) {
  const actorType = row.actor_type || row.actor || 'system';
  return {
    actor_type: actorType,
    actor_name: row.actor_name || row.admin_name || row.sender_name || (actorType === 'ai' ? 'AI Agent' : 'System'),
    actor_email: row.actor_email || row.admin_email || null,
  };
}

function enrich(row) {
  const actor = normalizeActor(row);
  return {
    id: `${row.source || 'activity'}-${row.id}`,
    source: row.source || 'activity',
    module: row.module || 'system',
    action: row.action || 'event',
    title: row.title || row.description || row.action || 'System event',
    description: row.description || row.title || '',
    severity: normalizeSeverity(row.severity || row.status),
    status: row.status || null,
    entity_type: row.entity_type || row.module || null,
    entity_id: row.entity_id || null,
    target_name: row.target_name || null,
    target_phone: row.target_phone || null,
    metadata: row.metadata || {},
    ip_address: row.ip_address || null,
    user_agent: row.user_agent || null,
    created_at: row.created_at,
    ...actor,
  };
}

async function safeQuery(sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (err) {
    if (['42P01', '42703'].includes(err.code)) return [];
    console.warn('Audit source skipped:', err.message);
    return [];
  }
}

function clientWhere(alias, clientId, params) {
  if (!clientId) return '';
  params.push(clientId);
  return `WHERE ${alias}.client_id = $${params.length}`;
}

function applyFilters(events, query) {
  const actor = String(query.actor || 'all').toLowerCase();
  const moduleName = String(query.module || 'all').toLowerCase();
  const severity = String(query.severity || 'all').toLowerCase();
  const search = String(query.search || '').trim().toLowerCase();

  return events.filter((event) => {
    if (actor !== 'all' && String(event.actor_type || '').toLowerCase() !== actor) return false;
    if (moduleName !== 'all' && String(event.module || '').toLowerCase() !== moduleName) return false;
    if (severity !== 'all' && String(event.severity || '').toLowerCase() !== severity) return false;
    if (!search) return true;
    return [
      event.title,
      event.description,
      event.actor_name,
      event.actor_email,
      event.target_name,
      event.target_phone,
      event.entity_type,
      event.entity_id,
      JSON.stringify(event.metadata || {}),
    ].some((value) => String(value || '').toLowerCase().includes(search));
  });
}

function summarize(events) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = events.filter((event) => new Date(event.created_at) >= today).length;
  const adminActions = events.filter((event) => event.actor_type === 'admin').length;
  const aiActions = events.filter((event) => event.actor_type === 'ai').length;
  const failed = events.filter((event) => ['failed', 'critical'].includes(event.severity)).length;
  const security = events.filter((event) => event.module === 'security' || event.action.includes('security')).length;
  return {
    total: events.length,
    today: todayCount,
    admin_actions: adminActions,
    ai_actions: aiActions,
    failed_actions: failed,
    security_alerts: security,
  };
}

router.get('/', async (req, res) => {
  try {
    await ensureActivityTable();
    const clientId = scopedClient(req);
    const sourceLimit = Math.min(parseInt(req.query.limit, 10) || 120, 300);
    const params = [];
    const activityWhere = clientWhere('l', clientId, params);

    const activityRows = await safeQuery(
      `SELECT
         'activity' AS source,
         l.id,
         COALESCE(l.metadata->>'module', l.entity_type, 'system') AS module,
         COALESCE(l.metadata->>'severity', 'info') AS severity,
         l.action,
         l.description AS title,
         l.description,
         'admin' AS actor_type,
         l.admin_name AS actor_name,
         l.admin_email AS actor_email,
         l.entity_type,
         l.entity_id,
         l.metadata,
         l.ip_address,
         l.user_agent,
         l.created_at
       FROM admin_activity_logs l
       ${activityWhere}
       ORDER BY l.created_at DESC
       LIMIT $${params.push(sourceLimit)}`,
      params
    );

    const clientParams = [];
    const conversationWhere = clientWhere('c', clientId, clientParams);
    const messageRows = await safeQuery(
      `SELECT
         'message' AS source,
         m.id,
         'conversations' AS module,
         CASE WHEN m.role = 'assistant' THEN 'ai_reply_sent'
              WHEN m.role = 'admin' THEN 'live_agent_reply_sent'
              ELSE 'customer_message_received' END AS action,
         CASE WHEN m.role = 'assistant' THEN 'AI replied to customer'
              WHEN m.role = 'admin' THEN 'Live agent replied to customer'
              ELSE 'Customer sent a message' END AS title,
         LEFT(m.content, 220) AS description,
         CASE WHEN m.role = 'assistant' THEN 'ai'
              WHEN m.role = 'admin' THEN 'admin'
              ELSE 'customer' END AS actor_type,
         COALESCE(m.sender_name, CASE WHEN m.role = 'assistant' THEN 'AI Agent' WHEN m.role = 'admin' THEN 'Live Agent' ELSE c.customer_name END) AS actor_name,
         c.customer_name AS target_name,
         c.customer_phone AS target_phone,
         'conversation' AS entity_type,
         c.id AS entity_id,
         jsonb_build_object('message_id', m.id, 'role', m.role, 'conversation_status', c.status) AS metadata,
         m.timestamp AS created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       ${conversationWhere}
       ORDER BY m.timestamp DESC
       LIMIT $${clientParams.push(sourceLimit)}`,
      clientParams
    );

    const ticketParams = [];
    const ticketWhere = clientWhere('t', clientId, ticketParams);
    const ticketRows = await safeQuery(
      `SELECT
         'ticket' AS source,
         te.id,
         'tickets' AS module,
         te.event_type AS action,
         CONCAT('Ticket ', te.event_type, ': ', t.title) AS title,
         COALESCE(te.body, t.summary, t.last_message, '') AS description,
         te.actor_type,
         te.actor_name,
         t.customer_name AS target_name,
         t.customer_phone AS target_phone,
         'ticket' AS entity_type,
         t.id AS entity_id,
         jsonb_build_object('ticket_status', t.status, 'priority', t.priority, 'category', t.category, 'event_metadata', te.metadata) AS metadata,
         CASE WHEN t.status IN ('resolved', 'closed') OR te.event_type = 'resolved' THEN 'success' ELSE 'info' END AS severity,
         te.created_at
       FROM ticket_events te
       JOIN tickets t ON t.id = te.ticket_id
       ${ticketWhere}
       ORDER BY te.created_at DESC
       LIMIT $${ticketParams.push(sourceLimit)}`,
      ticketParams
    );

    const invoiceParams = [];
    const invoiceWhere = clientWhere('i', clientId, invoiceParams);
    const invoiceRows = await safeQuery(
      `SELECT
         'invoice' AS source,
         i.id,
         'invoices' AS module,
         CONCAT('invoice_', i.status) AS action,
         CONCAT('Invoice ', i.invoice_number, ' ', i.status) AS title,
         CONCAT('Invoice for ', i.customer_name, ' worth ', i.total_amount) AS description,
         'ai' AS actor_type,
         CASE WHEN i.sent_at IS NOT NULL THEN 'AI Agent' ELSE 'System' END AS actor_name,
         i.customer_name AS target_name,
         i.customer_phone AS target_phone,
         'invoice' AS entity_type,
         i.id AS entity_id,
         jsonb_build_object('invoice_number', i.invoice_number, 'total_amount', i.total_amount, 'due_date', i.due_date, 'public_token', i.public_token) AS metadata,
         CASE WHEN i.status = 'paid' THEN 'success' WHEN i.status IN ('overdue', 'cancelled') THEN 'warning' ELSE 'info' END AS severity,
         COALESCE(i.sent_at, i.updated_at, i.created_at) AS created_at
       FROM invoices i
       ${invoiceWhere}
       ORDER BY COALESCE(i.sent_at, i.updated_at, i.created_at) DESC
       LIMIT $${invoiceParams.push(sourceLimit)}`,
      invoiceParams
    );

    const notificationParams = [];
    const notificationWhere = clientId ? `WHERE r.client_id = $${notificationParams.push(clientId)}` : '';
    const notificationRows = await safeQuery(
      `SELECT
         'notification' AS source,
         n.id,
         CASE WHEN n.event_type LIKE 'security%' THEN 'security' ELSE 'network' END AS module,
         n.event_type AS action,
         COALESCE(n.title, n.event_type) AS title,
         COALESCE(n.message_sent, '') AS description,
         'system' AS actor_type,
         'Nexa Monitor' AS actor_name,
         n.whatsapp_number AS target_phone,
         'router' AS entity_type,
         n.router_id AS entity_id,
         n.variables_json AS metadata,
         n.severity,
         n.status,
         COALESCE(n.sent_at, n.created_at) AS created_at
       FROM notification_events n
       JOIN mikrotik_routers r ON r.id = n.router_id
       ${notificationWhere}
       ORDER BY COALESCE(n.sent_at, n.created_at) DESC
       LIMIT $${notificationParams.push(sourceLimit)}`,
      notificationParams
    );

    const taskParams = [];
    const taskWhere = clientWhere('r', clientId, taskParams);
    const taskRows = await safeQuery(
      `SELECT
         'ai_task' AS source,
         r.id,
         'ai_tasks' AS module,
         CONCAT('task_', r.status) AS action,
         CONCAT('AI task ', r.status, ': ', t.title) AS title,
         COALESCE(r.summary, r.error, t.instruction) AS description,
         'ai' AS actor_type,
         'AI Agent' AS actor_name,
         'ai_task' AS entity_type,
         t.id AS entity_id,
         jsonb_build_object('task_type', t.task_type, 'task_status', t.status, 'run_stats', r.stats, 'error', r.error) AS metadata,
         CASE WHEN r.status = 'completed' THEN 'success' WHEN r.status = 'failed' THEN 'failed' ELSE 'info' END AS severity,
         COALESCE(r.finished_at, r.started_at) AS created_at
       FROM ai_task_runs r
       JOIN ai_tasks t ON t.id = r.task_id
       ${taskWhere}
       ORDER BY COALESCE(r.finished_at, r.started_at) DESC
       LIMIT $${taskParams.push(sourceLimit)}`,
      taskParams
    );

    const allEvents = [
      ...activityRows,
      ...messageRows,
      ...ticketRows,
      ...invoiceRows,
      ...notificationRows,
      ...taskRows,
    ].map(enrich)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const filtered = applyFilters(allEvents, req.query).slice(0, sourceLimit);
    res.json({
      events: filtered,
      summary: summarize(allEvents),
      filters: {
        modules: [...new Set(allEvents.map((event) => event.module).filter(Boolean))].sort(),
        actors: [...new Set(allEvents.map((event) => event.actor_type).filter(Boolean))].sort(),
        severities: [...new Set(allEvents.map((event) => event.severity).filter(Boolean))].sort(),
      },
    });
  } catch (err) {
    console.error('GET /activity error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
