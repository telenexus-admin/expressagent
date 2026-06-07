const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { testBillingConnection } = require('../services/billing');
const { sendSMS } = require('../services/sms');
const { ensurePayHeroSchema, getPayHeroBasicAuth, testPayHeroConnection } = require('../services/payhero');

router.use(authMiddleware, scopeMiddleware);

const ALLOWED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const BILLING_PROVIDERS = ['wispman'];
const SMS_PROVIDERS = ['blessed_text'];
const DEFAULT_WELCOME_MENU = {
  enabled: true,
  body: '',
  button_text: 'Choose option',
  footer: '',
  section_title: 'How can I help?',
  options: [
    {
      id: 'express_installation',
      title: 'Installation',
      description: 'Get connected or request a new setup.',
      text: 'I want to request a new installation.',
    },
    {
      id: 'express_billing',
      title: 'Billing & Payments',
      description: 'Check payments, expiry, plan or account status.',
      text: 'I need help with billing or payments.',
    },
    {
      id: 'express_technical',
      title: 'Technical Support',
      description: 'Internet down, slow speeds, router or fibre issue.',
      text: 'My internet has a technical issue.',
    },
    {
      id: 'express_general',
      title: 'General Inquiry',
      description: 'Ask about packages, coverage or anything else.',
      text: 'I have a general inquiry.',
    },
  ],
};
const DEFAULT_INSTALLATION_FORM = {
  title: 'Installation form',
  intro: 'Share your contact and location details so the installation team can prepare before calling you.',
  accent_color: '#3535FF',
  show_id: true,
  require_id: true,
  show_alternate_phone: true,
  show_email: true,
  show_plan: true,
  show_service_type: true,
  show_county: true,
  show_landmark: true,
  show_house_description: true,
  show_gps: true,
  show_schedule: true,
  show_notes: true,
};

// Resolve which client's settings to operate on:
//   regular admin -> their own client
//   superadmin    -> must pass ?clientId= (no global "settings" anymore)
function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

function requireOperator(req, res) {
  if (!req.scope.isSuperadmin) {
    res.status(403).json({ error: 'Only the Nexa operator can configure PayHero' });
    return false;
  }
  return true;
}

function normalizeBillingBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

function safeBillingConfig(row) {
  return {
    enabled: Boolean(row.billing_enabled),
    provider: row.billing_provider || 'wispman',
    base_url: row.billing_api_base_url || '',
    has_api_key: Boolean(row.billing_api_key),
    configured_at: row.billing_configured_at || null,
  };
}

function safeCommunicationConfig(row) {
  return {
    provider: row.sms_provider || 'blessed_text',
    sender_id: row.sms_sender_id || '',
    has_api_key: Boolean(row.sms_api_key),
    configured_at: row.sms_configured_at || null,
  };
}

function safePayHeroConfig(row) {
  return {
    enabled: row.payhero_enabled === true,
    channel_id: row.payhero_channel_id || '',
    provider: row.payhero_provider || 'm-pesa',
    has_basic_auth: Boolean(getPayHeroBasicAuth(row.payhero_basic_auth)),
  };
}

async function ensureCommunicationColumns() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(40)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_api_key TEXT`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(80)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_configured_at TIMESTAMP WITH TIME ZONE`);
}

async function ensureAgentSettingsColumns() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS system_prompt TEXT`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS support_number VARCHAR(50)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_name VARCHAR(80)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS voice_id VARCHAR(20) DEFAULT 'alloy'`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS welcome_menu_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS welcome_menu_config JSONB`);
}

async function ensureBillingColumns() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(40)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_api_base_url TEXT`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_api_key TEXT`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_configured_at TIMESTAMP WITH TIME ZONE`);
}

