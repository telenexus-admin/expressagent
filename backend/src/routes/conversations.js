const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { sendSMS } = require('../services/sms');

router.use(authMiddleware, scopeMiddleware);

async function loadConversationWithClient(conversationId, scope) {
  const result = await db.query(
    `SELECT
       conv.*,
       cl.id AS cl_id,
       cl.name AS cl_name,
       cl.business_name AS cl_business_name,
       cl.meta_phone_number_id AS cl_meta_phone_number_id,
       cl.meta_access_token AS cl_meta_access_token,
       cl.agent_name AS cl_agent_name,
       cl.support_number AS cl_support_number
     FROM conversations conv
     JOIN clients cl ON cl.id = conv.client_id
     WHERE conv.id = $1`,
    [conversationId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!scope.isSuperadmin && row.client_id !== scope.clientId) return null;
  return {
    conversation: {
      id: row.id,
      customer_phone: row.customer_phone,
      customer_name: row.customer_name,
      status: row.status,
      client_id: row.client_id,
      installation_state: row.installation_state,
      opted_out_at: row.opted_out_at,
    },
    client: {
      id: row.cl_id,
      name: row.cl_name,
      business_name: row.cl_business_name,
      meta_phone_number_id: row.cl_meta_phone_number_id,
      meta_access_token: row.cl_meta_access_token,
      agent_name: row.cl_agent_name,
      support_number: row.cl_support_number,
    },
  };
}

router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where += ` AND c.client_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      where += ` AND c.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (c.customer_phone ILIKE $${params.length} OR lm.content ILIKE $${params.length})`;
    }

    const query = `
      SELECT
        c.*,
        lm.content  AS last_message,
        lm.timestamp AS last_message_at,
        lm.role      AS last_message_role
      FROM conversations c
      LEFT JOIN LATERAL (
        SELECT content, timestamp, role
        FROM messages
        WHERE conversation_id = c.id
        ORDER BY timestamp DESC
        LIMIT 1
      ) lm ON true
      ${where}
      ORDER BY COALESCE(lm.timestamp, c.created_at) DESC
    `;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /conversations error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/messages', async (req, res) => {
  try {
    const ownership = await db.query(`SELECT client_id FROM conversations WHERE id = $1`, [req.params.id]);
    if (ownership.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (!req.scope.isSuperadmin && ownership.rows[0].client_id !== req.scope.clientId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const result = await db.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC`, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET messages error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/reply', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message content is required' });

  try {
    const loaded = await loadConversationWithClient(req.params.id, req.scope);
    if (!loaded) return res.status(404).json({ error: 'Conversation not found' });

    const { conversation, client } = loaded;

    await db.query(
      `INSERT INTO messages (conversation_id, role, content, sender_name, timestamp)
       VALUES ($1, 'admin', $2, $3, NOW())`,
      [req.params.id, message.trim(), req.user.name]
    );

    await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [req.params.id]);

    await sendWhatsAppMessage(
      client.meta_phone_number_id,
      client.meta_access_token,
      conversation.customer_phone,
      message.trim()
    );

    res.json({ success: true });
  } catch (err) {
    console.error('POST reply error:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.post('/:id/confirm-installation', async (req, res) => {
  try {
    const loaded = await loadConversationWithClient(req.params.id, req.scope);
    if (!loaded) return res.status(404).json({ error: 'Conversation not found' });
    const { conversation, client } = loaded;

    const firstName = (conversation.customer_name || '').split(' ')[0].trim();
    const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
    const signoff = (client.agent_name || '').trim() || 'Support';

    const customMessage = (req.body?.message || '').trim();
    const message =
      customMessage ||
      `${greeting} your installation has been confirmed. Our team will reach out shortly to coordinate the visit. — ${signoff}`;

    await sendSMS(conversation.customer_phone, message);

    await db.query(
      `INSERT INTO messages (conversation_id, role, content, sender_name, timestamp)
       VALUES ($1, 'admin', $2, $3, NOW())`,
      [conversation.id, `[Installation confirmation SMS] ${message}`, req.user.name]
    );
    await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversation.id]);

    await db.query(
      `UPDATE escalations SET resolved_at = NOW()
       WHERE conversation_id = $1 AND type = 'installation' AND resolved_at IS NULL`,
      [conversation.id]
    );

    res.json({ success: true, message });
  } catch (err) {
    console.error('POST /conversations/:id/confirm-installation error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to send confirmation SMS' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const valid = ['active', 'resolved', 'human_takeover'];
  if (!valid.includes(status)) return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });

  try {
    const ownership = await db.query(`SELECT client_id FROM conversations WHERE id = $1`, [req.params.id]);
    if (ownership.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (!req.scope.isSuperadmin && ownership.rows[0].client_id !== req.scope.clientId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const result = await db.query(
      `UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (status === 'resolved') {
      await db.query(
        `UPDATE escalations SET resolved_at = NOW()
         WHERE conversation_id = $1 AND resolved_at IS NULL`,
        [req.params.id]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH status error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
