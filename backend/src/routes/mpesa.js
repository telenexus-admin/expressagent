const express = require('express');
const db = require('../db');
const { ensureDarajaSchema, loadDarajaConfig } = require('../services/daraja');
const { fulfillHotspotPayment } = require('../services/hotspotPayments');
const { fulfillAgentWalletPayment } = require('./billingAgents');
const { fulfillPppoePortalPayment } = require('./pppoePortal');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { sendClientText } = require('../services/clientEvolution');
const { sendSMS } = require('../services/sms');
const { recordPaymentRouteIntent, markPaymentCollectionStatus } = require('../services/paymentRouter');

const router = express.Router();

function callbackMetadata(callback = {}) {
  const items = Array.isArray(callback.CallbackMetadata?.Item)
    ? callback.CallbackMetadata.Item
    : [];
  const values = new Map(items.map((item) => [String(item?.Name || ''), item?.Value]));
  return {
    amount: values.has('Amount') ? Number(values.get('Amount')) : null,
    receipt: values.get('MpesaReceiptNumber') ? String(values.get('MpesaReceiptNumber')) : null,
    transactionDate: values.get('TransactionDate') ? String(values.get('TransactionDate')) : null,
    phone: values.get('PhoneNumber') ? String(values.get('PhoneNumber')) : null,
  };
}

function normalizedStkCallback(body = {}) {
  const callback = body?.Body?.stkCallback || body?.stkCallback || {};
  const resultCode = Number(callback.ResultCode);
  const metadata = callbackMetadata(callback);
  return {
    checkoutRequestId: String(callback.CheckoutRequestID || '').trim(),
    merchantRequestId: String(callback.MerchantRequestID || '').trim(),
    resultCode: Number.isFinite(resultCode) ? resultCode : null,
    resultDescription: String(callback.ResultDesc || '').trim(),
    successful: Number.isFinite(resultCode) && resultCode === 0,
    ...metadata,
  };
}

async function notifyBillingWorkflowBySms({ client, payment }) {
  try {
    await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
    const routeResult = await db.query(
      `SELECT employee_id, employee_ids, is_enabled
       FROM workflow_routes
       WHERE client_id=$1 AND intent_key='payment_billing'
       LIMIT 1`,
      [client.id]
    );
    const route = routeResult.rows[0];
    if (!route?.is_enabled) return;
    const employeeIds = [
      ...(Array.isArray(route.employee_ids) ? route.employee_ids : []),
      route.employee_id,
    ]
      .map((value) => Number(value))
      .filter((value, index, all) => Number.isInteger(value) && value > 0 && all.indexOf(value) === index);
    if (!employeeIds.length) return;

    const employees = (await db.query(
      `SELECT id,name,phone FROM employees
       WHERE client_id=$1 AND is_active=TRUE AND id=ANY($2::int[])`,
      [client.id, employeeIds]
    )).rows.filter((employee) => employee.phone);
    if (!employees.length) return;

    const customer = payment.customer_name
      ? `${payment.customer_name} (+${payment.customer_phone})`
      : `+${payment.customer_phone}`;
    const message = [
      'M-Pesa payment received',
      `Client: ${customer}`,
      `Amount: KES ${Number(payment.amount).toLocaleString('en-KE')}`,
      `Receipt: ${payment.mpesa_receipt_number || 'not shown'}`,
      `Reference: ${payment.external_reference}`,
    ].join('\n');
    const results = await Promise.allSettled(
      employees.map((employee) => sendSMS(employee.phone, message, { client }))
    );
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length) {
      console.error(`[client ${client.id}] Daraja billing workflow SMS had ${failed.length} failure(s).`);
    }
  } catch (error) {
    console.error(`[client ${client.id}] Daraja billing workflow SMS failed:`, error.message);
  }
}

async function notifyCustomer(client, payment, successful) {
  const message = successful
    ? `Payment received successfully. KES ${payment.amount}${payment.mpesa_receipt_number ? `, receipt ${payment.mpesa_receipt_number}` : ''}. Thank you.`
    : `The M-Pesa payment was not completed. ${payment.result_description || 'You can request another prompt when ready.'}`;
  try {
    if (client.connection_provider === 'evolution') {
      await sendClientText(client, payment.customer_phone, message);
    } else if (client.meta_phone_number_id && client.meta_access_token) {
      await sendWhatsAppMessage(
        client.meta_phone_number_id,
        client.meta_access_token,
        payment.customer_phone,
        message
      );
    }
  } catch (error) {
    console.error('Daraja customer notification failed:', error.message);
  }

  if (payment.conversation_id) {
    await db.query(
      `INSERT INTO messages (conversation_id,role,content,timestamp)
       VALUES ($1,'assistant',$2,NOW())`,
      [payment.conversation_id, message]
    ).catch((error) => console.error('Daraja conversation notification failed:', error.message));
  }
}

