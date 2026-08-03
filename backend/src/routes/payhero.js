const express = require('express');
const db = require('../db');
const { ensurePayHeroSchema } = require('../services/payhero');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { sendClientText } = require('../services/clientEvolution');
const { sendSMS } = require('../services/sms');

const router = express.Router();

function normalizeEmployeeIds(value, fallback = null) {
  const source = Array.isArray(value) ? value : [];
  const ids = source.map((item) => parseInt(item, 10)).filter((item) => Number.isInteger(item) && item > 0);
  if (ids.length === 0 && fallback) ids.push(parseInt(fallback, 10));
  return [...new Set(ids)].filter((item) => Number.isInteger(item) && item > 0);
}

async function ensureWorkflowColumns() {
  await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`UPDATE workflow_routes SET employee_ids = jsonb_build_array(employee_id) WHERE employee_id IS NOT NULL AND employee_ids = '[]'::jsonb`);
}

async function notifyBillingWorkflowBySms({ client, payment }) {
  try {
    await ensureWorkflowColumns();
    const routeResult = await db.query(
      `SELECT employee_id, employee_ids, is_enabled
       FROM workflow_routes
       WHERE client_id = $1 AND intent_key = 'payment_billing'
       LIMIT 1`,
      [client.id]
    );
    const route = routeResult.rows[0];
    const employeeIds = normalizeEmployeeIds(route?.employee_ids, route?.employee_id);
    if (!route || !route.is_enabled || employeeIds.length === 0) return;

    const employees = (await db.query(
      `SELECT id, name, phone
       FROM employees
       WHERE client_id = $1 AND is_active = TRUE AND id = ANY($2::int[])
       ORDER BY name ASC`,
      [client.id, employeeIds]
    )).rows.filter((employee) => employee.phone);
    if (employees.length === 0) return;

    const customer = payment.customer_name
      ? `${payment.customer_name} (+${payment.customer_phone})`
      : `+${payment.customer_phone}`;
    const message =
      `Payment received\n` +
      `Client: ${customer}\n` +
      `Amount: KES ${Number(payment.amount).toLocaleString('en-KE')}\n` +
      `Receipt: ${payment.mpesa_receipt_number || 'not shown'}\n` +
      `Reference: ${payment.external_reference}`;

    const results = await Promise.allSettled(
      employees.map((employee) => sendSMS(employee.phone, message, { client }))
    );
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length) {
      console.error(
        `[client ${client.id}] PayHero billing SMS had ${failed.length} failure(s): ` +
          failed.map((result) => result.reason?.message || result.reason).join(' | ')
      );
    }
    if (results.some((result) => result.status === 'fulfilled')) {
      console.log(`[client ${client.id}] PayHero payment SMS sent to ${employees.length - failed.length}/${employees.length} billing workflow recipient(s).`);
    }
  } catch (err) {
    console.error(`[client ${client.id}] PayHero billing workflow SMS failed:`, err.message || err);
  }
}

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
    if (successful) {
      await notifyBillingWorkflowBySms({ client, payment });
    }
  } catch (err) {
    console.error('PayHero callback processing failed:', err.response?.data || err.message);
  }
});

router.post('/daraja-callback/:clientId', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    await ensurePayHeroSchema();
    const clientResult = await db.query(
      `SELECT * FROM clients WHERE id = $1 AND payhero_callback_secret = $2 LIMIT 1`,
      [req.params.clientId, String(req.query.token || '')]
    );
    const client = clientResult.rows[0];
    if (!client) return;
    const callback = req.body?.Body?.stkCallback || req.body?.stkCallback || {};
    const checkoutRequestId = String(callback.CheckoutRequestID || '');
    if (!checkoutRequestId) return;
    const metadata = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
    const receipt = metadata.find((item) => item.Name === 'MpesaReceiptNumber')?.Value || null;
    const successful = Number(callback.ResultCode) === 0;
    const status = successful ? 'paid' : 'failed';
    const updated = await db.query(
      `UPDATE payhero_payment_requests
       SET status = $1, result_description = $2, mpesa_receipt_number = $3,
           raw_response = $4::jsonb, updated_at = NOW()
       WHERE client_id = $5 AND checkout_request_id = $6 AND status <> 'paid'
       RETURNING *`,
      [
        status,
        callback.ResultDesc || null,
        receipt,
        JSON.stringify(req.body || {}),
        client.id,
        checkoutRequestId,
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
    if (successful) await notifyBillingWorkflowBySms({ client, payment });
  } catch (err) {
    console.error('Daraja callback processing failed:', err.response?.data || err.message);
  }
});

module.exports = router;
