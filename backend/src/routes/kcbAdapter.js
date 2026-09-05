const express = require('express');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const {
  loadKcbBuniConfig,
  publicKcbBuniStatus,
  testKcbBuniConnection,
} = require('../services/kcbBuni');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

router.get('/status', (_req, res) => {
  try {
    res.json(publicKcbBuniStatus(loadKcbBuniConfig()));
  } catch (error) {
    res.status(500).json({ error: 'Could not load KCB Buni adapter status' });
  }
});

router.post('/test', async (_req, res) => {
  try {
    const result = await testKcbBuniConnection();
    res.json(result);
  } catch (error) {
    console.error('KCB Buni OAuth test failed:', error.response?.data || error.message);
    res.status(400).json({
      success: false,
      bank: 'kcb',
      error: error.response?.data?.error_description || error.response?.data?.error || error.message || 'KCB Buni connection failed',
    });
  }
});

module.exports = router;
