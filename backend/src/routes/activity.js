const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

router.use(authMiddleware, scopeMiddleware);

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const params = [];
    let where = '';

    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where = `WHERE client_id = $${params.length}`;
    }

    params.push(limit);
    const result = await db.query(
      `SELECT id, admin_id, admin_name, admin_email, action, entity_type, entity_id, description, metadata, created_at
       FROM admin_activity_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /activity error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
