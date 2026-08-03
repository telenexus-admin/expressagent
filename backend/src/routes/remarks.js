const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { ensureRemarksSchema } = require('../services/clientRemarks');

router.use(authMiddleware, scopeMiddleware);

function scopeWhere(req, params) {
  if (!req.scope.isSuperadmin || req.scope.clientId) {
    params.push(req.scope.clientId);
    return `r.client_id = $${params.length}`;
  }
  return 'TRUE';
}

router.get('/', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [];
    const where = scopeWhere(req, params);
    const result = await db.query(
      `SELECT r.id, r.conversation_id, r.customer_name, r.requested_at, r.response_key, r.response_label, r.score, r.responded_at, r.requires_followup, r.reviewed_at, c.status AS conversation_status FROM client_remarks r JOIN conversations c ON c.id = r.conversation_id WHERE ${where} ORDER BY COALESCE(r.responded_at, r.requested_at) DESC LIMIT 250`, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /remarks error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [];
    const where = scopeWhere(req, params);
    const result = await db.query(
      `SELECT COUNT(*)::int AS surveys_sent, COUNT(*) FILTER (WHERE response_key IS NOT NULL)::int AS responses, COUNT(*) FILTER (WHERE response_key = 'excellent')::int AS excellent, COUNT(*) FILTER (WHERE response_key = 'okay')::int AS okay, COUNT(*) FILTER (WHERE response_key = 'need_help')::int AS need_help, COUNT(*) FILTER (WHERE requires_followup = TRUE AND reviewed_at IS NULL)::int AS pending_followup, ROUND(COALESCE(AVG(score) FILTER (WHERE score IS NOT NULL), 0), 1)::float AS average_score FROM client_remarks r WHERE ${where}`, params);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /remarks/summary error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/review', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [req.params.id];
    let where = 'id = $1';
    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where += ` AND client_id = $${params.length}`;
    }
    const result = await db.query(`UPDATE client_remarks SET reviewed_at = NOW() WHERE ${where} RETURNING *`, params);
    if (!result.rows[0]) return res.status(404).json({ error: 'Remark not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /remarks/:id/review error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
