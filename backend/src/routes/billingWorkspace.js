const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const net = require('net');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { encryptPassword, getOnlineUsernames, getSubscriberUsage, loadSubscriber, radiusEnabled, revokeHotspotRadiusAccess, syncHotspotMemberRadius, syncHotspotVoucherRadius, syncSubscriberRadius } = require('../services/radiusSync');
const {
  activatePaidHotspotDevice,
  revokeHotspotDeviceAccess,
} = require('../services/hotspotMacAccess');
const { enqueueRadiusSyncJob, processRadiusSyncJobs } = require('../services/radiusJobs');
const {
  ensureMikrotikTables,
  syncMikrotikClients,
  syncStaticDhcpLease,
} = require('../services/mikrotik');
const { createHotspotPortalToken } = require('../services/hotspotPortalToken');
const { installHotspotEdgePortal } = require('../services/hotspotEdgePortal');
const { ensureHotspotPlanSchema, normalizeHotspotDeviceLimit } = require('../services/hotspotPlanSchema');
const {
  appendBillingEvent,
  appendRequestEvent,
  ensureEventSchema,
  eventActorFromRequest,
  recordRequestEvent,
} = require('../services/events');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

async function requireBillingAccount(req, res, next) {
  if (req.scope.isSuperadmin || !req.scope.clientId) {
    return res.status(403).json({ error: 'Billing workspace access required' });
  }
  const result = await db.query('SELECT account_type FROM clients WHERE id = $1 LIMIT 1', [req.scope.clientId]);
  if (result.rows[0]?.account_type !== 'billing') {
    return res.status(403).json({ error: 'This account is not a billing workspace' });
  }
  next();
}

router.use(requireBillingAccount);

async function resolveStaticConfig(body, clientId, selectedRouter) {
  const accessMode = ['pppoe', 'pppoe_static', 'dhcp_static'].includes(body.access_mode) ? body.access_mode : 'pppoe';
  const needsStatic = accessMode !== 'pppoe';
  const staticIp = body.static_ip ? String(body.static_ip).trim() : null;
  const staticPoolId = body.static_pool_id ? Number(body.static_pool_id) : null;
  const staticMac = body.static_mac ? String(body.static_mac).trim().toUpperCase() : null;
  const staticDhcpServer = body.static_dhcp_server ? String(body.static_dhcp_server).trim() : null;
  if (!needsStatic) return { accessMode, staticPoolId: null, staticIp: null, staticMac: null, staticDhcpServer: null };
  if (!selectedRouter?.id || !staticPoolId || !staticIp || !net.isIP(staticIp)) throw new Error('Static clients require an assigned router, IP pool, and valid IP address');
  const pool = await db.query('SELECT * FROM billing_ip_pools WHERE id = $1 AND client_id = $2 AND router_id = $3 AND is_active = TRUE LIMIT 1', [staticPoolId, clientId, selectedRouter.id]);
  if (!pool.rows[0]) throw new Error('Selected IP pool does not belong to the assigned active router');
  const inPool = await db.query('SELECT $1::inet << $2::cidr AS allowed', [staticIp, pool.rows[0].cidr]);
  if (!inPool.rows[0].allowed) throw new Error('Static IP address is outside the selected IP pool');
  if (accessMode === 'dhcp_static' && (!staticMac || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(staticMac) || !staticDhcpServer)) throw new Error('Static DHCP requires a valid MAC address and MikroTik DHCP server name');
  return { accessMode, staticPoolId, staticIp, staticMac, staticDhcpServer };
}

