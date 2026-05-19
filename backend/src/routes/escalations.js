const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

router.use(authMiddleware, scopeMiddleware);

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
         e.id, e.conversation_id, e.customer_phone, e.customer_name,
         e.trigger_message, e.support_number, e.notify_status, e.notify_error,
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
