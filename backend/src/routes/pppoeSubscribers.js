const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { encryptPassword } = require('../services/radiusSync');
const { appendRequestEvent, ensureEventSchema } = require('../services/events');
const {
  normalizeAccountNumber,
  normalizePppoeUsername,
  provisionRadiusCredential,
  rateLimitFromPlan,
  removeRadiusCredential,
} = require('../services/pppoeProvisioning');

const router = express.Router();

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
  body('account_number')
    .trim()
    .matches(/^[A-Za-z0-9._-]{3,40}$/)
    .withMessage('Account number must be 3-40 letters, numbers, dots, dashes, or underscores'),
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
  const accountNumber = normalizeAccountNumber(req.body.account_number);
  const radiusUsername = normalizePppoeUsername(req.body.radius_username);
  const radiusPassword = String(req.body.radius_password || '');
  const planId = Number(req.body.plan_id);
  const routerId = Number(req.body.router_id);

  try {
    const [planResult, routerResult, duplicateResult] = await Promise.all([
      db.query(
        `SELECT id, name, validity_days, router_id, radius_profile,
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
        `SELECT account_number, radius_username
         FROM billing_subscribers
         WHERE (client_id = $1 AND UPPER(account_number) = UPPER($2))
            OR (radius_username IS NOT NULL AND LOWER(radius_username) = LOWER($3))
         LIMIT 1`,
        [clientId, accountNumber, radiusUsername]
      ),
    ]);

    const plan = planResult.rows[0];
    const selectedRouter = routerResult.rows[0];

    if (!plan) return res.status(400).json({ error: 'Choose an active PPPoE package from this billing workspace' });
    if (!selectedRouter) return res.status(400).json({ error: 'Choose an active MikroTik router from this billing workspace' });

    if (plan.router_id && Number(plan.router_id) !== routerId) {
      return res.status(400).json({ error: 'That package is assigned to a different MikroTik router' });
    }

    if (duplicateResult.rows[0]) {
      const duplicate = duplicateResult.rows[0];
      if (duplicate.radius_username && String(duplicate.radius_username).toLowerCase() === radiusUsername.toLowerCase()) {
        return res.status(409).json({ error: 'That PPPoE username is already used by another Polyizon subscriber' });
      }
      return res.status(409).json({ error: 'That M-Pesa account number is already used by another subscriber' });
    }

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

    let encryptedPassword;
    try {
      encryptedPassword = encryptPassword(radiusPassword);
    } catch (error) {
      return res.status(503).json({ error: error.message || 'RADIUS credential encryption is not configured' });
    }

    const expiresAt = new Date(Date.now() + validityDays * 86400000);
    await ensureEventSchema();

    const client = await db.connect();
    let radiusProvisioned = false;
    let subscriber = null;

    try {
      await client.query('BEGIN');

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
           $1,$2,$3,$4,$5,$6,$7,$8,'pending','pending',$9,$10,$11,'pppoe','provisioning',0
         )
         RETURNING *`,
        [
          clientId,
          plan.id,
          String(req.body.full_name).trim(),
          req.body.phone ? String(req.body.phone).trim() : null,
          req.body.email ? String(req.body.email).trim().toLowerCase() : null,
          accountNumber,
          radiusUsername,
          encryptedPassword,
          expiresAt,
          selectedRouter.id,
          selectedRouter.name,
        ]
      );

      subscriber = insertResult.rows[0];

      await provisionRadiusCredential({
        username: radiusUsername,
        password: radiusPassword,
        expiresAt,
        rateLimit,
      });
      radiusProvisioned = true;

      const activated = await client.query(
        `UPDATE billing_subscribers
         SET radius_status = 'active',
             service_status = 'active',
             radius_sync_status = 'synced',
             radius_sync_error = NULL,
             radius_last_synced_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND client_id = $2
         RETURNING *`,
        [subscriber.id, clientId]
      );

      subscriber = activated.rows[0];

      await appendRequestEvent(client, req, {
        eventType: 'subscriber.created',
        category: 'subscriber',
        source: 'billing_workspace',
        entityType: 'subscriber',
        entityId: subscriber.id,
        title: 'PPPoE subscriber created',
        description: `${subscriber.full_name} was created and synchronized with Polyizon RADIUS`,
        payload: {
          account_number: subscriber.account_number,
          pppoe_username: subscriber.radius_username,
          package_id: subscriber.plan_id,
          package_name: plan.name,
          router_id: subscriber.router_id,
          router_name: subscriber.router_name,
          expires_at: subscriber.expires_at,
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

      if (radiusProvisioned) {
        await removeRadiusCredential(radiusUsername).catch((cleanupError) => {
          console.error('PPPoE RADIUS cleanup failed:', cleanupError.message);
        });
      }

      throw error;
    } finally {
      client.release();
    }

    return res.status(201).json({
      subscriber: {
        id: subscriber.id,
        full_name: subscriber.full_name,
        phone: subscriber.phone,
        email: subscriber.email,
        account_number: subscriber.account_number,
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
        account_number: accountNumber,
        purpose: 'Use this account number as the customer M-Pesa subscription reference.',
      },
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