router.get('/summary', async (req, res) => {
  try {
    const clientId =
      req.scope.clientId;

    await ensureMikrotikTables();

    const [
      subscribers,
      plans,
      invoices,
      billingPayments,
      hotspotPayments,
      recentPayments,
    ] = await Promise.all([
      db.query(
        `SELECT
           (
             SELECT COUNT(*)
             FROM mikrotik_clients
             WHERE client_id = $1
               AND service_type <>
                   'hotspot'
           ) +

           (
             SELECT COUNT(*)
             FROM billing_hotspot_subscribers
             WHERE client_id = $1
               AND current_mac
                     IS NOT NULL
               AND status <>
                     'replaced'
           ) AS total,

           (
             SELECT COUNT(*)
             FROM mikrotik_clients
             WHERE client_id = $1
               AND service_type <>
                   'hotspot'
               AND is_online = TRUE
           ) +

           (
             SELECT COUNT(*)
             FROM billing_hotspot_subscribers
               subscriber

             JOIN LATERAL (
               SELECT client.is_online
               FROM mikrotik_clients client
               WHERE client.client_id =
                       subscriber.client_id

                 AND client.service_type =
                       'hotspot'

                 AND UPPER(
                       REGEXP_REPLACE(
                         COALESCE(
                           client.mac_address,
                           client.username,
                           ''
                         ),
                         '[^0-9A-Fa-f]',
                         '',
                         'g'
                       )
                     ) =
                     UPPER(
                       REGEXP_REPLACE(
                         subscriber.current_mac,
                         '[^0-9A-Fa-f]',
                         '',
                         'g'
                       )
                     )

               ORDER BY
                 client.is_online DESC,
                 client.last_synced_at DESC

               LIMIT 1
             ) live ON TRUE

             WHERE subscriber.client_id = $1
               AND subscriber.current_mac
                     IS NOT NULL
               AND subscriber.status <>
                     'replaced'
               AND subscriber.expires_at >
                     NOW()
               AND live.is_online = TRUE
           ) AS active,

           (
             SELECT COUNT(*)
             FROM mikrotik_clients
             WHERE client_id = $1
               AND service_type =
                   'pppoe'
           ) AS pppoe,

           (
             SELECT COUNT(*)
             FROM billing_hotspot_subscribers
             WHERE client_id = $1
               AND current_mac
                     IS NOT NULL
               AND status <>
                     'replaced'
           ) AS hotspot,

           (
             SELECT COUNT(*)
             FROM mikrotik_clients
             WHERE client_id = $1
               AND service_type =
                   'dhcp'
           ) AS static,

           GREATEST(
             (
               SELECT MAX(
                 last_synced_at
               )
               FROM mikrotik_clients
               WHERE client_id = $1
             ),

             (
               SELECT MAX(
                 updated_at
               )
               FROM billing_hotspot_subscribers
               WHERE client_id = $1
             )
           ) AS last_synced_at`,
        [
          clientId,
        ]
      ),

      db.query(
        `SELECT
           (
             SELECT COUNT(*)
             FROM billing_plans
             WHERE client_id = $1
               AND is_active = TRUE
           ) +
           (
             SELECT COUNT(*)
             FROM billing_hotspot_plans
             WHERE client_id = $1
               AND is_active = TRUE
           ) AS total`,
        [clientId]
      ),

      db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (
             WHERE status = 'overdue'
           )::int AS overdue,
           COALESCE(
             SUM(amount) FILTER (
               WHERE status IN (
                 'issued',
                 'overdue'
               )
             ),
             0
           )::numeric AS outstanding
         FROM billing_invoices
         WHERE client_id = $1`,
        [clientId]
      ),

      db.query(
        `SELECT
           COALESCE(
             SUM(amount),
             0
           )::numeric AS total
         FROM billing_payments
         WHERE client_id = $1
           AND status = 'completed'
           AND paid_at >=
             DATE_TRUNC(
               'month',
               CURRENT_DATE
             )
           AND paid_at <
             DATE_TRUNC(
               'month',
               CURRENT_DATE
             ) +
             INTERVAL '1 month'`,
        [clientId]
      ),

      db.query(
        `SELECT
           COALESCE(
             SUM(amount),
             0
           )::numeric AS total
         FROM payhero_payment_requests
         WHERE client_id = $1
           AND status = 'paid'
           AND metadata->>'purpose' =
             'hotspot'
           AND updated_at >=
             DATE_TRUNC(
               'month',
               CURRENT_DATE
             )
           AND updated_at <
             DATE_TRUNC(
               'month',
               CURRENT_DATE
             ) +
             INTERVAL '1 month'`,
        [clientId]
      ),

      db.query(
        `SELECT
           id,
           amount,
           method,
           reference,
           status,
           paid_at,
           invoice_number
         FROM (
           SELECT
             payment.id::text AS id,
             payment.amount,
             payment.method,
             payment.reference,
             payment.status,
             payment.paid_at,
             invoice.invoice_number
           FROM billing_payments payment
           LEFT JOIN billing_invoices invoice
             ON invoice.id =
                payment.invoice_id
            AND invoice.client_id =
                payment.client_id
           WHERE payment.client_id = $1

           UNION ALL

           SELECT
             'hotspot-' ||
               payment.id::text AS id,
             payment.amount,
             'M-Pesa' AS method,
             COALESCE(
               payment.mpesa_receipt_number,
               payment.external_reference
             ) AS reference,
             payment.status,
             payment.updated_at AS paid_at,
             'Hotspot package'
               AS invoice_number
           FROM payhero_payment_requests
             payment
           WHERE payment.client_id = $1
             AND payment.status = 'paid'
             AND payment.metadata->>'purpose' =
               'hotspot'
         ) payments
         ORDER BY paid_at DESC NULLS LAST
         LIMIT 8`,
        [clientId]
      ),
    ]);

    res.json({
      subscribers:
        subscribers.rows[0],

      plans: {
        total:
          Number(
            plans.rows[0]?.total ||
            0
          ),
      },

      invoices:
        invoices.rows[0],

      payments: {
        total:
          Number(
            billingPayments.rows[0]
              ?.total || 0
          ) +
          Number(
            hotspotPayments.rows[0]
              ?.total || 0
          ),
        period:
          'current_month',
      },

      recent_payments:
        recentPayments.rows,

      data_sources: {
        subscribers:
          'mikrotik-live',
        hotspot_devices:
          'confirmed-phone-mac-binding',
        graph:
          'mikrotik-noc-snapshots',
        simulated: false,
      },
    });
  } catch (error) {
    console.error(
      'Billing summary error:',
      error.message
    );

    res.status(500).json({
      error:
        'Failed to load live billing summary',
    });
  }
});

router.get('/plans', async (req, res) => {
  const result = await db.query(
    `SELECT p.*, r.name AS router_name
     FROM billing_plans p
     LEFT JOIN mikrotik_routers r ON r.id = p.router_id AND r.client_id = p.client_id
     WHERE p.client_id = $1 ORDER BY p.is_active DESC, p.name ASC`,
    [req.scope.clientId]
  );
  res.json(result.rows);
});

router.get('/ip-pools', async (req, res) => {
  await ensureMikrotikTables();
  const result = await db.query(`SELECT p.*, r.name AS router_name FROM billing_ip_pools p
    JOIN mikrotik_routers r ON r.id = p.router_id AND r.client_id = p.client_id
    WHERE p.client_id = $1 ORDER BY r.name, p.name`, [req.scope.clientId]);
  res.json(result.rows);
});

router.post('/ip-pools', [
  body('router_id').isInt({ min: 1 }), body('name').trim().notEmpty().isLength({ max: 160 }),
  body('cidr').trim().matches(/^.+\/.+$/).isLength({ max: 64 }), body('gateway').optional({ checkFalsy: true }).isIP(),
], async (req, res) => {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureMikrotikTables();
    const routerRow = await db.query('SELECT id FROM mikrotik_routers WHERE id=$1 AND client_id=$2 AND is_active=TRUE', [req.body.router_id, req.scope.clientId]);
    if (!routerRow.rows[0]) return res.status(400).json({ error: 'Selected router is not active in this billing account' });
    const probe = await db.query('SELECT $1::cidr AS cidr', [req.body.cidr.trim()]);
    const result = await db.query(`INSERT INTO billing_ip_pools (client_id, router_id, name, cidr, gateway, dns_servers)
      VALUES ($1,$2,$3,$4::cidr,$5::inet,$6) RETURNING *`, [req.scope.clientId, req.body.router_id, req.body.name.trim(), probe.rows[0].cidr, req.body.gateway?.trim() || null, req.body.dns_servers?.trim() || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error('Create IP pool error:', err.message); res.status(400).json({ error: 'Enter a valid CIDR and gateway address' }); }
});

router.post('/plans', [
  body('name').trim().notEmpty().isLength({ max: 160 }),
  body('price').optional().isFloat({ min: 0 }),
  body('validity_days').optional().isInt({ min: 1 }),
  body('router_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('fup_enabled').optional().isBoolean(),
  body('fup_threshold_mb').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('fup_download_speed_mbps').optional({ nullable: true, checkFalsy: true }).isFloat({ gt: 0 }),
  body('fup_upload_speed_mbps').optional({ nullable: true, checkFalsy: true }).isFloat({ gt: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const client = await db.connect();
  try {
    const { name, description, download_speed_mbps, upload_speed_mbps, price, validity_days, radius_profile, router_id,
      fup_enabled, fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps } = req.body;
    if (router_id) {
      const selectedRouter = await client.query(
        'SELECT id FROM mikrotik_routers WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1',
        [router_id, req.scope.clientId]
      );
      if (!selectedRouter.rows[0]) return res.status(400).json({ error: 'Selected router does not belong to this billing account or is inactive' });
    }
    if (fup_enabled && (!fup_threshold_mb || !fup_download_speed_mbps || !fup_upload_speed_mbps)) {
      return res.status(400).json({ error: 'FUP requires a usage threshold and reduced download and upload speeds' });
    }
    await ensureEventSchema();
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO billing_plans
       (client_id, name, description, download_speed_mbps, upload_speed_mbps, price, validity_days, radius_profile,
        router_id, fup_enabled, fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.scope.clientId, name.trim(), description?.trim() || null, download_speed_mbps || null, upload_speed_mbps || null,
        price || 0, validity_days || 30, radius_profile?.trim() || null, router_id || null, Boolean(fup_enabled),
        fup_enabled ? fup_threshold_mb : null, fup_enabled ? fup_download_speed_mbps : null, fup_enabled ? fup_upload_speed_mbps : null]
    );
    const plan = result.rows[0];
    await appendRequestEvent(client, req, {
      eventType: 'package.created',
      category: 'package',
      source: 'billing_workspace',
      entityType: 'package',
      entityId: plan.id,
      title: 'PPPoE package created',
      description: `${plan.name} was added to the service catalogue`,
      payload: {
        service_type: 'pppoe',
        price: plan.price,
        validity_days: plan.validity_days,
        download_speed_mbps: plan.download_speed_mbps,
        upload_speed_mbps: plan.upload_speed_mbps,
        fup_enabled: plan.fup_enabled,
      },
      newState: plan,
      relatedEntities: plan.router_id ? [{ entityType: 'router', entityId: plan.router_id, relationship: 'assigned_router' }] : [],
      deduplicationKey: `package:${plan.id}:created`,
    });
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction may not have started */ }
    if (err.code === '23505') return res.status(409).json({ error: 'A plan with that name already exists' });
    console.error('Create billing plan error:', err.message);
    res.status(500).json({ error: 'Failed to create billing plan' });
  } finally {
    client.release();
  }
});


/* managed-hotspot-subscriber-actions */

async function loadManagedHotspotSubscriber(
  clientId,
  subscriberId
) {
  const result = await db.query(
    `SELECT
       subscriber.*,

       voucher.code
         AS voucher_code,

       voucher.status
         AS voucher_status,

       voucher.expires_at
         AS voucher_expires_at,

       fulfillment.ip_address,

       plan.mikrotik_rate_limit,
       plan.data_limit_mb,
       plan.fup_enabled,
       plan.fup_threshold_mb,
       plan.fup_download_speed_mbps,
       plan.fup_upload_speed_mbps,

       COALESCE(
         subscriber.router_id,
         plan.router_id
       ) AS effective_router_id,

       router.name AS router_name

     FROM billing_hotspot_subscribers
       subscriber

     LEFT JOIN billing_hotspot_vouchers
       voucher
       ON voucher.id =
            subscriber.voucher_id
      AND voucher.client_id =
            subscriber.client_id

     LEFT JOIN hotspot_payment_fulfillments
       fulfillment
       ON fulfillment.payment_request_id =
            subscriber.payment_request_id
      AND fulfillment.client_id =
            subscriber.client_id

     LEFT JOIN billing_hotspot_plans
       plan
       ON plan.id =
            subscriber.plan_id
      AND plan.client_id =
            subscriber.client_id

     LEFT JOIN mikrotik_routers router
       ON router.id =
            COALESCE(
              subscriber.router_id,
              plan.router_id
            )
      AND router.client_id =
            subscriber.client_id

     WHERE subscriber.id = $1
       AND subscriber.client_id = $2

     LIMIT 1`,
    [
      subscriberId,
      clientId,
    ]
  );

  return result.rows[0] || null;
}


async function syncManagedHotspotSubscriber(
  subscriber
) {
  if (
    !subscriber.voucher_id ||
    !subscriber.voucher_code
  ) {
    throw new Error(
      'This hotspot subscriber has no active voucher'
    );
  }

  const expiresAt =
    subscriber.expires_at ||
    subscriber.voucher_expires_at;

  if (
    !expiresAt ||
    new Date(expiresAt) <= new Date()
  ) {
    throw new Error(
      'This hotspot package has expired. Extend it first.'
    );
  }

  const radius = await syncHotspotVoucherRadius({
    id:
      subscriber.voucher_id,

    client_id:
      subscriber.client_id,

    plan_id:
      subscriber.plan_id,

    code:
      subscriber.voucher_code,

    status:
      'active',

    expires_at:
      expiresAt,

    mikrotik_rate_limit:
      subscriber.mikrotik_rate_limit,

    data_limit_mb:
      subscriber.data_limit_mb,

    fup_enabled:
      subscriber.fup_enabled,

    fup_threshold_mb:
      subscriber.fup_threshold_mb,

    fup_download_speed_mbps:
      subscriber.fup_download_speed_mbps,

    fup_upload_speed_mbps:
      subscriber.fup_upload_speed_mbps,
  });

  if (
    radius.status &&
    radius.status !== 'synced'
  ) {
    throw new Error(
      'RADIUS did not synchronize this hotspot subscriber'
    );
  }

  await db.query(
    `UPDATE billing_hotspot_vouchers
     SET status = 'active'
     WHERE id = $1
       AND client_id = $2
       AND expires_at > NOW()`,
    [subscriber.voucher_id, subscriber.client_id]
  );

  let device = null;

  if (subscriber.current_mac) {
    device = await activatePaidHotspotDevice({
      clientId:
        subscriber.client_id,

      routerId:
        subscriber.effective_router_id ||
        null,

      macAddress:
        subscriber.current_mac,

      ipAddress:
        subscriber.ip_address ||
        '',

      expiresAt,

      rateLimit:
        subscriber.mikrotik_rate_limit ||
        null,

      dataLimitMb:
        subscriber.data_limit_mb ||
        null,
    });
  }

  await db.query(
    `UPDATE billing_hotspot_subscribers
     SET status = 'active',

         device_activation_status =
           COALESCE(
             $3,
             device_activation_status
           ),

         router_id =
           COALESCE(
             router_id,
             $4
           ),

         updated_at = NOW()

     WHERE id = $1
       AND client_id = $2`,
    [
      subscriber.id,
      subscriber.client_id,
      device?.status || null,
      subscriber.effective_router_id ||
        null,
    ]
  );

  return {
    radius,
    device,
  };
}


router.get('/hotspot/subscribers/:id/profile', async (req, res) => {
  try {
    const subscriber = await loadManagedHotspotSubscriber(req.scope.clientId, req.params.id);
    if (!subscriber) return res.status(404).json({ error: 'Hotspot subscriber was not found' });

    const clientId = req.scope.clientId;
    const paymentRequestId = subscriber.payment_request_id;
    let vouchers = [];
    let payments = [];

    if (paymentRequestId) {
      const result = await Promise.all([
        db.query(`SELECT v.id, v.code, v.status, v.max_devices, v.used_by, v.activated_at, v.expires_at,
                    COALESCE((regexp_match(v.used_by, 'mac:([0-9A-Fa-f:.-]+)', 'i'))[1], $3) AS mac_address
                  FROM hotspot_payment_fulfillments f
                  JOIN billing_hotspot_vouchers v
                    ON v.client_id = f.client_id
                   AND (v.id = f.voucher_id OR f.additional_voucher_ids @> jsonb_build_array(v.id))
                  WHERE f.client_id = $1 AND f.payment_request_id = $2
                  ORDER BY v.activated_at NULLS LAST, v.id`,
          [clientId, paymentRequestId, subscriber.current_mac || '']),
        db.query(`SELECT id, amount, status, external_reference, updated_at, created_at, customer_phone
                  FROM payhero_payment_requests
                  WHERE client_id = $1
                    AND (
                      id = $2
                      OR (
                        $3 <> ''
                        AND customer_phone = $3
                        AND metadata->>'purpose' = 'hotspot'
                      )
                    )
                  ORDER BY updated_at DESC`,
          [clientId, paymentRequestId, subscriber.customer_phone || '']),
        db.query(`SELECT mac_address, username, ip_address, is_online, uptime, last_seen, raw
                  FROM mikrotik_clients
                  WHERE client_id = $1 AND service_type = 'hotspot'`,
          [clientId]),
      ]);
      const clients = result[2].rows;
      const compact = value => String(value || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
      vouchers = result[0].rows.map(voucher => {
        const mac = compact(voucher.mac_address);
        const live = clients.find(client => compact(client.mac_address || client.username) === mac);
        const active = live?.raw?.active || {};
        return {
          ...voucher,
          mac_address: voucher.mac_address || null,
          is_online: Boolean(live?.is_online),
          ip_address: live?.ip_address || null,
          uptime: live?.uptime || null,
          last_seen: live?.last_seen || null,
          download_bytes: Number(active['bytes-in'] || 0),
          upload_bytes: Number(active['bytes-out'] || 0),
        };
      });
      payments = result[1].rows;
    }

    const summary = vouchers.reduce((total, voucher) => ({
      download_bytes: total.download_bytes + voucher.download_bytes,
      upload_bytes: total.upload_bytes + voucher.upload_bytes,
      online_devices: total.online_devices + (voucher.is_online ? 1 : 0),
    }), { download_bytes: 0, upload_bytes: 0, online_devices: 0 });
    summary.total_bytes = summary.download_bytes + summary.upload_bytes;
    summary.shared_devices = vouchers.length;
    summary.payment_count = payments.filter(payment => payment.status === 'paid').length;
    summary.lifetime_spend = payments.reduce((total, payment) => payment.status === 'paid' ? total + Number(payment.amount || 0) : total, 0);

    const history = [
      ...payments.map(payment => ({
        type: payment.status === 'paid' ? 'payment' : 'payment_pending',
        occurred_at: payment.updated_at || payment.created_at,
        title: payment.status === 'paid' ? 'Package payment received' : 'Payment awaiting confirmation',
        detail: payment.external_reference || payment.customer_phone || 'Hotspot payment',
        amount: Number(payment.amount || 0),
      })),
      ...vouchers.filter(voucher => voucher.activated_at).map(voucher => ({
        type: 'device', occurred_at: voucher.activated_at,
        title: 'Shared device connected', detail: voucher.mac_address || voucher.code, amount: null,
      })),
    ].sort((left, right) => new Date(right.occurred_at || 0) - new Date(left.occurred_at || 0)).slice(0, 12);

    return res.json({ subscriber, summary, devices: vouchers, payments, history });
  } catch (error) {
    console.error('Load hotspot subscriber profile error:', error.message);
    return res.status(500).json({ error: 'Could not load this hotspot account profile' });
  }
});
router.patch(
  '/hotspot/subscribers/:id',
  [
    body('service_status')
      .isIn([
        'active',
        'suspended',
      ]),
  ],
  async (req, res) => {
    const errors =
      validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        errors:
          errors.array(),
      });
    }

    try {
      const subscriber =
        await loadManagedHotspotSubscriber(
          req.scope.clientId,
          req.params.id
        );

      if (!subscriber) {
        return res.status(404).json({
          error:
            'Hotspot subscriber not found',
        });
      }

      if (
        req.body.service_status ===
        'suspended'
      ) {
        await revokeHotspotRadiusAccess({
          macAddress:
            subscriber.current_mac ||
            null,

          voucherCode:
            subscriber.voucher_code ||
            null,
        });

        if (subscriber.current_mac) {
          await revokeHotspotDeviceAccess({
            clientId:
              subscriber.client_id,

            routerId:
              subscriber.effective_router_id ||
              null,

            macAddress:
              subscriber.current_mac,

            ipAddress:
              subscriber.ip_address ||
              '',
          });
        }

        if (subscriber.voucher_id) {
          await db.query(
            `UPDATE billing_hotspot_vouchers
             SET status = 'suspended'
             WHERE id = $1
               AND client_id = $2`,
            [subscriber.voucher_id, subscriber.client_id]
          );
        }

        const updated =
          await db.query(
            `UPDATE billing_hotspot_subscribers
             SET status = 'suspended',
                 device_activation_status =
                   'suspended',
                 updated_at = NOW()
             WHERE id = $1
               AND client_id = $2
             RETURNING *`,
            [
              subscriber.id,
              subscriber.client_id,
            ]
          );

        return res.json(
          updated.rows[0]
        );
      }

      await syncManagedHotspotSubscriber(
        subscriber
      );

      const refreshed =
        await loadManagedHotspotSubscriber(
          req.scope.clientId,
          req.params.id
        );

      return res.json(
        refreshed
      );

    } catch (error) {
      console.error(
        'Hotspot subscriber status error:',
        error.message
      );

      return res.status(400).json({
        error:
          error.message ||
          'Could not update hotspot subscriber',
      });
    }
  }
);


router.post(
  '/hotspot/subscribers/:id/extend',
  [
    body('days')
      .isInt({
        min: 1,
        max: 365,
      }),
  ],
  async (req, res) => {
    const errors =
      validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        errors:
          errors.array(),
      });
    }

    const connection =
      await db.connect();

    try {
      await connection.query(
        'BEGIN'
      );

      const result =
        await connection.query(
          `SELECT *
           FROM billing_hotspot_subscribers
           WHERE id = $1
             AND client_id = $2
           FOR UPDATE`,
          [
            req.params.id,
            req.scope.clientId,
          ]
        );

      const subscriber =
        result.rows[0];

      if (!subscriber) {
        await connection.query(
          'ROLLBACK'
        );

        return res.status(404).json({
          error:
            'Hotspot subscriber not found',
        });
      }

      if (!subscriber.voucher_id) {
        await connection.query(
          'ROLLBACK'
        );

        return res.status(400).json({
          error:
            'This hotspot subscriber has no voucher to extend',
        });
      }

      const voucherResult =
        await connection.query(
          `UPDATE billing_hotspot_vouchers
           SET expires_at =
                 GREATEST(
                   COALESCE(
                     expires_at,
                     NOW()
                   ),
                   NOW()
                 ) +
                 (
                   $3::int *
                   INTERVAL '1 day'
                 ),

               status = 'active'

           WHERE id = $1
             AND client_id = $2

           RETURNING expires_at`,
          [
            subscriber.voucher_id,
            req.scope.clientId,
            Number(req.body.days),
          ]
        );

      const expiresAt =
        voucherResult.rows[0]
          ?.expires_at;

      if (!expiresAt) {
        throw new Error(
          'Could not extend hotspot voucher'
        );
      }

      await connection.query(
        `UPDATE billing_hotspot_subscribers
         SET expires_at = $3,
             status = 'active',
             cleanup_completed_at = NULL,
             cleanup_error = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND client_id = $2`,
        [
          subscriber.id,
          req.scope.clientId,
          expiresAt,
        ]
      );

      await connection.query(
        'COMMIT'
      );

      const refreshed =
        await loadManagedHotspotSubscriber(
          req.scope.clientId,
          req.params.id
        );

      const syncResult =
        await syncManagedHotspotSubscriber(
          refreshed
        );

      return res.json({
        ...refreshed,
        expires_at:
          expiresAt,

        radius_status:
          syncResult.radius?.status ||
          null,

        device_activation_status:
          syncResult.device?.status ||
          refreshed
            ?.device_activation_status ||
          null,
      });

    } catch (error) {
      try {
        await connection.query(
          'ROLLBACK'
        );
      } catch (_) {}

      console.error(
        'Extend hotspot subscriber error:',
        error.message
      );

      return res.status(400).json({
        error:
          error.message ||
          'Could not extend hotspot subscriber',
      });

    } finally {
      connection.release();
    }
  }
);


router.post(
  '/hotspot/subscribers/:id/sync',
  async (req, res) => {
    try {
      const subscriber =
        await loadManagedHotspotSubscriber(
          req.scope.clientId,
          req.params.id
        );

      if (!subscriber) {
        return res.status(404).json({
          error:
            'Hotspot subscriber not found',
        });
      }

      const result =
        await syncManagedHotspotSubscriber(
          subscriber
        );

      return res.json({
        success: true,
        radius_status:
          result.radius?.status ||
          null,
        device_activation_status:
          result.device?.status ||
          null,
      });

    } catch (error) {
      console.error(
        'Sync hotspot subscriber error:',
        error.message
      );

      return res.status(400).json({
        error:
          error.message ||
          'Could not synchronize hotspot subscriber',
      });
    }
  }
);


router.delete(
  '/hotspot/subscribers/:id',
  async (req, res) => {
    try {
      const subscriber =
        await loadManagedHotspotSubscriber(
          req.scope.clientId,
          req.params.id
        );

      if (!subscriber) {
        return res.status(404).json({
          error:
            'Hotspot subscriber not found',
        });
      }

      await revokeHotspotRadiusAccess({
        macAddress:
          subscriber.current_mac ||
          null,

        voucherCode:
          subscriber.voucher_code ||
          null,
      }).catch(() => {});

      if (subscriber.current_mac) {
        await revokeHotspotDeviceAccess({
          clientId:
            subscriber.client_id,

          routerId:
            subscriber.effective_router_id ||
            null,

          macAddress:
            subscriber.current_mac,

          ipAddress:
            subscriber.ip_address ||
            '',
        }).catch(() => {});
      }

      const client =
        await db.connect();

      try {
        await client.query(
          'BEGIN'
        );

        if (subscriber.voucher_id) {
          await client.query(
            `UPDATE billing_hotspot_vouchers
             SET status = 'expired',
                 expires_at =
                   LEAST(
                     COALESCE(
                       expires_at,
                       NOW()
                     ),
                     NOW()
                   )
             WHERE id = $1
               AND client_id = $2`,
            [
              subscriber.voucher_id,
              subscriber.client_id,
            ]
          );
        }

        if (
          subscriber.payment_request_id
        ) {
          await client.query(
            `UPDATE hotspot_payment_fulfillments
             SET device_activation_status =
                   'deleted',
                 updated_at = NOW()
             WHERE payment_request_id = $1
               AND client_id = $2`,
            [
              subscriber.payment_request_id,
              subscriber.client_id,
            ]
          );
        }

        await client.query(
          `DELETE FROM
             billing_hotspot_subscribers
           WHERE id = $1
             AND client_id = $2`,
          [
            subscriber.id,
            subscriber.client_id,
          ]
        );

        await client.query(
          'COMMIT'
        );

      } catch (error) {
        try {
          await client.query(
            'ROLLBACK'
          );
        } catch (_) {}

        throw error;

      } finally {
        client.release();
      }

      return res.json({
        success: true,
      });

    } catch (error) {
      console.error(
        'Delete hotspot subscriber error:',
        error.message
      );

      return res.status(400).json({
        error:
          error.message ||
          'Could not remove hotspot subscriber',
      });
    }
  }
);


router.get('/subscribers', async (req, res) => {
  const result = await db.query(
    `SELECT s.*, p.name AS plan_name, COALESCE(r.name, s.router_name) AS router_name,
            r.last_status AS router_status, r.is_active AS router_active
     FROM billing_subscribers s
     LEFT JOIN billing_plans p ON p.id = s.plan_id AND p.client_id = s.client_id
     LEFT JOIN mikrotik_routers r ON r.id = s.router_id AND r.client_id = s.client_id
     WHERE s.client_id = $1 ORDER BY s.created_at DESC`,
    [req.scope.clientId]
  );
  let online = new Set();
  const radiusUsernames = result.rows.map((row) => row.radius_username).filter(Boolean);
  try { online = await getOnlineUsernames(radiusUsernames); } catch (err) { console.error('RADIUS online session lookup failed:', err.message); }
  res.json(result.rows.map((subscriber) => ({
    ...subscriber,
    is_online: Boolean(subscriber.radius_username && online.has(String(subscriber.radius_username))),
  })));
});

router.get('/subscribers/crm', async (req, res) => {
  const accountNumber = String(req.query.account_number || '').trim();
  if (!accountNumber) return res.status(400).json({ error: 'Account number is required' });
  const clientId = req.scope.clientId;
  const subscriber = await db.query(
    `SELECT s.*, p.name AS plan_name FROM billing_subscribers s
     LEFT JOIN billing_plans p ON p.id = s.plan_id AND p.client_id = s.client_id
     WHERE s.client_id = $1 AND s.account_number = $2 LIMIT 1`,
    [clientId, accountNumber]
  );
  if (!subscriber.rows[0]) return res.status(404).json({ error: 'Subscriber not found' });
  const record = subscriber.rows[0];
  const [payments, invoices, tickets] = await Promise.all([
    db.query(`SELECT amount, method, reference, status, paid_at FROM billing_payments
              WHERE client_id = $1 AND subscriber_id = $2 ORDER BY paid_at DESC LIMIT 12`, [clientId, record.id]),
    db.query(`SELECT invoice_number, amount, status, due_date, paid_at, created_at FROM billing_invoices
              WHERE client_id = $1 AND subscriber_id = $2 ORDER BY created_at DESC LIMIT 12`, [clientId, record.id]),
    record.phone ? db.query(`SELECT id, title, category, priority, status, updated_at
              FROM tickets WHERE client_id = $1
              AND regexp_replace(customer_phone, '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g')
              ORDER BY updated_at DESC LIMIT 12`, [clientId, record.phone]) : Promise.resolve({ rows: [] }),
  ]);
  res.json({ subscriber: record, payments: payments.rows, invoices: invoices.rows, tickets: tickets.rows });
});

router.post('/subscribers', [
  body('full_name').trim().notEmpty().isLength({ max: 255 }),
  body('account_number').trim().notEmpty().isLength({ max: 120 }),
  body('plan_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('grace_period_days').optional({ nullable: true }).isInt({ min: 0, max: 90 }),
  body('phone').optional({ nullable: true }).isLength({ max: 80 }),
  body('email').optional({ nullable: true, checkFalsy: true }).isEmail(),
  body('radius_username').optional({ nullable: true, checkFalsy: true }).isLength({ max: 180 }),
  body('router_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('access_mode').optional().isIn(['pppoe', 'pppoe_static', 'dhcp_static']),
  body('vlan_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 4094 }),
  body('static_pool_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('static_ip').optional({ nullable: true, checkFalsy: true }).isIP(),
  body('static_mac').optional({ nullable: true, checkFalsy: true }).isLength({ max: 32 }),
  body('static_dhcp_server').optional({ nullable: true, checkFalsy: true }).isLength({ max: 160 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const { full_name, account_number, plan_id, phone, email, radius_username, router_id, vlan_id, notes, grace_period_days } = req.body;
    let selectedPlan = null;
    if (plan_id) {
      const plan = await db.query('SELECT id, validity_days, router_id FROM billing_plans WHERE id = $1 AND client_id = $2 LIMIT 1', [plan_id, req.scope.clientId]);
      selectedPlan = plan.rows[0];
      if (!selectedPlan) return res.status(400).json({ error: 'Selected plan does not belong to this billing workspace' });
    }
    const effectiveRouterId = router_id || selectedPlan?.router_id || null;
    let selectedRouter = null;
    if (effectiveRouterId) {
      const routerResult = await db.query(
        'SELECT id, name FROM mikrotik_routers WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1',
        [effectiveRouterId, req.scope.clientId]
      );
      selectedRouter = routerResult.rows[0];
      if (!selectedRouter) return res.status(400).json({ error: 'Selected router does not belong to this billing account or is inactive' });
    }
    let staticConfig;
    try { staticConfig = await resolveStaticConfig(req.body, req.scope.clientId, selectedRouter); } catch (error) { return res.status(400).json({ error: error.message }); }
    const graceDays = Number(grace_period_days || 0);
    const planDays = Number(selectedPlan?.validity_days || 0);
    const expiresAt = planDays ? new Date(Date.now() + planDays * 86400000) : null;
    await ensureEventSchema();
    const client = await db.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await client.query(
        `INSERT INTO billing_subscribers (client_id, plan_id, full_name, phone, email, account_number, radius_username, router_id, router_name, notes, grace_period_days, expires_at, access_mode, vlan_id, static_pool_id, static_ip, static_mac, static_dhcp_server)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [req.scope.clientId, plan_id || null, full_name.trim(), phone?.trim() || null, email?.trim() || null, account_number.trim(), radius_username?.trim() || null, selectedRouter?.id || null, selectedRouter?.name || null, notes?.trim() || null, graceDays, expiresAt, staticConfig.accessMode, vlan_id ? Number(vlan_id) : null, staticConfig.staticPoolId, staticConfig.staticIp, staticConfig.staticMac, staticConfig.staticDhcpServer]
      );
      const subscriber = result.rows[0];
      const actor = eventActorFromRequest(req);
      await appendBillingEvent(client, {
        clientId: req.scope.clientId,
        eventType: 'subscriber.created',
        category: 'subscriber',
        source: 'billing_api',
        entityType: 'subscriber',
        entityId: subscriber.id,
        ...actor,
        title: 'Subscriber created',
        description: `${subscriber.full_name} was added to the billing account`,
        payload: {
          account_number: subscriber.account_number,
          access_mode: subscriber.access_mode,
          plan_id: subscriber.plan_id,
          router_id: subscriber.router_id,
          vlan_id: subscriber.vlan_id,
          service_status: subscriber.service_status,
          expires_at: subscriber.expires_at,
        },
        newState: {
          service_status: subscriber.service_status,
          plan_id: subscriber.plan_id,
          router_id: subscriber.router_id,
          access_mode: subscriber.access_mode,
        },
        relatedEntities: [
          ...(subscriber.plan_id ? [{ entityType: 'package', entityId: subscriber.plan_id, relationship: 'subscribed_to' }] : []),
          ...(subscriber.router_id ? [{ entityType: 'router', entityId: subscriber.router_id, relationship: 'served_by' }] : []),
        ],
        deduplicationKey: `subscriber:${subscriber.id}:created`,
        sensitivity: 'confidential',
      });
      if (staticConfig.accessMode === 'dhcp_static') {
        await enqueueRadiusSyncJob(client, req.scope.clientId, subscriber.id, 'subscriber_created');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (staticConfig.accessMode === 'dhcp_static') processRadiusSyncJobs().catch(() => {});
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Account number or RADIUS username already exists' });
    console.error('Create subscriber error:', err.message);
    res.status(500).json({ error: 'Failed to create subscriber' });
  }
});

router.post('/subscribers/:id/recharge', [
  body('plan_id').isInt({ min: 1 }),
  body('method').optional({ nullable: true }).isLength({ max: 40 }),
  body('reference').optional({ nullable: true }).isLength({ max: 160 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureEventSchema();
  } catch (error) {
    console.error('Unable to initialize billing event schema:', error.message);
    return res.status(500).json({ error: 'Failed to initialize account event history' });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const subscriberResult = await client.query('SELECT * FROM billing_subscribers WHERE id = $1 AND client_id = $2 FOR UPDATE', [req.params.id, req.scope.clientId]);
    const subscriber = subscriberResult.rows[0];
    if (!subscriber) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Subscriber not found' }); }
    const planResult = await client.query('SELECT * FROM billing_plans WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1', [req.body.plan_id, req.scope.clientId]);
    const plan = planResult.rows[0];
    if (!plan) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Selected package does not belong to this billing workspace' }); }
    let packageRouter = null;
    if (plan.router_id) {
      const routerResult = await client.query(
        'SELECT id, name FROM mikrotik_routers WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1',
        [plan.router_id, req.scope.clientId]
      );
      packageRouter = routerResult.rows[0];
      if (!packageRouter) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The router allocated to this package is inactive or unavailable' }); }
    }
    const amount = Number(plan.price || 0);
    if (!(amount > 0)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The selected package must have a price before it can be recharged' }); }
    const reference = String(req.body.reference || `RECHARGE-${subscriber.id}-${Date.now()}`).trim();
    const duplicate = await client.query('SELECT id FROM billing_payments WHERE client_id = $1 AND reference = $2 LIMIT 1', [req.scope.clientId, reference]);
    if (duplicate.rows[0]) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A payment with that reference already exists' }); }
    const invoiceNumber = `INV-${req.scope.clientId}-R-${Date.now()}`;
    const invoice = await client.query(
      `INSERT INTO billing_invoices (client_id, subscriber_id, invoice_number, amount, status, due_date, paid_at)
       VALUES ($1,$2,$3,$4,'paid',CURRENT_DATE,NOW()) RETURNING *`,
      [req.scope.clientId, subscriber.id, invoiceNumber, amount]
    );
    const payment = await client.query(
      `INSERT INTO billing_payments (client_id, subscriber_id, invoice_id, amount, method, reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,'completed') RETURNING *`,
      [req.scope.clientId, subscriber.id, invoice.rows[0].id, amount, req.body.method?.trim() || 'Recharge', reference]
    );
    const currentExpiry = subscriber.expires_at ? new Date(subscriber.expires_at) : null;
    const base = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
    const expiresAt = new Date(base.getTime() + Number(plan.validity_days || 0) * 86400000);
    await client.query(
      `UPDATE billing_subscribers
       SET plan_id=$1, service_status='active', radius_status='active', expires_at=$2,
           router_id=COALESCE($3, router_id), router_name=COALESCE($4, router_name), updated_at=NOW()
       WHERE id=$5 AND client_id=$6`,
      [plan.id, expiresAt, packageRouter?.id || null, packageRouter?.name || null, subscriber.id, req.scope.clientId]
    );
    await enqueueRadiusSyncJob(client, req.scope.clientId, subscriber.id, 'recharge_committed');
    const actor = eventActorFromRequest(req);
    await appendBillingEvent(client, {
      clientId: req.scope.clientId,
      eventType: 'subscriber.recharged',
      category: 'subscriber',
      source: 'billing_api',
      entityType: 'subscriber',
      entityId: subscriber.id,
      ...actor,
      title: 'Subscriber recharged',
      description: `${subscriber.full_name} was recharged on ${plan.name}`,
      payload: {
        account_number: subscriber.account_number,
        package_id: plan.id,
        package_name: plan.name,
        amount,
        payment_reference: reference,
        invoice_number: invoice.rows[0].invoice_number,
      },
      previousState: {
        plan_id: subscriber.plan_id,
        service_status: subscriber.service_status,
        expires_at: subscriber.expires_at,
      },
      newState: {
        plan_id: plan.id,
        service_status: 'active',
        expires_at: expiresAt,
        router_id: packageRouter?.id || subscriber.router_id,
      },
      relatedEntities: [
        { entityType: 'package', entityId: plan.id, relationship: 'recharged_with' },
        { entityType: 'payment', entityId: payment.rows[0].id, relationship: 'paid_by' },
        { entityType: 'invoice', entityId: invoice.rows[0].id, relationship: 'settled_by' },
        ...((packageRouter?.id || subscriber.router_id) ? [{
          entityType: 'router',
          entityId: packageRouter?.id || subscriber.router_id,
          relationship: 'served_by',
        }] : []),
      ],
      correlationId: `recharge:${req.scope.clientId}:${reference}`,
      deduplicationKey: `subscriber-recharge:${req.scope.clientId}:${reference}`,
      sensitivity: 'confidential',
    });
    await appendBillingEvent(client, {
      clientId: req.scope.clientId,
      eventType: 'payment.received',
      category: 'payment',
      source: 'billing_api',
      entityType: 'payment',
      entityId: payment.rows[0].id,
      ...actor,
      title: 'Recharge payment received',
      description: `Payment ${reference} was received for ${subscriber.full_name}`,
      payload: {
        amount,
        method: payment.rows[0].method,
        reference,
        status: payment.rows[0].status,
      },
      relatedEntities: [
        { entityType: 'subscriber', entityId: subscriber.id, relationship: 'paid_for' },
        { entityType: 'invoice', entityId: invoice.rows[0].id, relationship: 'applied_to' },
      ],
      correlationId: `recharge:${req.scope.clientId}:${reference}`,
      deduplicationKey: `payment:${req.scope.clientId}:${reference}`,
      sensitivity: 'confidential',
    });
    await client.query('COMMIT');
    processRadiusSyncJobs().catch((error) => console.error('Unable to start RADIUS recharge sync:', error.message));
    res.status(201).json({ invoice: invoice.rows[0], payment: payment.rows[0], subscriber: { id: subscriber.id, plan_id: plan.id, expires_at: expiresAt, service_status: 'active' } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Recharge subscriber error:', err.message);
    res.status(500).json({ error: 'Failed to recharge subscriber' });
  } finally {
    client.release();
  }
});

router.post('/subscribers/:id/extend', [
  body('days').isInt({ min: 1, max: 365 }),
], async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      errors: errors.array(),
    });
  }

  const client = await db.connect();

  try {
    await ensureEventSchema();

    await client.query('BEGIN');

    const result = await client.query(
      `SELECT *
       FROM billing_subscribers
       WHERE id = $1
         AND client_id = $2
       FOR UPDATE`,
      [
        req.params.id,
        req.scope.clientId,
      ]
    );

    const subscriber = result.rows[0];

    if (!subscriber) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        error: 'Subscriber not found',
      });
    }

    const days = Number(req.body.days);

    const currentExpiry =
      subscriber.expires_at
        ? new Date(subscriber.expires_at)
        : null;

    const now = new Date();

    const base =
      currentExpiry &&
      !Number.isNaN(
        currentExpiry.getTime()
      ) &&
      currentExpiry > now
        ? currentExpiry
        : now;

    const expiresAt =
      new Date(
        base.getTime() +
        days * 86400000
      );

    const updated = await client.query(
      `UPDATE billing_subscribers
       SET
         expires_at = $1,
         service_status = 'active',
         radius_status = 'active',
         updated_at = NOW()
       WHERE id = $2
         AND client_id = $3
       RETURNING *`,
      [
        expiresAt,
        subscriber.id,
        req.scope.clientId,
      ]
    );

    if (
      subscriber.radius_username ||
      subscriber.access_mode ===
        'dhcp_static'
    ) {
      await enqueueRadiusSyncJob(
        client,
        req.scope.clientId,
        subscriber.id,
        'admin_subscription_extended'
      );
    }

    await appendRequestEvent(
      client,
      req,
      {
        eventType:
          'subscriber.extended',

        category:
          'subscriber',

        source:
          'billing_workspace',

        entityType:
          'subscriber',

        entityId:
          subscriber.id,

        title:
          'Subscriber subscription extended',

        description:
          `${subscriber.full_name} was extended by ${days} day${days === 1 ? '' : 's'}`,

        previousState: {
          expires_at:
            subscriber.expires_at,

          service_status:
            subscriber.service_status,
        },

        newState: {
          expires_at:
            expiresAt,

          service_status:
            'active',
        },

        payload: {
          days,
          account_number:
            subscriber.account_number,
        },

        deduplicationKey:
          `subscriber:${subscriber.id}:extend:${Date.now()}`,

        sensitivity:
          'confidential',
      }
    );

    await client.query('COMMIT');

    if (
      subscriber.radius_username ||
      subscriber.access_mode ===
        'dhcp_static'
    ) {
      processRadiusSyncJobs()
        .catch(
          error =>
            console.error(
              'Unable to start extended subscriber RADIUS sync:',
              error.message
            )
        );
    }

    return res.json({
      success: true,

      subscriber:
        updated.rows[0],

      days,

      expires_at:
        expiresAt,
    });
  } catch (error) {
    await client
      .query('ROLLBACK')
      .catch(() => {});

    console.error(
      'Extend subscriber error:',
      error.message
    );

    return res.status(500).json({
      error:
        'Failed to extend subscriber',
    });
  } finally {
    client.release();
  }
});


