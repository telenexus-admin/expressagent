const db = require('../db');
const { ensurePayHeroSchema } = require('./payhero');
const {
  activatePaidHotspotDevice,
  normalizeMac,
  revokeHotspotDeviceAccess,
} = require('./hotspotMacAccess');

let schemaPromise = null;
let schedulerTimer = null;
let schedulerRunning = false;

function tvPaymentMetadata(payment) {
  let metadata = payment?.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch (_) { metadata = {}; }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  if (metadata.purpose !== 'hotspot_tv') return null;

  const planId = Number(metadata.tv_plan_id || metadata.plan_id);
  const routerId = Number(metadata.router_id);
  const mac = normalizeMac(metadata.mac);
  const expectedAmount = Math.round(Number(metadata.expected_amount || payment.amount || 0));

  if (!Number.isInteger(planId) || planId < 1 || !Number.isInteger(routerId) || routerId < 1 || !mac) return null;
  return { ...metadata, plan_id: planId, router_id: routerId, mac, expected_amount: expectedAmount };
}

async function ensureHotspotTvSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensurePayHeroSchema();

      await db.query(`
        CREATE TABLE IF NOT EXISTS billing_hotspot_tv_plans (
          id BIGSERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          router_id INTEGER REFERENCES mikrotik_routers(id) ON DELETE SET NULL,
          name VARCHAR(180) NOT NULL,
          price NUMERIC(14,2) NOT NULL DEFAULT 0,
          duration_minutes INTEGER NOT NULL,
          mikrotik_rate_limit VARCHAR(120),
          data_limit_mb BIGINT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE(client_id, name)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS billing_hotspot_tv_subscribers (
          id BIGSERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          router_id INTEGER NOT NULL REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
          plan_id BIGINT REFERENCES billing_hotspot_tv_plans(id) ON DELETE SET NULL,
          mac_address VARCHAR(17) NOT NULL,
          customer_phone VARCHAR(32),
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          activated_at TIMESTAMP WITH TIME ZONE,
          expires_at TIMESTAMP WITH TIME ZONE,
          last_payment_request_id INTEGER REFERENCES payhero_payment_requests(id) ON DELETE SET NULL,
          last_payment_amount NUMERIC(14,2),
          device_activation_status VARCHAR(40),
          activation_error TEXT,
          last_activation_attempt_at TIMESTAMP WITH TIME ZONE,
          cleanup_completed_at TIMESTAMP WITH TIME ZONE,
          cleanup_error TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE(client_id, router_id, mac_address)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS hotspot_tv_payment_fulfillments (
          id BIGSERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          payment_request_id INTEGER NOT NULL UNIQUE REFERENCES payhero_payment_requests(id) ON DELETE CASCADE,
          plan_id BIGINT NOT NULL REFERENCES billing_hotspot_tv_plans(id) ON DELETE RESTRICT,
          subscription_id BIGINT REFERENCES billing_hotspot_tv_subscribers(id) ON DELETE SET NULL,
          router_id INTEGER NOT NULL REFERENCES mikrotik_routers(id) ON DELETE RESTRICT,
          mac_address VARCHAR(17) NOT NULL,
          customer_phone VARCHAR(32),
          amount NUMERIC(14,2) NOT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'paid',
          expires_at TIMESTAMP WITH TIME ZONE,
          device_activation_status VARCHAR(40),
          error TEXT,
          paid_at TIMESTAMP WITH TIME ZONE,
          activated_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`CREATE INDEX IF NOT EXISTS idx_hotspot_tv_subscribers_expiry ON billing_hotspot_tv_subscribers(status, expires_at)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_hotspot_tv_subscribers_client ON billing_hotspot_tv_subscribers(client_id, updated_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_hotspot_tv_fulfillments_client ON hotspot_tv_payment_fulfillments(client_id, created_at DESC)`);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function loadPlan(clientId, planId, { activeOnly = false, queryable = db } = {}) {
  await ensureHotspotTvSchema();
  const result = await queryable.query(
    `SELECT p.*, r.name AS router_name
     FROM billing_hotspot_tv_plans p
     LEFT JOIN mikrotik_routers r ON r.id = p.router_id AND r.client_id = p.client_id
     WHERE p.id = $1 AND p.client_id = $2 ${activeOnly ? 'AND p.is_active = TRUE' : ''}
     LIMIT 1`,
    [planId, clientId]
  );
  return result.rows[0] || null;
}

async function activateSubscription(subscription, plan) {
  const expiresAt = new Date(subscription.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new Error('This TV subscription has expired');
  }

  await db.query(
    `UPDATE billing_hotspot_tv_subscribers
     SET last_activation_attempt_at = NOW(), activation_error = NULL, updated_at = NOW()
     WHERE id = $1`,
    [subscription.id]
  );

  const result = await activatePaidHotspotDevice({
    clientId: subscription.client_id,
    routerId: subscription.router_id,
    macAddress: subscription.mac_address,
    ipAddress: '',
    expiresAt,
    rateLimit: plan?.mikrotik_rate_limit || null,
    dataLimitMb: plan?.data_limit_mb || null,
  });

  const ready = ['active', 'login_required'].includes(result?.status);
  if (!ready) throw new Error('MikroTik did not provision TV MAC access');

  const activationState = result.status === 'active' ? 'online' : 'ready';
  const updated = await db.query(
    `UPDATE billing_hotspot_tv_subscribers
     SET status = 'active',
         activated_at = COALESCE(activated_at, NOW()),
         device_activation_status = $2,
         activation_error = NULL,
         cleanup_completed_at = NULL,
         cleanup_error = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [subscription.id, activationState]
  );
  return { subscription: updated.rows[0], device: result };
}

