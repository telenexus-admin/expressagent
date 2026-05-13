const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateAIResponse } = require('../services/openai');
const { sendWhatsAppMessage } = require('../services/whatsapp');

// GET /webhook — Meta verification handshake
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('Webhook verified by Meta.');
    return res.status(200).send(challenge);
  }
  console.warn('Webhook verification failed — token mismatch.');
  return res.status(403).json({ error: 'Forbidden' });
});

// POST /webhook — incoming messages from WhatsApp
router.post('/', async (req, res) => {
  // Respond to Meta immediately — processing is async
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const incomingMessages = value?.messages;

    // Ignore delivery/read receipts and other non-message events
    if (!incomingMessages || incomingMessages.length === 0) return;

    const message = incomingMessages[0];
    if (message.type !== 'text') return;

    const phoneNumber = message.from;
    const messageText = message.text.body.trim();
    const timestamp = new Date(parseInt(message.timestamp, 10) * 1000);

    console.log(`Incoming WhatsApp message from ${phoneNumber}: "${messageText}"`);

    // Find or create an open conversation for this phone number
    const convResult = await db.query(
      `SELECT * FROM conversations
       WHERE customer_phone = $1 AND status != 'resolved'
       ORDER BY created_at DESC LIMIT 1`,
      [phoneNumber]
    );

    let conversation;
    if (convResult.rows.length === 0) {
      const newConv = await db.query(
        `INSERT INTO conversations (customer_phone, status) VALUES ($1, 'active') RETURNING *`,
        [phoneNumber]
      );
      conversation = newConv.rows[0];
    } else {
      conversation = convResult.rows[0];
    }

    // Persist the customer message
    await db.query(
      `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'user', $2, $3)`,
      [conversation.id, messageText, timestamp]
    );

    await db.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [conversation.id]
    );

    // Human takeover: skip AI, let admin reply manually
    if (conversation.status === 'human_takeover') {
      console.log(`Conversation ${conversation.id} is under human takeover — skipping AI.`);
      return;
    }

    // Fetch last 20 messages for GPT context
    const historyResult = await db.query(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY timestamp ASC
       LIMIT 20`,
      [conversation.id]
    );

    // Fetch configurable system prompt
    const settingResult = await db.query(
      `SELECT value FROM settings WHERE key = 'system_prompt'`
    );
    const systemPrompt =
      settingResult.rows[0]?.value ||
      'You are a helpful customer support agent.';

    // Generate AI reply
    const aiResponse = await generateAIResponse(systemPrompt, historyResult.rows);

    // Persist assistant message
    await db.query(
      `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'assistant', $2, NOW())`,
      [conversation.id, aiResponse]
    );

    await db.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [conversation.id]
    );

    // Send reply via WhatsApp
    await sendWhatsAppMessage(phoneNumber, aiResponse);
    console.log(`AI reply sent to ${phoneNumber}.`);
  } catch (err) {
    console.error('Error processing webhook:', err.message);
  }
});

module.exports = router;
