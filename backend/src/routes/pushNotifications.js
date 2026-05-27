const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const {
  deleteSubscription,
  pushConfigured,
  saveSubscription,
} = require('../services/pushNotifications');

router.use(authMiddleware);

router.get('/public-key', (_req, res) => {
  res.json({
    enabled: pushConfigured(),
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
  });
});

router.post('/subscribe', async (req, res) => {
  try {
    if (!pushConfigured()) {
      return res.status(503).json({ error: 'Push notifications are not configured on this server' });
    }
    await saveSubscription({
      admin: req.user,
      subscription: req.body.subscription,
      userAgent: req.headers['user-agent'] || null,
    });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('POST /push/subscribe error:', err.message);
    res.status(400).json({ error: err.message || 'Could not save push subscription' });
  }
});

router.post('/unsubscribe', async (req, res) => {
  try {
    const endpoint = req.body.endpoint || req.body.subscription?.endpoint;
    if (endpoint) await deleteSubscription(endpoint, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('POST /push/unsubscribe error:', err.message);
    res.status(500).json({ error: 'Could not remove push subscription' });
  }
});

module.exports = router;