async function fulfillHotspotTvPayment(suppliedPayment) {
  const metadata = tvPaymentMetadata(suppliedPayment);
  if (!metadata) return null;

  await ensureHotspotTvSchema();
  const connection = await db.connect();
  let payment;
  let plan;
  let subscription;
  let fulfillment;

  try {
    await connection.query('BEGIN');
    await connection.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`hotspot-tv-payment:${suppliedPayment.id}`]);
    await connection.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `hotspot-tv-subscription:${suppliedPayment.client_id}:${metadata.router_id}:${metadata.mac}`,
    ]);

    const paymentResult = await connection.query(
      `SELECT * FROM payhero_payment_requests WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [suppliedPayment.id, suppliedPayment.client_id]
    );
    payment = paymentResult.rows[0];
    if (!payment) {
      await connection.query('ROLLBACK');
      return { status: 'failed', error: 'Payment request was not found' };
    }
    if (payment.status !== 'paid') {
      await connection.query('COMMIT');
      return { status: 'pending', payment_status: payment.status };
    }

    const existingFulfillment = await connection.query(
      `SELECT * FROM hotspot_tv_payment_fulfillments
       WHERE payment_request_id = $1 AND client_id = $2 FOR UPDATE`,
      [payment.id, payment.client_id]
    );
    fulfillment = existingFulfillment.rows[0] || null;

    plan = await loadPlan(payment.client_id, metadata.plan_id, { queryable: connection });
    if (!plan) throw new Error('The purchased TV package no longer exists');

    if (Number(plan.router_id || metadata.router_id) !== Number(metadata.router_id) && plan.router_id) {
      throw new Error('This TV package belongs to a different MikroTik router');
    }
    if (!Number.isInteger(metadata.expected_amount) || metadata.expected_amount < 1 || Number(payment.amount) < metadata.expected_amount) {
      throw new Error('The confirmed payment is below the TV package price');
    }

    if (fulfillment) {
      const subscriptionResult = await connection.query(
        `SELECT * FROM billing_hotspot_tv_subscribers WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [fulfillment.subscription_id, payment.client_id]
      );
      subscription = subscriptionResult.rows[0] || null;
      if (!subscription) throw new Error('The TV subscription linked to this payment is missing');
      await connection.query('COMMIT');
    } else {
      const existingResult = await connection.query(
        `SELECT * FROM billing_hotspot_tv_subscribers
         WHERE client_id = $1 AND router_id = $2 AND mac_address = $3 FOR UPDATE`,
        [payment.client_id, metadata.router_id, metadata.mac]
      );
      const existing = existingResult.rows[0];
      const now = new Date();
      const currentExpiry = existing?.expires_at ? new Date(existing.expires_at) : null;
      const base = currentExpiry && Number.isFinite(currentExpiry.getTime()) && currentExpiry > now ? currentExpiry : now;
      const expiresAt = new Date(base.getTime() + Number(plan.duration_minutes) * 60000);

      const upsert = await connection.query(
        `INSERT INTO billing_hotspot_tv_subscribers
           (client_id, router_id, plan_id, mac_address, customer_phone, status, expires_at,
            last_payment_request_id, last_payment_amount, device_activation_status, activation_error, updated_at)
         VALUES ($1,$2,$3,$4,$5,'activation_pending',$6,$7,$8,'pending',NULL,NOW())
         ON CONFLICT (client_id, router_id, mac_address)
         DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           customer_phone = EXCLUDED.customer_phone,
           status = 'activation_pending',
           expires_at = EXCLUDED.expires_at,
           last_payment_request_id = EXCLUDED.last_payment_request_id,
           last_payment_amount = EXCLUDED.last_payment_amount,
           device_activation_status = 'pending',
           activation_error = NULL,
           cleanup_completed_at = NULL,
           cleanup_error = NULL,
           updated_at = NOW()
         RETURNING *`,
        [payment.client_id, metadata.router_id, plan.id, metadata.mac, payment.customer_phone || null,
          expiresAt, payment.id, Number(payment.amount)]
      );
      subscription = upsert.rows[0];

      const fulfillmentResult = await connection.query(
        `INSERT INTO hotspot_tv_payment_fulfillments
           (client_id, payment_request_id, plan_id, subscription_id, router_id, mac_address,
            customer_phone, amount, status, expires_at, paid_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'activation_pending',$9,NOW(),NOW())
         RETURNING *`,
        [payment.client_id, payment.id, plan.id, subscription.id, metadata.router_id, metadata.mac,
          payment.customer_phone || null, Number(payment.amount), expiresAt]
      );
      fulfillment = fulfillmentResult.rows[0];
      await connection.query('COMMIT');
    }
  } catch (error) {
    try { await connection.query('ROLLBACK'); } catch (_) {}
    connection.release();
    return { status: 'failed', error: error.message || 'TV payment fulfillment failed' };
  }
  connection.release();

  if (fulfillment.status === 'active' && subscription.status === 'active') {
    return { status: 'active', subscription, plan };
  }

  try {
    const activated = await activateSubscription(subscription, plan);
    await db.query(
      `UPDATE hotspot_tv_payment_fulfillments
       SET status = 'active', device_activation_status = $2, error = NULL,
           activated_at = COALESCE(activated_at, NOW()), updated_at = NOW()
       WHERE payment_request_id = $1`,
      [payment.id, activated.subscription.device_activation_status]
    );
    return { status: 'active', subscription: activated.subscription, plan, device: activated.device };
  } catch (error) {
    const message = String(error?.message || 'TV access provisioning is retrying');
    await db.query(
      `UPDATE billing_hotspot_tv_subscribers
       SET status = 'activation_pending', device_activation_status = 'retrying', activation_error = $2, updated_at = NOW()
       WHERE id = $1`,
      [subscription.id, message]
    );
    await db.query(
      `UPDATE hotspot_tv_payment_fulfillments
       SET status = 'activation_pending', device_activation_status = 'retrying', error = $2, updated_at = NOW()
       WHERE payment_request_id = $1`,
      [payment.id, message]
    );
    return { status: 'activating', subscription, plan, error: 'Payment received. TV internet activation is retrying automatically.' };
  }
}

