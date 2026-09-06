const db = require('../db');
const { enqueueRadiusSyncJob, processRadiusSyncJobs } = require('./radiusJobs');
const { ensurePppoeAccountNumberSchema } = require('./pppoeAccountNumbers');
const { recordBillingEvent } = require('./events');

let schemaPromise = null;

function normalizeAccountNumber(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function moneyCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function parsePaidAt(value) {
  if (!value) return new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

async function ensurePppoePaymentSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensurePppoeAccountNumberSchema();
      await db.query(`
        CREATE TABLE IF NOT EXISTS billing_pppoe_mpesa_payments (
          id BIGSERIAL PRIMARY KEY,
          transaction_id VARCHAR(120) NOT NULL UNIQUE,
          source VARCHAR(30) NOT NULL DEFAULT 'c2b',
          shortcode VARCHAR(30),
          account_number VARCHAR(80) NOT NULL,
          payer_phone VARCHAR(80),
          amount NUMERIC(14,2) NOT NULL,
          paid_at TIMESTAMPTZ,
          client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
          subscriber_id BIGINT REFERENCES billing_subscribers(id) ON DELETE SET NULL,
          plan_id BIGINT,
          status VARCHAR(40) NOT NULL DEFAULT 'received',
          error TEXT,
          raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          applied_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_pppoe_mpesa_account
        ON billing_pppoe_mpesa_payments (UPPER(account_number), created_at DESC)
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_pppoe_mpesa_status
        ON billing_pppoe_mpesa_payments (status, created_at DESC)
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_pppoe_mpesa_subscriber
        ON billing_pppoe_mpesa_payments (client_id, subscriber_id, created_at DESC)
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function resolvePppoePaymentAccount(accountNumber, queryable = db) {
  await ensurePppoePaymentSchema();
  const normalized = normalizeAccountNumber(accountNumber);
  if (!normalized) return null;

  const result = await queryable.query(
    `SELECT
       s.*,
       p.name AS plan_name,
       p.price AS plan_price,
       p.validity_days AS plan_validity_days,
       p.radius_profile AS plan_radius_profile,
       p.is_active AS plan_is_active,
       p.download_speed_mbps,
       p.upload_speed_mbps,
       c.name AS client_name,
       c.business_name AS client_business_name,
       c.mpesa_account_prefix
     FROM billing_subscribers s
     JOIN clients c ON c.id = s.client_id
     LEFT JOIN billing_plans p ON p.id = s.plan_id AND p.client_id = s.client_id
     WHERE s.account_number IS NOT NULL
       AND UPPER(s.account_number) = UPPER($1)
       AND COALESCE(s.access_mode, 'pppoe') IN ('pppoe','pppoe_static')
     ORDER BY s.id
     LIMIT 2`,
    [normalized]
  );

  if (result.rows.length !== 1) return null;
  return result.rows[0];
}

async function applyPppoeSubscriptionPayment({
  transactionId,
  accountNumber,
  amount,
  payerPhone = null,
  paidAt = null,
  source = 'c2b',
  shortcode = null,
  rawPayload = {},
}) {
  await ensurePppoePaymentSchema();

  const cleanTransactionId = String(transactionId || '').trim().toUpperCase();
  const cleanAccountNumber = normalizeAccountNumber(accountNumber);
  const amountCents = moneyCents(amount);

  if (!cleanTransactionId) throw new Error('M-Pesa transaction ID is required');
  if (!cleanAccountNumber) throw new Error('M-Pesa account number is required');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('A valid M-Pesa amount is required');

  const client = await db.connect();
  let result;

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pppoe-mpesa:${cleanTransactionId}`]);

    const inserted = await client.query(
      `INSERT INTO billing_pppoe_mpesa_payments
         (transaction_id, source, shortcode, account_number, payer_phone, amount, paid_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING *`,
      [
        cleanTransactionId,
        String(source || 'c2b').slice(0, 30),
        shortcode ? String(shortcode).trim() : null,
        cleanAccountNumber,
        payerPhone ? String(payerPhone).trim() : null,
        Number(amount),
        parsePaidAt(paidAt),
        JSON.stringify(rawPayload || {}),
      ]
    );

    if (!inserted.rows[0]) {
      const existing = await client.query(
        `SELECT * FROM billing_pppoe_mpesa_payments WHERE transaction_id=$1 LIMIT 1`,
        [cleanTransactionId]
      );
      await client.query('COMMIT');
      return {
        status: existing.rows[0]?.status || 'duplicate',
        idempotent: true,
        payment: existing.rows[0] || null,
      };
    }

    const payment = inserted.rows[0];
    const subscriberResult = await client.query(
      `SELECT
         s.*,
         p.name AS plan_name,
         p.price AS plan_price,
         p.validity_days AS plan_validity_days,
         p.radius_profile AS plan_radius_profile,
         p.is_active AS plan_is_active,
         c.name AS client_name,
         c.business_name AS client_business_name,
         c.mpesa_account_prefix
       FROM billing_subscribers s
       JOIN clients c ON c.id = s.client_id
       LEFT JOIN billing_plans p ON p.id = s.plan_id AND p.client_id = s.client_id
       WHERE s.account_number IS NOT NULL
         AND UPPER(s.account_number) = UPPER($1)
         AND COALESCE(s.access_mode, 'pppoe') IN ('pppoe','pppoe_static')
       ORDER BY s.id
       LIMIT 2
       FOR UPDATE OF s`,
      [cleanAccountNumber]
    );

    if (subscriberResult.rows.length !== 1) {
      const updated = await client.query(
        `UPDATE billing_pppoe_mpesa_payments
         SET status='unmatched', error='PPPoE account number was not found or is ambiguous', updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [payment.id]
      );
      await client.query('COMMIT');
      return { status: 'unmatched', idempotent: false, payment: updated.rows[0] };
    }

    const subscriber = subscriberResult.rows[0];
    const validityDays = Number(subscriber.plan_validity_days || 0);
    const expectedCents = moneyCents(subscriber.plan_price);

    if (!subscriber.plan_id || subscriber.plan_is_active !== true || !(validityDays > 0) || !Number.isInteger(expectedCents) || expectedCents <= 0) {
      const updated = await client.query(
        `UPDATE billing_pppoe_mpesa_payments
         SET client_id=$2, subscriber_id=$3, plan_id=$4, status='failed',
             error='Subscriber package is missing, inactive, or has no valid price/validity', updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [payment.id, subscriber.client_id, subscriber.id, subscriber.plan_id || null]
      );
      await client.query('COMMIT');
      return { status: 'failed', idempotent: false, payment: updated.rows[0], subscriber };
    }

    if (amountCents !== expectedCents) {
      const updated = await client.query(
        `UPDATE billing_pppoe_mpesa_payments
         SET client_id=$2, subscriber_id=$3, plan_id=$4, status='amount_mismatch',
             error=$5, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [
          payment.id,
          subscriber.client_id,
          subscriber.id,
          subscriber.plan_id,
          `Expected KES ${Number(subscriber.plan_price)}, received KES ${Number(amount)}`,
        ]
      );
      await client.query('COMMIT');
      return {
        status: 'amount_mismatch',
        idempotent: false,
        payment: updated.rows[0],
        subscriber,
        expectedAmount: Number(subscriber.plan_price),
      };
    }

    const now = new Date();
    const currentExpiry = subscriber.expires_at ? new Date(subscriber.expires_at) : null;
    const baseMs = currentExpiry && Number.isFinite(currentExpiry.getTime()) && currentExpiry > now
      ? currentExpiry.getTime()
      : now.getTime();
    const newExpiry = new Date(baseMs + validityDays * 24 * 60 * 60 * 1000);

    const updatedSubscriber = await client.query(
      `UPDATE billing_subscribers
       SET service_status='active',
           radius_status='active',
           radius_sync_status='pending',
           radius_sync_error=NULL,
           activated_at=COALESCE(activated_at, NOW()),
           expires_at=$2,
           updated_at=NOW()
       WHERE id=$1 AND client_id=$3
       RETURNING *`,
      [subscriber.id, newExpiry, subscriber.client_id]
    );

    await enqueueRadiusSyncJob(
      client,
      subscriber.client_id,
      subscriber.id,
      source === 'c2b' ? 'mpesa_c2b_payment' : 'mpesa_payment'
    );

    const updatedPayment = await client.query(
      `UPDATE billing_pppoe_mpesa_payments
       SET client_id=$2, subscriber_id=$3, plan_id=$4, status='applied',
           error=NULL, applied_at=NOW(), updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [payment.id, subscriber.client_id, subscriber.id, subscriber.plan_id]
    );

    await client.query('COMMIT');

    result = {
      status: 'applied',
      idempotent: false,
      payment: updatedPayment.rows[0],
      subscriber: updatedSubscriber.rows[0],
      previousExpiry: subscriber.expires_at || null,
      newExpiry: newExpiry.toISOString(),
      plan: {
        id: subscriber.plan_id,
        name: subscriber.plan_name,
        price: Number(subscriber.plan_price),
        validityDays,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (result?.status === 'applied') {
    setImmediate(() => {
      processRadiusSyncJobs().catch((error) => {
        console.error('Immediate RADIUS sync after M-Pesa payment failed:', error.message);
      });
    });

    recordBillingEvent({
      clientId: result.subscriber.client_id,
      eventType: 'pppoe.payment_applied',
      category: 'payment',
      source: source === 'c2b' ? 'mpesa_c2b' : 'mpesa',
      entityType: 'subscriber',
      entityId: result.subscriber.id,
      actorType: 'system',
      title: 'PPPoE package payment applied',
      payload: {
        transaction_id: cleanTransactionId,
        account_number: cleanAccountNumber,
        amount: Number(amount),
        plan_id: result.plan.id,
        plan_name: result.plan.name,
        previous_expiry: result.previousExpiry,
        new_expiry: result.newExpiry,
        payer_phone: payerPhone || null,
      },
      relatedEntities: [
        { entityType: 'payment', entityId: result.payment.id, relationship: 'payment' },
        { entityType: 'package', entityId: result.plan.id, relationship: 'renews' },
      ],
      deduplicationKey: `pppoe-mpesa:${cleanTransactionId}:applied`,
      sensitivity: 'restricted',
    }).catch((error) => console.error('PPPoE payment event could not be recorded:', error.message));
  }

  return result;
}

async function listPppoeMpesaPayments({ clientId, status = null, limit = 100 }) {
  await ensurePppoePaymentSchema();
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
  const values = [];
  const where = [];
  if (clientId) {
    values.push(Number(clientId));
    where.push(`p.client_id = $${values.length}`);
  }
  if (status) {
    values.push(String(status));
    where.push(`p.status = $${values.length}`);
  }
  values.push(safeLimit);
  const result = await db.query(
    `SELECT p.*, s.full_name AS subscriber_name, s.radius_username,
            bp.name AS plan_name, c.business_name AS isp_name
     FROM billing_pppoe_mpesa_payments p
     LEFT JOIN billing_subscribers s ON s.id=p.subscriber_id AND s.client_id=p.client_id
     LEFT JOIN billing_plans bp ON bp.id=p.plan_id AND bp.client_id=p.client_id
     LEFT JOIN clients c ON c.id=p.client_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

module.exports = {
  applyPppoeSubscriptionPayment,
  ensurePppoePaymentSchema,
  listPppoeMpesaPayments,
  moneyCents,
  normalizeAccountNumber,
  resolvePppoePaymentAccount,
};
