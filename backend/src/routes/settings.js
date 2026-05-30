const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { testBillingConnection } = require('../services/billing');

router.use(authMiddleware, scopeMiddleware);

const ALLOWED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const BILLING_PROVIDERS = ['wispman'];
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

// GET /api/settings — returns the agent config for the caller's client
router.get('/', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  try {
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

  try {
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

  if (baseUrl === null) {
    return res.status(400).json({ error: 'Enter a valid billing API base URL' });
  }

  try {
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

module.exports = router;
