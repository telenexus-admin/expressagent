const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendWhatsAppMessage, sendWhatsAppButtons } = require('../services/whatsapp');
const {
  FEEDBACK_BUTTONS,
  ensureRemarksSchema,
  looksLikeConversationComplete,
  hasSurveyForConversation,
  createSurveyRequest,
  saveButtonResponse,
} = require('../services/clientRemarks');

async function findContext(phoneNumberId, phoneNumber) {
  const clients = await db.query(
    `SELECT * FROM clients WHERE meta_phone_number_id = $1 AND status = 'active' LIMIT 1`,
    [phoneNumberId]
  );
  const client = clients.rows[0];
  if (!client) return null;
  const conversations = await db.query(
    `SELECT * FROM conversations WHERE client_id = $1 AND customer_phone = $2 ORDER BY updated_at DESC LIMIT 1`,
    [client.id, phoneNumber]
  );
  const conversation = conversations.rows[0];
  return conversation ? { client, conversation } : null;
}

async function saveChatLine(conversationId, role, content) {
  await db.query(
    `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, $2, $3, NOW())`,
    [conversationId, role, content]
  );
  await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
}

router.use(async (req, res, next) => {
  if (req.method !== 'POST') return next();
  try {
    const value = req.body && req.body.entry && req.body.entry[0] && req.body.entry[0].changes[0].value;
    const message = value && value.messages && value.messages[0];
    const phoneNumberId = value && value.metadata && value.metadata.phone_number_id;
    if (!message || !phoneNumberId) return next();
    const context = await findContext(phoneNumberId, message.from);
    if (!context) return next();
    const { client, conversation } = context;
    await ensureRemarksSchema();

    const buttonId = message.type === 'interactive' && message.interactive && message.interactive.button_reply
      ? message.interactive.button_reply.id : null;
    if (buttonId && buttonId.startsWith('cx_')) {
      const result = await saveButtonResponse(conversation.id, buttonId);
      if (!result) return res.status(200).send('EVENT_RECEIVED');
      await saveChatLine(conversation.id, 'user', `[Experience feedback: ${result.choice.label}]`);
      if (result.choice.requiresFollowup) {
        await db.query(`UPDATE conversations SET status = 'human_takeover' WHERE id = $1`, [conversation.id]);
        await db.query(
          `INSERT INTO escalations (conversation_id, client_id, customer_phone, customer_name, trigger_message, notify_status, type, summary)
           VALUES ($1, $2, $3, $4, $5, 'logged', 'human', $6)`,
          [conversation.id, client.id, message.from, conversation.customer_name, 'Customer selected Need help in experience survey.', 'Customer needs further help after AI assistance.']
        );
        const reply = 'Thank you. I have flagged this for our support team so that someone can follow up and assist you.';
        await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, message.from, reply);
        await saveChatLine(conversation.id, 'assistant', reply);
      } else {
        await db.query(`UPDATE conversations SET status = 'resolved' WHERE id = $1`, [conversation.id]);
        const reply = result.choice.key === 'excellent'
          ? 'Thank you! We are happy we could help you today.'
          : 'Thank you for your feedback. We will keep improving your experience.';
        await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, message.from, reply);
        await saveChatLine(conversation.id, 'assistant', reply);
      }
      return res.status(200).send('EVENT_RECEIVED');
    }

    if (message.type !== 'text' || conversation.status === 'human_takeover') return next();
    const customerText = String(message.text.body || '').trim();
    if (!looksLikeConversationComplete(customerText) || await hasSurveyForConversation(conversation.id)) return next();
    const saved = await createSurveyRequest({ clientId: client.id, conversationId: conversation.id, customerPhone: message.from, customerName: conversation.customer_name, reason: 'Customer indicated completion.' });
    if (!saved) return next();
    await saveChatLine(conversation.id, 'user', customerText);
    const survey = 'Glad I could assist. Before you go, how was your experience with our AI support today?';
    await sendWhatsAppButtons(client.meta_phone_number_id, client.meta_access_token, message.from, survey, FEEDBACK_BUTTONS, 'Your feedback helps us improve.');
    await saveChatLine(conversation.id, 'assistant', `${survey} [Excellent | Okay | Need help]`);
    return res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('Feedback webhook handling failed:', err.message);
    return next();
  }
});

module.exports = router;
