const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { synthesizeVoice } = require('../services/openai');
const { testEmailConfig } = require('../services/email');
const {
  ensureOperatorAgentTables,
  getOperatorSettings,
  sendEvolutionText,
  sendEvolutionVoiceNote,
} = require('../services/evolution');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function operatorEmailConfig(body = {}, current = {}) {
  const host = clean(body.email_smtp_host) || current.email_smtp_host || '';
  const port = Number(body.email_smtp_port || current.email_smtp_port || 465);
  const fromAddress = normalizeEmail(body.email_from_address || current.email_from_address);
  const replyTo = normalizeEmail(body.email_reply_to || current.email_reply_to || fromAddress);
  const username = clean(body.email_smtp_username) || current.email_smtp_username || '';
  const password = clean(body.email_smtp_password) || '';
  return {
    email_provider: 'resend',
    email_enabled: body.email_enabled === undefined ? current.email_enabled === true : Boolean(body.email_enabled),
    email_from_name: clean(body.email_from_name) || current.email_from_name || 'Nexa',
    email_from_address: fromAddress,
    email_reply_to: replyTo,
    email_smtp_host: host,
    email_smtp_port: Number.isInteger(port) ? port : 465,
    email_smtp_secure: body.email_smtp_secure === undefined ? current.email_smtp_secure !== false : Boolean(body.email_smtp_secure),
    email_smtp_username: username,
    email_smtp_password: password,
    email_resend_api_key: clean(body.email_resend_api_key) || '',
  };
}

function validateOperatorEmailConfig(config, hasSavedPassword) {
  if (!config.email_enabled) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email_from_address)) return 'Enter a valid from email address';
  if (config.email_reply_to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email_reply_to)) return 'Enter a valid reply-to email address';
  if (!config.email_resend_api_key && !hasSavedPassword) return 'Resend API key is required';
  return null;
}

function hasSavedEmailSecret(config, current = {}) {
  return Boolean(current.email_resend_api_key);
}

function withTimeout(promise, ms, message) {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

function webhookUrl(req, secret) {
  const publicBase = String(process.env.PUBLIC_BACKEND_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${publicBase}/webhook/evolution/nexa?token=${encodeURIComponent(secret)}`;
}

router.get('/config', async (req, res) => {
  try {
    const settings = await getOperatorSettings();
    res.json({ ...settings, webhook_url: webhookUrl(req, settings.webhook_secret) });
  } catch (err) {
    console.error('GET /operator-agent/config error:', err.message);
    res.status(500).json({ error: 'Failed to load Nexa WhatsApp configuration' });
  }
});

router.put('/config', [
  body('enabled').optional().isBoolean(),
  body('evolution_base_url').optional({ checkFalsy: true }).isURL({ require_tld: false }).withMessage('Enter a valid Evolution API URL'),
  body('evolution_instance').optional().isString().isLength({ max: 120 }),
  body('evolution_api_key').optional().isString(),
  body('agent_name').optional().isString().isLength({ max: 80 }),
  body('system_prompt').optional().isString().isLength({ min: 20 }),
  body('owner_phone').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Enter a valid owner phone number'),
  body('email_provider').optional().isIn(['smtp', 'resend']),
  body('email_enabled').optional().isBoolean(),
  body('email_from_name').optional({ checkFalsy: true }).isString().isLength({ max: 160 }),
  body('email_from_address').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid from email address'),
  body('email_reply_to').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid reply-to email address'),
  body('email_smtp_host').optional({ checkFalsy: true }).isString().isLength({ max: 180 }),
  body('email_smtp_port').optional({ checkFalsy: true }).isInt({ min: 1, max: 65535 }),
  body('email_smtp_secure').optional().isBoolean(),
  body('email_smtp_username').optional({ checkFalsy: true }).isString().isLength({ max: 180 }),
  body('email_smtp_password').optional({ checkFalsy: true }).isString(),
  body('email_resend_api_key').optional({ checkFalsy: true }).isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureOperatorAgentTables();
    const current = await getOperatorSettings({ includeKey: true });
    const emailConfig = operatorEmailConfig(req.body, current);
    const emailValidation = validateOperatorEmailConfig(emailConfig, hasSavedEmailSecret(emailConfig, current));
    if (emailValidation) return res.status(400).json({ error: emailValidation });
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
       evolution_api_key = $4, agent_name = $5, system_prompt = $6, owner_phone = $7,
       email_provider = $8, email_enabled = $9, email_from_name = $10, email_from_address = $11, email_reply_to = $12,
       email_smtp_host = $13, email_smtp_port = $14, email_smtp_secure = $15,
       email_smtp_username = $16, email_smtp_password = COALESCE(NULLIF($17, ''), email_smtp_password),
       email_resend_api_key = COALESCE(NULLIF($18, ''), email_resend_api_key),
       email_configured_at = CASE WHEN $9 THEN NOW() ELSE email_configured_at END,
       updated_at = NOW() WHERE id = 1`,
      [
        values.enabled, values.evolution_base_url, values.evolution_instance, values.evolution_api_key,
        values.agent_name, values.system_prompt, values.owner_phone,
        emailConfig.email_provider, emailConfig.email_enabled, emailConfig.email_from_name, emailConfig.email_from_address || null,
        emailConfig.email_reply_to || null, emailConfig.email_smtp_host || null, emailConfig.email_smtp_port || null,
        emailConfig.email_smtp_secure, emailConfig.email_smtp_username || null, emailConfig.email_smtp_password,
        emailConfig.email_resend_api_key,
      ]
    );
    const saved = await getOperatorSettings();
    res.json({ ...saved, webhook_url: webhookUrl(req, saved.webhook_secret) });
  } catch (err) {
    console.error('PUT /operator-agent/config error:', err.message);
    res.status(500).json({ error: 'Failed to save Nexa WhatsApp configuration' });
  }
});