async function fulfillSuccessfulPayment(payment) {
  const tasks = [
    ['Hotspot payment fulfillment', () => fulfillHotspotPayment(payment)],
    ['Agent wallet fulfillment', () => fulfillAgentWalletPayment(payment)],
    ['PPPoE portal payment fulfillment', () => fulfillPppoePortalPayment(payment)],
  ];
  for (const [label, task] of tasks) {
    try {
      await task();
    } catch (error) {
      console.error(`${label} failed:`, error.message);
    }
  }
}

async function capturePaymentRoute({ clientId, payment, status, providerReference = null, errorMessage = null }) {
  try {
    const route = await recordPaymentRouteIntent({
      clientId,
      paymentRequestId: payment.id,
      externalReference: payment.external_reference,
      amount: Number(payment.amount),
      collectionProvider: payment.payment_provider || 'daraja',
      collectionStatus: status,
    });
    if (!route) return;
    await markPaymentCollectionStatus({
      clientId,
      paymentRequestId: payment.id,
      status,
      providerReference,
      errorMessage,
    });
  } catch (error) {
    // Settlement capture must never turn a valid M-Pesa callback into a failed customer payment.
    console.error(`[client ${clientId}] Payment router capture failed:`, error.message);
  }
}

async function processCallback(req) {
  await ensureDarajaSchema();
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return;

  const config = await loadDarajaConfig(clientId);
  const suppliedToken = String(req.query.token || '');
  if (!config.callbackSecret || suppliedToken.length < 32 || suppliedToken !== config.callbackSecret) {
    console.warn(`[client ${clientId}] Rejected Daraja callback with invalid token.`);
    return;
  }

  const callback = normalizedStkCallback(req.body || {});
  if (!callback.checkoutRequestId) {
    console.warn(`[client ${clientId}] Daraja callback did not include CheckoutRequestID.`);
    return;
  }

  const current = await db.query(
    `SELECT * FROM payhero_payment_requests
     WHERE client_id=$1 AND checkout_request_id=$2
     LIMIT 1`,
    [clientId, callback.checkoutRequestId]
  );
  const existing = current.rows[0];
  if (!existing) {
    console.warn(`[client ${clientId}] Daraja callback did not match a payment request: ${callback.checkoutRequestId}`);
    return;
  }
  // Safaricom may retry callbacks. Re-capture the route idempotently, but never fulfill or notify twice.
  if (existing.status === 'paid') {
    await capturePaymentRoute({
      clientId,
      payment: existing,
      status: 'paid',
      providerReference: existing.mpesa_receipt_number || callback.receipt || null,
    });
    return;
  }

  const missingSuccessMetadata = callback.successful && (!Number.isFinite(callback.amount) || !callback.receipt);
  const amountMismatch = callback.successful && Number.isFinite(callback.amount) && Number(existing.amount) !== callback.amount;
  const successful = callback.successful && !missingSuccessMetadata && !amountMismatch;
  const status = successful ? 'paid' : 'failed';
  let description = callback.resultDescription;
  if (amountMismatch) {
    description = `Daraja callback amount mismatch: expected KES ${existing.amount}, received KES ${callback.amount}`;
  } else if (missingSuccessMetadata) {
    description = 'Daraja success callback was missing the expected amount or M-Pesa receipt';
  }

  const updated = await db.query(
    `UPDATE payhero_payment_requests
     SET status=$1,
         result_description=COALESCE(NULLIF($2,''),result_description),
         mpesa_receipt_number=COALESCE(NULLIF($3,''),mpesa_receipt_number),
         merchant_request_id=COALESCE(NULLIF($4,''),merchant_request_id),
         payhero_reference=COALESCE(NULLIF($4,''),payhero_reference),
         payment_provider='daraja',
         raw_response=$5::jsonb,
         updated_at=NOW()
     WHERE id=$6
     RETURNING *`,
    [
      status,
      description,
      callback.receipt || '',
      callback.merchantRequestId || '',
      JSON.stringify(req.body || {}),
      existing.id,
    ]
  );
  const payment = updated.rows[0];
  if (!payment) return;

  await capturePaymentRoute({
    clientId,
    payment,
    status,
    providerReference: callback.receipt || null,
    errorMessage: successful ? null : description,
  });

  if (successful) await fulfillSuccessfulPayment(payment);

  const clientResult = await db.query(`SELECT * FROM clients WHERE id=$1 LIMIT 1`, [clientId]);
  const client = clientResult.rows[0];
  if (client) {
    await notifyCustomer(client, payment, successful);
    if (successful) await notifyBillingWorkflowBySms({ client, payment });
  }
}

function callbackHandler(req, res) {
  // Safaricom should receive an acknowledgement quickly; processing is idempotent and continues after ACK.
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  setImmediate(() => {
    processCallback(req).catch((error) => {
      console.error('Daraja callback processing failed:', error.response?.data || error.message);
    });
  });
}

router.post('/stk-callback/:clientId', callbackHandler);
// Temporary alias for STK requests issued by the previous direct-Daraja implementation.
router.post('/daraja-callback/:clientId', callbackHandler);

module.exports = router;
module.exports.normalizedStkCallback = normalizedStkCallback;