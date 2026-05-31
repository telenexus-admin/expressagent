const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { ensureEvoOnboardingTable, refreshOnboarding } = require('../services/evoSelfOnboarding');
const { DEFAULT_SYSTEM_PROMPT } = require('../services/ispKnowledge');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

router.get('/', async (_req, res) => {
  try {
    await ensureEvoOnboardingTable();
    const result = await db.query(
      `SELECT e.id, e.business_name, e.owner_name, e.phone, e.email, e.location, e.service_interest,
              e.instance_name, e.status, e.connection_method, e.connection_state, e.connected_number,
              e.connected_at, e.provider_error, e.created_at, e.updated_at, e.reviewed_at,
              c.id AS workspace_client_id, c.agent_name AS workspace_agent_name,
              c.support_number AS workspace_support_number, a.email AS dashboard_admin_email
       FROM evo_client_onboardings e
       LEFT JOIN clients c ON c.connection_provider = 'evolution' AND c.evolution_instance_name = e.instance_name
       LEFT JOIN LATERAL (
         SELECT email FROM admins WHERE client_id = c.id AND role = 'admin' ORDER BY created_at ASC LIMIT 1
       ) a ON TRUE
       WHERE e.status != 'archived'
       ORDER BY e.created_at DESC
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
       SET status = $1::varchar,
           reviewed_at = CASE
             WHEN $1::varchar IN ('reviewed', 'active') THEN COALESCE(reviewed_at, NOW())
             ELSE reviewed_at
           END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.body.status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Evolution client not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /evo-clients/:id/status error:', err.message);
    res.status(500).json({ error: 'Failed to update Evolution client status' });
  }
});

router.post(
  '/:id/workspace',
  [
    body('agent_name').trim().isLength({ min: 2, max: 80 }).withMessage('Agent name is required'),
    body('support_number').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Enter a valid support number'),
    body('system_prompt').optional().isString(),
    body('opening_message').optional().isString(),
    body('photo_troubleshooting_enabled').optional().isBoolean(),
    body('admin_name').trim().notEmpty().withMessage('Dashboard admin name is required'),
    body('admin_email').isEmail().normalizeEmail().withMessage('A valid dashboard email is required'),
    body('admin_password').isLength({ min: 8 }).withMessage('Dashboard password must be at least 8 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    await ensureEvoOnboardingTable();
    const trx = await db.connect();
    try {
      await trx.query('BEGIN');
      const signupResult = await trx.query(`SELECT * FROM evo_client_onboardings WHERE id = $1 FOR UPDATE`, [req.params.id]);
      const signup = signupResult.rows[0];
      if (!signup) {
        await trx.query('ROLLBACK');
        return res.status(404).json({ error: 'Evolution client not found' });
      }
      if (!['reviewed', 'active'].includes(signup.status)) {
        await trx.query('ROLLBACK');
        return res.status(400).json({ error: 'Mark this connected client as reviewed before creating a workspace.' });
      }
      const existing = await trx.query(`SELECT id FROM clients WHERE evolution_instance_name = $1 LIMIT 1`, [signup.instance_name]);
      if (existing.rows[0]) {
        await trx.query('ROLLBACK');
        return res.status(409).json({ error: 'A client workspace already exists for this WhatsApp connection.' });
      }

      const webhookSecret = crypto.randomBytes(32).toString('hex');
      const insertedClient = await trx.query(
        `INSERT INTO clients (
          name, business_name, contact_email, status, connection_provider,
          evolution_instance_name, evolution_webhook_secret, support_number,
          system_prompt, agent_name, voice_id, opening_message, photo_troubleshooting_enabled
        ) VALUES ($1, $2, $3, 'active', 'evolution', $4, $5, $6, $7, $8, 'alloy', $9, $10)
        RETURNING id, name, business_name, connection_provider, evolution_instance_name, agent_name, support_number`,
        [
          signup.business_name,
          signup.business_name,
          signup.email,
          signup.instance_name,
          webhookSecret,
          String(req.body.support_number || signup.phone || '').trim() || null,
          String(req.body.system_prompt || '').trim() || DEFAULT_SYSTEM_PROMPT,
          req.body.agent_name.trim(),
          String(req.body.opening_message || '').trim() || null,
          req.body.photo_troubleshooting_enabled !== false,
        ]
      );
      const client = insertedClient.rows[0];
      const hash = await bcrypt.hash(req.body.admin_password, 12);
      const adminResult = await trx.query(
        `INSERT INTO admins (name, email, password_hash, role, client_id)
         VALUES ($1, $2, $3, 'admin', $4)
         RETURNING id, name, email, role, client_id`,
        [req.body.admin_name.trim(), req.body.admin_email, hash, client.id]
      );
      await trx.query(
        `UPDATE evo_client_onboardings SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [signup.id]
      );
      await trx.query('COMMIT');
      return res.status(201).json({
        client,
        admin: adminResult.rows[0],
        dashboard_url: '/login',
        message: 'Dashboard workspace created. Evolution AI message routing still needs webhook activation.',
      });
    } catch (err) {
      await trx.query('ROLLBACK');
      if (err.code === '23505') {
        if (String(err.constraint || '').includes('email')) return res.status(409).json({ error: 'This dashboard email is already in use.' });
        return res.status(409).json({ error: 'A workspace already exists for this client connection.' });
      }
      console.error('POST /evo-clients/:id/workspace error:', err.message);
      return res.status(500).json({ error: 'Failed to create the client workspace.' });
    } finally {
      trx.release();
    }
  }
);

module.exports = router;
