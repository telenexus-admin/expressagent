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
const {
  createClientSubdomain,
  ensureClientDomainSchema,
  getDomainSettings,
  saveDomainSettings,
  verifyClientDomain,
} = require('../services/clientDomains');

router.use(authMiddleware, superadminMiddleware);

const ALLOWED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const ALLOWED_CONNECTION_PROVIDERS = ['meta', 'evolution', 'website'];
const MIN_META_ACCESS_TOKEN_LENGTH = 50;
const OPERATOR_ACCESS_PERMISSIONS = [
  'statistics',
  'conversations',
  'tickets',
  'invoices',
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

let providerSchemaReady;

async function ensureProviderSchema() {
  if (!providerSchemaReady) {
    providerSchemaReady = db.query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS connection_provider VARCHAR(20) NOT NULL DEFAULT 'meta';
      ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_connection_provider_check;
      ALTER TABLE clients ADD CONSTRAINT clients_connection_provider_check CHECK (connection_provider IN ('meta', 'evolution', 'website'));
    `);
  }
  await providerSchemaReady;
  await ensureClientDomainSchema();
  await db.query(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS official_whatsapp_number VARCHAR(80);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS official_contact_name VARCHAR(160);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS update_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS update_contact_updated_at TIMESTAMP WITH TIME ZONE;
    CREATE INDEX IF NOT EXISTS idx_clients_official_whatsapp ON clients(official_whatsapp_number);
  `);
}

function normalizeConnectionProvider(value) {
  const provider = String(value || 'meta').trim().toLowerCase();
  return ALLOWED_CONNECTION_PROVIDERS.includes(provider) ? provider : 'meta';
}

function requiresMetaCredentials(req) {
  return normalizeConnectionProvider(req.body.connection_provider) === 'meta';
}

function validateMetaPhoneNumber(value, { req }) {
  const phoneNumberId = String(value || '').trim();
  if (requiresMetaCredentials(req) && !phoneNumberId) {
    throw new Error('Meta phone_number_id is required for Meta WhatsApp clients');
  }
  return true;
}

function validateMetaAccessToken(value, { req }) {
  const token = String(value || '').trim();
  if (requiresMetaCredentials(req) && !token) {
    throw new Error('Meta access token is required for Meta WhatsApp clients');
  }
  if (token && token.length < MIN_META_ACCESS_TOKEN_LENGTH) {
    throw new Error('Meta access token looks too short. Paste the full token from Meta.');
  }
  return true;
}

// GET /api/clients — list all clients with admin counts
router.get('/', async (_req, res) => {
  try {
    await ensureProviderSchema();
    const result = await db.query(
      `SELECT
         c.id, c.name, c.business_name, c.contact_email, c.status, c.connection_provider,
         c.meta_phone_number_id, c.meta_business_account_id,
         c.support_number, c.agent_name, c.voice_id, c.photo_troubleshooting_enabled, c.created_at,
         c.official_whatsapp_number, c.official_contact_name, c.update_notifications_enabled, c.update_contact_updated_at,
         (SELECT COUNT(*)::int FROM admins WHERE client_id = c.id) AS admin_count,
         (SELECT COUNT(*)::int FROM conversations WHERE client_id = c.id) AS conversation_count,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', d.id,
                 'domain', d.domain,
                 'slug', d.slug,
                 'status', d.status,
                 'domain_type', d.domain_type,
                 'ssl_status', d.ssl_status,
                 'last_checked_at', d.last_checked_at,
                 'error', d.error
               )
               ORDER BY d.created_at DESC
             )
             FROM client_domains d
             WHERE d.client_id = c.id
           ),
           '[]'::jsonb
         ) AS domains
       FROM clients c
       ORDER BY c.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /clients error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/domain-settings/cloudflare', async (_req, res) => {
  try {
    const settings = await getDomainSettings();
    res.json(settings);
  } catch (err) {
    console.error('GET /clients/domain-settings/cloudflare error:', err.message);
    res.status(500).json({ error: 'Failed to load Cloudflare domain settings' });
  }
});

router.put('/domain-settings/cloudflare', async (req, res) => {
  try {
    const settings = await saveDomainSettings(req.body || {});
    await logActivity({
      req,
      action: 'cloudflare_domain_settings_updated',
      entityType: 'operator_domain_settings',
      entityId: 1,
      description: `${req.user.name || 'Operator'} updated Cloudflare automatic domain settings.`,
      metadata: { root_domain: settings.root_domain, target_domain: settings.target_domain, proxied: settings.proxied },
    });
    res.json(settings);
  } catch (err) {
    console.error('PUT /clients/domain-settings/cloudflare error:', err.message);
    res.status(500).json({ error: 'Failed to save Cloudflare domain settings' });
  }
});

// GET /api/clients/:id — full client incl. webhook config
router.get('/:id', async (req, res) => {
  try {
    await ensureProviderSchema();
    const result = await db.query(
      `SELECT id, name, business_name, contact_email, status, connection_provider,
              meta_phone_number_id, meta_business_account_id, meta_verify_token,
              support_number, system_prompt, agent_name, voice_id, opening_message,
              photo_troubleshooting_enabled, official_whatsapp_number, official_contact_name,
              update_notifications_enabled, update_contact_updated_at, created_at
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

router.post('/:id/domain/create', async (req, res) => {
  try {
    await ensureProviderSchema();
    const result = await db.query(
      `SELECT id, name, business_name FROM clients WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const domain = await createClientSubdomain(client, req.body?.slug);
    await logActivity({
      req,
      action: 'client_domain_created',
      entityType: 'client',
      entityId: client.id,
      description: `${req.user.name || 'Operator'} created ${domain.domain} for ${client.name}.`,
      metadata: { client_id: client.id, domain: domain.domain, status: domain.status },
    });
    res.status(201).json(domain);
  } catch (err) {
    console.error('POST /clients/:id/domain/create error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to create client domain' });
  }
});

router.post('/:id/domain/:domainId/verify', async (req, res) => {
  try {
    await ensureProviderSchema();
    const result = await db.query(
      `SELECT * FROM client_domains WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [req.params.domainId, req.params.id]
    );
    const domain = result.rows[0];
    if (!domain) return res.status(404).json({ error: 'Client domain not found' });
    const verified = await verifyClientDomain(domain);
    res.json(verified);
  } catch (err) {
    console.error('POST /clients/:id/domain/:domainId/verify error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to verify client domain' });
  }
});

// POST /api/clients — create a new client + first admin login in one transaction
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Client name is required'),
    body('business_name').optional().trim(),
    body('contact_email').optional({ checkFalsy: true }).isEmail().withMessage('Valid contact email required'),
    body('connection_provider').optional().isIn(ALLOWED_CONNECTION_PROVIDERS).withMessage('Invalid connection provider'),
    body('meta_phone_number_id').custom(validateMetaPhoneNumber),
    body('meta_access_token').custom(validateMetaAccessToken),
    body('meta_business_account_id').optional().trim(),
    body('meta_verify_token').optional().trim(),
    body('support_number').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Invalid support phone number'),
    body('official_whatsapp_number').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Invalid official update WhatsApp number'),
    body('official_contact_name').optional({ checkFalsy: true }).isString().isLength({ max: 160 }).withMessage('Official contact name max 160 chars'),
    body('update_notifications_enabled').optional().isBoolean().withMessage('Update notification setting must be true or false'),
    body('system_prompt').optional().isString(),
    body('agent_name').optional().isLength({ max: 80 }).withMessage('Agent name max 80 chars'),
    body('voice_id').optional().isIn(ALLOWED_VOICES).withMessage(`Voice must be one of ${ALLOWED_VOICES.join(', ')}`),
    body('opening_message').optional().isString(),
    body('photo_troubleshooting_enabled').optional().isBoolean().withMessage('Photo troubleshooting must be true or false'),
    body('auto_create_domain').optional().isBoolean().withMessage('Auto-create domain must be true or false'),
    body('domain_slug').optional().trim().isLength({ max: 80 }).withMessage('Domain slug max 80 chars'),
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
      connection_provider,
      meta_phone_number_id,
      meta_access_token,
      meta_business_account_id,
      meta_verify_token,
      support_number,
      official_whatsapp_number,
      official_contact_name,
      update_notifications_enabled,
      system_prompt,
      agent_name,
      voice_id,
      opening_message,
      photo_troubleshooting_enabled,
      auto_create_domain,
      domain_slug,
      admin_name,
      admin_email,
      admin_password,
    } = req.body;

    const client = await db.connect();
    try {
      await ensureProviderSchema();
      await client.query('BEGIN');

      const verifyToken = (meta_verify_token || '').trim() || genVerifyToken();
      const provider = normalizeConnectionProvider(connection_provider);

      const insertedClient = await client.query(
        `INSERT INTO clients (
           name, business_name, contact_email, status, connection_provider,
           meta_phone_number_id, meta_access_token, meta_business_account_id, meta_verify_token,
           support_number, official_whatsapp_number, official_contact_name, update_notifications_enabled, update_contact_updated_at,
           system_prompt, agent_name, voice_id, opening_message, photo_troubleshooting_enabled
         ) VALUES (
           $1, $2, $3, 'active', $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12, CASE WHEN $10 IS NULL THEN NULL ELSE NOW() END,
           $13, $14, $15, $16, $17
         ) RETURNING id, name, business_name, contact_email, status, connection_provider,
                    meta_phone_number_id, meta_business_account_id, meta_verify_token,
                    support_number, official_whatsapp_number, official_contact_name, update_notifications_enabled,
                    agent_name, voice_id, photo_troubleshooting_enabled, created_at`,
        [
          name.trim(),
          (business_name || '').trim() || null,
          (contact_email || '').trim() || null,
          provider,
          (meta_phone_number_id || '').trim() || null,
          (meta_access_token || '').trim() || null,
          (meta_business_account_id || '').trim() || null,
          verifyToken,
          (support_number || '').trim() || null,
          (official_whatsapp_number || '').replace(/[^0-9]/g, '') || null,
          (official_contact_name || '').trim() || null,
          update_notifications_enabled !== false,
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

      let domain = null;
      let domainError = null;
      if (auto_create_domain === true) {
        try {
          domain = await createClientSubdomain(newClient, domain_slug);
          await logActivity({
            req,
            action: 'client_domain_created',
            module: 'onboarding',
            entityType: 'client_domain',
            entityId: domain.id,
            description: `${req.user.name || 'Operator'} created ${domain.domain} while onboarding ${newClient.name}.`,
            metadata: { client_id: newClient.id, domain: domain.domain, status: domain.status },
          });
        } catch (domainErr) {
          domainError = domainErr.message;
          console.error('Automatic client domain creation failed:', domainErr.message);
        }
      }

      res.status(201).json({ client: newClient, admin: insertedAdmin.rows[0], domain, domain_error: domainError });
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
    body('connection_provider').optional().isIn(ALLOWED_CONNECTION_PROVIDERS).withMessage('Invalid connection provider'),
    body('meta_phone_number_id').optional({ nullable: true }).custom(validateMetaPhoneNumber),
    body('meta_access_token').optional({ nullable: true, checkFalsy: true }).custom(validateMetaAccessToken),
    body('meta_business_account_id').optional().trim(),
    body('meta_verify_token').optional().trim().notEmpty(),
    body('support_number').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/),
    body('official_whatsapp_number').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/),
    body('official_contact_name').optional({ checkFalsy: true }).isString().isLength({ max: 160 }),
    body('update_notifications_enabled').optional().isBoolean(),
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
      'name', 'business_name', 'contact_email', 'status', 'connection_provider',
      'meta_phone_number_id', 'meta_access_token', 'meta_business_account_id', 'meta_verify_token',
      'support_number', 'system_prompt', 'agent_name', 'voice_id', 'opening_message',
      'photo_troubleshooting_enabled', 'official_whatsapp_number', 'official_contact_name', 'update_notifications_enabled',
    ];

    const updates = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const raw = req.body[key];
        const val = key === 'official_whatsapp_number'
          ? String(raw || '').replace(/[^0-9]/g, '')
          : typeof raw === 'string' ? raw.trim() : raw;
        params.push(val === '' ? null : val);
        updates.push(`${key} = $${params.length}`);
      }
    }

    if (req.body.official_whatsapp_number !== undefined || req.body.official_contact_name !== undefined || req.body.update_notifications_enabled !== undefined) {
      updates.push('update_contact_updated_at = NOW()');
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    try {
      await ensureProviderSchema();
      params.push(req.params.id);
      const result = await db.query(
        `UPDATE clients SET ${updates.join(', ')} WHERE id = $${params.length}
         RETURNING id, name, business_name, contact_email, status, connection_provider,
                   meta_phone_number_id, meta_business_account_id, meta_verify_token,
                   support_number, official_whatsapp_number, official_contact_name, update_notifications_enabled,
                   agent_name, voice_id, photo_troubleshooting_enabled, created_at`,
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