async function getHotspotTvPaymentStatus({ clientId, externalReference }) {
  await ensureHotspotTvSchema();
  const paymentResult = await db.query(
    `SELECT * FROM payhero_payment_requests WHERE client_id = $1 AND external_reference = $2 LIMIT 1`,
    [clientId, externalReference]
  );
  const payment = paymentResult.rows[0];
  if (!payment) return null;

  let fulfillment = null;
  if (payment.status === 'paid') fulfillment = await fulfillHotspotTvPayment(payment);

  const storedResult = await db.query(
    `SELECT f.*, s.status AS subscription_status, s.expires_at AS subscription_expires_at,
            s.device_activation_status AS subscription_activation_status, p.name AS plan_name
     FROM hotspot_tv_payment_fulfillments f
     LEFT JOIN billing_hotspot_tv_subscribers s ON s.id = f.subscription_id AND s.client_id = f.client_id
     LEFT JOIN billing_hotspot_tv_plans p ON p.id = f.plan_id AND p.client_id = f.client_id
     WHERE f.payment_request_id = $1 AND f.client_id = $2 LIMIT 1`,
    [payment.id, clientId]
  );
  const stored = storedResult.rows[0];

  if (stored?.status === 'active' || fulfillment?.status === 'active') {
    return {
      status: 'active',
      payment_status: payment.status,
      amount: Number(payment.amount),
      receipt: payment.mpesa_receipt_number || null,
      mac_address: stored?.mac_address || fulfillment?.subscription?.mac_address,
      plan_name: stored?.plan_name || fulfillment?.plan?.name,
      expires_at: stored?.subscription_expires_at || fulfillment?.subscription?.expires_at,
      device_activation_status: stored?.subscription_activation_status || fulfillment?.subscription?.device_activation_status || 'ready',
    };
  }
  if (payment.status === 'failed') {
    return { status: 'failed', payment_status: payment.status, error: payment.result_description || 'The M-Pesa payment was not completed' };
  }
  return {
    status: payment.status === 'paid' ? 'activating' : 'pending',
    payment_status: payment.status,
    amount: Number(payment.amount),
    message: stored?.error || fulfillment?.error || (payment.status === 'paid'
      ? 'Payment received. Preparing TV internet access.'
      : 'Waiting for M-Pesa confirmation.'),
  };
}

