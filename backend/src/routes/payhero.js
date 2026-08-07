const express = require('express');
const db = require('../db');
const { ensurePayHeroSchema } = require('../services/payhero');
const {
  fulfillHotspotPayment,
} = require('../services/hotspotPayments');

const {
  fulfillAgentWalletPayment,
} = require('./billingAgents');
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

function callbackObject(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
    ? value
    : null;
}

function callbackField(
  objects,
  fieldNames
) {
  for (const object of objects) {
    if (!object) continue;

    for (const fieldName of fieldNames) {
      if (
        Object.prototype.hasOwnProperty.call(
          object,
          fieldName
        ) &&
        object[fieldName] !== null &&
        object[fieldName] !== undefined &&
        object[fieldName] !== ''
      ) {
        return object[fieldName];
      }
    }
  }

  return null;
}

function normalizePayHeroCallback(body = {}) {
  const objects = [
    callbackObject(body.response),
    callbackObject(body.data?.response),
    callbackObject(body.data),
    callbackObject(body.Body?.stkCallback),
    callbackObject(body.stkCallback),
    callbackObject(body),
  ].filter(Boolean);

  const rawResultCode = callbackField(
    objects,
    [
      'ResultCode',
      'result_code',
      'resultCode',
      'ResponseCode',
      'response_code',
    ]
  );

  const resultCode =
    rawResultCode === null
      ? null
      : Number(rawResultCode);

  const statusText = String(
    callbackField(
      objects,
      [
        'Status',
        'status',
        'payment_status',
        'transaction_status',
        'state',
      ]
    ) || ''
  ).trim().toLowerCase();

  const externalReference = String(
    callbackField(
      objects,
      [
        'ExternalReference',
        'external_reference',
        'externalReference',
        'account_reference',
        'AccountReference',
      ]
    ) || ''
  ).trim();

  const checkoutRequestId = String(
    callbackField(
      objects,
      [
        'CheckoutRequestID',
        'checkout_request_id',
        'checkoutRequestId',
      ]
    ) || ''
  ).trim();

  const payheroReference = String(
    callbackField(
      objects,
      [
        'merchant_reference',
        'MerchantReference',
        'reference',
        'payhero_reference',
        'MerchantRequestID',
      ]
    ) || ''
  ).trim();

  const receipt = String(
    callbackField(
      objects,
      [
        'MpesaReceiptNumber',
        'mpesa_receipt_number',
        'mpesaReceiptNumber',
        'TransactionID',
        'transaction_id',
        'transactionId',
        'receipt_number',
        'ReceiptNumber',
      ]
    ) || ''
  ).trim();

  const description = String(
    callbackField(
      objects,
      [
        'ResultDesc',
        'result_description',
        'result_desc',
        'message',
        'Message',
        'description',
      ]
    ) || statusText || ''
  ).trim();

  const amountValue = callbackField(
    objects,
    [
      'Amount',
      'amount',
      'TransAmount',
    ]
  );

  const amount =
    amountValue === null
      ? null
      : Number(amountValue);

  const successfulStatuses = new Set([
    'success',
    'successful',
    'paid',
    'completed',
    'complete',
    'processed',
  ]);

  const failedStatuses = new Set([
    'failed',
    'failure',
    'cancelled',
    'canceled',
    'rejected',
    'declined',
    'expired',
    'timeout',
  ]);

  const explicitFailure = (
    (
      Number.isFinite(resultCode) &&
      resultCode !== 0
    ) ||
    failedStatuses.has(statusText)
  );

  const successful = (
    !explicitFailure &&
    (
      (
        Number.isFinite(resultCode) &&
        resultCode === 0
      ) ||
      successfulStatuses.has(statusText) ||
      Boolean(receipt)
    )
  );

  return {
    successful,
    explicitFailure,
    resultCode:
      Number.isFinite(resultCode)
        ? resultCode
        : null,
    statusText,
    externalReference,
    checkoutRequestId,
    payheroReference,
    receipt,
    description,
    amount:
      Number.isFinite(amount)
        ? amount
        : null,
  };
}

