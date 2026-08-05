const crypto = require('crypto');
const db = require('../db');
const {
  radiusEnabled,
  syncHotspotVoucherRadius,
} = require('./radiusSync');
const {
  activatePaidHotspotDevice,
} = require('./hotspotMacAccess');

let schemaPromise;

async function ensureHotspotPaymentSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS hotspot_payment_fulfillments (
          id BIGSERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL
            REFERENCES clients(id) ON DELETE CASCADE,
          payment_request_id INTEGER NOT NULL UNIQUE
            REFERENCES payhero_payment_requests(id)
            ON DELETE CASCADE,
          plan_id INTEGER NOT NULL,
          voucher_id INTEGER
            REFERENCES billing_hotspot_vouchers(id)
            ON DELETE SET NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'pending',
          amount INTEGER NOT NULL,
          customer_phone VARCHAR(80),
          mac_address VARCHAR(80),
          ip_address VARCHAR(80),
          radius_status VARCHAR(40),
          error TEXT,
          paid_at TIMESTAMP WITH TIME ZONE,
          activated_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE
            NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE
            NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`
        ALTER TABLE hotspot_payment_fulfillments
        ADD COLUMN IF NOT EXISTS
          device_activation_status VARCHAR(30)
      `);

      await db.query(`
        ALTER TABLE hotspot_payment_fulfillments
        ADD COLUMN IF NOT EXISTS
          device_activation_error TEXT
      `);

      await db.query(`
        ALTER TABLE hotspot_payment_fulfillments
        ADD COLUMN IF NOT EXISTS
          device_activated_at
            TIMESTAMP WITH TIME ZONE
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS
          idx_hotspot_payment_fulfillments_client
        ON hotspot_payment_fulfillments(
          client_id,
          created_at DESC
        )
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS
          idx_hotspot_payment_fulfillments_voucher
        ON hotspot_payment_fulfillments(voucher_id)
        WHERE voucher_id IS NOT NULL
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

function paymentMetadata(payment) {
  const metadata = payment?.metadata;

  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata)
  ) {
    return metadata;
  }

  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch (_) {
      return {};
    }
  }

  return {};
}

function hotspotMetadata(payment) {
  const metadata = paymentMetadata(payment);

  if (metadata.purpose !== 'hotspot') {
    return null;
  }

  const planId = Number(metadata.plan_id);

  if (!Number.isInteger(planId) || planId < 1) {
    return null;
  }

  return {
    ...metadata,
    plan_id: planId,
    expected_amount: Math.round(
      Number(
        metadata.expected_amount ||
        payment.amount ||
        0
      )
    ),
  };
}

function voucherCode(paymentId) {
  return [
    'HP',
    Number(paymentId).toString(36).toUpperCase(),
    crypto.randomBytes(3).toString('hex').toUpperCase(),
  ].join('-');
}

async function saveFailure({
  clientId,
  paymentId,
  planId,
  amount,
  phone,
  mac,
  ip,
  error,
}) {
  await db.query(
    `INSERT INTO hotspot_payment_fulfillments
       (
         client_id,
         payment_request_id,
         plan_id,
         status,
         amount,
         customer_phone,
         mac_address,
         ip_address,
         error,
         paid_at,
         updated_at
       )
     VALUES (
       $1,
       $2,
       $3,
       'failed',
       $4,
       $5,
       $6,
       $7,
       $8,
       NOW(),
       NOW()
     )
     ON CONFLICT (payment_request_id)
     DO UPDATE SET
       status = 'failed',
       error = EXCLUDED.error,
       updated_at = NOW()`,
    [
      clientId,
      paymentId,
      planId,
      amount,
      phone || null,
      mac || null,
      ip || null,
      String(error || 'Hotspot activation failed'),
    ]
  );
}

async function fulfillHotspotPayment(
  suppliedPayment
) {
  const metadata =
    hotspotMetadata(suppliedPayment);

  if (!metadata) {
    return null;
  }

  await ensureHotspotPaymentSchema();

  const connection = await db.connect();
  let payment;
  let plan;
  let voucher;
  let fulfillment;

  try {
    await connection.query('BEGIN');

    await connection.query(
      `SELECT pg_advisory_xact_lock(
         hashtext($1)
       )`,
      [
        `hotspot-payment:${
          suppliedPayment.id
        }`,
      ]
    );

    const paymentResult =
      await connection.query(
        `SELECT *
         FROM payhero_payment_requests
         WHERE id = $1
           AND client_id = $2
         FOR UPDATE`,
        [
          suppliedPayment.id,
          suppliedPayment.client_id,
        ]
      );

    payment = paymentResult.rows[0];

    if (!payment) {
      await connection.query('ROLLBACK');

      return {
        status: 'failed',
        error: 'Payment request was not found',
      };
    }

    if (payment.status !== 'paid') {
      await connection.query('COMMIT');

      return {
        status: 'pending',
        payment_status: payment.status,
      };
    }

    const planResult =
      await connection.query(
        `SELECT *
         FROM billing_hotspot_plans
         WHERE id = $1
           AND client_id = $2
         LIMIT 1`,
        [
          metadata.plan_id,
          payment.client_id,
        ]
      );

    plan = planResult.rows[0];

    if (!plan) {
      await connection.query('ROLLBACK');

      await saveFailure({
        clientId: payment.client_id,
        paymentId: payment.id,
        planId: metadata.plan_id,
        amount: payment.amount,
        phone: payment.customer_phone,
        mac: metadata.mac,
        ip: metadata.ip,
        error:
          'The purchased hotspot package no longer exists',
      });

      return {
        status: 'failed',
        error:
          'The purchased hotspot package no longer exists',
      };
    }

    const expectedAmount =
      metadata.expected_amount;

    if (
      !Number.isInteger(expectedAmount) ||
      expectedAmount < 1 ||
      Number(payment.amount) < expectedAmount
    ) {
      await connection.query('ROLLBACK');

      const error =
        'The confirmed payment is below the package price';

      await saveFailure({
        clientId: payment.client_id,
        paymentId: payment.id,
        planId: plan.id,
        amount: payment.amount,
        phone: payment.customer_phone,
        mac: metadata.mac,
        ip: metadata.ip,
        error,
      });

      return {
        status: 'failed',
        error,
      };
    }

    await connection.query(
      `INSERT INTO hotspot_payment_fulfillments
         (
           client_id,
           payment_request_id,
           plan_id,
           status,
           amount,
           customer_phone,
           mac_address,
           ip_address,
           paid_at,
           updated_at
         )
       VALUES (
         $1,
         $2,
         $3,
         'paid',
         $4,
         $5,
         $6,
         $7,
         NOW(),
         NOW()
       )
       ON CONFLICT (payment_request_id)
       DO UPDATE SET
         customer_phone =
           EXCLUDED.customer_phone,
         mac_address =
           EXCLUDED.mac_address,
         ip_address =
           EXCLUDED.ip_address,
         amount =
           EXCLUDED.amount,
         paid_at =
           COALESCE(
             hotspot_payment_fulfillments.paid_at,
             NOW()
           ),
         status =
           CASE
             WHEN hotspot_payment_fulfillments.status =
               'active'
             THEN 'active'
             ELSE 'paid'
           END,
         error =
           CASE
             WHEN hotspot_payment_fulfillments.status =
               'active'
             THEN hotspot_payment_fulfillments.error
             ELSE NULL
           END,
         updated_at = NOW()
       RETURNING *`,
      [
        payment.client_id,
        payment.id,
        plan.id,
        Number(payment.amount),
        payment.customer_phone || null,
        metadata.mac || null,
        metadata.ip || null,
      ]
    );

    const fulfillmentResult =
      await connection.query(
        `SELECT *
         FROM hotspot_payment_fulfillments
         WHERE payment_request_id = $1
         FOR UPDATE`,
        [payment.id]
      );

    fulfillment =
      fulfillmentResult.rows[0];

    if (fulfillment.voucher_id) {
      const voucherResult =
        await connection.query(
          `SELECT *
           FROM billing_hotspot_vouchers
           WHERE id = $1
             AND client_id = $2
           LIMIT 1`,
          [
            fulfillment.voucher_id,
            payment.client_id,
          ]
        );

      voucher = voucherResult.rows[0] || null;
    }

    const needsDeviceActivation =
      Boolean(metadata.mac);

    const deviceAlreadyActivated =
      ['active', 'triggered'].includes(
        fulfillment.device_activation_status
      );

    if (
      fulfillment.status === 'active' &&
      voucher &&
      voucher.expires_at &&
      new Date(voucher.expires_at) > new Date() &&
      (
        !needsDeviceActivation ||
        deviceAlreadyActivated
      )
    ) {
      await connection.query('COMMIT');

      return {
        status: 'active',
        voucher,
        plan,
        radius_status:
          fulfillment.radius_status,
        authentication:
          needsDeviceActivation
            ? 'mac'
            : 'voucher',
        device_activation_status:
          fulfillment.device_activation_status ||
          null,
      };
    }

    if (!voucher) {
      const code = voucherCode(payment.id);
      const usedBy = [
        payment.customer_phone
          ? `payhero:+${payment.customer_phone}`
          : 'payhero',
        metadata.mac
          ? `mac:${metadata.mac}`
          : null,
        metadata.ip
          ? `ip:${metadata.ip}`
          : null,
      ].filter(Boolean).join(' ');

      const voucherResult =
        await connection.query(
          `INSERT INTO billing_hotspot_vouchers
             (
               client_id,
               plan_id,
               code,
               status,
               used_by,
               activated_at,
               expires_at
             )
           VALUES (
             $1,
             $2,
             $3,
             'active',
             $4,
             NOW(),
             NOW() +
               ($5::text || ' minutes')::interval
           )
           RETURNING *`,
          [
            payment.client_id,
            plan.id,
            code,
            usedBy,
            Number(plan.duration_minutes),
          ]
        );

      voucher = voucherResult.rows[0];

      await connection.query(
        `UPDATE hotspot_payment_fulfillments
         SET voucher_id = $1,
             status = 'provisioning',
             error = NULL,
             updated_at = NOW()
         WHERE payment_request_id = $2`,
        [
          voucher.id,
          payment.id,
        ]
      );
    } else {
      await connection.query(
        `UPDATE hotspot_payment_fulfillments
         SET status = 'provisioning',
             error = NULL,
             updated_at = NOW()
         WHERE payment_request_id = $1`,
        [payment.id]
      );
    }

    await connection.query('COMMIT');
  } catch (error) {
    try {
      await connection.query('ROLLBACK');
    } catch (_) {
      // Transaction may already be closed.
    }

    throw error;
  } finally {
    connection.release();
  }

  if (!radiusEnabled()) {
    const error =
      'RADIUS synchronization is not enabled';

    await db.query(
      `UPDATE hotspot_payment_fulfillments
       SET status = 'failed',
           radius_status = 'not_configured',
           error = $2,
           updated_at = NOW()
       WHERE payment_request_id = $1`,
      [
        payment.id,
        error,
      ]
    );

    return {
      status: 'failed',
      error,
    };
  }

  try {
    const radiusSync =
      await syncHotspotVoucherRadius({
        ...voucher,
        mikrotik_rate_limit:
          plan.mikrotik_rate_limit,
        data_limit_mb:
          plan.data_limit_mb,
        fup_enabled:
          plan.fup_enabled,
        fup_threshold_mb:
          plan.fup_threshold_mb,
        fup_download_speed_mbps:
          plan.fup_download_speed_mbps,
        fup_upload_speed_mbps:
          plan.fup_upload_speed_mbps,
      });

    if (radiusSync.status !== 'synced') {
      throw new Error(
        'RADIUS did not activate the purchased voucher'
      );
    }

    let deviceActivation = null;

    if (metadata.mac) {
      deviceActivation =
        await activatePaidHotspotDevice({
          clientId: payment.client_id,
          routerId: plan.router_id || null,
          macAddress: metadata.mac,
          ipAddress: metadata.ip || '',
          expiresAt: voucher.expires_at,
          rateLimit:
            plan.mikrotik_rate_limit ||
            null,
          dataLimitMb:
            plan.data_limit_mb ||
            null,
        });
    }

    await db.query(
      `UPDATE hotspot_payment_fulfillments
       SET status = 'active',
           radius_status = $2,
           device_activation_status = $3,
           device_activation_error = NULL,
           device_activated_at =
             CASE
               WHEN $3 IS NULL
               THEN device_activated_at
               ELSE NOW()
             END,
           error = NULL,
           activated_at = NOW(),
           updated_at = NOW()
       WHERE payment_request_id = $1`,
      [
        payment.id,
        radiusSync.status,
        deviceActivation?.status ||
          null,
      ]
    );

    return {
      status: 'active',
      voucher,
      plan,
      radius_status: radiusSync.status,
      authentication:
        deviceActivation
          ? 'mac'
          : 'voucher',
      device_activation_status:
        deviceActivation?.status ||
        null,
    };
  } catch (error) {
    await db.query(
      `UPDATE hotspot_payment_fulfillments
       SET status = 'paid',
           radius_status = 'failed',
           device_activation_status = 'failed',
           device_activation_error = $2,
           error = $2,
           updated_at = NOW()
       WHERE payment_request_id = $1`,
      [
        payment.id,
        String(
          error?.message ||
          'RADIUS activation failed'
        ),
      ]
    );

    return {
      status: 'paid',
      error:
        'Payment received. Internet activation is retrying.',
    };
  }
}

async function getHotspotPaymentStatus({
  clientId,
  externalReference,
}) {
  await ensureHotspotPaymentSchema();

  const paymentResult = await db.query(
    `SELECT *
     FROM payhero_payment_requests
     WHERE client_id = $1
       AND external_reference = $2
     LIMIT 1`,
    [
      clientId,
      externalReference,
    ]
  );

  const payment = paymentResult.rows[0];

  if (!payment) {
    return null;
  }

  let fulfillment = null;

  if (payment.status === 'paid') {
    fulfillment =
      await fulfillHotspotPayment(payment);
  }

  const fulfillmentResult = await db.query(
    `SELECT
       f.*,
       v.code,
       v.expires_at,
       p.name AS plan_name,
       p.duration_minutes
     FROM hotspot_payment_fulfillments f
     LEFT JOIN billing_hotspot_vouchers v
       ON v.id = f.voucher_id
      AND v.client_id = f.client_id
     LEFT JOIN billing_hotspot_plans p
       ON p.id = f.plan_id
      AND p.client_id = f.client_id
     WHERE f.payment_request_id = $1
       AND f.client_id = $2
     LIMIT 1`,
    [
      payment.id,
      clientId,
    ]
  );

  const stored =
    fulfillmentResult.rows[0] || null;

  if (
    fulfillment?.status === 'active' ||
    stored?.status === 'active'
  ) {
    const source =
      stored || fulfillment;

    return {
      status: 'active',
      payment_status: payment.status,
      amount: payment.amount,
      receipt:
        payment.mpesa_receipt_number || null,
      authentication:
        ['active', 'triggered'].includes(
          source.device_activation_status
        )
          ? 'mac'
          : 'voucher',
      device_activation_status:
        source.device_activation_status ||
        null,
      voucher: {
        code:
          source.code ||
          fulfillment?.voucher?.code,
        plan_name:
          source.plan_name ||
          fulfillment?.plan?.name,
        duration_minutes:
          source.duration_minutes ||
          fulfillment?.plan?.duration_minutes,
        expires_at:
          source.expires_at ||
          fulfillment?.voucher?.expires_at,
      },
      login: {
        username:
          source.code ||
          fulfillment?.voucher?.code,
        password:
          source.code ||
          fulfillment?.voucher?.code,
      },
    };
  }

  if (
    payment.status === 'failed' ||
    stored?.status === 'failed'
  ) {
    return {
      status: 'failed',
      payment_status: payment.status,
      amount: payment.amount,
      error:
        stored?.error ||
        payment.result_description ||
        'The M-Pesa payment was not completed',
    };
  }

  return {
    status:
      payment.status === 'paid'
        ? 'activating'
        : 'pending',
    payment_status: payment.status,
    amount: payment.amount,
    message:
      stored?.error ||
      fulfillment?.error ||
      (
        payment.status === 'paid'
          ? 'Payment received. Activating internet access.'
          : 'Waiting for the M-Pesa payment confirmation.'
      ),
  };
}

module.exports = {
  ensureHotspotPaymentSchema,
  fulfillHotspotPayment,
  getHotspotPaymentStatus,
};
