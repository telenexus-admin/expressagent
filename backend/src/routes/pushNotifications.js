const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const {
  deleteSubscription,
  pushConfigured,
  saveSubscription,
} = require('../services/pushNotifications');
const { markHumanTakeover, markAiActive } = require('../services/humanTakeoverRecovery');

router.get('/action-status', (_req, res) => {
  res.json({ ok: true });
});

router.post('/actions', async (req, res) => {
  try {
    const { token, action } = req.body || {};
    if (action !== 'toggle_ai') return res.status(400).json({ error: 'Unsupported push action' });
    if (!token || !process.env.JWT_SECRET) return res.status(401).json({ error: 'Invalid push action token' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'push_action') return res.status(401).json({ error: 'Invalid push action token' });
    if (payload.scope === 'operator') {
      if (typeof payload.targetAiEnabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid operator AI target' });
      }
      const access = await db.query(
        `SELECT c.id
         FROM operator_conversations c
         JOIN admins a ON a.id = $2
         WHERE c.id = $1 AND a.role = 'superadmin'
         LIMIT 1`,
        [payload.conversationId, payload.adminId]
      );
      if (access.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });

      const result = await db.query(
        `UPDATE operator_conversations SET ai_enabled = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, ai_enabled`,
        [payload.targetAiEnabled, payload.conversationId]
      );

      return res.json({
        success: true,
        scope: 'operator',
        conversation_id: result.rows[0].id,
        ai_enabled: result.rows[0].ai_enabled,
      });
    }

    if (!['active', 'human_takeover'].includes(payload.targetStatus)) {
      return res.status(400).json({ error: 'Invalid target status' });
    }

    const access = await db.query(
      `SELECT c.id
       FROM conversations c
       JOIN admins a ON a.id = $2
       WHERE c.id = $1
         AND c.client_id = $3
         AND (
           a.role = 'superadmin'
           OR (
             a.client_id = c.client_id
             AND (a.permissions = '[]'::jsonb OR a.permissions ? 'conversations' OR a.permissions ? 'tickets')
           )
         )
       LIMIT 1`,
      [payload.conversationId, payload.adminId, payload.clientId]
    );
    if (access.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });

    if (payload.targetStatus === 'human_takeover') await markHumanTakeover(payload.conversationId);
    else await markAiActive(payload.conversationId);
    const result = await db.query(
      `SELECT id, status FROM conversations WHERE id = $1 AND client_id = $2`,
      [payload.conversationId, payload.clientId]
    );

    res.json({ success: true, conversation_id: result.rows[0].id, status: result.rows[0].status });
  } catch (err) {
    console.error('POST /push/actions error:', err.message);
    res.status(401).json({ error: 'Invalid or expired push action' });
  }
});

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