router.post('/callback/:clientId', async (req, res) => {
  res.status(200).json({
    received: true,
  });

  try {
    await ensurePayHeroSchema();

    const clientResult = await db.query(
      `SELECT *
       FROM clients
       WHERE id = $1
         AND payhero_callback_secret = $2
       LIMIT 1`,
      [
        req.params.clientId,
        String(req.query.token || ''),
      ]
    );

    const client = clientResult.rows[0];

    if (!client) {
      return;
    }

    const callback =
      normalizePayHeroCallback(
        req.body || {}
      );

    if (
      !callback.externalReference &&
      !callback.checkoutRequestId &&
      !callback.payheroReference
    ) {
      console.warn(
        `[client ${client.id}] PayHero callback did not contain a usable payment reference.`
      );

      return;
    }

    const status =
      callback.successful
        ? 'paid'
        : 'failed';

    const updated = await db.query(
      `UPDATE payhero_payment_requests
       SET
         status =
           CASE
             WHEN status = 'paid'
             THEN 'paid'
             ELSE $1
           END,
         result_description =
           COALESCE(
             NULLIF($2, ''),
             result_description
           ),
         mpesa_receipt_number =
           COALESCE(
             NULLIF($3, ''),
             mpesa_receipt_number
           ),
         checkout_request_id =
           COALESCE(
             NULLIF($4, ''),
             checkout_request_id
           ),
         payhero_reference =
           COALESCE(
             NULLIF($5, ''),
             payhero_reference
           ),
         raw_response = $6::jsonb,
         updated_at = NOW()
       WHERE client_id = $7
         AND (
           external_reference =
             NULLIF($8, '')
           OR checkout_request_id =
             NULLIF($9, '')
           OR payhero_reference =
             NULLIF($10, '')
         )
         AND (
           status <> 'paid'
           OR $1 = 'paid'
         )
       RETURNING *`,
      [
        status,
        callback.description,
        callback.receipt,
        callback.checkoutRequestId,
        callback.payheroReference,
        JSON.stringify(req.body || {}),
        client.id,
        callback.externalReference,
        callback.checkoutRequestId,
        callback.payheroReference,
      ]
    );

    const payment = updated.rows[0];

    if (!payment) {
      return;
    }

    if (callback.successful) {
      try {
        await fulfillHotspotPayment(
          payment
        );
      } catch (fulfillmentError) {
        console.error(
          'Hotspot payment fulfillment failed:',
          fulfillmentError.message
        );
      }
    }

    if (callback.successful) {
      try {
        await fulfillAgentWalletPayment(
          payment
        );
      } catch (walletError) {
        console.error(
          'Agent wallet fulfillment failed:',
          walletError.message
        );
      }
    }

    const message = callback.successful
      ? (
          `Payment received successfully. ` +
          `KES ${payment.amount}` +
          (
            payment.mpesa_receipt_number
              ? `, receipt ${
                  payment.mpesa_receipt_number
                }`
              : ''
          ) +
          '. Thank you.'
        )
      : (
          `The M-Pesa payment was not completed. ${
            payment.result_description ||
            'You can request another prompt when ready.'
          }`
        );

    try {
      if (
        client.connection_provider ===
        'evolution'
      ) {
        await sendClientText(
          client,
          payment.customer_phone,
          message
        );
      } else if (
        client.meta_phone_number_id &&
        client.meta_access_token
      ) {
        await sendWhatsAppMessage(
          client.meta_phone_number_id,
          client.meta_access_token,
          payment.customer_phone,
          message
        );
      }
    } catch (notificationError) {
      console.error(
        'PayHero customer notification failed:',
        notificationError.message
      );
    }

    if (payment.conversation_id) {
      await db.query(
        `INSERT INTO messages
           (
             conversation_id,
             role,
             content,
             timestamp
           )
         VALUES (
           $1,
           'assistant',
           $2,
           NOW()
         )`,
        [
          payment.conversation_id,
          message,
        ]
      );
    }

    if (callback.successful) {
      await notifyBillingWorkflowBySms({
        client,
        payment,
      });
    }
  } catch (error) {
    console.error(
      'PayHero callback processing failed:',
      error.response?.data ||
      error.message
    );
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

    if (successful) {
      try {
        await fulfillHotspotPayment(payment);
      } catch (fulfillmentError) {
        console.error(
          'Hotspot payment fulfillment failed:',
          fulfillmentError.message
        );
      }
    }

    if (successful) {
      try {
        await fulfillAgentWalletPayment(
          payment
        );
      } catch (walletError) {
        console.error(
          'Agent wallet fulfillment failed:',
          walletError.message
        );
      }
    }

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
