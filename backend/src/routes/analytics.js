const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

router.use(authMiddleware, scopeMiddleware);

// GET /api/analytics — message volume + AI health snapshot
router.get('/', async (req, res) => {
  try {
    // Build a "client filter" clause + params used by every sub-query.
    // For non-superadmins (or superadmin with ?clientId=), scope to one client.
    // For unscoped superadmin, no filter — totals span all clients.
    const scoped = !req.scope.isSuperadmin || req.scope.clientId;
    const clientId = req.scope.clientId;

    // Each query owns its own params array; SQL is built per query.
    const messagesByDay = scoped
      ? db.query(
          `WITH days AS (
             SELECT generate_series(
               (CURRENT_DATE - INTERVAL '13 days'),
               CURRENT_DATE,
               '1 day'::interval
             )::date AS day
           )
           SELECT
             d.day,
             COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0)::int AS user_count,
             COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0)::int AS assistant_count,
             COALESCE(SUM(CASE WHEN m.role = 'admin' THEN 1 ELSE 0 END), 0)::int AS admin_count
           FROM days d
           LEFT JOIN messages m ON m.timestamp::date = d.day
             AND m.conversation_id IN (SELECT id FROM conversations WHERE client_id = $1)
           GROUP BY d.day
           ORDER BY d.day ASC`,
          [clientId]
        )
      : db.query(`
          WITH days AS (
            SELECT generate_series(
              (CURRENT_DATE - INTERVAL '13 days'),
              CURRENT_DATE,
              '1 day'::interval
            )::date AS day
          )
          SELECT
            d.day,
            COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0)::int AS user_count,
            COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0)::int AS assistant_count,
            COALESCE(SUM(CASE WHEN m.role = 'admin' THEN 1 ELSE 0 END), 0)::int AS admin_count
          FROM days d
          LEFT JOIN messages m ON m.timestamp::date = d.day
          GROUP BY d.day
          ORDER BY d.day ASC
        `);

    const convStatus = scoped
      ? db.query(`SELECT status, COUNT(*)::int AS count FROM conversations WHERE client_id = $1 GROUP BY status`, [clientId])
      : db.query(`SELECT status, COUNT(*)::int AS count FROM conversations GROUP BY status`);

    const escalationHealth = scoped
      ? db.query(
          `SELECT
             COUNT(*)::int AS total_30d,
             COALESCE(SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END), 0)::int AS open_count,
             COALESCE(SUM(CASE WHEN notify_status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_notify_count
           FROM escalations
           WHERE client_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
          [clientId]
        )
      : db.query(`
          SELECT
            COUNT(*)::int AS total_30d,
            COALESCE(SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END), 0)::int AS open_count,
            COALESCE(SUM(CASE WHEN notify_status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_notify_count
          FROM escalations
          WHERE created_at >= NOW() - INTERVAL '30 days'
        `);

    const msgRoles = scoped
      ? db.query(
          `SELECT
             COALESCE(SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END), 0)::int AS user_total,
             COALESCE(SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END), 0)::int AS assistant_total,
             COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0)::int AS admin_total
           FROM messages
           WHERE timestamp >= NOW() - INTERVAL '30 days'
             AND conversation_id IN (SELECT id FROM conversations WHERE client_id = $1)`,
          [clientId]
        )
      : db.query(`
          SELECT
            COALESCE(SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END), 0)::int AS user_total,
            COALESCE(SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END), 0)::int AS assistant_total,
            COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0)::int AS admin_total
          FROM messages
          WHERE timestamp >= NOW() - INTERVAL '30 days'
        `);

    const [volumeRes, convoStatusRes, escalationRes, msgRoleRes] = await Promise.all([
      messagesByDay, convStatus, escalationHealth, msgRoles,
    ]);

    const statusCounts = { active: 0, resolved: 0, human_takeover: 0 };
    for (const row of convoStatusRes.rows) {
      statusCounts[row.status] = row.count;
    }
    const totalConvos = statusCounts.active + statusCounts.resolved + statusCounts.human_takeover;

    const rawEscalationStats = escalationRes.rows[0] || {};
    const escalationStats = {
      total_30d: Number(rawEscalationStats.total_30d) || 0,
      open_count: Number(rawEscalationStats.open_count) || 0,
      failed_notify_count: Number(rawEscalationStats.failed_notify_count) || 0,
    };
    const rawMsgRoles = msgRoleRes.rows[0] || {};
    const msgRolesRow = {
      user_total: Number(rawMsgRoles.user_total) || 0,
      assistant_total: Number(rawMsgRoles.assistant_total) || 0,
      admin_total: Number(rawMsgRoles.admin_total) || 0,
    };

    const aiHandleRate = msgRolesRow.user_total > 0
      ? Math.min(100, Math.round((msgRolesRow.assistant_total / msgRolesRow.user_total) * 100))
      : 0;

    const escalationRate = totalConvos > 0
      ? Math.round((statusCounts.human_takeover / totalConvos) * 100)
      : 0;

    const failurePenalty = Math.min(30, escalationStats.failed_notify_count * 10);
    const healthScore = Math.max(0, Math.min(100,
      Math.round(aiHandleRate * 0.6 + (100 - escalationRate) * 0.4 - failurePenalty)
    ));

    let healthStatus = 'healthy';
    if (healthScore < 50) healthStatus = 'critical';
    else if (healthScore < 75) healthStatus = 'warning';

    res.json({
      messages_by_day: volumeRes.rows,
      conversations: {
        total: totalConvos,
        active: statusCounts.active,
        resolved: statusCounts.resolved,
        human_takeover: statusCounts.human_takeover,
      },
      ai_health: {
        score: healthScore,
        status: healthStatus,
        ai_handle_rate: aiHandleRate,
        escalation_rate: escalationRate,
        open_escalations: escalationStats.open_count,
        failed_notifications: escalationStats.failed_notify_count,
        total_user_messages_30d: msgRolesRow.user_total,
        total_ai_messages_30d: msgRolesRow.assistant_total,
        total_admin_messages_30d: msgRolesRow.admin_total,
      },
    });
  } catch (err) {
    console.error('GET /analytics error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
