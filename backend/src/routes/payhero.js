const express = require('express');
const db = require('../db');
const { ensurePayHeroSchema } = require('../services/payhero');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { sendClientText } = require('../services/clientEvolution');

const router = express.Router();

router.post('/callback/:clientId', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    await ensurePayHeroSchema();
    const clientResult = await db.query(
      `SELECT * FROM clients WHERE id = $1 AND payhero_callback_secret = $2 LIMIT 1`,
      [req.params.clientId, String(req.query.token || '')]
    );
    const client = clientResult.rows[0];
    if (!client) return;
    const response = req.body?.response || {};
    const externalReference = String(response.ExternalReference || '');
    if (!externalReference) return;
    const successful = Number(response.ResultCode) === 0 || String(response.Status || '').toLowerCase() === 'success';
    const status = successful ? 'paid' : 'failed';
    const updated = await db.query(
      `UPDATE payhero_payment_requests
       SET status = $1, result_description = $2, mpesa_receipt_number = $3,
           checkout_request_id = COALESCE($4, checkout_request_id), raw_response = $5::jsonb, updated_at = NOW()
       WHERE client_id = $6 AND external_reference = $7 AND status <> 'paid'
       RETURNING *`,
      [
        status,
        response.ResultDesc || response.Status || null,
        response.MpesaReceiptNumber || null,
        response.CheckoutRequestID || null,
        JSON.stringify(req.body || {}),
        client.id,
        externalReference,
      ]
    );
    const payment = updated.rows[0];
    if (!payment) return;
    const text = successful
      ? `Payment received successfully. KES ${payment.amount}${payment.mpesa_receipt_number ? `, receipt ${payment.mpesa_receipt_number}` : ''}. Thank you.`
      : `The M-Pesa payment was not completed. ${payment.result_description || 'You can request another prompt when ready.'}`;
    if (client.connection_provider === 'evolution') await sendClientText(client, payment.customer_phone, text);
    else await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, payment.customer_phone, text);
    if (payment.conversation_id) {
      await db.query(
        `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'assistant', $2, NOW())`,
        [payment.conversation_id, text]
      );
    }
  } catch (err) {
    console.error('PayHero callback processing failed:', err.response?.data || err.message);
  }
});

module.exports = router;