router.get('/subscribers/:id/details', async (req, res) => {
  try {
    const subscriberResult =
      await db.query(
        `SELECT
           subscriber.*,

           plan.name
             AS plan_name,

           plan.price
             AS plan_price,

           plan.download_speed_mbps,

           plan.upload_speed_mbps,

           plan.validity_days

         FROM billing_subscribers
           subscriber

         LEFT JOIN billing_plans
           plan

           ON plan.id =
              subscriber.plan_id

          AND plan.client_id =
              subscriber.client_id

         WHERE subscriber.id = $1
           AND subscriber.client_id = $2

         LIMIT 1`,
        [
          req.params.id,
          req.scope.clientId,
        ]
      );

    const subscriber =
      subscriberResult.rows[0];

    if (!subscriber) {
      return res
        .status(404)
        .json({
          error:
            'Subscriber not found',
        });
    }

    const [
      invoices,
      payments,
      tickets,
    ] =
      await Promise.all([
        db.query(
          `SELECT
             invoice_number,
             amount,
             status,
             due_date,
             paid_at,
             created_at

           FROM billing_invoices

           WHERE client_id = $1
             AND subscriber_id = $2

           ORDER BY
             created_at DESC

           LIMIT 30`,
          [
            req.scope.clientId,
            subscriber.id,
          ]
        ),

        db.query(
          `SELECT
             amount,
             method,
             reference,
             status,
             paid_at,
             created_at

           FROM billing_payments

           WHERE client_id = $1
             AND subscriber_id = $2

           ORDER BY
             created_at DESC

           LIMIT 30`,
          [
            req.scope.clientId,
            subscriber.id,
          ]
        ),

        subscriber.phone
          ? db.query(
              `SELECT
                 id,
                 title,
                 category,
                 priority,
                 status,
                 updated_at

               FROM tickets

               WHERE client_id = $1

                 AND regexp_replace(
                       customer_phone,
                       '\\D',
                       '',
                       'g'
                     ) =
                     regexp_replace(
                       $2,
                       '\\D',
                       '',
                       'g'
                     )

               ORDER BY
                 updated_at DESC

               LIMIT 30`,
              [
                req.scope.clientId,
                subscriber.phone,
              ]
            )
          : Promise.resolve({
              rows: [],
            }),
      ]);

    return res.json({
      subscriber,

      invoices:
        invoices.rows,

      payments:
        payments.rows,

      tickets:
        tickets.rows,
    });
  } catch (error) {
    console.error(
      'Subscriber details error:',
      error.message
    );

    return res
      .status(500)
      .json({
        error:
          'Failed to load subscriber details',
      });
  }
});

