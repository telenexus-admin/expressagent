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
  normalizePppoeUsername,
  rateLimitFromPlan,
} = require('../services/pppoeProvisioning');
const {
  allocatePppoeAccountNumber,
  ensurePppoeAccountNumberSchema,
} = require('../services/pppoeAccountNumbers');

const router = express.Router();

function paymentInstructions(_client, accountNumber) {
  const shortcode = String(process.env.DARAJA_SHORTCODE || '').trim();
  if (shortcode) {
    return `Pay via M-Pesa PayBill ${shortcode}. Use ${accountNumber} as the account number/reference.`;
  }
  return `Use account number ${accountNumber} as your payment reference. Contact support for the available M-Pesa payment method.`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function deliverWelcomeNotice({ client, subscriber, plan }) {
  const businessName = String(client?.business_name || client?.name || 'Polyizon').trim();
  const firstName = String(subscriber.full_name || '').trim().split(/\s+/)[0] || 'there';
  const packagePrice = Number(plan.price || 0).toLocaleString('en-KE');
  const instructions = paymentInstructions(client, subscriber.account_number);
  const message = [
    `Welcome to ${businessName}, ${firstName}.`,
    `Your PPPoE account number is ${subscriber.account_number}.`,
    `Package: ${plan.name} — KES ${packagePrice} for ${plan.validity_days} days.`,
    instructions,
    'Your internet will activate after payment is confirmed.',
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
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;color:#172033;line-height:1.6"><h2>Welcome to ${escapeHtml(businessName)}</h2><p>Hello ${escapeHtml(firstName)},</p><p>Your PPPoE account has been created and is waiting for payment.</p><div style="background:#f5f3ff;border-radius:14px;padding:16px;margin:18px 0"><strong>Account number: ${escapeHtml(subscriber.account_number)}</strong><br>Package: ${escapeHtml(plan.name)}<br>Amount: KES ${escapeHtml(packagePrice)}<br>Validity: ${escapeHtml(plan.validity_days)} days</div><p>${escapeHtml(instructions)}</p><p>Your internet will activate after payment is confirmed.</p></div>`,
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
    'SELECT account_type FROM clients WHERE id = $1 LIMIT 1',
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
    await ensurePppoeAccountNumberSchema();

    const [planResult, routerResult, duplicateResult, clientSettingsResult] = await Promise.all([
      db.query(
        `SELECT id, name, price, validity_days, router_id, radius_profile,
                download_speed_mbps, upload_speed_mbps
         FROM billing_plans
         WHERE id = $1 AND client_id = $2 AND is_active = TRUE
         LIMIT 1`,
        [planId, clientId]
      ),
      db.query(
        `SELECT id, name
         FROM mikrotik_routers
         WHERE id = $1 AND client_id = $2 AND is_active = TRUE
         LIMIT 1`,
        [routerId, clientId]
      ),
      db.query(
        `SELECT radius_username
         FROM billing_subscribers
         WHERE client_id = $1 AND radius_username IS NOT NULL AND LOWER(radius_username) = LOWER($2)
         LIMIT 1`,
        [clientId, radiusUsername]
      ),
      db.query('SELECT * FROM clients WHERE id = $1 LIMIT 1', [clientId]),
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
      return res.status(400).json({
        error: 'This package has no RADIUS speed profile. Set upload/download speeds or a RADIUS rate-limit first.',
      });
    }

    const validityDays = Number(plan.validity_days || 0);
    if (!(validityDays > 0)) {
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
    let subscriber = null;
    let accountAllocation = null;

    try {
      await client.query('BEGIN');
      accountAllocation = await allocatePppoeAccountNumber(client, clientId);

      if (!String(plan.radius_profile || '').trim()) {
        await client.query(
          `UPDATE billing_plans
           SET radius_profile = $1, updated_at = NOW()
           WHERE id = $2 AND client_id = $3 AND (radius_profile IS NULL OR radius_profile = '')`,
          [rateLimit, plan.id, clientId]
        );
      }

      const insertResult = await client.query(
        `INSERT INTO billing_subscribers (
           client_id, plan_id, full_name, phone, email, account_number,
           radius_username, radius_password_ciphertext, radius_status,
           service_status, expires_at, router_id, router_name, access_mode,
           radius_sync_status, grace_period_days
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,'pending','pending',NULL,$9,$10,'pppoe','pending_payment',0
         )
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
        title: 'PPPoE subscriber created pending payment',
        description: `${subscriber.full_name} was created pending payment; RADIUS access is disabled until payment is confirmed`,
        payload: {
          account_number: subscriber.account_number,
          account_prefix: accountAllocation.prefix,
          pppoe_username: subscriber.radius_username,
          package_id: subscriber.plan_id,
          package_name: plan.name,
          package_price: Number(plan.price),
          router_id: subscriber.router_id,
          router_name: subscriber.router_name,
          expires_at: subscriber.expires_at,
          payment_required: true,
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

    const welcome = await deliverWelcomeNotice({ client: billingClient, subscriber, plan });

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
      payment: {
        account_number: subscriber.account_number,
        account_prefix: accountAllocation.prefix,
        paybill: String(process.env.DARAJA_SHORTCODE || '').trim() || null,
        amount: Number(plan.price),
        purpose: paymentInstructions(billingClient, subscriber.account_number),
      },
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

module.exports = router;
