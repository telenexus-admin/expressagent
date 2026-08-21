const db = require('../db');

const {
  normalizeMac,
  revokeHotspotDeviceAccess,
} = require('./hotspotMacAccess');

const {
  revokeHotspotRadiusAccess,
} = require('./radiusSync');

let schemaPromise = null;
let schedulerTimer = null;
let schedulerRunning = false;

function normalizeHotspotPhone(value) {
  const digits = String(value || '')
    .replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (
    digits.startsWith('254') &&
    digits.length >= 12
  ) {
    return digits.slice(0, 12);
  }

  if (
    digits.startsWith('0') &&
    digits.length === 10
  ) {
    return `254${digits.slice(1)}`;
  }

  if (
    digits.length === 9 &&
    /^[17]/.test(digits)
  ) {
    return `254${digits}`;
  }

  return digits;
}

function normalizedMac(value) {
  return normalizeMac(value) || '';
}

function voucherMacFromUsedBy(value) {
  const match = String(value || '').match(/(?:^|\s)mac:([0-9a-f:.-]+)/i);
  return match ? normalizedMac(match[1]) : '';
}

async function ensureHotspotSubscriberSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS
          billing_hotspot_subscribers (
            id BIGSERIAL PRIMARY KEY,

            client_id INTEGER NOT NULL
              REFERENCES clients(id)
              ON DELETE CASCADE,

            customer_phone VARCHAR(32)
              NOT NULL,

            current_mac VARCHAR(17),

            last_requested_mac VARCHAR(17),

            router_id INTEGER,

            plan_id INTEGER,

            payment_request_id INTEGER,

            voucher_id INTEGER,

            package_name VARCHAR(180),

            status VARCHAR(30)
              NOT NULL DEFAULT 'offline',

            expires_at
              TIMESTAMP WITH TIME ZONE,

            last_payment_at
              TIMESTAMP WITH TIME ZONE,

            last_payment_amount
              NUMERIC(14, 2),

            device_activation_status
              VARCHAR(30),

            cleanup_completed_at
              TIMESTAMP WITH TIME ZONE,

            cleanup_error TEXT,

            created_at
              TIMESTAMP WITH TIME ZONE
              NOT NULL DEFAULT NOW(),

            updated_at
              TIMESTAMP WITH TIME ZONE
              NOT NULL DEFAULT NOW(),

            UNIQUE (
              client_id,
              customer_phone
            )
          )
      `);

      await db.query(`
        ALTER TABLE
          billing_hotspot_subscribers
        ADD COLUMN IF NOT EXISTS
          last_requested_mac VARCHAR(17)
      `);

      await db.query(`
        ALTER TABLE
          billing_hotspot_subscribers
        ADD COLUMN IF NOT EXISTS
          cleanup_completed_at
            TIMESTAMP WITH TIME ZONE
      `);

      await db.query(`
        ALTER TABLE
          billing_hotspot_subscribers
        ADD COLUMN IF NOT EXISTS
          cleanup_error TEXT
      `);

      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS
          idx_hotspot_subscribers_current_mac
        ON billing_hotspot_subscribers (
          client_id,
          current_mac
        )
        WHERE current_mac IS NOT NULL
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS
          idx_hotspot_subscribers_expiry
        ON billing_hotspot_subscribers (
          expires_at,
          status
        )
      `);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function resolveHotspotSubscriberBinding({
  queryable = db,
  clientId,
  customerPhone,
  requestedMac,
  routerId = null,
}) {
  const phone =
    normalizeHotspotPhone(
      customerPhone
    );

  const requested =
    normalizedMac(
      requestedMac
    );

  if (!phone) {
    throw new Error(
      'A valid payment phone number is required'
    );
  }

  const existingResult =
    await queryable.query(
      `SELECT *
       FROM billing_hotspot_subscribers
       WHERE client_id = $1
         AND customer_phone = $2
       FOR UPDATE`,
      [
        clientId,
        phone,
      ]
    );

  const existing =
    existingResult.rows[0];

  const current =
    normalizedMac(
      existing?.current_mac
    ) || requested;

  if (!current) {
    throw new Error(
      'A valid Hotspot device MAC address is required'
    );
  }

  await queryable.query(
    `UPDATE billing_hotspot_subscribers
     SET current_mac = NULL,
         status = 'replaced',
         cleanup_completed_at = NULL,
         cleanup_error =
           'Device ownership transferred to another paying phone',
         updated_at = NOW()
     WHERE client_id = $1
       AND current_mac = $2
       AND customer_phone <> $3`,
    [
      clientId,
      current,
      phone,
    ]
  );

  if (existing) {
    const updated =
      await queryable.query(
        `UPDATE billing_hotspot_subscribers
         SET current_mac = $3,
             last_requested_mac = $4,
             router_id =
               COALESCE(
                 $5,
                 router_id
               ),
             updated_at = NOW()
         WHERE client_id = $1
           AND customer_phone = $2
         RETURNING *`,
        [
          clientId,
          phone,
          current,
          requested || null,
          routerId || null,
        ]
      );

    return {
      ...updated.rows[0],
      requested_mac:
        requested || null,
      binding_reused:
        Boolean(
          existing.current_mac
        ),
      different_requested_mac:
        Boolean(
          requested &&
          requested !== current
        ),
    };
  }

  const inserted =
    await queryable.query(
      `INSERT INTO
         billing_hotspot_subscribers (
           client_id,
           customer_phone,
           current_mac,
           last_requested_mac,
           router_id,
           status,
           updated_at
         )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         'offline',
         NOW()
       )
       RETURNING *`,
      [
        clientId,
        phone,
        current,
        requested || null,
        routerId || null,
      ]
    );

  return {
    ...inserted.rows[0],
    requested_mac:
      requested || null,
    binding_reused: false,
    different_requested_mac: false,
  };
}

