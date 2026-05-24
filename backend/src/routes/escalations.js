const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { ensureRemarksSchema } = require('../services/clientRemarks');

router.use(authMiddleware, scopeMiddleware);

function applyClientScope(req, params, alias) {
  if (!req.scope.isSuperadmin || req.scope.clientId) {
    params.push(req.scope.clientId);
    return `${alias}.client_id = $${params.length}`;
  }
  return 'TRUE';
}

// GET /api/escalations/remarks-summary — customer experience totals.
router.get('/remarks-summary', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [];
    const condition = applyClientScope(req, params, 'r');
    const result = await db.query(
      `SELECT
         COUNT(*)::int AS surveys_sent,
         COUNT(*) FILTER (WHERE response_key IS NOT NULL)::int AS responses,
         COUNT(*) FILTER (WHERE response_key = 'excellent')::int AS excellent,
         COUNT(*) FILTER (WHERE response_key = 'okay')::int AS okay,
         COUNT(*) FILTER (WHERE response_key = 'need_help')::int AS need_help,
         COUNT(*) FILTER (WHERE requires_followup = TRUE AND reviewed_at IS NULL)::int AS pending_followup,
         ROUND(COALESCE(AVG(score) FILTER (WHERE score IS NOT NULL), 0), 1)::float AS average_score
       FROM client_remarks r
       WHERE ${condition}`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /escalations/remarks-summary error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/escalations/remarks-list — end-of-chat experience feedback.
router.get('/remarks-list', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [];
    const condition = applyClientScope(req, params, 'r');
    const result = await db.query(
      `SELECT r.id, r.conversation_id, r.customer_name, r.requested_at,
              r.response_key, r.response_label, r.score, r.responded_at,
              r.requires_followup, r.reviewed_at, c.status AS conversation_status
       FROM client_remarks r
       JOIN conversations c ON c.id = r.conversation_id
       WHERE ${condition}
       ORDER BY COALESCE(r.responded_at, r.requested_at) DESC
       LIMIT 250`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /escalations/remarks-list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/escalations/remarks/:id/review — clear an attention-required remark.
router.patch('/remarks/:id/review', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [req.params.id];
    let where = 'id = $1';
    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where += ` AND client_id = $${params.length}`;
    }
    const result = await db.query(
      `UPDATE client_remarks SET reviewed_at = NOW() WHERE ${where} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Remark not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /escalations/remarks/:id/review error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/escalations
router.get('/', async (req, res) => {
  try {
    const { status, type } = req.query;
    const conditions = [];
    const params = [];

    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      conditions.push(`e.client_id = $${params.length}`);
    }

    if (status === 'open') conditions.push('e.resolved_at IS NULL');
    else if (status === 'resolved') conditions.push('e.resolved_at IS NOT NULL');

    if (type === 'human' || type === 'installation' || type === 'complaint') {
      params.push(type);
      conditions.push(`e.type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT
         e.id, e.conversation_id, e.customer_phone, e.customer_name, e.customer_email,
         e.trigger_message, e.support_number, e.notify_status, e.notify_error,
         e.request_email_status, e.request_email_error,
         e.confirmation_email_status, e.confirmation_email_error,
         e.resolved_at, e.created_at, e.type, e.summary,
         c.status AS conversation_status
       FROM escalations e
       JOIN conversations c ON c.id = e.conversation_id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /escalations error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/escalations/:id/resolve
router.patch('/:id/resolve', async (req, res) => {
  try {
    const ownership = await db.query(`SELECT client_id FROM escalations WHERE id = $1`, [req.params.id]);
    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Escalation not found' });
    }
    if (!req.scope.isSuperadmin && ownership.rows[0].client_id !== req.scope.clientId) {
      return res.status(404).json({ error: 'Escalation not found' });
    }

    const result = await db.query(
      `UPDATE escalations SET resolved_at = NOW()
       WHERE id = $1 AND resolved_at IS NULL
       RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Escalation not found or already resolved' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /escalations/:id/resolve error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;