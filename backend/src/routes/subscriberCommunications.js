const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { sendClientText } = require('../services/clientEvolution');
const { ensureSmsSchema, hasSMSConfig, sendSMS } = require('../services/sms');

const router = express.Router();
let communicationSchemaPromise = null;

router.use(authMiddleware, scopeMiddleware);

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length === 10) digits = `254${digits.slice(1)}`;
  else if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) digits = `254${digits}`;
  return digits;
}

async function ensureCommunicationSchema() {
  if (!communicationSchemaPromise) {
    communicationSchemaPromise = (async () => {
      await ensureSmsSchema();
      await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_instance_name VARCHAR(120)`);
      await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp'`);
    })().catch((error) => {
      communicationSchemaPromise = null;
      throw error;
    });
  }
  return communicationSchemaPromise;
}

async function loadBillingClient(clientId) {
  await ensureCommunicationSchema();
  const result = await db.query(
    `SELECT
       id,
       account_type,
       connection_provider,
       evolution_instance_name,
       meta_phone_number_id,
       meta_access_token,
       sms_provider,
       sms_api_key,
       sms_sender_id,
       sms_partner_id
     FROM clients
     WHERE id = $1
     LIMIT 1`,
    [clientId]
  );
  return result.rows[0] || null;
}

function whatsappConfigured(client) {
  if (client?.connection_provider === 'evolution') {
    return Boolean(
      String(client.evolution_instance_name || '').trim() &&
      String(process.env.EVOLUTION_API_URL || '').trim() &&
      String(process.env.EVOLUTION_API_KEY || '').trim()
    );
  }
  return Boolean(client?.meta_phone_number_id && client?.meta_access_token);
}

async function findOrCreateConversation(client, phone, customerName) {
  const sourceInstance = client.connection_provider === 'evolution'
    ? String(client.evolution_instance_name || '').trim() || null
    : null;

  const existing = await db.query(
    `SELECT *
     FROM conversations
     WHERE client_id = $1
       AND RIGHT(regexp_replace(COALESCE(customer_phone, ''), '[^0-9]', '', 'g'), 9) = RIGHT($2, 9)
       AND status <> 'resolved'
     ORDER BY
       CASE
         WHEN source_instance_name = $3 THEN 0
         WHEN source_instance_name IS NULL THEN 1
         ELSE 2
       END,
       updated_at DESC NULLS LAST,
       created_at DESC
     LIMIT 1`,
    [client.id, phone, sourceInstance]
  );

  if (existing.rows[0]) {
    const updated = await db.query(
      `UPDATE conversations
       SET customer_phone = $1,
           customer_name = COALESCE(NULLIF($2, ''), customer_name),
           source_instance_name = COALESCE(source_instance_name, $3)
       WHERE id = $4
       RETURNING *`,
      [phone, customerName || '', sourceInstance, existing.rows[0].id]
    );
    return updated.rows[0];
  }

  const inserted = await db.query(
    `INSERT INTO conversations (
       customer_phone,
       customer_name,
       status,
       client_id,
       source_instance_name
     )
     VALUES ($1, $2, 'active', $3, $4)
     RETURNING *`,
    [phone, customerName || null, client.id, sourceInstance]
  );
  return inserted.rows[0];
}

async function loadMessages(conversationId, channel) {
  const result = await db.query(
    `SELECT id, role, content, sender_name, timestamp, channel
     FROM messages
     WHERE conversation_id = $1
       AND channel = $2
     ORDER BY timestamp ASC
     LIMIT 250`,
    [conversationId, channel]
  );
  return result.rows;
}

async function requireWorkspace(req, res) {
  if (req.scope.isSuperadmin || !req.scope.clientId) {
    res.status(403).json({ error: 'Billing workspace access required' });
    return null;
  }

  const client = await loadBillingClient(req.scope.clientId);
  if (!client || client.account_type !== 'billing') {
    res.status(403).json({ error: 'This account is not a billing workspace' });
    return null;
  }
  return client;
}

const requestValidation = [
  body('phone').trim().notEmpty().isLength({ max: 80 }),
  body('customer_name').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('channel').isIn(['sms', 'whatsapp']),
];

router.post('/open', requestValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const client = await requireWorkspace(req, res);
    if (!client) return;

    const phone = normalizePhone(req.body.phone);
    if (phone.length < 9 || phone.length > 15) {
      return res.status(400).json({ error: 'This subscriber does not have a valid phone number' });
    }

    const channel = req.body.channel;
    const conversation = await findOrCreateConversation(
      client,
      phone,
      String(req.body.customer_name || '').trim()
    );

    const messages = await loadMessages(conversation.id, channel);
    const channels = {
      sms: hasSMSConfig({ client }),
      whatsapp: whatsappConfigured(client),
    };

    return res.json({
      conversation: {
        id: conversation.id,
        customer_phone: conversation.customer_phone,
        customer_name: conversation.customer_name,
      },
      channel,
      configured: channels[channel],
      channels,
      messages,
    });
  } catch (error) {
    console.error('Subscriber communication open failed:', error.message);
    return res.status(500).json({ error: error.message || 'Could not open subscriber conversation' });
  }
});

router.post('/send', [
  ...requestValidation,
  body('message').trim().notEmpty().isLength({ max: 4000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const client = await requireWorkspace(req, res);
    if (!client) return;

    const phone = normalizePhone(req.body.phone);
    if (phone.length < 9 || phone.length > 15) {
      return res.status(400).json({ error: 'This subscriber does not have a valid phone number' });
    }

    const channel = req.body.channel;
    const message = String(req.body.message || '').trim();
    const customerName = String(req.body.customer_name || '').trim();
    const conversation = await findOrCreateConversation(client, phone, customerName);

    if (channel === 'sms') {
      if (!hasSMSConfig({ client })) {
        return res.status(503).json({ error: 'SMS is not configured for this billing workspace' });
      }
      await sendSMS(phone, message, { client });
    } else {
      if (!whatsappConfigured(client)) {
        return res.status(503).json({ error: 'WhatsApp is not configured for this billing workspace' });
      }
      if (client.connection_provider === 'evolution') {
        await sendClientText(client, phone, message);
      } else {
        await sendWhatsAppMessage(
          client.meta_phone_number_id,
          client.meta_access_token,
          phone,
          message
        );
      }
    }

    await db.query(
      `INSERT INTO messages (
         conversation_id,
         role,
         content,
         sender_name,
         timestamp,
         channel
       )
       VALUES ($1, 'admin', $2, $3, NOW(), $4)`,
      [conversation.id, message, req.user?.name || 'Staff', channel]
    );
    await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversation.id]);

    const messages = await loadMessages(conversation.id, channel);
    return res.json({ success: true, conversation_id: conversation.id, channel, messages });
  } catch (error) {
    console.error('Subscriber communication send failed:', error.response?.data || error.message);
    return res.status(500).json({ error: error.message || 'Could not send message' });
  }
});

router._test = {
  normalizePhone,
  whatsappConfigured,
};

module.exports = router;
