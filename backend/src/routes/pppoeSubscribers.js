const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { encryptPassword } = require('../services/radiusSync');
const { sendEmail, isEmailConfigured } = require('../services/email');
const { sendSMS } = require('../services/sms');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { sendClientText } = require('../services/clientEvolution');
const { appendRequestEvent, ensureEventSchema } = require('../services/events');
const {
  cleanPhone,
  initiateDarajaPayment,
  paymentConfiguration,
} = require('../services/daraja');
const {
  normalizePppoeUsername,
  rateLimitFromPlan,
} = require('../services/pppoeProvisioning');
const {
  allocatePppoeAccountNumber,
  ensurePppoeAccountNumberSchema,
} = require('../services/pppoeAccountNumbers');
const {
  createManualBankClaim,
  ensureManualBankPaymentSchema,
  listManualBankClaims,
  manualBankInstructions,
  rejectManualBankClaim,
  verifyManualBankClaim,
} = require('../services/pppoeManualBankPayments');

const router = express.Router();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function subscriberWithPlan(clientId, subscriberId) {
  const result = await db.query(
    `SELECT s.*,p.name AS plan_name,p.price AS plan_price,p.validity_days AS plan_validity_days,
            p.is_active AS plan_is_active
     FROM billing_subscribers s
     JOIN billing_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
     WHERE s.id=$1 AND s.client_id=$2
       AND COALESCE(s.access_mode,'pppoe') IN ('pppoe','pppoe_static')
     LIMIT 1`,
    [subscriberId, clientId]
  );
  return result.rows[0] || null;
}

async function directBankPaymentOptions(clientId, subscriberId, accountNumber, amount) {
  let stk;
  try {
    const readiness = await paymentConfiguration(clientId);
    const destination = readiness?.destination || null;
    if (!readiness?.ready || !destination) {
      stk = {
        method: 'direct_bank_stk',
        ready: false,
        holds_funds: false,
        error: readiness?.error || 'Direct-to-bank M-Pesa STK is not configured for this ISP',
      };
    } else {
      stk = {
        method: 'direct_bank_stk',
        ready: true,
        holds_funds: false,
        institution_code: destination.institutionCode,
        institution_name: destination.institutionName,
        bank_paybill: destination.paybill,
        bank_account_last4: destination.accountLast4,
      };
    }
  } catch (error) {
    stk = {
      method: 'direct_bank_stk',
      ready: false,
      holds_funds: false,
      error: error.message || 'Direct-bank STK readiness could not be checked',
    };
  }

  let manual;
  try {
    manual = await manualBankInstructions({ clientId, subscriberId });
  } catch (error) {
    manual = {
      method: 'manual_bank_paybill',
      ready: false,
      holds_funds: false,
      error: error.message || 'Manual direct-bank Paybill is not configured for this ISP',
    };
  }

  return {
    method: 'direct_bank',
    ready: Boolean(stk.ready || manual.ready),
    holds_funds: false,
    account_number: accountNumber,
    amount: Number(amount),
    stk,
    manual,
    purpose: 'All PPPoE subscriber payments go directly to the ISP configured bank account. Polyizon never receives or holds the funds.',
  };
}

function welcomePaymentInstructions(payment, accountNumber) {
  const lines = [
    `Your Polyizon subscriber reference is ${accountNumber}.`,
  ];

  if (payment?.manual?.ready) {
    lines.push(
      'Manual M-Pesa Paybill option:',
      `Paybill ${payment.manual.paybill}, account ${payment.manual.bank_account_number}, amount KES ${Number(payment.manual.amount).toLocaleString('en-KE')}.`,
      `Keep the M-Pesa receipt and send it to your ISP together with subscriber reference ${accountNumber} for verification.`
    );
  }

  if (payment?.stk?.ready) {
    lines.push('You can also request a direct-bank M-Pesa STK prompt from your ISP.');
  }

  if (!payment?.manual?.ready && !payment?.stk?.ready) {
    lines.push('Direct-to-bank payment is not ready yet. Contact your ISP before paying.');
  }

  lines.push('Polyizon never receives or holds your subscription money.');
  return lines.join('\n');
}