async function reconcileTvSubscriptions({ limit = 100 } = {}) {
  await ensureHotspotTvSchema();
  if (schedulerRunning) return { skipped: true };
  schedulerRunning = true;
  let paid = 0;
  let expired = 0;
  let retried = 0;
  let failed = 0;
  try {
    const orphanPaidRows = (await db.query(
      `SELECT p.*
       FROM payhero_payment_requests p
       LEFT JOIN hotspot_tv_payment_fulfillments f ON f.payment_request_id=p.id
       WHERE p.status='paid'
         AND p.metadata->>'purpose'='hotspot_tv'
         AND f.id IS NULL
       ORDER BY p.updated_at ASC
       LIMIT $1`,
      [limit]
    )).rows;

    for (const payment of orphanPaidRows) {
      try {
        const result = await fulfillHotspotTvPayment(payment);
        if (result?.status === 'active' || result?.status === 'activating') paid += 1;
        else if (result?.status === 'failed') failed += 1;
      } catch (error) {
        console.error('Hotspot TV paid fulfillment retry failed:', error.message);
        failed += 1;
      }
    }

    const expiredRows = (await db.query(
      `SELECT s.* FROM billing_hotspot_tv_subscribers s
       WHERE s.expires_at <= NOW()
         AND s.status IN ('active','activation_pending','suspended')
       ORDER BY s.expires_at ASC LIMIT $1`,
      [limit]
    )).rows;

    for (const subscription of expiredRows) {
      try {
        await revokeHotspotDeviceAccess({
          clientId: subscription.client_id,
          routerId: subscription.router_id,
          macAddress: subscription.mac_address,
          ipAddress: '',
        });
        await db.query(
          `UPDATE billing_hotspot_tv_subscribers
           SET status='expired', device_activation_status='expired', cleanup_completed_at=NOW(), cleanup_error=NULL, updated_at=NOW()
           WHERE id=$1`,
          [subscription.id]
        );
        expired += 1;
      } catch (error) {
        await db.query(
          `UPDATE billing_hotspot_tv_subscribers SET cleanup_error=$2, updated_at=NOW() WHERE id=$1`,
          [subscription.id, String(error.message || 'TV expiry cleanup failed')]
        );
        failed += 1;
      }
    }

    const pendingRows = (await db.query(
      `SELECT s.*, p.mikrotik_rate_limit, p.data_limit_mb
       FROM billing_hotspot_tv_subscribers s
       JOIN billing_hotspot_tv_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
       WHERE s.status='activation_pending' AND s.expires_at > NOW()
         AND (s.last_activation_attempt_at IS NULL OR s.last_activation_attempt_at < NOW() - INTERVAL '45 seconds')
       ORDER BY s.updated_at ASC LIMIT $1`,
      [limit]
    )).rows;

    for (const subscription of pendingRows) {
      try {
        const result = await activateSubscription(subscription, subscription);
        await db.query(
          `UPDATE hotspot_tv_payment_fulfillments
           SET status='active', device_activation_status=$2, error=NULL, activated_at=COALESCE(activated_at,NOW()), updated_at=NOW()
           WHERE subscription_id=$1 AND status='activation_pending'`,
          [subscription.id, result.subscription.device_activation_status]
        );
        retried += 1;
      } catch (error) {
        await db.query(
          `UPDATE billing_hotspot_tv_subscribers SET activation_error=$2, last_activation_attempt_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [subscription.id, String(error.message || 'TV activation retry failed')]
        );
        failed += 1;
      }
    }
    return { paid, expired, retried, failed };
  } finally {
    schedulerRunning = false;
  }
}

function startHotspotTvScheduler() {
  if (schedulerTimer) return schedulerTimer;
  ensureHotspotTvSchema()
    .then(() => reconcileTvSubscriptions().catch((error) => console.error('Hotspot TV reconcile failed:', error.message)))
    .catch((error) => console.error('Hotspot TV schema failed:', error.message));
  schedulerTimer = setInterval(() => {
    reconcileTvSubscriptions().catch((error) => console.error('Hotspot TV reconcile failed:', error.message));
  }, 60 * 1000);
  schedulerTimer.unref?.();
  return schedulerTimer;
}

module.exports = {
  ensureHotspotTvSchema,
  fulfillHotspotTvPayment,
  getHotspotTvPaymentStatus,
  loadPlan,
  reconcileTvSubscriptions,
  startHotspotTvScheduler,
  tvPaymentMetadata,
};
