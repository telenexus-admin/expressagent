const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendWhatsAppMessage } = require('../services/whatsapp');

router.use(authMiddleware);

// GET /api/conversations
router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

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

// GET /api/conversations/:id/messages
router.get('/:id/messages', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET messages error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/conversations/:id/reply — admin manual reply
router.post('/:id/reply', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  try {
    const convResult = await db.query(
      `SELECT * FROM conversations WHERE id = $1`,
      [req.params.id]
    );
    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conversation = convResult.rows[0];

    await db.query(
      `INSERT INTO messages (conversation_id, role, content, sender_name, timestamp)
       VALUES ($1, 'admin', $2, $3, NOW())`,
      [req.params.id, message.trim(), req.user.name]
    );

    await db.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    await sendWhatsAppMessage(conversation.customer_phone, message.trim());

    res.json({ success: true });
  } catch (err) {
    console.error('POST reply error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/conversations/:id/status
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const valid = ['active', 'resolved', 'human_takeover'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });
  }

  try {
    const result = await db.query(
      `UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH status error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