async function deliverWelcomeNotice({ client, subscriber, plan, payment }) {
  const businessName = String(client?.business_name || client?.name || 'Polyizon').trim();
  const firstName = String(subscriber.full_name || '').trim().split(/\s+/)[0] || 'there';
  const packagePrice = Number(plan.price || 0).toLocaleString('en-KE');
  const instructions = welcomePaymentInstructions(payment, subscriber.account_number);
  const message = [
    `Welcome to ${businessName}, ${firstName}.`,
    `Your PPPoE account reference is ${subscriber.account_number}.`,
    `Package: ${plan.name} — KES ${packagePrice} for ${plan.validity_days} days.`,
    instructions,
    'Your internet activates only after the payment is confirmed.',
  ].join('\n');

  const results = [];
  const add = async (channel, task) => {
    try {
      const result = await task();
      results.push({ channel, status: result?.status || 'sent', error: result?.error || null });
    } catch (error) {
      results.push({ channel, status: 'failed', error: error.message || 'Delivery failed' });
    }
  };

  if (subscriber.phone) {
    if (client?.connection_provider === 'evolution') {
      await add('whatsapp', () => sendClientText(client, subscriber.phone, message));
    } else if (client?.meta_phone_number_id && client?.meta_access_token) {
      await add('whatsapp', () => sendWhatsAppMessage(
        client.meta_phone_number_id,
        client.meta_access_token,
        subscriber.phone,
        message
      ));
    } else {
      results.push({ channel: 'whatsapp', status: 'skipped', error: 'WhatsApp is not configured' });
    }
    await add('sms', () => sendSMS(subscriber.phone, message, { client }));
  } else {
    results.push({ channel: 'message', status: 'skipped', error: 'Customer phone is not set' });
  }

  if (subscriber.email) {
    if (!isEmailConfigured(client)) {
      results.push({ channel: 'email', status: 'skipped', error: 'Email is not configured' });
    } else {
      const fromName = String(client.email_from_name || client.business_name || client.name || 'Polyizon').trim();
      const fromAddress = String(client.email_from_address || process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM_EMAIL || '').trim();
      await add('email', () => sendEmail(client, {
        from: `${fromName} <${fromAddress}>`,
        to: [subscriber.email],
        reply_to: client.email_reply_to || fromAddress,
        subject: `Welcome to ${businessName} — payment details`,
        text: message,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;color:#172033;line-height:1.6"><h2>Welcome to ${escapeHtml(businessName)}</h2><p>Hello ${escapeHtml(firstName)},</p><p>Your PPPoE account has been created and is waiting for payment.</p><div style="background:#f5f3ff;border-radius:14px;padding:16px;margin:18px 0"><strong>Subscriber reference: ${escapeHtml(subscriber.account_number)}</strong><br>Package: ${escapeHtml(plan.name)}<br>Amount: KES ${escapeHtml(packagePrice)}<br>Validity: ${escapeHtml(plan.validity_days)} days</div><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(instructions)}</pre><p>Your internet activates after the payment is verified. Polyizon does not receive or hold the subscription funds.</p></div>`,
      }));
    }
  } else {
    results.push({ channel: 'email', status: 'skipped', error: 'Customer email is not set' });
  }

  return { message, deliveries: results };
}

router.use(authMiddleware, scopeMiddleware);

router.use(async (req, res, next) => {
  if (req.scope.isSuperadmin || !req.scope.clientId) {
    return res.status(403).json({ error: 'Billing workspace access required' });
  }

  const result = await db.query(
    'SELECT account_type FROM clients WHERE id=$1 LIMIT 1',
    [req.scope.clientId]
  );
  if (result.rows[0]?.account_type !== 'billing') {
    return res.status(403).json({ error: 'This account is not a billing workspace' });
  }
  return next();
});