router.get('/subscribers/:id/usage', async (req, res) => {
  try {
    const subscriber = await loadSubscriber(req.params.id, req.scope.clientId);
    if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
    const usage = await getSubscriberUsage(subscriber.radius_username, req.query.days || 30);
    const plan = subscriber.plan_id ? await db.query('SELECT name, price, validity_days FROM billing_plans WHERE id = $1 AND client_id = $2 LIMIT 1', [subscriber.plan_id, req.scope.clientId]) : { rows: [] };
    res.json({ subscriber: { id: subscriber.id, full_name: subscriber.full_name, account_number: subscriber.account_number, plan_name: plan.rows[0]?.name || null, expires_at: subscriber.expires_at, service_status: subscriber.service_status, is_online: usage.available ? usage.sessions.some((session) => session.is_active) : false }, usage });
  } catch (err) {
    console.error('Subscriber usage error:', err.message);
    res.status(500).json({ error: 'Failed to load subscriber bandwidth usage' });
  }
});
router.get('/invoices', async (req, res) => {
  const result = await db.query(
    `SELECT i.*, s.full_name AS subscriber_name, s.account_number,
            COALESCE((SELECT SUM(p.amount) FROM billing_payments p WHERE p.invoice_id = i.id AND p.status = 'completed'), 0)::numeric AS paid_amount
     FROM billing_invoices i
     LEFT JOIN billing_subscribers s ON s.id = i.subscriber_id AND s.client_id = i.client_id
     WHERE i.client_id = $1
     ORDER BY i.created_at DESC`,
    [req.scope.clientId]
  );
  res.json(result.rows);
});

