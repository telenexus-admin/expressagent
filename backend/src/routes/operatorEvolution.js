const express = require('express');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { getOperatorSettings, setEvolutionWebhook } = require('../services/evolution');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

function webhookUrl(req, secret) {
  const publicBase = String(
    process.env.PUBLIC_BACKEND_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '');
  return `${publicBase}/webhook/evolution/nexa?token=${encodeURIComponent(secret)}`;
}

router.post('/connect-webhook', async (req, res) => {
  try {
    const settings = await getOperatorSettings({ includeKey: true });
    const url = webhookUrl(req, settings.webhook_secret);
    await setEvolutionWebhook(settings, url);
    res.json({ success: true, webhook_url: url, event: 'MESSAGES_UPSERT' });
  } catch (err) {
    const message = typeof err.response?.data === 'object'
      ? JSON.stringify(err.response.data)
      : (err.response?.data || err.message);
    console.error('POST /operator-evolution/connect-webhook error:', message);
    res.status(500).json({ error: `Could not connect Evolution webhook: ${message}` });
  }
});

module.exports = router;