async function recordHotspotSubscriberAccess({
  clientId,
  customerPhone,
  currentMac,
  requestedMac = null,
  routerId = null,
  plan,
  payment,
  voucher,
  deviceActivationStatus = null,
}) {
  await ensureHotspotSubscriberSchema();

  const phone =
    normalizeHotspotPhone(
      customerPhone
    );

  const mac =
    normalizedMac(
      currentMac
    );

  if (!phone || !mac) {
    throw new Error(
      'The Hotspot subscriber phone or MAC is invalid'
    );
  }

  const previousResult =
    await db.query(
      `SELECT
         subscriber.*,
         voucher.code
           AS previous_voucher_code
       FROM billing_hotspot_subscribers
         subscriber
       LEFT JOIN billing_hotspot_vouchers
         voucher
         ON voucher.id =
              subscriber.voucher_id
        AND voucher.client_id =
              subscriber.client_id
       WHERE subscriber.client_id = $1
         AND subscriber.customer_phone = $2
       LIMIT 1`,
      [
        clientId,
        phone,
      ]
    );

  const previous =
    previousResult.rows[0];

  const expiry =
    new Date(
      voucher.expires_at
    );

  if (
    Number.isNaN(
      expiry.getTime()
    )
  ) {
    throw new Error(
      'The Hotspot package expiry is invalid'
    );
  }

  const status =
    expiry.getTime() <= Date.now()
      ? 'expired'
      : 'active';

  const result =
    await db.query(
      `INSERT INTO
         billing_hotspot_subscribers (
           client_id,
           customer_phone,
           current_mac,
           last_requested_mac,
           router_id,
           plan_id,
           payment_request_id,
           voucher_id,
           package_name,
           status,
           expires_at,
           last_payment_at,
           last_payment_amount,
           device_activation_status,
           cleanup_completed_at,
           cleanup_error,
           updated_at
         )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12,
         $13,
         $14,
         NULL,
         NULL,
         NOW()
       )
       ON CONFLICT (
         client_id,
         customer_phone
       )
       DO UPDATE SET
         current_mac =
           COALESCE(
             billing_hotspot_subscribers.current_mac,
             EXCLUDED.current_mac
           ),

         last_requested_mac =
           EXCLUDED.last_requested_mac,

         router_id =
           COALESCE(
             EXCLUDED.router_id,
             billing_hotspot_subscribers.router_id
           ),

         plan_id =
           EXCLUDED.plan_id,

         payment_request_id =
           EXCLUDED.payment_request_id,

         voucher_id =
           EXCLUDED.voucher_id,

         package_name =
           EXCLUDED.package_name,

         status =
           EXCLUDED.status,

         expires_at =
           EXCLUDED.expires_at,

         last_payment_at =
           EXCLUDED.last_payment_at,

         last_payment_amount =
           EXCLUDED.last_payment_amount,

         device_activation_status =
           EXCLUDED.device_activation_status,

         cleanup_completed_at =
           CASE
             WHEN
               billing_hotspot_subscribers.payment_request_id =
                 EXCLUDED.payment_request_id
               AND
               billing_hotspot_subscribers.voucher_id =
                 EXCLUDED.voucher_id
               AND
               billing_hotspot_subscribers.expires_at =
                 EXCLUDED.expires_at
             THEN
               billing_hotspot_subscribers.cleanup_completed_at
             ELSE NULL
           END,

         cleanup_error =
           CASE
             WHEN
               billing_hotspot_subscribers.payment_request_id =
                 EXCLUDED.payment_request_id
               AND
               billing_hotspot_subscribers.voucher_id =
                 EXCLUDED.voucher_id
               AND
               billing_hotspot_subscribers.expires_at =
                 EXCLUDED.expires_at
             THEN
               billing_hotspot_subscribers.cleanup_error
             ELSE NULL
           END,

         updated_at = NOW()

       RETURNING *`,
      [
        clientId,
        phone,
        mac,
        normalizedMac(
          requestedMac
        ) || null,
        routerId || null,
        plan.id,
        payment.id,
        voucher.id,
        plan.name,
        status,
        expiry,
        payment.updated_at ||
          payment.created_at ||
          new Date(),
        Number(
          payment.amount || 0
        ),
        deviceActivationStatus,
      ]
    );

  if (
    previous?.voucher_id &&
    Number(previous.voucher_id) !==
      Number(voucher.id)
  ) {
    await db.query(
      `UPDATE billing_hotspot_vouchers
       SET status = 'expired'
       WHERE id = $1
         AND client_id = $2`,
      [
        previous.voucher_id,
        clientId,
      ]
    );

    if (
      previous.previous_voucher_code
    ) {
      await revokeHotspotRadiusAccess({
        voucherCode:
          previous.previous_voucher_code,
      }).catch(error => {
        console.error(
          'Previous Hotspot voucher cleanup failed:',
          error.message
        );
      });
    }
  }

  return {
    ...result.rows[0],
    previous_voucher_id:
      previous?.voucher_id || null,
  };
}