router.patch('/subscribers/:id', [
  body('full_name').optional().trim().notEmpty().isLength({ max: 255 }),
  body('plan_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('grace_period_days').optional().isInt({ min: 0, max: 90 }),
  body('service_status').optional().isIn(['active', 'suspended', 'expired', 'pending']),
  body('router_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('access_mode').optional().isIn(['pppoe', 'pppoe_static', 'dhcp_static']),
  body('vlan_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 4094 }),
  body('static_pool_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('static_ip').optional({ nullable: true, checkFalsy: true }).isIP(),
  body('static_mac').optional({ nullable: true, checkFalsy: true }).isLength({ max: 32 }),
  body('static_dhcp_server').optional({ nullable: true, checkFalsy: true }).isLength({ max: 160 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const current = await loadSubscriber(req.params.id, req.scope.clientId);
  if (!current) return res.status(404).json({ error: 'Subscriber not found' });
  const { full_name, phone, email, plan_id, grace_period_days, service_status } = req.body;
  if (plan_id) {
    const plan = await db.query('SELECT id FROM billing_plans WHERE id = $1 AND client_id = $2', [plan_id, req.scope.clientId]);
    if (!plan.rows[0]) return res.status(400).json({ error: 'Selected plan does not belong to this billing workspace' });
  }
  const routerWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'router_id');
  let selectedRouter = null;
  if (routerWasProvided && req.body.router_id) {
    const routerResult = await db.query(
      'SELECT id, name FROM mikrotik_routers WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1',
      [req.body.router_id, req.scope.clientId]
    );
    selectedRouter = routerResult.rows[0];
    if (!selectedRouter) return res.status(400).json({ error: 'Selected router does not belong to this billing account or is inactive' });
  }
  const effectiveRouter = routerWasProvided ? selectedRouter : (current.router_id ? { id: current.router_id, name: current.router_name } : null);
  let staticConfig;
  try { staticConfig = await resolveStaticConfig({ ...current, ...req.body, access_mode: req.body.access_mode || current.access_mode }, req.scope.clientId, effectiveRouter); } catch (error) { return res.status(400).json({ error: error.message }); }
  const result = await db.query(
    `UPDATE billing_subscribers SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone), email = COALESCE($3, email),
       plan_id = COALESCE($4, plan_id), grace_period_days = COALESCE($5, grace_period_days), service_status = COALESCE($6, service_status),
       router_id = CASE WHEN $7 THEN $8 ELSE router_id END,
       router_name = CASE WHEN $7 THEN $9 ELSE router_name END, access_mode=$10, vlan_id=$11, static_pool_id=$12, static_ip=$13, static_mac=$14, static_dhcp_server=$15, updated_at = NOW()
     WHERE id = $16 AND client_id = $17 RETURNING *`,
    [full_name || null, phone || null, email || null, plan_id || null, grace_period_days ?? null, service_status || null,
      routerWasProvided, selectedRouter?.id || null, selectedRouter?.name || null, staticConfig.accessMode, req.body.vlan_id ? Number(req.body.vlan_id) : null, staticConfig.staticPoolId, staticConfig.staticIp, staticConfig.staticMac, staticConfig.staticDhcpServer, current.id, req.scope.clientId]
  );
  const subscriber = await loadSubscriber(current.id, req.scope.clientId);
  if (subscriber.access_mode === 'dhcp_static') { await enqueueRadiusSyncJob(db, req.scope.clientId, subscriber.id, 'subscriber_updated'); processRadiusSyncJobs().catch(() => {}); }
  else if (subscriber.radius_username) await syncSubscriberRadius(subscriber);
  await recordRequestEvent(req, {
    eventType: 'subscriber.updated',
    category: 'subscriber',
    source: 'billing_workspace',
    entityType: 'subscriber',
    entityId: subscriber.id,
    title: 'Subscriber updated',
    description: subscriber.full_name,
    previousState: current,
    newState: result.rows[0],
    payload: {
      changed_fields: Object.keys(req.body || {}),
      access_mode: subscriber.access_mode,
      service_status: subscriber.service_status,
    },
    relatedEntities: [
      ...(subscriber.plan_id ? [{ entityType: 'package', entityId: subscriber.plan_id, relationship: 'package' }] : []),
      ...(subscriber.router_id ? [{ entityType: 'router', entityId: subscriber.router_id, relationship: 'router' }] : []),
    ],
    deduplicationKey: `subscriber:${subscriber.id}:updated:${Date.now()}`,
    sensitivity: 'confidential',
  });
  res.json(result.rows[0]);
});

router.delete('/subscribers/:id', async (req, res) => {
  const subscriber = await loadSubscriber(req.params.id, req.scope.clientId);
  if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
  if (subscriber.access_mode === 'dhcp_static') {
    await syncStaticDhcpLease({ ...subscriber, service_status: 'suspended' });
  } else if (subscriber.radius_username && radiusEnabled()) {
    await syncSubscriberRadius({ ...subscriber, service_status: 'suspended' });
  }
  await db.query('DELETE FROM billing_subscribers WHERE id = $1 AND client_id = $2', [subscriber.id, req.scope.clientId]);
  await recordRequestEvent(req, {
    eventType: 'subscriber.deleted',
    category: 'subscriber',
    source: 'billing_workspace',
    entityType: 'subscriber',
    entityId: subscriber.id,
    severity: 'warning',
    title: 'Subscriber deleted',
    description: subscriber.full_name,
    previousState: subscriber,
    relatedEntities: [
      ...(subscriber.plan_id ? [{ entityType: 'package', entityId: subscriber.plan_id, relationship: 'package' }] : []),
      ...(subscriber.router_id ? [{ entityType: 'router', entityId: subscriber.router_id, relationship: 'router' }] : []),
    ],
    deduplicationKey: `subscriber:${subscriber.id}:deleted`,
    sensitivity: 'confidential',
  });
  res.json({ success: true });
});

router.post('/invoices', [
  body('subscriber_id').isInt({ min: 1 }),
  body('amount').isFloat({ min: 0.01 }),
  body('due_date').optional({ nullable: true }).isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const client = await db.connect();
  try {
    await ensureEventSchema();
    await client.query('BEGIN');
    const subscriber = await client.query('SELECT id, full_name, account_number FROM billing_subscribers WHERE id = $1 AND client_id = $2 LIMIT 1', [req.body.subscriber_id, req.scope.clientId]);
    if (!subscriber.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Selected subscriber does not belong to this billing workspace' });
    }
    const invoiceNumber = `INV-${req.scope.clientId}-${Date.now()}`;
    const result = await client.query(
      `INSERT INTO billing_invoices (client_id, subscriber_id, invoice_number, amount, status, due_date)
       VALUES ($1, $2, $3, $4, 'issued', $5) RETURNING *`,
      [req.scope.clientId, req.body.subscriber_id, invoiceNumber, req.body.amount, req.body.due_date || null]
    );
    const invoice = result.rows[0];
    await appendRequestEvent(client, req, {
      eventType: 'invoice.issued',
      category: 'invoice',
      source: 'billing_workspace',
      entityType: 'invoice',
      entityId: invoice.id,
      title: 'Invoice issued',
      description: `${invoice.invoice_number} was issued to ${subscriber.rows[0].full_name}`,
      payload: {
        invoice_number: invoice.invoice_number,
        amount: invoice.amount,
        due_date: invoice.due_date,
        status: invoice.status,
      },
      newState: invoice,
      relatedEntities: [{ entityType: 'subscriber', entityId: invoice.subscriber_id, relationship: 'billed_subscriber' }],
      deduplicationKey: `invoice:${invoice.id}:issued`,
      sensitivity: 'confidential',
    });
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction may not have started */ }
    console.error('Create invoice error:', err.message);
    res.status(500).json({ error: 'Failed to create invoice' });
  } finally {
    client.release();
  }
});

router.get('/payments', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM (
         SELECT
           'billing-' ||
             payment.id::text AS id,
           payment.client_id,
           payment.subscriber_id,
           payment.invoice_id,
           payment.amount::numeric
             AS amount,
           COALESCE(
             payment.method,
             'Payment'
           ) AS method,
           COALESCE(
             payment.reference,
             ''
           ) AS reference,
           payment.status,
           payment.paid_at,
           payment.created_at,
           subscriber.full_name
             AS subscriber_name,
           subscriber.account_number,
           invoice.invoice_number,
           'billing' AS source
         FROM billing_payments payment
         LEFT JOIN billing_subscribers
           subscriber
           ON subscriber.id =
             payment.subscriber_id
          AND subscriber.client_id =
             payment.client_id
         LEFT JOIN billing_invoices invoice
           ON invoice.id =
             payment.invoice_id
          AND invoice.client_id =
             payment.client_id
         WHERE payment.client_id = $1

         UNION ALL

         SELECT
           'hotspot-' ||
             payment.id::text AS id,
           payment.client_id,
           NULL::integer AS subscriber_id,
           NULL::integer AS invoice_id,
           payment.amount::numeric
             AS amount,
           'M-Pesa' AS method,
           COALESCE(
             payment.mpesa_receipt_number,
             payment.external_reference
           ) AS reference,
           payment.status,
           payment.updated_at AS paid_at,
           payment.created_at,
           COALESCE(
             payment.customer_name,
             'Hotspot customer'
           ) AS subscriber_name,
           payment.customer_phone
             AS account_number,
           'Hotspot package'
             AS invoice_number,
           'hotspot' AS source
         FROM payhero_payment_requests
           payment
         WHERE payment.client_id = $1
           AND payment.status = 'paid'
           AND payment.metadata->>'purpose' =
             'hotspot'
       ) payments
       ORDER BY
         paid_at DESC NULLS LAST,
         created_at DESC`,
      [req.scope.clientId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(
      'List live payments error:',
      error.message
    );

    res.status(500).json({
      error:
        'Failed to load live payments',
    });
  }
});

router.post('/payments', [
  body('invoice_id').isInt({ min: 1 }),
  body('amount').isFloat({ min: 0.01 }),
  body('method').optional({ nullable: true }).isLength({ max: 40 }),
  body('reference').trim().notEmpty().isLength({ max: 160 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const client = await db.connect();
  let entitlementSubscriberId = null;
  try {
    await ensureEventSchema();
    await client.query('BEGIN');
    const existingPayment = await client.query(
      `SELECT id, invoice_id, subscriber_id, amount, method, reference, status, paid_at
       FROM billing_payments WHERE client_id = $1 AND reference = $2 LIMIT 1`,
      [req.scope.clientId, req.body.reference.trim()]
    );
    if (existingPayment.rows[0]) {
      await client.query('COMMIT');
      return res.status(200).json({ payment: existingPayment.rows[0], duplicate: true });
    }
    const invoiceResult = await client.query('SELECT * FROM billing_invoices WHERE id = $1 AND client_id = $2 FOR UPDATE', [req.body.invoice_id, req.scope.clientId]);
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Selected invoice does not belong to this billing workspace' });
    }
    if (invoice.status === 'void' || invoice.status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This invoice cannot receive a payment' });
    }
    const paymentResult = await client.query(
      `INSERT INTO billing_payments (client_id, subscriber_id, invoice_id, amount, method, reference, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed') RETURNING *`,
      [req.scope.clientId, invoice.subscriber_id, invoice.id, req.body.amount, req.body.method?.trim() || null, req.body.reference.trim()]
    );
    const paid = await client.query("SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM billing_payments WHERE invoice_id = $1 AND status = 'completed'", [invoice.id]);
    const paidAmount = Number(paid.rows[0].total || 0);
    if (paidAmount >= Number(invoice.amount)) {
      await client.query("UPDATE billing_invoices SET status = 'paid', paid_at = NOW() WHERE id = $1", [invoice.id]);
      const entitlement = await client.query(
        `SELECT s.id, s.expires_at, p.validity_days
         FROM billing_subscribers s
         LEFT JOIN billing_plans p ON p.id = s.plan_id AND p.client_id = s.client_id
         WHERE s.id = $1 AND s.client_id = $2
         FOR UPDATE OF s`,
        [invoice.subscriber_id, req.scope.clientId]
      );
      const subscriber = entitlement.rows[0];
      if (subscriber) {
        const validityDays = Number(subscriber.validity_days || 0);
        const currentExpiry = subscriber.expires_at ? new Date(subscriber.expires_at) : null;
        const base = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
        const renewedExpiry = validityDays ? new Date(base.getTime() + validityDays * 86400000) : currentExpiry;
        await client.query(
          `UPDATE billing_subscribers
           SET service_status = 'active', radius_status = 'active', expires_at = $1, updated_at = NOW()
           WHERE id = $2 AND client_id = $3`,
          [renewedExpiry, subscriber.id, req.scope.clientId]
        );
        entitlementSubscriberId = subscriber.id;
        await enqueueRadiusSyncJob(client, req.scope.clientId, subscriber.id, 'payment_committed');
      }
    }
    const payment = paymentResult.rows[0];
    const correlationId = `invoice:${invoice.id}`;
    await appendRequestEvent(client, req, {
      eventType: 'payment.received',
      category: 'payment',
      source: 'billing_workspace',
      entityType: 'payment',
      entityId: payment.id,
      title: 'Payment received',
      description: `${payment.reference} recorded against ${invoice.invoice_number}`,
      payload: {
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        status: payment.status,
      },
      newState: payment,
      relatedEntities: [
        { entityType: 'invoice', entityId: invoice.id, relationship: 'settles' },
        { entityType: 'subscriber', entityId: invoice.subscriber_id, relationship: 'payer' },
      ],
      correlationId,
      deduplicationKey: `payment:${payment.id}:received`,
      sensitivity: 'confidential',
    });
    if (paidAmount >= Number(invoice.amount)) {
      await appendRequestEvent(client, req, {
        eventType: 'invoice.paid',
        category: 'invoice',
        source: 'billing_workspace',
        entityType: 'invoice',
        entityId: invoice.id,
        title: 'Invoice paid',
        description: `${invoice.invoice_number} is fully paid`,
        payload: {
          invoice_number: invoice.invoice_number,
          invoice_amount: invoice.amount,
          paid_amount: paidAmount,
        },
        previousState: { status: invoice.status },
        newState: { status: 'paid', paid_amount: paidAmount },
        relatedEntities: [
          { entityType: 'payment', entityId: payment.id, relationship: 'final_payment' },
          { entityType: 'subscriber', entityId: invoice.subscriber_id, relationship: 'subscriber' },
        ],
        correlationId,
        deduplicationKey: `invoice:${invoice.id}:paid`,
        sensitivity: 'confidential',
      });
    }
    await client.query('COMMIT');
    let reconnection = { status: entitlementSubscriberId ? 'queued' : 'not_required' };
    if (entitlementSubscriberId) {
      processRadiusSyncJobs().catch((error) => console.error('Unable to start RADIUS sync worker:', error.message));
    }
    res.status(201).json({ payment: paymentResult.rows[0], invoice_status: paidAmount >= Number(invoice.amount) ? 'paid' : 'issued', paid_amount: paidAmount, reconnection });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'A payment with that reference already exists' });
    console.error('Record payment error:', err.message);
    res.status(500).json({ error: 'Failed to record payment' });
  } finally {
    client.release();
  }
});

