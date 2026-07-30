const express = require('express');
const { completeSinglePaste } = require('../services/onePasteOnboarding');
const router = express.Router();
router.post('/onboard', async (req, res) => { try { res.json(await completeSinglePaste(req.body || {})); } catch (err) { console.error('Public MikroTik onboarding callback failed:', err.message); res.status(400).json({ error: err.message || 'Router onboarding callback failed' }); } });
module.exports = router;