async function paymentTablesAvailable() {
  const result =
    await db.query(`
      SELECT
        TO_REGCLASS(
          'public.hotspot_payment_fulfillments'
        ) AS fulfillments,

        TO_REGCLASS(
          'public.payhero_payment_requests'
        ) AS payments
    `);

  return Boolean(
    result.rows[0]?.fulfillments &&
    result.rows[0]?.payments
  );
}

async function backfillHotspotSubscribers() {
  await ensureHotspotSubscriberSchema();

  if (
    !await paymentTablesAvailable()
  ) {
    return {
      processed: 0,
      reason:
        'Payment tables are not ready',
    };
  }

  const result =
    await db.query(`
      SELECT
        payment.id
          AS payment_request_id,

        payment.client_id,

        payment.customer_phone,

        payment.amount,

        payment.created_at,

        payment.updated_at,

        fulfillment.mac_address,

        fulfillment.ip_address,

        fulfillment.plan_id,

        fulfillment.voucher_id,

        fulfillment.device_activation_status,

        voucher.expires_at,

        plan.name
          AS package_name,

        plan.router_id

      FROM hotspot_payment_fulfillments
        fulfillment

      JOIN payhero_payment_requests
        payment
        ON payment.id =
             fulfillment.payment_request_id
       AND payment.client_id =
             fulfillment.client_id

      JOIN billing_hotspot_plans
        plan
        ON plan.id =
             fulfillment.plan_id
       AND plan.client_id =
             fulfillment.client_id

      LEFT JOIN billing_hotspot_vouchers
        voucher
        ON voucher.id =
             fulfillment.voucher_id
       AND voucher.client_id =
             fulfillment.client_id

      WHERE payment.status = 'paid'
        AND payment.metadata->>'purpose' =
          'hotspot'
        AND fulfillment.mac_address
          IS NOT NULL
        AND fulfillment.device_activation_status
              IS DISTINCT FROM 'deleted'
        AND voucher.expires_at
          IS NOT NULL

      ORDER BY
        payment.updated_at ASC,
        payment.id ASC
    `);

  const latestByPhone =
    new Map();

  for (const row of result.rows) {
    const phone =
      normalizeHotspotPhone(
        row.customer_phone
      );

    if (!phone) {
      continue;
    }

    latestByPhone.set(
      `${row.client_id}:${phone}`,
      row
    );
  }

  const latestRows =
    [...latestByPhone.values()]
      .sort(
        (left, right) =>
          new Date(
            left.updated_at
          ) -
          new Date(
            right.updated_at
          )
      );

  let processed = 0;

  for (const row of latestRows) {
    const binding =
      await resolveHotspotSubscriberBinding({
        clientId:
          row.client_id,

        customerPhone:
          row.customer_phone,

        requestedMac:
          row.mac_address,

        routerId:
          row.router_id,
      });

    await recordHotspotSubscriberAccess({
      clientId:
        row.client_id,

      customerPhone:
        row.customer_phone,

      currentMac:
        binding.current_mac,

      requestedMac:
        row.mac_address,

      routerId:
        row.router_id,

      plan: {
        id:
          row.plan_id,

        name:
          row.package_name,
      },

      payment: {
        id:
          row.payment_request_id,

        amount:
          row.amount,

        created_at:
          row.created_at,

        updated_at:
          row.updated_at,
      },

      voucher: {
        id:
          row.voucher_id,

        expires_at:
          row.expires_at,
      },

      deviceActivationStatus:
        row.device_activation_status,
    });

    processed += 1;
  }

  return {
    processed,
    source_payments:
      result.rows.length,
  };
}