router.get('/radius/status', (_req, res) => {
  res.json({ enabled: radiusEnabled(), transport: 'wireguard', endpoint: radiusEnabled() ? 'private' : 'not_configured' });
});

router.post('/subscribers/:id/radius', [
  body('radius_username').trim().notEmpty().isLength({ max: 180 }),
  body('radius_password').optional({ checkFalsy: true }).isLength({ min: 4, max: 255 }),
  body('radius_status').optional().isIn(['active', 'suspended']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const current = await loadSubscriber(req.params.id, req.scope.clientId);
    if (!current) return res.status(404).json({ error: 'Subscriber not found' });
    const updates = ['radius_username = $1', 'radius_status = $2', 'updated_at = NOW()'];
    const params = [req.body.radius_username.trim(), req.body.radius_status || 'active'];
    if (req.body.radius_password) {
      params.push(encryptPassword(req.body.radius_password));
      updates.push(`radius_password_ciphertext = $${params.length}`);
    }
    params.push(current.id, req.scope.clientId);
    await db.query(
      `UPDATE billing_subscribers SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND client_id = $${params.length}`,
      params
    );
    const subscriber = await loadSubscriber(current.id, req.scope.clientId);
    const sync = await syncSubscriberRadius(subscriber);
    await recordRequestEvent(req, {
      eventType: 'radius.subscriber_configured',
      category: 'radius',
      source: 'billing_workspace',
      entityType: 'subscriber',
      entityId: subscriber.id,
      title: 'Subscriber RADIUS access configured',
      payload: {
        radius_username: subscriber.radius_username,
        radius_status: subscriber.radius_status,
        sync_status: sync.status,
      },
      newState: {
        radius_username: subscriber.radius_username,
        radius_status: subscriber.radius_status,
      },
      deduplicationKey: `subscriber:${subscriber.id}:radius-config:${Date.now()}`,
      sensitivity: 'restricted',
    });
    res.json({ success: true, sync, subscriber: { id: subscriber.id, radius_username: subscriber.radius_username, radius_status: subscriber.radius_status } });
  } catch (err) {
    console.error('Radius subscriber sync error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to sync subscriber to RADIUS' });
  }
});

router.post('/subscribers/:id/radius/sync', async (req, res) => {
  try {
    const subscriber = await loadSubscriber(req.params.id, req.scope.clientId);
    if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
    const sync = subscriber.access_mode === 'dhcp_static' ? await syncStaticDhcpLease(subscriber) : await syncSubscriberRadius(subscriber);
    await recordRequestEvent(req, {
      eventType: 'radius.subscriber_synced',
      category: 'radius',
      source: 'billing_workspace',
      entityType: 'subscriber',
      entityId: subscriber.id,
      title: 'Subscriber access synchronized',
      payload: {
        access_mode: subscriber.access_mode,
        radius_username: subscriber.radius_username,
        sync_status: sync.status,
      },
      relatedEntities: subscriber.router_id ? [{ entityType: 'router', entityId: subscriber.router_id, relationship: 'access_router' }] : [],
      deduplicationKey: `subscriber:${subscriber.id}:manual-radius-sync:${Date.now()}`,
      sensitivity: 'restricted',
    });
    res.json({ success: true, sync });
  } catch (err) {
    console.error('Radius resync error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to sync subscriber to RADIUS' });
  }
});

