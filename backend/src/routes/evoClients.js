const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { ensureEvoOnboardingTable, refreshOnboarding } = require('../services/evoSelfOnboarding');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

router.get('/', async (_req, res) => {
  try {
    await ensureEvoOnboardingTable();
    const result = await db.query(
      `SELECT id, business_name, owner_name, phone, email, location, service_interest,
              instance_name, status, connection_state, connected_number, connected_at,
              provider_error, created_at, updated_at, reviewed_at
       FROM evo_client_onboardings
       WHERE status != 'archived'
       ORDER BY created_at DESC
       LIMIT 300`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /evo-clients error:', err.message);
    res.status(500).json({ error: 'Failed to load Evolution clients' });
  }
});

router.get('/summary', async (_req, res) => {
  try {
    await ensureEvoOnboardingTable();
    const result = await db.query(
      `SELECT
        COUNT(*) FILTER (WHERE status != 'archived')::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending_qr')::int AS waiting_scan,
        COUNT(*) FILTER (WHERE status = 'connected')::int AS connected,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM evo_client_onboardings`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /evo-clients/summary error:', err.message);
    res.status(500).json({ error: 'Failed to load Evolution client summary' });
  }
});

router.post('/:id/refresh', async (req, res) => {
  try {
    await ensureEvoOnboardingTable();
    const result = await db.query(`SELECT * FROM evo_client_onboardings WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Evolution client not found' });
    const refreshed = await refreshOnboarding(result.rows[0]);
    res.json(refreshed);
  } catch (err) {
    console.error('POST /evo-clients/:id/refresh error:', err.message);
    res.status(500).json({ error: 'Failed to refresh connection status' });
  }
});

router.patch('/:id/status', [body('status').isIn(['reviewed', 'active', 'archived'])], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureEvoOnboardingTable();
    const result = await db.query(
      `UPDATE evo_client_onboardings
       SET status = $1, reviewed_at = CASE WHEN $1 IN ('reviewed', 'active') THEN COALESCE(reviewed_at, NOW()) ELSE reviewed_at END,
           updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [req.body.status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Evolution client not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /evo-clients/:id/status error:', err.message);
    res.status(500).json({ error: 'Failed to update Evolution client status' });
  }
});

module.exports = router;