async function reconcileExpiredHotspotAccess({
  limit = 250,
} = {}) {
  await ensureHotspotSubscriberSchema();

  if (
    !await paymentTablesAvailable()
  ) {
    return {
      locked: true,
      checked: 0,
      cleaned: 0,
      failed: 0,
    };
  }

  const lockClient =
    await db.connect();

  let lockAcquired = false;

  try {
    const lockResult =
      await lockClient.query(
        `SELECT
           PG_TRY_ADVISORY_LOCK(
             HASHTEXT($1)
           ) AS locked`,
        [
          'nexa-hotspot-expiry-reconciler',
        ]
      );

    lockAcquired =
      lockResult.rows[0]?.locked ===
      true;

    if (!lockAcquired) {
      return {
        locked: false,
        checked: 0,
        cleaned: 0,
        failed: 0,
      };
    }

    const expiredResult =
      await db.query(
        `SELECT
           fulfillment.id
             AS fulfillment_id,

           fulfillment.client_id,

           fulfillment.payment_request_id,

           fulfillment.plan_id,

           fulfillment.voucher_id,

           fulfillment.mac_address,

           fulfillment.ip_address,

           fulfillment.device_activation_status,

           voucher.code
             AS voucher_code,

           voucher.expires_at,

           plan.router_id,

           subscriber.id
             AS subscriber_id,

           subscriber.customer_phone,

           subscriber.current_mac,

           subscriber.cleanup_completed_at

         FROM hotspot_payment_fulfillments
           fulfillment

         JOIN billing_hotspot_vouchers
           voucher
           ON voucher.id =
                fulfillment.voucher_id
          AND voucher.client_id =
                fulfillment.client_id

         LEFT JOIN billing_hotspot_plans
           plan
           ON plan.id =
                fulfillment.plan_id
          AND plan.client_id =
                fulfillment.client_id

         LEFT JOIN billing_hotspot_subscribers
           subscriber
           ON subscriber.client_id =
                fulfillment.client_id
          AND subscriber.payment_request_id =
                fulfillment.payment_request_id

         WHERE voucher.expires_at <= NOW()

           AND voucher.status IS DISTINCT FROM 'expired'

           AND fulfillment.device_activation_status
                 IS DISTINCT FROM 'deleted'

           AND (
             fulfillment.device_activation_status
               IS DISTINCT FROM 'expired'

             OR subscriber.cleanup_completed_at
               IS NULL
           )

           AND NOT EXISTS (
             SELECT 1
             FROM billing_hotspot_subscribers
               active_subscriber

             WHERE active_subscriber.client_id =
                     fulfillment.client_id

               AND active_subscriber.current_mac
                     IS NOT NULL

               AND UPPER(
                     REGEXP_REPLACE(
                       active_subscriber.current_mac,
                       '[^0-9A-Fa-f]',
                       '',
                       'g'
                     )
                   ) =
                   UPPER(
                     REGEXP_REPLACE(
                       COALESCE(
                         fulfillment.mac_address,
                         ''
                       ),
                       '[^0-9A-Fa-f]',
                       '',
                       'g'
                     )
                   )

               AND active_subscriber.expires_at >
                     NOW()
           )

         ORDER BY
           voucher.expires_at ASC

         LIMIT $1`,
        [
          Math.max(
            1,
            Number(limit) || 250
          ),
        ]
      );

    const result = {
      locked: true,
      checked:
        expiredResult.rows.length,
      cleaned: 0,
      failed: 0,
      errors: [],
    };

    for (
      const access
      of expiredResult.rows
    ) {
      const mac =
        normalizedMac(
          access.current_mac ||
          access.mac_address
        );

      const errors = [];

      try {
        await revokeHotspotRadiusAccess({
          macAddress:
            mac || null,

          voucherCode:
            access.voucher_code ||
            null,
        });
      } catch (error) {
        errors.push(
          `RADIUS: ${error.message}`
        );
      }

      if (mac) {
        try {
          await revokeHotspotDeviceAccess({
            clientId:
              access.client_id,

            routerId:
              access.router_id ||
              null,

            macAddress:
              mac,

            ipAddress:
              access.ip_address ||
              '',
          });
        } catch (error) {
          errors.push(
            `MikroTik: ${error.message}`
          );
        }
      }

      const cleanupSucceeded =
        errors.length === 0;

      await db.query(
        `UPDATE billing_hotspot_vouchers
         SET status = 'expired'
         WHERE id = $1
           AND client_id = $2`,
        [
          access.voucher_id,
          access.client_id,
        ]
      );

      await db.query(
        `UPDATE hotspot_payment_fulfillments
         SET device_activation_status =
               CASE
                 WHEN $3
                 THEN 'expired'
                 ELSE device_activation_status
               END,

             device_activation_error =
               CASE
                 WHEN $3
                 THEN NULL
                 ELSE $4
               END,

             updated_at = NOW()

         WHERE id = $1
           AND client_id = $2`,
        [
          access.fulfillment_id,
          access.client_id,
          cleanupSucceeded,
          errors.join('; ') ||
            null,
        ]
      );

      if (access.subscriber_id) {
        await db.query(
          `UPDATE billing_hotspot_subscribers
           SET status = 'expired',

               device_activation_status =
                 CASE
                   WHEN $3
                   THEN 'expired'
                   ELSE device_activation_status
                 END,

               cleanup_completed_at =
                 CASE
                   WHEN $3
                   THEN NOW()
                   ELSE NULL
                 END,

               cleanup_error =
                 CASE
                   WHEN $3
                   THEN NULL
                   ELSE $4
                 END,

               updated_at = NOW()

           WHERE id = $1
             AND client_id = $2`,
          [
            access.subscriber_id,
            access.client_id,
            cleanupSucceeded,
            errors.join('; ') ||
              null,
          ]
        );
      }

      if (mac) {
        await db.query(
          `UPDATE mikrotik_clients
           SET status = 'expired',
               is_online = FALSE,
               last_seen =
                 'package expired',
               updated_at = NOW()

           WHERE client_id = $1
             AND service_type =
               'hotspot'

             AND UPPER(
                   REGEXP_REPLACE(
                     COALESCE(
                       mac_address,
                       username,
                       ''
                     ),
                     '[^0-9A-Fa-f]',
                     '',
                     'g'
                   )
                 ) =
                 UPPER(
                   REGEXP_REPLACE(
                     $2,
                     '[^0-9A-Fa-f]',
                     '',
                     'g'
                   )
                 )`,
          [
            access.client_id,
            mac,
          ]
        );
      }

      if (cleanupSucceeded) {
        result.cleaned += 1;
      } else {
        result.failed += 1;

        result.errors.push({
          payment_request_id:
            access.payment_request_id,

          error:
            errors.join('; '),
        });
      }
    }

    /*
     * Additional-device vouchers are independent RADIUS logins.
     * They do not have a fulfillment.voucher_id, so clean them
     * separately and actively drop the matching hotspot session.
     */
    const additionalExpiredResult = await db.query(
      `SELECT v.id AS voucher_id, v.client_id, v.code AS voucher_code,
              v.used_by, v.expires_at, p.router_id
       FROM billing_hotspot_vouchers v
       JOIN hotspot_payment_fulfillments f
         ON f.client_id = v.client_id
        AND f.additional_voucher_ids @> jsonb_build_array(v.id)
       LEFT JOIN billing_hotspot_plans p
         ON p.id = v.plan_id AND p.client_id = v.client_id
       WHERE v.status = 'active'
         AND v.expires_at <= NOW()
       ORDER BY v.expires_at ASC
       LIMIT $1`,
      [Math.max(1, Number(limit) || 250)]
    );

    result.checked += additionalExpiredResult.rows.length;

    for (const voucher of additionalExpiredResult.rows) {
      const mac = voucherMacFromUsedBy(voucher.used_by);
      const errors = [];

      try {
        await revokeHotspotRadiusAccess({ voucherCode: voucher.voucher_code });
      } catch (error) {
        errors.push(`RADIUS: ${error.message}`);
      }

      if (mac) {
        try {
          await revokeHotspotDeviceAccess({
            clientId: voucher.client_id,
            routerId: voucher.router_id || null,
            macAddress: mac,
          });
        } catch (error) {
          errors.push(`MikroTik: ${error.message}`);
        }
      }

      const cleanupSucceeded = errors.length === 0;
      await db.query(
        `UPDATE billing_hotspot_vouchers
         SET status = 'expired'
         WHERE id = $1 AND client_id = $2`,
        [voucher.voucher_id, voucher.client_id]
      );

      if (mac) {
        await db.query(
          `UPDATE mikrotik_clients
           SET status = 'expired', is_online = FALSE,
               last_seen = 'package expired', updated_at = NOW()
           WHERE client_id = $1 AND service_type = 'hotspot'
             AND UPPER(REGEXP_REPLACE(COALESCE(mac_address, username, ''), '[^0-9A-Fa-f]', '', 'g')) =
                 UPPER(REGEXP_REPLACE($2, '[^0-9A-Fa-f]', '', 'g'))`,
          [voucher.client_id, mac]
        );
      }

      if (cleanupSucceeded) {
        result.cleaned += 1;
      } else {
        result.failed += 1;
        result.errors.push({ voucher_code: voucher.voucher_code, error: errors.join('; ') });
      }
    }

    return result;
  } finally {
    if (lockAcquired) {
      await lockClient.query(
        `SELECT
           PG_ADVISORY_UNLOCK(
             HASHTEXT($1)
           )`,
        [
          'nexa-hotspot-expiry-reconciler',
        ]
      ).catch(() => {});
    }

    lockClient.release();
  }
}

