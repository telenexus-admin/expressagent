const db = require('../db');
const jwt = require('jsonwebtoken');

let webpush = null;
try {
  webpush = require('web-push');
} catch {
  webpush = null;
}

let schemaReady = false;

async function ensurePushSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      subscription JSONB NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_admin ON admin_push_subscriptions(admin_id);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_client ON admin_push_subscriptions(client_id);
  `);
  schemaReady = true;
}

function pushConfigured() {
  return Boolean(webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configurePush() {
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@telenexustechnologies.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

async function saveSubscription({ admin, subscription, userAgent }) {
  await ensurePushSchema();
  if (!subscription?.endpoint) throw new Error('Push subscription endpoint is required');
  const payload = JSON.stringify(subscription);
  const result = await db.query(
    `INSERT INTO admin_push_subscriptions (admin_id, client_id, endpoint, subscription, user_agent)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       admin_id = EXCLUDED.admin_id,
       client_id = EXCLUDED.client_id,
       subscription = EXCLUDED.subscription,
       user_agent = EXCLUDED.user_agent,
       updated_at = NOW()
     RETURNING id`,
    [admin.id, admin.client_id || null, subscription.endpoint, payload, userAgent || null]
  );
  return result.rows[0];
}

async function deleteSubscription(endpoint, adminId) {
  await ensurePushSchema();
  await db.query(
    `DELETE FROM admin_push_subscriptions WHERE endpoint = $1 AND admin_id = $2`,
    [endpoint, adminId]
  );
}

function cleanSnippet(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function createActionToken({ adminId, clientId, conversationId, targetStatus }) {
  if (!process.env.JWT_SECRET) return null;
  return jwt.sign(
    {
      type: 'push_action',
      adminId,
      clientId,
      conversationId,
      targetStatus,
    },
    process.env.JWT_SECRET,
    { expiresIn: '2d' }
  );
}

function createOperatorActionToken({ adminId, conversationId, targetAiEnabled }) {
  if (!process.env.JWT_SECRET) return null;
  return jwt.sign(
    {
      type: 'push_action',
      scope: 'operator',
      adminId,
      conversationId,
      targetAiEnabled,
    },
    process.env.JWT_SECRET,
    { expiresIn: '2d' }
  );
}

async function notifyClientAdmins({ clientId, conversationId, customerName, customerPhone, messageText }) {
  await ensurePushSchema();
  if (!configurePush()) return { status: 'skipped', reason: 'Web push is not configured' };

  let conversationStatus = 'active';
  if (conversationId) {
    const conversation = await db.query(
      `SELECT status FROM conversations WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [conversationId, clientId]
    );
    conversationStatus = conversation.rows[0]?.status || 'active';
  }

  const result = await db.query(
    `SELECT ps.id, ps.admin_id, ps.endpoint, ps.subscription
     FROM admin_push_subscriptions ps
     JOIN admins a ON a.id = ps.admin_id
     WHERE a.role = 'superadmin'
        OR (a.client_id = $1 AND (a.permissions = '[]'::jsonb OR a.permissions ? 'conversations' OR a.permissions ? 'tickets'))`,
    [clientId]
  );

  const title = customerName ? `New message from ${customerName}` : `New message from +${customerPhone}`;
  const targetStatus = conversationStatus === 'human_takeover' ? 'active' : 'human_takeover';

  let sent = 0;
  let failed = 0;
  for (const row of result.rows) {
    const actionToken = conversationId
      ? createActionToken({
          adminId: row.admin_id,
          clientId,
          conversationId,
          targetStatus,
        })
      : null;
    const payload = JSON.stringify({
      title,
      body: cleanSnippet(messageText) || 'Customer sent a new message',
      url: conversationId ? `/dashboard/conversations/${conversationId}` : '/dashboard/conversations',
      tag: `conversation-${conversationId || customerPhone}`,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      actions: actionToken
        ? [
            {
              action: 'toggle_ai',
              title: targetStatus === 'human_takeover' ? 'AI Off' : 'AI On',
              token: actionToken,
            },
            { action: 'reply', title: 'Reply' },
          ]
        : [{ action: 'reply', title: 'Reply' }],
    });
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent += 1;
    } catch (err) {
      failed += 1;
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query(`DELETE FROM admin_push_subscriptions WHERE id = $1`, [row.id]);
      } else {
        console.error('Push notification failed:', err.message);
      }
    }
  }
  return { status: 'done', sent, failed };
}

async function notifyOperatorAdmins({ conversationId, customerName, customerPhone, messageText, title: customTitle, body: customBody, tag: customTag }) {
  await ensurePushSchema();
  if (!configurePush()) return { status: 'skipped', reason: 'Web push is not configured' };

  let aiEnabled = true;
  if (conversationId) {
    const conversation = await db.query(
      `SELECT ai_enabled FROM operator_conversations WHERE id = $1 LIMIT 1`,
      [conversationId]
    );
    aiEnabled = conversation.rows[0]?.ai_enabled !== false;
  }

  const result = await db.query(
    `SELECT ps.id, ps.admin_id, ps.endpoint, ps.subscription
     FROM admin_push_subscriptions ps
     JOIN admins a ON a.id = ps.admin_id
     WHERE a.role = 'superadmin'`
  );

  const title = customTitle || (customerName ? `Nexus message from ${customerName}` : `Nexus message from +${customerPhone}`);
  const targetAiEnabled = !aiEnabled;
  const url = conversationId
    ? `/onboarding/nexa-whatsapp?conversationId=${encodeURIComponent(conversationId)}`
    : '/onboarding/nexa-whatsapp';

  let sent = 0;
  let failed = 0;
  for (const row of result.rows) {
    const actionToken = conversationId
      ? createOperatorActionToken({
          adminId: row.admin_id,
          conversationId,
          targetAiEnabled,
        })
      : null;
    const payload = JSON.stringify({
      title,
      body: cleanSnippet(customBody || messageText) || 'Someone sent Nexus a new message',
      url,
      tag: customTag || `operator-conversation-${conversationId || customerPhone}`,
      icon: '/nexus-pwa-192x192.png',
      badge: '/nexus-pwa-192x192.png',
      actions: actionToken
        ? [
            { action: 'reply', title: 'Reply' },
            {
              action: 'toggle_ai',
              title: targetAiEnabled ? 'AI On' : 'AI Off',
              token: actionToken,
            },
          ]
        : [{ action: 'reply', title: 'Reply' }],
    });
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent += 1;
    } catch (err) {
      failed += 1;
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query(`DELETE FROM admin_push_subscriptions WHERE id = $1`, [row.id]);
      } else {
        console.error('Operator push notification failed:', err.message);
      }
    }
  }
  return { status: 'done', sent, failed };
}

module.exports = {
  ensurePushSchema,
  pushConfigured,
  saveSubscription,
  deleteSubscription,
  notifyClientAdmins,
  notifyOperatorAdmins,
};