router.get('/hotspot/portal-config', async (req, res) => {
  try {
    const account = await db.query("SELECT id, name FROM clients WHERE id = $1 AND account_type = 'billing' LIMIT 1", [req.scope.clientId]);
    if (!account.rows[0]) return res.status(404).json({ error: 'Billing account not found' });
    const token = createHotspotPortalToken(account.rows[0].id);
    const baseUrl = String(process.env.FRONTEND_URL || 'https://nexa.telenexustechnologies.com').replace(/\/$/, '');
    res.json({ client_id: account.rows[0].id, account_name: account.rows[0].name, portal_url: `${baseUrl}/hotspot?portalToken=${encodeURIComponent(token)}`, portal_token: token });
  } catch (err) { console.error('Hotspot portal config error:', err.message); res.status(500).json({ error: 'Could not create hotspot portal link' }); }
});
router.get('/hotspot/plans', async (req, res) => {
  try {
    await ensureHotspotPlanSchema();
    const result = await db.query(
      `SELECT p.*, r.name AS router_name
       FROM billing_hotspot_plans p
       LEFT JOIN mikrotik_routers r ON r.id = p.router_id AND r.client_id = p.client_id
       WHERE p.client_id = $1 ORDER BY p.is_active DESC, p.name ASC`,
      [req.scope.clientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List hotspot plans error:', err.message);
    res.status(500).json({ error: 'Failed to load hotspot plans' });
  }
});

router.post('/hotspot/plans', [
  body('name').trim().notEmpty().isLength({ max: 160 }),
  body('price').isFloat({ min: 0 }),
  body('duration_minutes').isInt({ min: 1 }),
  body('max_devices').optional().isInt({ min: 1, max: 20 }),
  body('data_limit_mb').optional({ nullable: true }).isInt({ min: 1 }),
  body('mikrotik_rate_limit').optional({ nullable: true }).isLength({ max: 160 }),
  body('router_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('fup_enabled').optional().isBoolean(),
  body('fup_threshold_mb').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('fup_download_speed_mbps').optional({ nullable: true, checkFalsy: true }).isFloat({ gt: 0 }),
  body('fup_upload_speed_mbps').optional({ nullable: true, checkFalsy: true }).isFloat({ gt: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const client = await db.connect();
  try {
    await ensureHotspotPlanSchema();
    const maxDevices = normalizeHotspotDeviceLimit(req.body.max_devices);
    if (req.body.router_id) {
      const selectedRouter = await client.query(
        'SELECT id FROM mikrotik_routers WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1',
        [req.body.router_id, req.scope.clientId]
      );
      if (!selectedRouter.rows[0]) return res.status(400).json({ error: 'Selected router does not belong to this billing account or is inactive' });
    }
    if (req.body.fup_enabled && (!req.body.fup_threshold_mb || !req.body.fup_download_speed_mbps || !req.body.fup_upload_speed_mbps)) {
      return res.status(400).json({ error: 'FUP requires a usage threshold and reduced download and upload speeds' });
    }
    await ensureEventSchema();
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO billing_hotspot_plans
       (client_id, name, price, duration_minutes, max_devices, data_limit_mb, mikrotik_rate_limit, router_id,
        fup_enabled, fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.scope.clientId, req.body.name.trim(), req.body.price, req.body.duration_minutes, maxDevices, req.body.data_limit_mb || null,
        req.body.mikrotik_rate_limit?.trim() || null, req.body.router_id || null, Boolean(req.body.fup_enabled),
        req.body.fup_enabled ? req.body.fup_threshold_mb : null,
        req.body.fup_enabled ? req.body.fup_download_speed_mbps : null,
        req.body.fup_enabled ? req.body.fup_upload_speed_mbps : null]
    );
    const plan = result.rows[0];
    await appendRequestEvent(client, req, {
      eventType: 'package.created',
      category: 'package',
      source: 'billing_workspace',
      entityType: 'hotspot_package',
      entityId: plan.id,
      title: 'Hotspot package created',
      description: `${plan.name} was added to the hotspot catalogue`,
      payload: {
        service_type: 'hotspot',
        price: plan.price,
        duration_minutes: plan.duration_minutes,
        max_devices: plan.max_devices,
        data_limit_mb: plan.data_limit_mb,
        mikrotik_rate_limit: plan.mikrotik_rate_limit,
        fup_enabled: plan.fup_enabled,
      },
      newState: plan,
      relatedEntities: plan.router_id ? [{ entityType: 'router', entityId: plan.router_id, relationship: 'assigned_router' }] : [],
      deduplicationKey: `hotspot-package:${plan.id}:created`,
    });
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction may not have started */ }
    if (err.code === '23505') return res.status(409).json({ error: 'A hotspot package with that name already exists' });
    console.error('Create hotspot plan error:', err.message);
    res.status(500).json({ error: 'Failed to create hotspot package' });
  } finally {
    client.release();
  }
});

router.patch('/hotspot/plans/:id/status', [
  body('is_active').isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'A valid active status is required' });
  try {
    const result = await db.query(
      `UPDATE billing_hotspot_plans SET is_active = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3 RETURNING *`,
      [req.body.is_active === true || req.body.is_active === 'true', req.params.id, req.scope.clientId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Hotspot package not found' });
    await ensureEventSchema();
    await appendBillingEvent(db, {
      eventType: result.rows[0].is_active ? 'package.activated' : 'package.inactivated', category: 'package', source: 'billing_workspace',
      entityType: 'hotspot_package', entityId: result.rows[0].id,
      title: result.rows[0].is_active ? 'Hotspot package activated' : 'Hotspot package inactivated',
      description: `${result.rows[0].name} is now ${result.rows[0].is_active ? 'available' : 'hidden'} on the hotspot portal`,
      payload: { service_type: 'hotspot', is_active: result.rows[0].is_active }, newState: result.rows[0],
      deduplicationKey: `hotspot-package:${result.rows[0].id}:status:${result.rows[0].is_active}`,
    });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update hotspot plan status error:', err.message);
    res.status(500).json({ error: 'Could not update hotspot package status' });
  }
});

router.delete('/hotspot/plans/:id', async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const plan = await client.query('SELECT * FROM billing_hotspot_plans WHERE id = $1 AND client_id = $2 FOR UPDATE', [req.params.id, req.scope.clientId]);
    if (!plan.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Hotspot package not found' }); }
    const vouchers = await client.query('SELECT COUNT(*)::int AS count FROM billing_hotspot_vouchers WHERE plan_id = $1 AND client_id = $2', [req.params.id, req.scope.clientId]);
    if (vouchers.rows[0].count > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This package has vouchers. Inactivate it instead or remove its vouchers first.' }); }
    await client.query('DELETE FROM billing_hotspot_plans WHERE id = $1 AND client_id = $2', [req.params.id, req.scope.clientId]);
    await ensureEventSchema();
    await appendRequestEvent(client, req, {
      eventType: 'package.deleted', category: 'package', source: 'billing_workspace', entityType: 'hotspot_package', entityId: plan.rows[0].id,
      title: 'Hotspot package deleted', description: `${plan.rows[0].name} was removed from the hotspot catalogue`,
      payload: { service_type: 'hotspot', name: plan.rows[0].name }, previousState: plan.rows[0],
      deduplicationKey: `hotspot-package:${plan.rows[0].id}:deleted:${Date.now()}`,
    });
    await client.query('COMMIT');
    res.json({ success: true, deleted_id: Number(req.params.id) });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction may not have started */ }
    console.error('Delete hotspot plan error:', err.message);
    res.status(500).json({ error: 'Could not delete hotspot package' });
  } finally { client.release(); }
});
router.get('/hotspot/vouchers', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT v.*, p.name AS plan_name, p.duration_minutes, p.price, p.mikrotik_rate_limit
       FROM billing_hotspot_vouchers v
       LEFT JOIN billing_hotspot_plans p ON p.id = v.plan_id AND p.client_id = v.client_id
       WHERE v.client_id = $1 ORDER BY v.created_at DESC`,
      [req.scope.clientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List hotspot vouchers error:', err.message);
    res.status(500).json({ error: 'Failed to load hotspot vouchers' });
  }
});

router.delete('/hotspot/vouchers/:id', async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM billing_hotspot_vouchers WHERE id = $1 AND client_id = $2 AND status IN ('available', 'expired') RETURNING id`,
      [req.params.id, req.scope.clientId]
    );
    if (!result.rows[0]) return res.status(400).json({ error: 'Only available or expired vouchers can be deleted' });
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Delete hotspot voucher error:', err.message);
    res.status(500).json({ error: 'Failed to delete voucher' });
  }
});
router.post('/hotspot/vouchers', [
  body('plan_id').isInt({ min: 1 }),
  body('quantity').isInt({ min: 1, max: 100 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const client = await db.connect();
  try {
    const plan = await client.query('SELECT id FROM billing_hotspot_plans WHERE id = $1 AND client_id = $2 AND is_active = TRUE', [req.body.plan_id, req.scope.clientId]);
    if (!plan.rows[0]) return res.status(400).json({ error: 'Select an active hotspot package from this billing account' });
    await ensureEventSchema();
    await client.query('BEGIN');
    const vouchers = [];
    for (let index = 0; index < req.body.quantity; index += 1) {
      const code = `NX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO billing_hotspot_vouchers (client_id, plan_id, code) VALUES ($1,$2,$3) RETURNING *`,
        [req.scope.clientId, req.body.plan_id, code]
      );
      vouchers.push(result.rows[0]);
    }
    await appendRequestEvent(client, req, {
      eventType: 'hotspot.vouchers_created',
      category: 'hotspot',
      source: 'billing_workspace',
      entityType: 'hotspot_package',
      entityId: req.body.plan_id,
      title: 'Hotspot vouchers created',
      description: `${vouchers.length} hotspot voucher${vouchers.length === 1 ? '' : 's'} created`,
      payload: {
        quantity: vouchers.length,
        voucher_ids: vouchers.map((voucher) => voucher.id),
      },
      relatedEntities: vouchers.map((voucher) => ({
        entityType: 'hotspot_voucher',
        entityId: voucher.id,
        relationship: 'created_voucher',
      })),
      deduplicationKey: `hotspot-voucher-batch:${vouchers[0]?.id}:${vouchers.length}`,
      sensitivity: 'confidential',
    });
    await client.query('COMMIT');
    res.status(201).json(vouchers);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Generate hotspot vouchers error:', err.message);
    res.status(500).json({ error: 'Failed to generate hotspot vouchers' });
  } finally {
    client.release();
  }
});

router.post(
  '/hotspot/vouchers/:id/simulate-login',
  (_req, res) => {
    res.status(410).json({
      error:
        'Simulated hotspot logins are disabled. Use a real voucher login or confirmed payment.',
      simulated: false,
    });
  }
);


async function ensureHotspotPortalConfigColumn() {
  await db.query(`
    ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS hotspot_portal_config JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
}

function hotspotBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function hotspotText(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function hotspotSentence(value, maxLength = 180) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function hotspotPortalResponse(
  config = {}
) {
  const layouts = [
    'featured',
    'grid2',
    'compact',
    'list',
    'circles',
  ];

  const themes = [
    'blue',
    'dark',
    'orange',
    'green',
    'purple',
  ];

  const packageLayout =
    layouts.includes(
      String(
        config.package_layout ||
        ''
      )
    )
      ? String(
          config.package_layout
        )
      : 'featured';

  const themePreset =
    themes.includes(
      String(
        config.theme_preset ||
        ''
      )
    )
      ? String(
          config.theme_preset
        )
      : 'blue';

  const accentColor =
    /^#[0-9A-Fa-f]{6}$/
      .test(
        String(
          config.accent_color ||
          ''
        )
      )
      ? String(
          config.accent_color
        )
      : '#0878f9';

  return {
    brand_name:
      hotspotText(
        config.brand_name,
        80
      ),

    tagline:
      hotspotText(
        config.tagline,
        180
      ),

    hero_heading:
      hotspotText(
        config.hero_heading ||
        'Fast Internet. Everywhere.',
        100
      ),

    support_phone:
      hotspotText(
        config.support_phone,
        50
      ),

    whatsapp_phone:
      hotspotText(
        config.whatsapp_phone,
        50
      ),

    support_text:
      hotspotText(
        config.support_text,
        180
      ),

    wallet_enabled:
      config.wallet_enabled ===
        undefined
        ? true
        : hotspotBoolean(
            config.wallet_enabled
          ),

    wallet_label:
      hotspotText(
        config.wallet_label ||
        'MY WALLET',
        40
      ),

    wallet_balance:
      Number.isFinite(
        Number(
          config.wallet_balance
        )
      )
        ? Math.max(
            0,
            Number(
              config.wallet_balance
            )
          )
        : 0,

    flash_enabled:
      hotspotBoolean(
        config.flash_enabled
      ),

    flash_plan_id:
      config.flash_plan_id
        ? Number(
            config.flash_plan_id
          )
        : '',

    flash_discount_price:
      config.flash_discount_price ===
        null ||
      config.flash_discount_price ===
        undefined ||
      config.flash_discount_price ===
        ''
        ? ''
        : Number(
            config.flash_discount_price
          ),

    flash_starts_at:
      config.flash_starts_at ||
      '',

    flash_ends_at:
      config.flash_ends_at ||
      '',

    popular_plan_id:
      config.popular_plan_id
        ? Number(
            config.popular_plan_id
          )
        : '',

    package_layout:
      packageLayout,

    theme_preset:
      themePreset,

    design_template:
      String(config.design_template || '') === 'green_portrait'
        ? 'green_portrait'
        : 'classic',

    accent_color:
      accentColor,

    background_image_data:
      String(
        config.background_image_data ||
        ''
      ),

    background_image_updated_at:
      config.background_image_updated_at ||
      '',

    promo_slides: Array.isArray(config.promo_slides) ? config.promo_slides.slice(0, 5).map((slide) => ({ id: String(slide?.id || ''), image_data: String(slide?.image_data || ''), updated_at: String(slide?.updated_at || '') })).filter((slide) => slide.id && /^data:image\/(?:webp|jpeg|jpg|png);base64,/i.test(slide.image_data)) : [],

    campaign_enabled:
      config.campaign_enabled === undefined
        ? false
        : hotspotBoolean(config.campaign_enabled),

    campaign_message:
      hotspotSentence(config.campaign_message, 180),


    background_overlay:
      Number.isFinite(
        Number(
          config.background_overlay
        )
      )
        ? Math.max(
            0,
            Math.min(
              85,
              Number(
                config.background_overlay
              )
            )
          )
        : 46,

    show_support:
      config.show_support ===
        undefined
        ? true
        : hotspotBoolean(
            config.show_support
          ),

    show_whatsapp:
      config.show_whatsapp ===
        undefined
        ? true
        : hotspotBoolean(
            config.show_whatsapp
          ),

    show_voucher_login:
      config.show_voucher_login ===
        undefined
        ? true
        : hotspotBoolean(
            config.show_voucher_login
          ),
  };
}


router.get('/hotspot/portal-settings', async (req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  try {
    await ensureHotspotPortalConfigColumn();
    const result = await db.query(
      `SELECT name, hotspot_portal_config
       FROM clients
       WHERE id = $1 AND account_type = 'billing'
       LIMIT 1`,
      [req.scope.clientId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Billing account not found' });
    const response = hotspotPortalResponse(result.rows[0].hotspot_portal_config || {});
    if (!response.brand_name) response.brand_name = result.rows[0].name || '';
    return res.json(response);
  } catch (err) {
    console.error('Load hotspot portal settings error:', err.message);
    return res.status(500).json({ error: 'Could not load hotspot portal settings' });
  }
});

router.put(
  '/hotspot/portal-settings',
  async (
    req,
    res
  ) => {
    res.set('Cache-Control', 'private, no-store, max-age=0');
    try {
      await ensureHotspotPortalConfigColumn();

      const existingResult =
        await db.query(`
          SELECT
            name,
            hotspot_portal_config

          FROM clients

          WHERE id = $1
            AND account_type =
                'billing'

          LIMIT 1
        `, [
          req.scope.clientId,
        ]);

      if (
        !existingResult.rows[0]
      ) {
        return res.status(404).json({
          error:
            'Billing account not found',
        });
      }

      const previous =
        existingResult
          .rows[0]
          .hotspot_portal_config ||
        {};

      const raw = {
        ...previous,
        ...(req.body || {}),
      };

      const campaignMessage =
        hotspotSentence(
          raw.campaign_message,
          180
        );

      const campaignEnabled =
        raw.campaign_enabled === undefined
          ? Boolean(campaignMessage)
          : hotspotBoolean(raw.campaign_enabled);

      if (
        campaignEnabled &&
        !campaignMessage
      ) {
        return res.status(400).json({
          error:
            'Enter a notification sentence before enabling the campaign',
        });
      }

      let flashEnabled =
        hotspotBoolean(
          raw.flash_enabled
        );

      const flashPlanId =
        raw.flash_plan_id
          ? Number(
              raw.flash_plan_id
            )
          : null;

      const popularPlanId =
        raw.popular_plan_id
          ? Number(
              raw.popular_plan_id
            )
          : null;

      const walletBalance =
        Number(
          raw.wallet_balance ||
          0
        );

      const discountPrice =
        raw.flash_discount_price ===
          null ||
        raw.flash_discount_price ===
          undefined ||
        raw.flash_discount_price ===
          ''
          ? null
          : Number(
              raw.flash_discount_price
            );

      if (
        !Number.isFinite(
          walletBalance
        ) ||
        walletBalance <
          0
      ) {
        return res.status(400).json({
          error:
            'Displayed wallet balance must be zero or more',
        });
      }


      const layouts = [
        'featured',
        'grid2',
        'compact',
        'list',
        'circles',
      ];

      const packageLayout =
        String(
          raw.package_layout ||
          'featured'
        );

      if (
        !layouts.includes(
          packageLayout
        )
      ) {
        return res.status(400).json({
          error:
            'Choose a valid Hotspot package layout',
        });
      }


      const themes = [
        'blue',
        'dark',
        'orange',
        'green',
        'purple',
      ];

      const themePreset =
        String(
          raw.theme_preset ||
          'blue'
        );

      if (
        !themes.includes(
          themePreset
        )
      ) {
        return res.status(400).json({
          error:
            'Choose a valid Hotspot theme',
        });
      }


      const accentColor =
        String(
          raw.accent_color ||
          '#0878f9'
        );

      if (
        !/^#[0-9A-Fa-f]{6}$/
          .test(
            accentColor
          )
      ) {
        return res.status(400).json({
          error:
            'Accent color must be a valid six-digit hex color',
        });
      }


      const backgroundOverlay =
        Number(
          raw.background_overlay ??
          46
        );

      if (
        !Number.isFinite(
          backgroundOverlay
        ) ||
        backgroundOverlay <
          0 ||
        backgroundOverlay >
          85
      ) {
        return res.status(400).json({
          error:
            'Background overlay must be between 0 and 85',
        });
      }


      let backgroundImage =
        String(
          raw.background_image_data ||
          ''
        );

      if (
        backgroundImage
      ) {
        if (
          backgroundImage.length >
          1000000
        ) {
          return res.status(400).json({
            error:
              'Background image is too large after compression',
          });
        }

        if (
          !/^data:image\/(?:jpeg|jpg|png|webp);base64,/i
            .test(
              backgroundImage
            )
        ) {
          return res.status(400).json({
            error:
              'Background image must be JPEG, PNG or WebP',
          });
        }
      }


      const promoSlides = Array.isArray(raw.promo_slides) ? raw.promo_slides.slice(0, 6) : [];
      if (promoSlides.length > 5) return res.status(400).json({ error: 'You can add up to five promo slides' });
      let promoBytes = 0;
      const normalizedPromoSlides = promoSlides.map((slide, index) => {
        const id = String(slide?.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
        const imageData = String(slide?.image_data || '');
        if (!id || !/^data:image\/(?:webp|jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/i.test(imageData) || imageData.length > 360000) {
          throw new Error('Each promo slide must be a valid lightweight image');
        }
        promoBytes += imageData.length;
        return { id, image_data: imageData, updated_at: String(slide?.updated_at || new Date().toISOString()).slice(0, 40) };
      });
      if (promoBytes > 1300000) return res.status(400).json({ error: 'Promo slides are too large in total. Use lighter images.' });

      let flashPlan =
        null;

      if (
        flashPlanId
      ) {
        const result =
          await db.query(`
            SELECT
              id,
              name,
              price,
              is_active

            FROM billing_hotspot_plans

            WHERE id = $1
              AND client_id = $2

            LIMIT 1
          `, [
            flashPlanId,
            req.scope.clientId,
          ]);

        flashPlan =
          result.rows[0] ||
          null;
      }


      if (
        flashEnabled
      ) {
        if (
          !flashPlan ||
          flashPlan.is_active ===
            false
        ) {
          return res.status(400).json({
            error:
              'Choose an active hotspot package for the flash offer',
          });
        }

        if (
          !Number.isFinite(
            discountPrice
          ) ||
          discountPrice <
            0 ||
          discountPrice >=
            Number(
              flashPlan.price
            )
        ) {
          return res.status(400).json({
            error:
              `Flash price must be lower than the package price of KSh ${Number(
                flashPlan.price
              ).toLocaleString()}`,
          });
        }
      }


      if (
        popularPlanId
      ) {
        const popular =
          await db.query(`
            SELECT id
            FROM billing_hotspot_plans

            WHERE id = $1
              AND client_id = $2
              AND is_active = TRUE

            LIMIT 1
          `, [
            popularPlanId,
            req.scope.clientId,
          ]);

        if (
          !popular.rows[0]
        ) {
          return res.status(400).json({
            error:
              'Popular package must be an active hotspot package',
          });
        }
      }


      const startDate =
        raw.flash_starts_at
          ? new Date(
              raw.flash_starts_at
            )
          : null;

      const endDate =
        raw.flash_ends_at
          ? new Date(
              raw.flash_ends_at
            )
          : null;


      if (
        raw.flash_starts_at &&
        Number.isNaN(
          startDate.getTime()
        )
      ) {
        return res.status(400).json({
          error:
            'Enter a valid flash-offer start time',
        });
      }


      if (
        raw.flash_ends_at &&
        Number.isNaN(
          endDate.getTime()
        )
      ) {
        return res.status(400).json({
          error:
            'Enter a valid flash-offer end time',
        });
      }

      // An expired promotion must never prevent an administrator from saving unrelated portal changes (such as promo slides).
      if (flashEnabled && endDate && endDate <= new Date()) {
        flashEnabled = false;
      }


      if (
        flashEnabled &&
        !endDate
      ) {
        return res.status(400).json({
          error:
            'Set when the flash offer should end',
        });
      }


      if (
        flashEnabled &&
        startDate &&
        endDate <=
          startDate
      ) {
        return res.status(400).json({
          error:
            'Flash-offer end time must be after its start time',
        });
      }


      if (
        flashEnabled &&
        endDate <=
          new Date()
      ) {
        return res.status(400).json({
          error:
            'Flash-offer end time must be in the future',
        });
      }


      const backgroundChanged =
        backgroundImage !==
        String(
          previous.background_image_data ||
          ''
        );


      const config = {
        version:
          2,

        brand_name:
          hotspotText(
            raw.brand_name,
            80
          ),

        tagline:
          hotspotText(
            raw.tagline,
            180
          ),

        hero_heading:
          hotspotText(
            raw.hero_heading ||
            'Fast Internet. Everywhere.',
            100
          ),

        support_phone:
          hotspotText(
            raw.support_phone,
            50
          ),

        whatsapp_phone:
          hotspotText(
            raw.whatsapp_phone,
            50
          ),

        support_text:
          hotspotText(
            raw.support_text,
            180
          ),

        wallet_enabled:
          raw.wallet_enabled ===
            undefined
            ? true
            : hotspotBoolean(
                raw.wallet_enabled
              ),

        wallet_label:
          hotspotText(
            raw.wallet_label ||
            'MY WALLET',
            40
          ),

        wallet_balance:
          walletBalance,

        flash_enabled:
          flashEnabled,

        flash_plan_id:
          flashPlanId,

        flash_discount_price:
          discountPrice,

        flash_starts_at:
          startDate
            ? startDate
                .toISOString()
            : null,

        flash_ends_at:
          endDate
            ? endDate
                .toISOString()
            : null,

        popular_plan_id:
          popularPlanId,

        package_layout:
          packageLayout,

        theme_preset:
          themePreset,

        design_template:
          String(raw.design_template || '') === 'green_portrait'
            ? 'green_portrait'
            : 'classic',

        accent_color:
          accentColor,

        background_image_data:
          backgroundImage,

        background_image_updated_at:
          backgroundChanged
            ? new Date()
                .toISOString()
            : (
                previous
                  .background_image_updated_at ||
                null
              ),

        background_overlay:
          backgroundOverlay,

        promo_slides:
          normalizedPromoSlides,

        campaign_enabled:
          campaignEnabled,

        campaign_message:
          campaignMessage,

        show_support:
          raw.show_support ===
            undefined
            ? true
            : hotspotBoolean(
                raw.show_support
              ),

        show_whatsapp:
          raw.show_whatsapp ===
            undefined
            ? true
            : hotspotBoolean(
                raw.show_whatsapp
              ),

        show_voucher_login:
          raw.show_voucher_login ===
            undefined
            ? true
            : hotspotBoolean(
                raw.show_voucher_login
              ),

        updated_at:
          new Date()
            .toISOString(),
      };


      const result =
        await db.query(`
          UPDATE clients

          SET
            hotspot_portal_config =
              $2::jsonb

          WHERE id = $1
            AND account_type =
                'billing'

          RETURNING
            name,
            hotspot_portal_config
        `, [
          req.scope.clientId,
          JSON.stringify(
            config
          ),
        ]);


      const response =
        hotspotPortalResponse(
          result.rows[0]
            .hotspot_portal_config ||
          {}
        );

      if (
        !response.brand_name
      ) {
        response.brand_name =
          result.rows[0]
            .name ||
          '';
      }

      return res.json(
        response
      );
    } catch (
      error
    ) {
      if (error.message === 'Each promo slide must be a valid lightweight image') {
        return res.status(400).json({ error: error.message });
      }
      console.error(
        'Save hotspot portal settings error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not save hotspot portal settings',
      });
    }
  }
);


router.post(
  '/hotspot/publish',
  async (
    req,
    res
  ) => {
    try {
      await ensureMikrotikTables();

      const result =
        await db.query(`
          SELECT DISTINCT
            router.id,
            router.name

          FROM mikrotik_routers
            router

          JOIN network_router_executor_credentials
            executor

            ON executor.client_id =
                 router.client_id

           AND executor.router_id =
                 router.id

          WHERE router.client_id =
                  $1

            AND router.is_active =
                  TRUE

            AND executor.enabled =
                  TRUE

            AND executor.verification_status =
                  'verified'

          ORDER BY
            router.id
        `, [
          req.scope.clientId,
        ]);


      if (
        !result.rows.length
      ) {
        return res.status(400).json({
          error:
            'No active verified MikroTik router is available for Hotspot publishing',
        });
      }


      const installs =
        await Promise.all(
          result.rows.map(
            async router => {
              try {
                const install =
                  await installHotspotEdgePortal({
                    clientId:
                      req.scope.clientId,

                    routerId:
                      router.id,
                  });

                return {
                  router_id:
                    router.id,

                  router_name:
                    router.name,

                  status:
                    'published',

                  edge_bytes:
                    install.edge_bytes,
                };
              } catch (
                error
              ) {
                return {
                  router_id:
                    router.id,

                  router_name:
                    router.name,

                  status:
                    'failed',

                  error:
                    error.message,
                };
              }
            }
          )
        );


      const published =
        installs.filter(
          item =>
            item.status ===
            'published'
        ).length;

      const failed =
        installs.length -
        published;


      return res.json({
        published,
        failed,
        routers:
          installs,
      });
    } catch (
      error
    ) {
      console.error(
        'Publish hotspot portal error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not publish Hotspot portal',
      });
    }
  }
);


let hotspotMemberSchemaPromise;
function ensureHotspotMemberSchema(){ if(!hotspotMemberSchemaPromise) hotspotMemberSchemaPromise=db.query("CREATE TABLE IF NOT EXISTS billing_hotspot_members (id BIGSERIAL PRIMARY KEY, client_id BIGINT NOT NULL, router_id BIGINT NOT NULL, username TEXT NOT NULL, password_hash TEXT NOT NULL, rate_limit TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(client_id,username))"); return hotspotMemberSchemaPromise; }
router.get('/hotspot/members',async(req,res)=>{try{await ensureHotspotMemberSchema();const q=await db.query("SELECT m.id,m.username,m.router_id,m.rate_limit,m.is_active,m.created_at,r.name router_name FROM billing_hotspot_members m LEFT JOIN mikrotik_routers r ON r.id=m.router_id WHERE m.client_id=$1 ORDER BY m.created_at DESC",[req.scope.clientId]);res.json(q.rows)}catch(e){res.status(500).json({error:'Could not load member logins'})}});
router.post('/hotspot/members',async(req,res)=>{try{await ensureHotspotMemberSchema();const username=String(req.body.username||'').trim(),password=String(req.body.password||''),routerId=Number(req.body.router_id||req.body.routerId),down=Number(req.body.download_mbps||req.body.download||req.body.download_speed_mbps),up=Number(req.body.upload_mbps||req.body.upload||req.body.upload_speed_mbps);const missing=[];if(!/^[A-Za-z0-9._-]{3,48}$/.test(username))missing.push('username');if(password.length<8)missing.push('password (at least 8 characters)');if(!routerId)missing.push('router');if(!(down>0))missing.push('download speed');if(!(up>0))missing.push('upload speed');if(missing.length)return res.status(400).json({error:'Enter: '+missing.join(', ')+'.'});const routerQ=await db.query("SELECT id,COALESCE(wireguard_address,private_tunnel_ip,management_ip) router_address FROM mikrotik_routers WHERE id=$1 AND client_id=$2 LIMIT 1",[routerId,req.scope.clientId]);if(!routerQ.rows[0])return res.status(400).json({error:'Select an onboarded router.'});const rateLimit=up+'M/'+down+'M',hash=await bcrypt.hash(password,12),q=await db.query("INSERT INTO billing_hotspot_members(client_id,router_id,username,password_hash,rate_limit) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.scope.clientId,routerId,username,hash,rateLimit]);const sync=await syncHotspotMemberRadius(Object.assign({},q.rows[0],{password:password,router_address:routerQ.rows[0].router_address}));res.status(201).json({success:true,member:{id:q.rows[0].id,username:q.rows[0].username,router_id:q.rows[0].router_id,rate_limit:q.rows[0].rate_limit,is_active:q.rows[0].is_active},radius_sync:sync})}catch(e){res.status(500).json({error:e.code==='23505'?'That username already exists.':(e.message||'Could not create member')})}});


router.get('/settings/profile', async (req, res) => {
  try {
    const result = await db.query('SELECT name,business_name,contact_email,support_number,official_contact_name,official_whatsapp_number FROM clients WHERE id=$1 AND account_type=$2 LIMIT 1',[req.scope.clientId,'billing']);
    if (!result.rows[0]) return res.status(404).json({error:'Billing account not found'});
    return res.json(result.rows[0]);
  } catch (error) { console.error('Load billing settings profile error:',error.message); return res.status(500).json({error:'Could not load business profile'}); }
});
router.put('/settings/profile', async (req, res) => {
  try {
    const clean = (value, max) => String(value || '').trim().slice(0,max);
    const name=clean(req.body?.name,160), businessName=clean(req.body?.business_name,180), email=clean(req.body?.contact_email,180), support=clean(req.body?.support_number,80), contact=clean(req.body?.official_contact_name,160), whatsapp=clean(req.body?.official_whatsapp_number,80);
    if (!name) return res.status(400).json({error:'Business account name is required'});
    const result = await db.query('UPDATE clients SET name=$2,business_name=$3,contact_email=$4,support_number=$5,official_contact_name=$6,official_whatsapp_number=$7 WHERE id=$1 AND account_type=$8 RETURNING name,business_name,contact_email,support_number,official_contact_name,official_whatsapp_number',[req.scope.clientId,name,businessName||null,email||null,support||null,contact||null,whatsapp||null,'billing']);
    if (!result.rows[0]) return res.status(404).json({error:'Billing account not found'});
    return res.json(result.rows[0]);
  } catch (error) { console.error('Save billing settings profile error:',error.message); return res.status(500).json({error:'Could not save business profile'}); }
});

module.exports = router;
