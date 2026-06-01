const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { DEFAULT_SYSTEM_PROMPT } = require('../services/ispKnowledge');
const { logActivity } = require('../services/audit');

router.use(authMiddleware, superadminMiddleware);

const ALLOWED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const OPERATOR_ACCESS_PERMISSIONS = [
  'statistics',
  'conversations',
  'tickets',
  'billing',
  'communication',
  'escalations',
  'installations',
  'complaints',
  'ai_health',
  'admins',
  'employees',
  'workflow',
  'agent',
  'settings',
  'logs',
];

function genVerifyToken() {
  return crypto.randomBytes(24).toString('hex');
}

// GET /api/clients — list all clients with admin counts
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT
         c.id, c.name, c.business_name, c.contact_email, c.status,
         c.meta_phone_number_id, c.meta_business_account_id,
         c.support_number, c.agent_name, c.voice_id, c.photo_troubleshooting_enabled, c.created_at,
         (SELECT COUNT(*)::int FROM admins WHERE client_id = c.id) AS admin_count,
         (SELECT COUNT(*)::int FROM conversations WHERE client_id = c.id) AS conversation_count
       FROM clients c
       ORDER BY c.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /clients error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clients/:id — full client incl. webhook config
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, business_name, contact_email, status,
              meta_phone_number_id, meta_business_account_id, meta_verify_token,
              support_number, system_prompt, agent_name, voice_id, opening_message,
              photo_troubleshooting_enabled, created_at
       FROM clients WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /clients/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clients/:id/operator-access - short-lived dashboard session for support/configuration
router.post('/:id/operator-access', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, business_name, contact_email, status
       FROM clients
       WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = result.rows[0];
    if (client.status === 'suspended') {
      return res.status(403).json({ error: 'Client is suspended. Activate the client before opening their dashboard.' });
    }

    const operatorName = req.user.name || 'Nexa operator';
    const admin = {
      id: req.user.id,
      name: `${operatorName} (Operator Access)`,
      email: req.user.email,
      role: 'admin',
      client_id: client.id,
      client_name: client.name,
      client_business_name: client.business_name || null,
      permissions: OPERATOR_ACCESS_PERMISSIONS,
      operator_access: true,
      operator_id: req.user.id,
      operator_email: req.user.email,
      operator_name: req.user.name || null,
    };

    const token = jwt.sign(admin, process.env.JWT_SECRET, { expiresIn: '1h' });

    await logActivity({
      req,
      action: 'operator_client_access',
      entityType: 'client',
      entityId: client.id,
      description: `${operatorName} opened ${client.name}'s dashboard through operator access.`,
      metadata: { client_id: client.id, client_name: client.name },
    });

    res.json({
      token,
      admin,
      expires_in_seconds: 3600,
    });
  } catch (err) {
    console.error('POST /clients/:id/operator-access error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clients — create a new client + first admin login in one transaction
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Client name is required'),
    body('business_name').optional().trim(),
    body('contact_email').optional({ checkFalsy: true }).isEmail().withMessage('Valid contact email required'),
    body('meta_phone_number_id').trim().notEmpty().withMessage('Meta phone_number_id is required'),
    body('meta_access_token').trim().notEmpty().withMessage('Meta access token is required'),
    body('meta_business_account_id').optional().trim(),
    body('meta_verify_token').optional().trim(),
    body('support_number').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Invalid support phone number'),
    body('system_prompt').optional().isString(),
    body('agent_name').optional().isLength({ max: 80 }).withMessage('Agent name max 80 chars'),
    body('voice_id').optional().isIn(ALLOWED_VOICES).withMessage(`Voice must be one of ${ALLOWED_VOICES.join(', ')}`),
    body('opening_message').optional().isString(),
    body('photo_troubleshooting_enabled').optional().isBoolean().withMessage('Photo troubleshooting must be true or false'),
    body('admin_name').trim().notEmpty().withMessage('Admin name is required'),
    body('admin_email').isEmail().normalizeEmail().withMessage('Valid admin email required'),
    body('admin_password').isLength({ min: 8 }).withMessage('Admin password must be at least 8 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      name,
      business_name,
      contact_email,
      meta_phone_number_id,
      meta_access_token,
      meta_business_account_id,
      meta_verify_token,
      support_number,
      system_prompt,
      agent_name,
      voice_id,
      opening_message,
      photo_troubleshooting_enabled,
      admin_name,
      admin_email,
      admin_password,
    } = req.body;

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const verifyToken = (meta_verify_token || '').trim() || genVerifyToken();

      const insertedClient = await client.query(
        `INSERT INTO clients (
           name, business_name, contact_email, status,
           meta_phone_number_id, meta_access_token, meta_business_account_id, meta_verify_token,
           support_number, system_prompt, agent_name, voice_id, opening_message, photo_troubleshooting_enabled
         ) VALUES (
           $1, $2, $3, 'active',
           $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13
         ) RETURNING id, name, business_name, contact_email, status,
                    meta_phone_number_id, meta_business_account_id, meta_verify_token,
                    support_number, agent_name, voice_id, photo_troubleshooting_enabled, created_at`,
        [
          name.trim(),
          (business_name || '').trim() || null,
          (contact_email || '').trim() || null,
          meta_phone_number_id.trim(),
          meta_access_token.trim(),
          (meta_business_account_id || '').trim() || null,
          verifyToken,
          (support_number || '').trim() || null,
          (system_prompt || '').trim() || DEFAULT_SYSTEM_PROMPT,
          (agent_name || '').trim() || null,
          (voice_id || 'alloy').trim(),
          (opening_message || '').trim() || null,
          photo_troubleshooting_enabled !== false,
        ]
      );

      const newClient = insertedClient.rows[0];

      const hash = await bcrypt.hash(admin_password, 12);
      const insertedAdmin = await client.query(
        `INSERT INTO admins (name, email, password_hash, role, client_id)
         VALUES ($1, $2, $3, 'admin', $4)
         RETURNING id, name, email, role, client_id, created_at`,
        [admin_name.trim(), admin_email, hash, newClient.id]
      );

      await client.query('COMMIT');
      res.status(201).json({ client: newClient, admin: insertedAdmin.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        if (err.constraint && err.constraint.includes('meta_phone_number_id')) {
          return res.status(409).json({ error: 'Another client is already using that Meta phone_number_id' });
        }
        if (err.constraint && err.constraint.includes('meta_verify_token')) {
          return res.status(409).json({ error: 'Another client is already using that verify token' });
        }
        if (err.constraint && err.constraint.includes('email')) {
          return res.status(409).json({ error: 'An admin with that email already exists' });
        }
        return res.status(409).json({ error: 'Duplicate value' });
      }
      console.error('POST /clients error:', err.message);
      res.status(500).json({ error: 'Server error' });
    } finally {
      client.release();
    }
  }
);

