const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`SELECT key, value FROM settings`);
    const settings = {};
    result.rows.forEach((row) => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (err) {
    console.error('GET /settings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  const { system_prompt } = req.body;
  if (!system_prompt || !system_prompt.trim()) {
    return res.status(400).json({ error: 'system_prompt is required' });
  }

  try {
    await db.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('system_prompt', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [system_prompt.trim()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /settings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