router.post('/email-test', [
  body('to').isEmail().withMessage('Enter a valid test email address'),
  body('email_provider').optional().isIn(['smtp', 'resend']),
  body('email_enabled').optional().isBoolean(),
  body('email_from_name').optional({ checkFalsy: true }).isString().isLength({ max: 160 }),
  body('email_from_address').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid from email address'),
  body('email_reply_to').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid reply-to email address'),
  body('email_smtp_host').optional({ checkFalsy: true }).isString().isLength({ max: 180 }),
  body('email_smtp_port').optional({ checkFalsy: true }).isInt({ min: 1, max: 65535 }),
  body('email_smtp_secure').optional().isBoolean(),
  body('email_smtp_username').optional({ checkFalsy: true }).isString().isLength({ max: 180 }),
  body('email_smtp_password').optional({ checkFalsy: true }).isString(),
  body('email_resend_api_key').optional({ checkFalsy: true }).isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const current = await getOperatorSettings({ includeKey: true });
    const config = operatorEmailConfig({ ...req.body, email_enabled: true }, current);
    config.email_smtp_password = config.email_smtp_password || current.email_smtp_password;
    config.email_resend_api_key = config.email_resend_api_key || current.email_resend_api_key;
    const validation = validateOperatorEmailConfig(config, Boolean(config.email_resend_api_key));
    if (validation) return res.status(400).json({ error: validation });
    const result = await withTimeout(
      testEmailConfig(config, normalizeEmail(req.body.to)),
      30000,
      'Email test timed out after 30 seconds. Check the provider settings, API key, domain verification, or network access.'
    );
    if (result.status !== 'sent') return res.status(400).json({ error: result.error || 'Test email failed' });
    res.json({ success: true, status: result.status, id: result.id || null });
  } catch (err) {
    console.error('POST /operator-agent/email-test error:', err.message);
    res.status(500).json({ error: `Email could not be sent: ${err.message}` });
  }
});

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

router.post('/test-message', [body('phone').matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Enter a valid test WhatsApp number')], async (req, res) => {
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
});

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

router.get('/conversations/:id', async (req, res) => {
  try {
    await ensureOperatorAgentTables();
    const conversation = await db.query(`SELECT * FROM operator_conversations WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (!conversation.rows[0]) return res.status(404).json({ error: 'Conversation not found' });
    const messages = await db.query(
      `SELECT id, role, content, timestamp FROM operator_messages WHERE conversation_id = $1 ORDER BY timestamp ASC LIMIT 500`,
      [req.params.id]
    );
    res.json({ conversation: conversation.rows[0], messages: messages.rows });
  } catch (err) {
    console.error('GET /operator-agent/conversations/:id error:', err.message);
    res.status(500).json({ error: 'Failed to load Nexa chat' });
  }
});

router.patch('/conversations/:id', [
  body('ai_enabled').optional().isBoolean(),
  body('reply_mode').optional().isIn(['auto', 'text', 'voice', 'silent']),
  body('internal_note').optional().isString().isLength({ max: 1000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureOperatorAgentTables();
    const result = await db.query(
      `UPDATE operator_conversations SET
         ai_enabled = COALESCE($1, ai_enabled),
         reply_mode = COALESCE($2, reply_mode),
         internal_note = COALESCE($3, internal_note),
         updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [req.body.ai_enabled, req.body.reply_mode, req.body.internal_note, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Conversation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /operator-agent/conversations/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update conversation controls' });
  }
});

router.post('/conversations/:id/send', [
  body('content').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('Type a message first.'),
  body('mode').optional().isIn(['text', 'voice']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureOperatorAgentTables();
    const convResult = await db.query(`SELECT * FROM operator_conversations WHERE id = $1 LIMIT 1`, [req.params.id]);
    const conversation = convResult.rows[0];
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const settings = await getOperatorSettings({ includeKey: true });
    const content = clean(req.body.content);
    const mode = req.body.mode || 'text';
    if (mode === 'voice') {
      const audio = await synthesizeVoice(content, 'alloy');
      await sendEvolutionVoiceNote(settings, conversation.customer_phone, audio);
    } else {
      await sendEvolutionText(settings, conversation.customer_phone, content);
    }
    const stored = mode === 'voice' ? `[Manual voice reply] ${content}` : content;
    const inserted = await db.query(
      `INSERT INTO operator_messages (conversation_id, role, content, timestamp) VALUES ($1, 'admin', $2, NOW()) RETURNING *`,
      [conversation.id, stored]
    );
    await db.query(`UPDATE operator_conversations SET updated_at = NOW() WHERE id = $1`, [conversation.id]);
    res.json(inserted.rows[0]);
  } catch (err) {
    console.error('POST /operator-agent/conversations/:id/send error:', err.message);
    res.status(500).json({ error: 'Failed to send operator message' });
  }
});

module.exports = router;