async function ensureInstallationFormColumn() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS installation_form_config JSONB NOT NULL DEFAULT '{}'::jsonb`);
}

function normalizeWelcomeMenuConfig(raw = {}, enabled = true) {
  const source = typeof raw === 'object' && raw !== null ? raw : {};
  const options = Array.isArray(source.options) ? source.options : DEFAULT_WELCOME_MENU.options;
  const cleanOptions = options
    .slice(0, 10)
    .map((option, index) => ({
      id: String(option.id || DEFAULT_WELCOME_MENU.options[index]?.id || `welcome_option_${index + 1}`).trim().slice(0, 80),
      title: String(option.title || '').trim().slice(0, 24),
      description: String(option.description || '').trim().slice(0, 72),
      text: String(option.text || '').trim().slice(0, 280),
    }))
    .filter((option) => option.id && option.title && option.text);

  return {
    enabled: Boolean(enabled),
    body: String(source.body || '').trim().slice(0, 1024),
    button_text: String(source.button_text || DEFAULT_WELCOME_MENU.button_text).trim().slice(0, 20),
    footer: String(source.footer || '').trim().slice(0, 60),
    section_title: String(source.section_title || DEFAULT_WELCOME_MENU.section_title).trim().slice(0, 24),
    options: cleanOptions.length > 0 ? cleanOptions : DEFAULT_WELCOME_MENU.options,
  };
}

function normalizeInstallationFormConfig(raw = {}) {
  const source = typeof raw === 'object' && raw !== null ? raw : {};
  const pickBool = (key) => source[key] === undefined ? DEFAULT_INSTALLATION_FORM[key] : Boolean(source[key]);
  const accent = String(source.accent_color || DEFAULT_INSTALLATION_FORM.accent_color).trim();
  return {
    title: String(source.title || DEFAULT_INSTALLATION_FORM.title).trim().slice(0, 80),
    intro: String(source.intro || DEFAULT_INSTALLATION_FORM.intro).trim().slice(0, 300),
    accent_color: /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_INSTALLATION_FORM.accent_color,
    show_id: pickBool('show_id'),
    require_id: pickBool('show_id') ? pickBool('require_id') : false,
    show_alternate_phone: pickBool('show_alternate_phone'),
    show_email: pickBool('show_email'),
    show_plan: pickBool('show_plan'),
    show_service_type: pickBool('show_service_type'),
    show_county: pickBool('show_county'),
    show_landmark: pickBool('show_landmark'),
    show_house_description: pickBool('show_house_description'),
    show_gps: pickBool('show_gps'),
    show_schedule: pickBool('show_schedule'),
    show_notes: pickBool('show_notes'),
  };
}

// GET /api/settings — returns the agent config for the caller's client
router.get('/', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  try {
    await ensureAgentSettingsColumns();
    const result = await db.query(
      `SELECT system_prompt, support_number, agent_name, voice_id, welcome_menu_enabled, welcome_menu_config
       FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const row = result.rows[0];
    res.json({
      system_prompt: row.system_prompt || '',
      support_number: row.support_number || '',
      agent_name: row.agent_name || '',
      voice_id: row.voice_id || 'alloy',
      welcome_menu: normalizeWelcomeMenuConfig(row.welcome_menu_config, row.welcome_menu_enabled),
    });
  } catch (err) {
    console.error('GET /settings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/settings/billing — returns safe billing integration config
router.get('/billing', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  try {
    await ensureBillingColumns();
    const result = await db.query(
      `SELECT billing_enabled, billing_provider, billing_api_base_url, billing_api_key, billing_configured_at
       FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(safeBillingConfig(result.rows[0]));
  } catch (err) {
    console.error('GET /settings/billing error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/settings/communication â€” returns safe SMS provider config
router.get('/communication', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  try {
    await ensureCommunicationColumns();
    const result = await db.query(
      `SELECT sms_provider, sms_api_key, sms_sender_id, sms_configured_at
       FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(safeCommunicationConfig(result.rows[0]));
  } catch (err) {
    console.error('GET /settings/communication error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/payhero', async (req, res) => {
  if (!requireOperator(req, res)) return;
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;
  try {
    await ensurePayHeroSchema();
    const result = await db.query(
      `SELECT payhero_enabled, payhero_channel_id, payhero_provider, payhero_basic_auth FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Client not found' });
    res.json(safePayHeroConfig(result.rows[0]));
  } catch (err) {
    console.error('GET /settings/payhero error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/settings/installation-form — returns public installation intake form controls
router.get('/installation-form', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  try {
    await ensureInstallationFormColumn();
    const result = await db.query(
      `SELECT installation_form_config FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(normalizeInstallationFormConfig(result.rows[0].installation_form_config));
  } catch (err) {
    console.error('GET /settings/installation-form error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings — partial update of the caller's client agent config
router.put('/', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  const { system_prompt, support_number, agent_name, voice_id, welcome_menu } = req.body;

  if (
    system_prompt === undefined &&
    support_number === undefined &&
    agent_name === undefined &&
    voice_id === undefined &&
    welcome_menu === undefined
  ) {
    return res.status(400).json({ error: 'No settings provided' });
  }

  const updates = [];
  const params = [];

  if (system_prompt !== undefined) {
    if (!system_prompt || !system_prompt.trim()) {
      return res.status(400).json({ error: 'system_prompt cannot be empty' });
    }
    params.push(system_prompt.trim());
    updates.push(`system_prompt = $${params.length}`);
  }

  if (support_number !== undefined) {
    const trimmed = (support_number || '').trim();
    if (trimmed && !/^\+?[0-9][0-9\s\-()]{6,19}$/.test(trimmed)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    params.push(trimmed || null);
    updates.push(`support_number = $${params.length}`);
  }

  if (agent_name !== undefined) {
    const trimmed = (agent_name || '').trim();
    if (trimmed.length > 80) {
      return res.status(400).json({ error: 'Agent name must be 80 characters or fewer' });
    }
    params.push(trimmed || null);
    updates.push(`agent_name = $${params.length}`);
  }

  if (voice_id !== undefined) {
    const trimmed = (voice_id || '').trim().toLowerCase();
    if (trimmed && !ALLOWED_VOICES.includes(trimmed)) {
      return res.status(400).json({
        error: `Invalid voice. Choose one of: ${ALLOWED_VOICES.join(', ')}`,
      });
    }
    params.push(trimmed || 'alloy');
    updates.push(`voice_id = $${params.length}`);
  }

  if (welcome_menu !== undefined) {
    const normalized = normalizeWelcomeMenuConfig(welcome_menu, welcome_menu.enabled);
    if (normalized.enabled && normalized.options.length === 0) {
      return res.status(400).json({ error: 'At least one interactive option is required' });
    }
    params.push(normalized.enabled);
    updates.push(`welcome_menu_enabled = $${params.length}`);
    params.push(JSON.stringify({
      body: normalized.body,
      button_text: normalized.button_text,
      footer: normalized.footer,
      section_title: normalized.section_title,
      options: normalized.options,
    }));
    updates.push(`welcome_menu_config = $${params.length}::jsonb`);
  }

  try {
    await ensureAgentSettingsColumns();
    params.push(targetClient);
    await db.query(
      `UPDATE clients SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /settings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings/billing — save Wispman connection details for this client
router.put('/billing', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  const enabled = Boolean(req.body.enabled);
  const selectedProvider = String(req.body.provider || 'wispman').trim().toLowerCase();
  const baseUrl = normalizeBillingBaseUrl(req.body.base_url);
  const apiKey = String(req.body.api_key || '').trim();

  if (!BILLING_PROVIDERS.includes(selectedProvider)) {
    return res.status(400).json({ error: 'Unsupported billing system' });
  }

  if (baseUrl === null) {
    return res.status(400).json({ error: 'Enter a valid billing API base URL' });
  }

  try {
    await ensureBillingColumns();
    const existing = await db.query(
      `SELECT billing_api_key FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const savedKey = existing.rows[0].billing_api_key || '';
    if (enabled && (!baseUrl || (!apiKey && !savedKey))) {
      return res.status(400).json({ error: 'Base URL and API key are required before enabling billing lookup' });
    }

    const result = await db.query(
      `UPDATE clients
       SET billing_enabled = $1,
           billing_provider = $2,
           billing_api_base_url = $3,
           billing_api_key = COALESCE(NULLIF($4, ''), billing_api_key),
           billing_configured_at = CASE WHEN $1 THEN NOW() ELSE billing_configured_at END
       WHERE id = $5
       RETURNING billing_enabled, billing_provider, billing_api_base_url, billing_api_key, billing_configured_at`,
      [enabled, selectedProvider, baseUrl || null, apiKey, targetClient]
    );

    res.json({ success: true, ...safeBillingConfig(result.rows[0]) });
  } catch (err) {
    console.error('PUT /settings/billing error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings/communication â€” save Blessed Text credentials for this client
router.put('/communication', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  const selectedProvider = String(req.body.provider || 'blessed_text').trim().toLowerCase();
  const apiKey = String(req.body.api_key || '').trim();
  const senderId = String(req.body.sender_id || '').trim();

  if (!SMS_PROVIDERS.includes(selectedProvider)) {
    return res.status(400).json({ error: 'Unsupported SMS provider' });
  }
  if (senderId && !/^[A-Za-z0-9_. -]{2,40}$/.test(senderId)) {
    return res.status(400).json({ error: 'Sender ID should be 2-40 letters, numbers or simple symbols' });
  }

  try {
    await ensureCommunicationColumns();
    const existing = await db.query(
      `SELECT sms_api_key, sms_sender_id FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const savedKey = existing.rows[0].sms_api_key || '';
    const finalSender = senderId || existing.rows[0].sms_sender_id || '';
    if (!finalSender || (!apiKey && !savedKey)) {
      return res.status(400).json({ error: 'API key and sender ID are required before saving SMS provider' });
    }

    const result = await db.query(
      `UPDATE clients
       SET sms_provider = $1,
           sms_api_key = COALESCE(NULLIF($2, ''), sms_api_key),
           sms_sender_id = $3,
           sms_configured_at = NOW()
       WHERE id = $4
       RETURNING sms_provider, sms_api_key, sms_sender_id, sms_configured_at`,
      [selectedProvider, apiKey, finalSender, targetClient]
    );

    res.json({ success: true, ...safeCommunicationConfig(result.rows[0]) });
  } catch (err) {
    console.error('PUT /settings/communication error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/payhero', async (req, res) => {
  if (!requireOperator(req, res)) return;
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;
  const enabled = req.body.enabled === true;
  const channelId = Number.parseInt(req.body.channel_id, 10);
  const provider = String(req.body.provider || 'm-pesa').trim();
  if (enabled && (!Number.isInteger(channelId) || channelId <= 0)) return res.status(400).json({ error: 'A valid PayHero channel ID is required' });
  try {
    await ensurePayHeroSchema();
    const existing = await db.query(`SELECT payhero_basic_auth, payhero_callback_secret FROM clients WHERE id = $1`, [targetClient]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Client not found' });
    if (enabled && !getPayHeroBasicAuth(existing.rows[0].payhero_basic_auth)) return res.status(400).json({ error: 'PAYHERO_BASIC_AUTH is required before enabling PayHero' });
    const callbackSecret = existing.rows[0].payhero_callback_secret || crypto.randomBytes(32).toString('hex');
    const result = await db.query(
      `UPDATE clients SET payhero_enabled = $1, payhero_channel_id = $2, payhero_provider = $3,
         payhero_callback_secret = $4
       WHERE id = $5
       RETURNING payhero_enabled, payhero_channel_id, payhero_provider, payhero_basic_auth`,
      [enabled, Number.isInteger(channelId) ? channelId : null, provider, callbackSecret, targetClient]
    );
    res.json({ success: true, ...safePayHeroConfig(result.rows[0]) });
  } catch (err) {
    console.error('PUT /settings/payhero error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/payhero/test', async (req, res) => {
  if (!requireOperator(req, res)) return;
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;
  try {
    await ensurePayHeroSchema();
    const existing = await db.query(`SELECT payhero_basic_auth FROM clients WHERE id = $1`, [targetClient]);
    const basicAuth = getPayHeroBasicAuth(existing.rows[0]?.payhero_basic_auth);
    if (!basicAuth) return res.status(400).json({ error: 'PayHero Basic Auth token is required' });
    const result = await testPayHeroConnection(basicAuth, req.body.channel_id);
    res.json({
      success: true,
      channels: result.channels.length,
      channel: result.selectedChannel
        ? { id: result.selectedChannel.id, description: result.selectedChannel.description, type: result.selectedChannel.channel_type }
        : null,
    });
  } catch (err) {
    const message = err.response?.data?.message || err.response?.data?.error || err.message;
    console.error('POST /settings/payhero/test error:', message);
    res.status(400).json({ error: String(message || 'PayHero connection failed') });
  }
});

// PUT /api/settings/installation-form — save public installation intake form controls
router.put('/installation-form', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  try {
    await ensureInstallationFormColumn();
    const normalized = normalizeInstallationFormConfig(req.body || {});
    const result = await db.query(
      `UPDATE clients
       SET installation_form_config = $1::jsonb
       WHERE id = $2
       RETURNING installation_form_config`,
      [JSON.stringify(normalized), targetClient]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ success: true, ...normalizeInstallationFormConfig(result.rows[0].installation_form_config) });
  } catch (err) {
    console.error('PUT /settings/installation-form error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/settings/billing/test — verify submitted or saved Wispman credentials
router.post('/billing/test', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  const selectedProvider = String(req.body.provider || 'wispman').trim().toLowerCase();
  const baseUrl = normalizeBillingBaseUrl(req.body.base_url);
  const submittedKey = String(req.body.api_key || '').trim();

  if (!BILLING_PROVIDERS.includes(selectedProvider)) {
    return res.status(400).json({ error: 'Unsupported billing system' });
  }

  if (baseUrl === null) {
    return res.status(400).json({ error: 'Enter a valid billing API base URL' });
  }

  try {
    await ensureBillingColumns();
    const existing = await db.query(
      `SELECT billing_api_key FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const apiKey = submittedKey || existing.rows[0].billing_api_key || '';
    const result = await testBillingConnection({
      provider: selectedProvider,
      baseUrl,
      apiKey,
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    console.error('POST /settings/billing/test error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/settings/communication/test â€” send a test SMS using submitted or saved credentials
router.post('/communication/test', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  const selectedProvider = String(req.body.provider || 'blessed_text').trim().toLowerCase();
  const submittedKey = String(req.body.api_key || '').trim();
  const submittedSender = String(req.body.sender_id || '').trim();
  const phone = String(req.body.phone || '').replace(/[^0-9]/g, '');

  if (!SMS_PROVIDERS.includes(selectedProvider)) {
    return res.status(400).json({ error: 'Unsupported SMS provider' });
  }
  if (!/^[0-9]{9,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Enter a valid test phone number' });
  }

  try {
    await ensureCommunicationColumns();
    const existing = await db.query(
      `SELECT sms_provider, sms_api_key, sms_sender_id FROM clients WHERE id = $1`,
      [targetClient]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const row = existing.rows[0];
    const apiKey = submittedKey || row.sms_api_key || '';
    const senderId = submittedSender || row.sms_sender_id || '';
    await sendSMS(phone, 'Nexa SMS provider test. Your Blessed Text configuration is working.', {
      provider: selectedProvider,
      apiKey,
      senderId,
    });
    res.json({ success: true, sent_to: phone });
  } catch (err) {
    const message = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message);
    console.error('POST /settings/communication/test error:', message);
    res.status(500).json({ error: `SMS could not be sent: ${message}` });
  }
});

module.exports = router;