router.post('/', [
  body('full_name').trim().notEmpty().isLength({ max: 255 }),
  body('phone').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 80 }),
  body('email').optional({ nullable: true, checkFalsy: true }).trim().isEmail().isLength({ max: 255 }),
  body('radius_username')
    .trim()
    .matches(/^[A-Za-z0-9._@-]{3,64}$/)
    .withMessage('PPPoE username must be 3-64 letters, numbers, dots, dashes, underscores, or @'),
  body('radius_password')
    .isString()
    .matches(/^\S{8,128}$/)
    .withMessage('PPPoE password must be 8-128 characters with no spaces'),
  body('plan_id').isInt({ min: 1 }),
  body('router_id').isInt({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const clientId = req.scope.clientId;
  const radiusUsername = normalizePppoeUsername(req.body.radius_username);
  const radiusPassword = String(req.body.radius_password || '');
  const planId = Number(req.body.plan_id);
  const routerId = Number(req.body.router_id);

  try {
    await Promise.all([
      ensurePppoeAccountNumberSchema(),
      ensureManualBankPaymentSchema(),
    ]);

    const [planResult, routerResult, duplicateResult, clientSettingsResult] = await Promise.all([
      db.query(
        `SELECT id,name,price,validity_days,router_id,radius_profile,download_speed_mbps,upload_speed_mbps
         FROM billing_plans
         WHERE id=$1 AND client_id=$2 AND is_active=TRUE
         LIMIT 1`,
        [planId, clientId]
      ),
      db.query(
        `SELECT id,name
         FROM mikrotik_routers
         WHERE id=$1 AND client_id=$2 AND is_active=TRUE
         LIMIT 1`,
        [routerId, clientId]
      ),
      db.query(
        `SELECT radius_username
         FROM billing_subscribers
         WHERE client_id=$1 AND radius_username IS NOT NULL AND LOWER(radius_username)=LOWER($2)
         LIMIT 1`,
        [clientId, radiusUsername]
      ),
      db.query('SELECT * FROM clients WHERE id=$1 LIMIT 1', [clientId]),
    ]);

    const plan = planResult.rows[0];
    const selectedRouter = routerResult.rows[0];
    if (!plan) return res.status(400).json({ error: 'Choose an active PPPoE package from this billing workspace' });
    if (!selectedRouter) return res.status(400).json({ error: 'Choose an active MikroTik router from this billing workspace' });
    if (plan.router_id && Number(plan.router_id) !== routerId) {
      return res.status(400).json({ error: 'That package is assigned to a different MikroTik router' });
    }
    if (duplicateResult.rows[0]) {
      return res.status(409).json({ error: 'That PPPoE username is already used by another Polyizon subscriber' });
    }

    const billingClient = clientSettingsResult.rows[0] || {};
    const rateLimit = rateLimitFromPlan(plan);
    if (!rateLimit) {
      return res.status(400).json({ error: 'This package has no RADIUS speed profile. Set upload/download speeds or a RADIUS rate-limit first.' });
    }
    if (!(Number(plan.validity_days) > 0)) {
      return res.status(400).json({ error: 'This package has no valid subscription duration' });
    }
    if (!(Number(plan.price) > 0)) {
      return res.status(400).json({ error: 'This package has no valid M-Pesa price' });
    }

    let encryptedPassword;
    try {
      encryptedPassword = encryptPassword(radiusPassword);
    } catch (error) {
      return res.status(503).json({ error: error.message || 'RADIUS credential encryption is not configured' });
    }

    await ensureEventSchema();

    const client = await db.connect();
    let subscriber;
    let accountAllocation;
    try {
      await client.query('BEGIN');
      accountAllocation = await allocatePppoeAccountNumber(client, clientId);

      if (!String(plan.radius_profile || '').trim()) {
        await client.query(
          `UPDATE billing_plans
           SET radius_profile=$1,updated_at=NOW()
           WHERE id=$2 AND client_id=$3 AND (radius_profile IS NULL OR radius_profile='')`,
          [rateLimit, plan.id, clientId]
        );
      }

      const insertResult = await client.query(
        `INSERT INTO billing_subscribers (
           client_id,plan_id,full_name,phone,email,account_number,
           radius_username,radius_password_ciphertext,radius_status,
           service_status,expires_at,router_id,router_name,access_mode,
           radius_sync_status,grace_period_days
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending','pending',NULL,$9,$10,'pppoe','pending_payment',0)
         RETURNING *`,
        [
          clientId,
          plan.id,
          String(req.body.full_name).trim(),
          req.body.phone ? String(req.body.phone).trim() : null,
          req.body.email ? String(req.body.email).trim().toLowerCase() : null,
          accountAllocation.accountNumber,
          radiusUsername,
          encryptedPassword,
          selectedRouter.id,
          selectedRouter.name,
        ]
      );
      subscriber = insertResult.rows[0];

      await appendRequestEvent(client, req, {
        eventType: 'subscriber.created',
        category: 'subscriber',
        source: 'billing_workspace',
        entityType: 'subscriber',
        entityId: subscriber.id,
        title: 'PPPoE subscriber created pending direct-bank payment',
        description: `${subscriber.full_name} was created pending direct-bank payment; RADIUS access is disabled until payment is confirmed`,
        payload: {
          account_number: subscriber.account_number,
          account_prefix: accountAllocation.prefix,
          pppoe_username: subscriber.radius_username,
          package_id: subscriber.plan_id,
          package_name: plan.name,
          package_price: Number(plan.price),
          router_id: subscriber.router_id,
          router_name: subscriber.router_name,
          payment_required: true,
          payment_model: 'direct_bank_only',
          polyizon_holds_funds: false,
          radius_rate_limit: rateLimit,
        },
        newState: {
          service_status: subscriber.service_status,
          radius_status: subscriber.radius_status,
          radius_sync_status: subscriber.radius_sync_status,
          access_mode: subscriber.access_mode,
        },
        relatedEntities: [
          { entityType: 'package', entityId: plan.id, relationship: 'subscribed_to' },
          { entityType: 'router', entityId: selectedRouter.id, relationship: 'served_by' },
        ],
        deduplicationKey: `subscriber:${subscriber.id}:native-pppoe-created`,
        sensitivity: 'restricted',
      });

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const payment = await directBankPaymentOptions(
      clientId,
      subscriber.id,
      subscriber.account_number,
      Number(plan.price)
    );

    const welcome = await deliverWelcomeNotice({
      client: billingClient,
      subscriber,
      plan,
      payment,
    });

    return res.status(201).json({
      subscriber: {
        id: subscriber.id,
        full_name: subscriber.full_name,
        phone: subscriber.phone,
        email: subscriber.email,
        account_number: subscriber.account_number,
        account_prefix: accountAllocation.prefix,
        plan_id: subscriber.plan_id,
        router_id: subscriber.router_id,
        router_name: subscriber.router_name,
        expires_at: subscriber.expires_at,
        service_status: subscriber.service_status,
        radius_status: subscriber.radius_status,
        radius_sync_status: subscriber.radius_sync_status,
      },
      pppoe: {
        username: radiusUsername,
        password: radiusPassword,
        rate_limit: rateLimit,
      },
      payment,
      notifications: welcome.deliveries,
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That account number or PPPoE username already exists' });
    }
    if (error.code === 'RADIUS_USERNAME_EXISTS') {
      return res.status(409).json({ error: error.message });
    }
    if (error.code === 'RADIUS_NOT_CONFIGURED') {
      return res.status(503).json({ error: error.message });
    }
    console.error('Create native PPPoE subscriber error:', error.message);
    return res.status(500).json({ error: error.message || 'Could not create the PPPoE subscriber' });
  }
});

router.get('/:id/payment-options', async (req, res) => {
  const clientId = req.scope.clientId;
  const subscriberId = Number(req.params.id);
  if (!Number.isInteger(subscriberId) || subscriberId < 1) {
    return res.status(400).json({ error: 'Invalid PPPoE subscriber id' });
  }

  try {
    const subscriber = await subscriberWithPlan(clientId, subscriberId);
    if (!subscriber) return res.status(404).json({ error: 'PPPoE subscriber not found' });
    return res.json(await directBankPaymentOptions(
      clientId,
      subscriber.id,
      subscriber.account_number,
      Number(subscriber.plan_price)
    ));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not load payment options' });
  }
});

router.post('/:id/payments/initiate', [
  body('phone').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 80 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const clientId = req.scope.clientId;
  const subscriberId = Number(req.params.id);
  if (!Number.isInteger(subscriberId) || subscriberId < 1) {
    return res.status(400).json({ error: 'Invalid PPPoE subscriber id' });
  }

  try {
    const [subscriber, clientResult] = await Promise.all([
      subscriberWithPlan(clientId, subscriberId),
      db.query(`SELECT * FROM clients WHERE id=$1 AND account_type='billing' LIMIT 1`, [clientId]),
    ]);
    const billingClient = clientResult.rows[0];
    if (!subscriber || !billingClient) return res.status(404).json({ error: 'PPPoE subscriber not found' });
    if (subscriber.plan_is_active !== true) {
      return res.status(400).json({ error: 'This subscriber package is no longer active' });
    }

    const rawAmount = Number(subscriber.plan_price);
    const amount = Math.round(rawAmount);
    if (!Number.isFinite(rawAmount) || rawAmount < 10 || Math.abs(rawAmount - amount) > 0.0001) {
      return res.status(400).json({ error: 'Direct M-Pesa payment requires a whole-KES package price of at least KES 10' });
    }

    const phone = cleanPhone(req.body.phone || subscriber.phone || '');
    if (!/^254[17]\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid Safaricom M-Pesa phone number' });
    }

    const options = await directBankPaymentOptions(
      clientId,
      subscriber.id,
      subscriber.account_number,
      amount
    );
    if (!options.stk?.ready) {
      return res.status(409).json({
        error: options.stk?.error || 'Direct-to-bank STK payment is not ready for this ISP',
        payment: options,
      });
    }

    const result = await initiateDarajaPayment({
      client: billingClient,
      conversationId: null,
      customerPhone: phone,
      customerName: subscriber.full_name,
      amount,
      metadata: {
        purpose: 'pppoe_portal',
        version: 2,
        payment_origin: 'billing_workspace_direct_bank',
        direct_bank_required: true,
        subscriber_id: Number(subscriber.id),
        account_number: subscriber.account_number,
        current_plan_id: subscriber.plan_id ? Number(subscriber.plan_id) : null,
        target_plan_id: Number(subscriber.plan_id),
        plan_name_snapshot: subscriber.plan_name,
        amount_snapshot: amount,
        action: 'renew',
      },
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Could not send the direct-bank M-Pesa prompt' });
    }
    if (!result.settlement || result.settlement.mode !== 'direct_bank_stk') {
      console.error(`Direct-bank safety invariant failed after initiating PPPoE payment ${result.externalReference || ''}`);
      return res.status(500).json({ error: 'Payment was not confirmed as direct-to-bank; contact support before retrying' });
    }

    return res.status(201).json({
      success: true,
      reference: result.externalReference,
      status: result.status,
      checkout_request_id: result.checkoutRequestId || null,
      subscriber: {
        id: subscriber.id,
        account_number: subscriber.account_number,
        full_name: subscriber.full_name,
      },
      amount,
      phone,
      settlement: result.settlement,
      holds_funds: false,
      message: `M-Pesa prompt sent. KES ${amount} will be deposited directly into ${result.settlement.institutionName} account ending ${result.settlement.accountLast4}. Polyizon does not receive or hold the funds.`,
    });
  } catch (error) {
    console.error('Initiate direct-bank PPPoE payment error:', error.response?.data || error.message);
    return res.status(500).json({ error: error.message || 'Could not start the direct-bank M-Pesa payment' });
  }
});

router.post('/:id/payments/manual-claim', [
  body('receipt_number').trim().notEmpty().isLength({ min: 6, max: 32 }),
  body('payer_phone').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 80 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const clientId = req.scope.clientId;
  const subscriberId = Number(req.params.id);
  if (!Number.isInteger(subscriberId) || subscriberId < 1) {
    return res.status(400).json({ error: 'Invalid PPPoE subscriber id' });
  }

  try {
    const claim = await createManualBankClaim({
      clientId,
      subscriberId,
      receiptNumber: req.body.receipt_number,
      payerPhone: req.body.payer_phone || null,
    });
    return res.status(201).json({
      claim,
      holds_funds: false,
      message: 'Receipt recorded for ISP bank verification. No service was activated yet.',
    });
  } catch (error) {
    const status = error.code === 'MANUAL_BANK_RECEIPT_EXISTS' ? 409 : 400;
    return res.status(status).json({ error: error.message || 'Could not record the manual bank payment receipt' });
  }
});

router.get('/:id/payments/manual-claims', async (req, res) => {
  const clientId = req.scope.clientId;
  const subscriberId = Number(req.params.id);
  if (!Number.isInteger(subscriberId) || subscriberId < 1) {
    return res.status(400).json({ error: 'Invalid PPPoE subscriber id' });
  }
  try {
    const claims = await listManualBankClaims({ clientId, subscriberId, limit: 50 });
    return res.json({ claims });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not load manual payment claims' });
  }
});

router.post('/:id/payments/manual-claims/:claimId/verify', [
  body('confirmed_amount').isFloat({ gt: 0 }),
  body('notes').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const clientId = req.scope.clientId;
  const subscriberId = Number(req.params.id);
  const claimId = Number(req.params.claimId);
  if (!Number.isInteger(subscriberId) || subscriberId < 1 || !Number.isInteger(claimId) || claimId < 1) {
    return res.status(400).json({ error: 'Invalid subscriber or payment claim id' });
  }

  try {
    const result = await verifyManualBankClaim({
      clientId,
      subscriberId,
      claimId,
      confirmedAmount: Number(req.body.confirmed_amount),
      notes: req.body.notes || null,
    });
    return res.json({
      success: true,
      claim: result.claim,
      payment: result.payment,
      holds_funds: false,
      message: 'Verified direct-bank payment applied. The subscriber is now queued for RADIUS activation.',
    });
  } catch (error) {
    const status = [
      'MANUAL_BANK_CLAIM_NOT_FOUND',
      'MANUAL_BANK_CLAIM_REJECTED',
      'MANUAL_BANK_AMOUNT_MISMATCH',
      'MANUAL_BANK_CLAIM_STALE',
    ].includes(error.code) ? 400 : 500;
    return res.status(status).json({ error: error.message || 'Could not verify the manual bank payment' });
  }
});

router.post('/:id/payments/manual-claims/:claimId/reject', [
  body('notes').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const clientId = req.scope.clientId;
  const subscriberId = Number(req.params.id);
  const claimId = Number(req.params.claimId);
  if (!Number.isInteger(subscriberId) || subscriberId < 1 || !Number.isInteger(claimId) || claimId < 1) {
    return res.status(400).json({ error: 'Invalid subscriber or payment claim id' });
  }

  try {
    const claim = await rejectManualBankClaim({
      clientId,
      subscriberId,
      claimId,
      notes: req.body.notes || null,
    });
    return res.json({ claim });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not reject the manual bank payment claim' });
  }
});

module.exports = router;
