const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  ensureDarajaSchema,
  loadDarajaConfig,
  testDarajaConnection,
} = require('../services/daraja');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function targetClientId(req, res) {
  if (!req.scope?.isSuperadmin) {
    res.status(403).json({ error: 'Only the Polyizon operator can configure Daraja credentials' });
    return null;
  }
  const requested = Number(
    req.scope?.clientId || req.query.clientId || req.body?.client_id ||
    process.env.DEFAULT_CLIENT_ID || process.env.EXPRESSNET_CLIENT_ID || 0
  );
  if (!Number.isInteger(requested) || requested < 1) {
    res.status(400).json({ error: 'clientId is required for operator Daraja configuration' });
    return null;
  }
  return requested;
}

function safeConfig(config) {
  return {
    enabled: config.enabled === true,
    provider: 'daraja',
    shortcode: config.shortcode || '',
    environment: config.environment || 'production',
    transaction_type: config.transactionType || 'CustomerPayBillOnline',
    has_consumer_key: Boolean(config.consumerKey),
    has_consumer_secret: Boolean(config.consumerSecret),
    has_passkey: Boolean(config.passkey),
    callback_ready: Boolean(config.callbackSecret),
    configured_at: config.configuredAt || null,
  };
}

function normalizeEnvironment(value, fallback = 'production') {
  return String(value || fallback || 'production').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
}

function normalizeTransactionType(value, fallback = 'CustomerPayBillOnline') {
  const selected = String(value || fallback || 'CustomerPayBillOnline').trim();
  const allowed = new Set(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']);
  return allowed.has(selected) ? selected : null;
}

router.get('/', async (req, res) => {
  const clientId = targetClientId(req, res);
  if (!clientId) return;
  try {
    const config = await loadDarajaConfig(clientId);
    return res.json(safeConfig(config));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not load Daraja configuration' });
  }
});

router.put('/', async (req, res) => {
  const clientId = targetClientId(req, res);
  if (!clientId) return;
  try {
    await ensureDarajaSchema();
    const existing = await db.query(
      `SELECT mpesa_consumer_key,mpesa_consumer_secret,mpesa_shortcode,mpesa_passkey,
              mpesa_callback_secret,mpesa_environment,mpesa_transaction_type
       FROM clients WHERE id=$1 LIMIT 1`,
      [clientId]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: 'Billing account not found' });
    const row = existing.rows[0];

    const enabled = req.body.enabled === true;
    const consumerKey = String(req.body.consumer_key || req.body.mpesa_consumer_key || '').trim();
    const consumerSecret = String(req.body.consumer_secret || req.body.mpesa_consumer_secret || '').trim();
    const shortcode = String(req.body.shortcode || req.body.mpesa_shortcode || row.mpesa_shortcode || '').replace(/\D/g, '');
    const passkey = String(req.body.passkey || req.body.mpesa_passkey || '').trim();
    const environment = normalizeEnvironment(req.body.environment || req.body.mpesa_environment, row.mpesa_environment);
    const transactionType = normalizeTransactionType(req.body.transaction_type || req.body.mpesa_transaction_type, row.mpesa_transaction_type);
    if (!transactionType) return res.status(400).json({ error: 'Unsupported M-Pesa transaction type' });
    if (shortcode && !/^\d{5,12}$/.test(shortcode)) return res.status(400).json({ error: 'Enter a valid M-Pesa shortcode' });

    const finalKey = consumerKey || row.mpesa_consumer_key || process.env.DARAJA_CONSUMER_KEY || '';
    const finalSecret = consumerSecret || row.mpesa_consumer_secret || process.env.DARAJA_CONSUMER_SECRET || '';
    const finalPasskey = passkey || row.mpesa_passkey || process.env.DARAJA_PASSKEY || '';
    const finalShortcode = shortcode || process.env.DARAJA_SHORTCODE || '';
    if (enabled && (!finalKey || !finalSecret || !finalPasskey || !finalShortcode)) {
      return res.status(400).json({ error: 'Consumer key, consumer secret, shortcode and passkey are required before enabling Daraja' });
    }

    const callbackSecret = row.mpesa_callback_secret || process.env.DARAJA_CALLBACK_SECRET || crypto.randomBytes(32).toString('hex');
    await db.query(
      `UPDATE clients
       SET mpesa_enabled=$1,
           mpesa_consumer_key=COALESCE(NULLIF($2,''),mpesa_consumer_key),
           mpesa_consumer_secret=COALESCE(NULLIF($3,''),mpesa_consumer_secret),
           mpesa_shortcode=$4,
           mpesa_passkey=COALESCE(NULLIF($5,''),mpesa_passkey),
           mpesa_environment=$6,
           mpesa_transaction_type=$7,
           mpesa_callback_secret=$8,
           mpesa_configured_at=CASE WHEN $1 THEN NOW() ELSE mpesa_configured_at END,
           payment_prompt_provider='daraja',
           payhero_enabled=FALSE,
           payhero_basic_auth=NULL,
           payhero_channel_id=NULL
       WHERE id=$9`,
      [enabled, consumerKey, consumerSecret, finalShortcode || null, passkey, environment, transactionType, callbackSecret, clientId]
    );
    const config = await loadDarajaConfig(clientId);
    return res.json({ success: true, ...safeConfig(config) });
  } catch (error) {
    console.error('PUT /settings/mpesa error:', error.message);
    return res.status(500).json({ error: error.message || 'Could not save Daraja configuration' });
  }
});

router.post('/test', async (req, res) => {
  const clientId = targetClientId(req, res);
  if (!clientId) return;
  try {
    const saved = await loadDarajaConfig(clientId);
    const result = await testDarajaConnection(clientId, {
      consumerKey: String(req.body.consumer_key || '').trim(),
      consumerSecret: String(req.body.consumer_secret || '').trim(),
      shortcode: String(req.body.shortcode || '').replace(/\D/g, ''),
      passkey: String(req.body.passkey || '').trim(),
      environment: normalizeEnvironment(req.body.environment, saved.environment),
      transactionType: normalizeTransactionType(req.body.transaction_type, saved.transactionType) || 'CustomerPayBillOnline',
    });
    return res.json(result);
  } catch (error) {
    const detail = error.response?.data?.errorMessage || error.response?.data?.error || error.message;
    console.error('POST /settings/mpesa/test error:', detail);
    return res.status(400).json({ error: String(detail || 'Daraja connection test failed') });
  }
});

module.exports = router;