// PUT /api/clients/:id — update an existing client
router.put(
  '/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('business_name').optional().trim(),
    body('contact_email').optional({ checkFalsy: true }).isEmail(),
    body('status').optional().isIn(['active', 'suspended']),
    body('meta_phone_number_id').optional().trim().notEmpty(),
    body('meta_access_token').optional().trim().notEmpty(),
    body('meta_business_account_id').optional().trim(),
    body('meta_verify_token').optional().trim().notEmpty(),
    body('support_number').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/),
    body('system_prompt').optional().isString().notEmpty(),
    body('agent_name').optional().isLength({ max: 80 }),
    body('voice_id').optional().isIn(ALLOWED_VOICES),
    body('opening_message').optional().isString(),
    body('photo_troubleshooting_enabled').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const allowed = [
      'name', 'business_name', 'contact_email', 'status',
      'meta_phone_number_id', 'meta_access_token', 'meta_business_account_id', 'meta_verify_token',
      'support_number', 'system_prompt', 'agent_name', 'voice_id', 'opening_message',
      'photo_troubleshooting_enabled',
    ];

    const updates = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const raw = req.body[key];
        const val = typeof raw === 'string' ? raw.trim() : raw;
        params.push(val === '' ? null : val);
        updates.push(`${key} = $${params.length}`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    try {
      params.push(req.params.id);
      const result = await db.query(
        `UPDATE clients SET ${updates.join(', ')} WHERE id = $${params.length}
         RETURNING id, name, business_name, contact_email, status,
                   meta_phone_number_id, meta_business_account_id, meta_verify_token,
                   support_number, agent_name, voice_id, photo_troubleshooting_enabled, created_at`,
        params
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client not found' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Duplicate value (phone_number_id or verify_token already in use)' });
      }
      console.error('PUT /clients/:id error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// DELETE /api/clients/:id — cascades to admins/conversations/escalations
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM clients WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /clients/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