function startHotspotSubscriberScheduler() {
  if (schedulerTimer) {
    return schedulerTimer;
  }

  const reconcile = async () => {
    if (schedulerRunning) {
      return;
    }

    schedulerRunning = true;

    try {
      const result =
        await reconcileExpiredHotspotAccess();

      if (
        result.cleaned ||
        result.failed
      ) {
        console.log(
          'Hotspot expiry reconciliation:',
          result
        );
      }
    } catch (error) {
      console.error(
        'Hotspot expiry reconciliation failed:',
        error.message
      );
    } finally {
      schedulerRunning = false;
    }
  };

  void (async () => {
    try {
      await ensureHotspotSubscriberSchema();

      const backfill =
        await backfillHotspotSubscribers();

      console.log(
        'Hotspot subscriber binding backfill:',
        backfill
      );

      await reconcile();
    } catch (error) {
      console.error(
        'Hotspot subscriber initialization failed:',
        error.message
      );
    }
  })();

  schedulerTimer =
    setInterval(
      () => {
        void reconcile();
      },
      30000
    );

  schedulerTimer.unref?.();

  return schedulerTimer;
}

module.exports = {
  backfillHotspotSubscribers,
  ensureHotspotSubscriberSchema,
  normalizeHotspotPhone,
  reconcileExpiredHotspotAccess,
  recordHotspotSubscriberAccess,
  resolveHotspotSubscriberBinding,
  startHotspotSubscriberScheduler,
};
