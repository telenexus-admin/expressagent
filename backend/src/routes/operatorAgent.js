const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { ensureOperatorAgentTables, getOperatorSettings, sendEvolutionText } = require('../services/evolution');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function webhookUrl(req, secret) {
  const publicBase = String(process.env.PUBLIC_BACKEND_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${publicBase}/webhook/evolution/nexa?token=${encodeURIComponent(secret)}`;
}

router.get('/config', async (req, res) => {
  try {
    const settings = await getOperatorSettings();
    res.json({
      ...settings,
      webhook_url: webhookUrl(req, settings.webhook_secret),
    });
  } catch (err) {
    console.error('GET /operator-agent/config error:', err.message);
    res.status(500).json({ error: 'Failed to load Nexa WhatsApp configuration' });
  }
});

router.put(
  '/config',
  [
    body('enabled').optional().isBoolean(),
    body('evolution_base_url').optional({ checkFalsy: true }).isURL({ require_tld: false }).withMessage('Enter a valid Evolution API URL'),
    body('evolution_instance').optional().isString().isLength({ max: 120 }),
    body('evolution_api_key').optional().isString(),
    body('agent_name').optional().isString().isLength({ max: 80 }),
    body('system_prompt').optional().isString().isLength({ min: 20 }),
    body('owner_phone').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Enter a valid owner phone number'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await ensureOperatorAgentTables();
      const current = await getOperatorSettings({ includeKey: true });
      const values = {
        enabled: req.body.enabled !== undefined ? Boolean(req.body.enabled) : current.enabled,
        evolution_base_url: req.body.evolution_base_url !== undefined ? clean(req.body.evolution_base_url) || null : current.evolution_base_url,
        evolution_instance: req.body.evolution_instance !== undefined ? clean(req.body.evolution_instance) || null : current.evolution_instance,
        evolution_api_key: req.body.evolution_api_key !== undefined && clean(req.body.evolution_api_key) ? clean(req.body.evolution_api_key) : current.evolution_api_key,
        agent_name: req.body.agent_name !== undefined ? clean(req.body.agent_name) || 'Nexa' : current.agent_name,
        system_prompt: req.body.system_prompt !== undefined ? clean(req.body.system_prompt) : current.system_prompt,
        owner_phone: req.body.owner_phone !== undefined ? clean(req.body.owner_phone) || null : current.owner_phone,
      };
      if (values.enabled && (!values.evolution_base_url || !values.evolution_instance || !values.evolution_api_key)) {
        return res.status(400).json({ error: 'Enter the Evolution API URL, instance name and API key before switching Nexa live.' });
      }
      await db.query(
        `UPDATE operator_agent_settings SET enabled = $1, evolution_base_url = $2, evolution_instance = $3,
          evolution_api_key = $4, agent_name = $5, system_prompt = $6, owner_phone = $7, updated_at = NOW()
         WHERE id = 1`,
        [values.enabled, values.evolution_base_url, values.evolution_instance, values.evolution_api_key, values.agent_name, values.system_prompt, values.owner_phone]
      );
      const saved = await getOperatorSettings();
      res.json({ ...saved, webhook_url: webhookUrl(req, saved.webhook_secret) });
    } catch (err) {
      console.error('PUT /operator-agent/config error:', err.message);
      res.status(500).json({ error: 'Failed to save Nexa WhatsApp configuration' });
    }
  }
);

router.post('/regenerate-webhook-secret', async (req, res) => {
  try {
    await ensureOperatorAgentTables();
    const secret = crypto.randomBytes(30).toString('hex');
    await db.query(`UPDATE operator_agent_settings SET webhook_secret = $1, updated_at = NOW() WHERE id = 1`, [secret]);
    res.json({ webhook_url: webhookUrl(req, secret) });
  } catch (err) {
    console.error('POST /operator-agent/regenerate-webhook-secret error:', err.message);
    res.status(500).json({ error: 'Failed to regenerate webhook URL' });
  }
});

router.post(
  '/test-message',
  [body('phone').matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Enter a valid test WhatsApp number')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const settings = await getOperatorSettings({ includeKey: true });
      await sendEvolutionText(settings, req.body.phone, `Hello! This is ${settings.agent_name || 'Nexa'}. Your Evolution API connection is working successfully.`);
      res.json({ success: true });
    } catch (err) {
      const message = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message);
      console.error('POST /operator-agent/test-message error:', message);
      res.status(500).json({ error: `Test WhatsApp message failed: ${message}` });
    }
  }
);

router.get('/conversations', async (_req, res) => {
  try {
    await ensureOperatorAgentTables();
    const result = await db.query(
      `SELECT c.*, latest.content AS last_message, latest.timestamp AS last_message_at,
              (SELECT COUNT(*)::int FROM operator_messages m WHERE m.conversation_id = c.id) AS message_count
       FROM operator_conversations c
       LEFT JOIN LATERAL (
         SELECT content, timestamp FROM operator_messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1
       ) latest ON true
       ORDER BY COALESCE(latest.timestamp, c.updated_at) DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /operator-agent/conversations error:', err.message);
    res.status(500).json({ error: 'Failed to load Nexa conversations' });
  }
});

module.exports = router;
