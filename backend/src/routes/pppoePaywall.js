const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const {
  cleanPhone,
  ensureDarajaSchema,
  initiateDarajaPayment,
  paymentConfiguration,
} = require('../services/daraja');

const router = express.Router();

function normalizeAccount(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function maskPhone(value) {
  const phone = cleanPhone(value || '');
  if (!phone) return '';
  return `${phone.slice(0, 5)}•••${phone.slice(-3)}`;
}

function signPaymentToken({ clientId, subscriberId, reference }) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign(
    {
      kind: 'pppoe_paywall_payment',
      client_id: Number(clientId),
      subscriber_id: Number(subscriberId),
      reference: String(reference),
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function verifyPaymentToken(token, reference) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  const decoded = jwt.verify(String(token || ''), process.env.JWT_SECRET);
  if (decoded.kind !== 'pppoe_paywall_payment' || String(decoded.reference) !== String(reference)) {
    throw new Error('Invalid payment status token');
  }
  return decoded;
}

async function resolveSubscriber(accountNumber, rawPhone) {
  await ensureDarajaSchema();
  const account = normalizeAccount(accountNumber);
  const phone = cleanPhone(rawPhone || '');
  if (!account || !/^254[17]\d{8}$/.test(phone)) return null;

  const result = await db.query(
    `SELECT
       s.id,s.client_id,s.full_name,s.phone,s.account_number,s.plan_id,
       s.service_status,s.radius_status,s.expires_at,s.access_mode,
       p.name AS plan_name,p.price AS plan_price,p.validity_days,p.is_active AS plan_is_active,
       c.name AS client_name,c.business_name,c.account_type
     FROM billing_subscribers s
     JOIN billing_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
     JOIN clients c ON c.id=s.client_id
     WHERE UPPER(s.account_number)=UPPER($1)
       AND COALESCE(s.access_mode,'pppoe') IN ('pppoe','pppoe_static')
       AND c.account_type='billing'
     LIMIT 2`,
    [account]
  );

  if (result.rows.length !== 1) return null;
  const subscriber = result.rows[0];
  if (cleanPhone(subscriber.phone || '') !== phone) return null;
  return subscriber;
}

function paymentRequired(subscriber) {
  const status = String(subscriber?.service_status || '').toLowerCase();
  const expiry = subscriber?.expires_at ? new Date(subscriber.expires_at) : null;
  const expiredByTime = expiry && Number.isFinite(expiry.getTime()) && expiry <= new Date();
  return ['expired', 'pending'].includes(status) || Boolean(expiredByTime);
}

async function directBankReadiness(clientId) {
  const readiness = await paymentConfiguration(clientId);
  if (!readiness?.ready || !readiness.destination) {
    const error = new Error(readiness?.error || 'Direct-to-bank M-Pesa is not configured for this ISP');
    error.code = 'DIRECT_BANK_NOT_READY';
    throw error;
  }
  return readiness;
}

router.post('/resolve', async (req, res) => {
  try {
    const subscriber = await resolveSubscriber(req.body.account_number, req.body.phone);
    if (!subscriber) {
      return res.status(404).json({ error: 'The account number and registered phone number do not match.' });
    }
    if (!subscriber.plan_is_active) {
      return res.status(409).json({ error: 'The linked internet package is no longer active. Contact your ISP.' });
    }
    if (!paymentRequired(subscriber)) {
      return res.status(409).json({ error: 'This subscription is still active. Use the customer portal if you want to renew early.' });
    }

    const amount = Number(subscriber.plan_price);
    if (!Number.isInteger(amount) || amount < 10) {
      return res.status(409).json({ error: 'This package cannot be paid by STK until its price is a whole KES amount of at least KES 10.' });
    }

    const readiness = await directBankReadiness(subscriber.client_id);
    const destination = readiness.destination;

    return res.json({
      ready: true,
      holds_funds: false,
      subscriber: {
        account_number: subscriber.account_number,
        full_name: subscriber.full_name,
        phone: maskPhone(subscriber.phone),
        service_status: subscriber.service_status,
        expires_at: subscriber.expires_at,
      },
      network: {
        name: subscriber.business_name || subscriber.client_name || 'Internet Provider',
      },
      package: {
        id: subscriber.plan_id,
        name: subscriber.plan_name,
        amount,
        validity_days: Number(subscriber.validity_days || 0),
      },
      settlement: {
        mode: 'direct_bank_stk',
        institution_code: destination.institutionCode,
        institution_name: destination.institutionName,
        bank_account_last4: destination.accountLast4,
      },
    });
  } catch (error) {
    const status = error.code === 'DIRECT_BANK_NOT_READY' ? 409 : 500;
    return res.status(status).json({ error: error.message || 'Could not load payment details.' });
  }
});

router.post('/stk', async (req, res) => {
  try {
    const subscriber = await resolveSubscriber(req.body.account_number, req.body.phone);
    if (!subscriber) {
      return res.status(404).json({ error: 'The account number and registered phone number do not match.' });
    }
    if (!subscriber.plan_is_active || !paymentRequired(subscriber)) {
      return res.status(409).json({ error: 'This account is not currently eligible for the expired-package payment page.' });
    }

    const amount = Number(subscriber.plan_price);
    if (!Number.isInteger(amount) || amount < 10) {
      return res.status(409).json({ error: 'This package cannot be paid by STK until its price is a whole KES amount of at least KES 10.' });
    }

    await directBankReadiness(subscriber.client_id);

    const clientResult = await db.query(
      `SELECT * FROM clients WHERE id=$1 AND account_type='billing' LIMIT 1`,
      [subscriber.client_id]
    );
    const billingClient = clientResult.rows[0];
    if (!billingClient) return res.status(404).json({ error: 'ISP billing account was not found.' });

    const result = await initiateDarajaPayment({
      client: billingClient,
      conversationId: null,
      customerPhone: subscriber.phone,
      customerName: subscriber.full_name,
      amount,
      metadata: {
        purpose: 'pppoe_portal',
        version: 3,
        payment_origin: 'pppoe_expired_paywall',
        direct_bank_required: true,
        subscriber_id: Number(subscriber.id),
        portal_account_id: null,
        account_number: subscriber.account_number,
        current_plan_id: subscriber.plan_id ? Number(subscriber.plan_id) : null,
        target_plan_id: Number(subscriber.plan_id),
        plan_name_snapshot: subscriber.plan_name,
        amount_snapshot: amount,
        action: 'renew',
      },
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Could not send the M-Pesa STK prompt.' });
    }
    if (!result.settlement || result.settlement.mode !== 'direct_bank_stk') {
      console.error(`PPPoE paywall direct-bank invariant failed for ${result.externalReference || 'unknown reference'}`);
      return res.status(500).json({ error: 'Payment was not confirmed as direct-to-bank. Contact your ISP before retrying.' });
    }

    return res.status(201).json({
      success: true,
      reference: result.externalReference,
      checkout_request_id: result.checkoutRequestId || null,
      status: result.status,
      amount,
      holds_funds: false,
      poll_token: signPaymentToken({
        clientId: subscriber.client_id,
        subscriberId: subscriber.id,
        reference: result.externalReference,
      }),
      settlement: result.settlement,
      message: `M-Pesa prompt sent. KES ${amount} goes directly to ${result.settlement.institutionName} account ending ${result.settlement.accountLast4}.`,
    });
  } catch (error) {
    const status = error.code === 'DIRECT_BANK_NOT_READY' ? 409 : 500;
    console.error('PPPoE expired paywall STK error:', error.message);
    return res.status(status).json({ error: error.message || 'Could not start the M-Pesa payment.' });
  }
});

router.post('/status', async (req, res) => {
  try {
    const reference = String(req.body.reference || '').trim();
    if (!reference) return res.status(400).json({ error: 'Payment reference is required.' });
    const decoded = verifyPaymentToken(req.body.poll_token, reference);

    const result = await db.query(
      `SELECT
         request.status AS provider_status,
         request.result_description,
         request.mpesa_receipt_number,
         request.amount,
         portal.status AS portal_status,
         portal.applied_at
       FROM payhero_payment_requests request
       LEFT JOIN billing_pppoe_portal_payments portal
         ON portal.external_reference=request.external_reference
        AND portal.client_id=request.client_id
        AND portal.subscriber_id=$3
       WHERE request.client_id=$1
         AND request.external_reference=$2
       LIMIT 1`,
      [decoded.client_id, reference, decoded.subscriber_id]
    );

    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Payment request was not found.' });
    const effectiveStatus = row.applied_at
      ? 'applied'
      : row.portal_status || row.provider_status || 'initiated';

    return res.json({
      reference,
      effective_status: effectiveStatus,
      provider_status: row.provider_status,
      applied_at: row.applied_at || null,
      receipt: row.mpesa_receipt_number || null,
      result_description: row.result_description || null,
      amount: Number(row.amount || 0),
    });
  } catch (error) {
    const authFailure = ['JsonWebTokenError', 'TokenExpiredError'].includes(error.name)
      || error.message === 'Invalid payment status token';
    return res.status(authFailure ? 401 : 500).json({
      error: authFailure ? 'Payment status session expired.' : (error.message || 'Could not check payment status.'),
    });
  }
});

module.exports = router;