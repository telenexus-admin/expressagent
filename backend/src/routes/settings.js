const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

router.use(authMiddleware, scopeMiddleware);

const ALLOWED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

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

// GET /api/settings — returns the agent config for the caller's client
router.get('/', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  try {
    const result = await db.query(
      `SELECT system_prompt, support_number, agent_name, voice_id
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
    });
  } catch (err) {
    console.error('GET /settings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings — partial update of the caller's client agent config
router.put('/', async (req, res) => {
  const targetClient = resolveTargetClient(req, res);
  if (!targetClient) return;

  const { system_prompt, support_number, agent_name, voice_id } = req.body;

  if (
    system_prompt === undefined &&
    support_number === undefined &&
    agent_name === undefined &&
    voice_id === undefined
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

module.exports = router;
