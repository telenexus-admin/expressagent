const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { radiusEnabled, syncHotspotVoucherRadius } = require('../services/radiusSync');
const {
  cleanPhone,
  initiatePayHeroPayment,
  loadPayHeroConfig,
} = require('../services/payhero');
const {
  ensureHotspotPaymentSchema,
  getHotspotPaymentStatus,
} = require('../services/hotspotPayments');
const { verifyHotspotPortalToken } = require('../services/hotspotPortalToken');

const router = express.Router();
function getPortalClientId(req, res) {
  const token = req.query.portalToken || req.body?.portal_token;
  const decoded = verifyHotspotPortalToken(token);
  if (!decoded) { res.status(403).json({ error: 'This hotspot portal link is invalid or not configured' }); return null; }
  return decoded.client_id;
}

async function resolveClientId(req, res) {
  const clientId = getPortalClientId(req, res);
  if (!clientId) return null;
  const result = await db.query(`SELECT id, name, account_type FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
  if (result.rows[0]?.account_type !== 'billing') { res.status(404).json({ error: 'Hotspot account not found' }); return null; }
  return { id: clientId, ...result.rows[0] };
}
async function ensureHotspotPortalConfigColumn() {
  await db.query(`
    ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS hotspot_portal_config JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
}

function publicBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

const HOTSPOT_PAYHERO_CHANNEL_ID = Number(
  process.env.HOTSPOT_PAYHERO_CHANNEL_ID ||
  9010
);

const checkoutAttempts = new Map();

function allowCheckout(key) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const previous =
    checkoutAttempts.get(key) || [];

  const current = previous.filter(
    (time) => now - time < windowMs
  );

  if (current.length >= 5) {
    checkoutAttempts.set(key, current);
    return false;
  }

  current.push(now);
  checkoutAttempts.set(key, current);

  if (checkoutAttempts.size > 5000) {
    for (
      const [storedKey, attempts]
      of checkoutAttempts.entries()
    ) {
      if (
        !attempts.some(
          (time) => now - time < windowMs
        )
      ) {
        checkoutAttempts.delete(storedKey);
      }
    }
  }

  return true;
}

async function resolveCheckoutPlan(
  clientId,
  planId
) {
  await ensureHotspotPortalConfigColumn();

  const result = await db.query(
    `SELECT
       p.*,
       c.hotspot_portal_config
     FROM billing_hotspot_plans p
     JOIN clients c
       ON c.id = p.client_id
     WHERE p.id = $1
       AND p.client_id = $2
       AND p.is_active = TRUE
     LIMIT 1`,
    [
      planId,
      clientId,
    ]
  );

  const plan = result.rows[0];

  if (!plan) {
    return null;
  }

  const normalPrice = Number(plan.price);
  let amount = Math.round(normalPrice);
  let discountApplied = false;

  const config =
    plan.hotspot_portal_config || {};

  const startsAt = config.flash_starts_at
    ? Date.parse(config.flash_starts_at)
    : null;

  const endsAt = config.flash_ends_at
    ? Date.parse(config.flash_ends_at)
    : null;

  const discountPrice =
    Number(config.flash_discount_price);

  const now = Date.now();

  const flashActive = (
    publicBoolean(config.flash_enabled) &&
    Number(config.flash_plan_id) ===
      Number(plan.id) &&
    (
      !Number.isFinite(startsAt) ||
      now >= startsAt
    ) &&
    Number.isFinite(endsAt) &&
    now < endsAt &&
    Number.isFinite(discountPrice) &&
    discountPrice >= 0 &&
    discountPrice < normalPrice
  );

  if (flashActive) {
    amount = Math.round(discountPrice);
    discountApplied = true;
  }

  return {
    plan,
    amount,
    normal_price: Math.round(normalPrice),
    discount_applied: discountApplied,
  };
}
router.get('/config', async (req, res) => {
  try {
    await ensureHotspotPortalConfigColumn();
    const client = await resolveClientId(req, res);
    if (!client) return;

    const [plans, settings, portalConfigResult] = await Promise.all([
      db.query(
        `SELECT id, name, price, duration_minutes, data_limit_mb, mikrotik_rate_limit, router_id,
                fup_enabled, fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps
         FROM billing_hotspot_plans
         WHERE client_id = $1 AND is_active = TRUE
         ORDER BY price ASC, duration_minutes ASC`,
        [client.id]
      ),
      db.query(
        `SELECT key, value
         FROM client_settings
         WHERE client_id = $1
           AND key IN ('hotspot_brand_name','hotspot_support_phone','hotspot_support_text')`,
        [client.id]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT hotspot_portal_config
         FROM clients
         WHERE id = $1
         LIMIT 1`,
        [client.id]
      ),
    ]);

    const legacySettings = Object.fromEntries(
      settings.rows.map((row) => [row.key, row.value])
    );
    const saved = portalConfigResult.rows[0]?.hotspot_portal_config || {};
    const paymentConfig =
      await loadPayHeroConfig(client.id)
        .catch(() => ({
          enabled: false,
          basicAuth: '',
          channelId: null,
        }));
    const brandName = String(
      saved.brand_name
      || legacySettings.hotspot_brand_name
      || client.name
      || 'Nexa'
    ).trim();

    const flashPlan = plans.rows.find(
      (plan) => Number(plan.id) === Number(saved.flash_plan_id)
    );
    const originalPrice = Number(flashPlan?.price || 0);
    const discountPrice = Number(saved.flash_discount_price);
    const startsAt = saved.flash_starts_at || null;
    const endsAt = saved.flash_ends_at || null;
    const startTime = startsAt ? Date.parse(startsAt) : null;
    const endTime = endsAt ? Date.parse(endsAt) : null;
    const now = Date.now();

    const validFlash = (
      publicBoolean(saved.flash_enabled)
      && flashPlan
      && Number.isFinite(discountPrice)
      && discountPrice >= 0
      && discountPrice < originalPrice
      && Number.isFinite(endTime)
      && endTime > now
    );

    let flashOffer = null;
    if (validFlash) {
      flashOffer = {
        enabled: true,
        status: Number.isFinite(startTime) && now < startTime ? 'scheduled' : 'active',
        plan_id: flashPlan.id,
        name: flashPlan.name,
        price: flashPlan.price,
        original_price: originalPrice,
        discount_price: discountPrice,
        starts_at: startsAt,
        ends_at: endsAt,
        duration_minutes: flashPlan.duration_minutes,
        data_limit_mb: flashPlan.data_limit_mb,
        mikrotik_rate_limit: flashPlan.mikrotik_rate_limit,
      };
    }

    return res.json({
      server_now: new Date().toISOString(),
      client: {
        id: client.id,
        name: brandName,
        domain: null,
      },
      portal: {
        brand_name: brandName,
        tagline: String(saved.tagline || `Stay connected with ${brandName} Hotspot`).trim(),
        wallet_label: String(saved.wallet_label || 'MY WALLET').trim(),
        wallet_balance: Number.isFinite(Number(saved.wallet_balance))
          ? Math.max(0, Number(saved.wallet_balance))
          : 0,
        popular_plan_id: saved.popular_plan_id ? Number(saved.popular_plan_id) : null,
      },
      support: {
        phone: String(
          saved.support_phone
          || legacySettings.hotspot_support_phone
          || ''
        ).trim(),
        whatsapp: String(
          saved.whatsapp_phone
          || saved.support_phone
          || legacySettings.hotspot_support_phone
          || ''
        ).trim(),
        text: String(
          saved.support_text
          || legacySettings.hotspot_support_text
          || 'Need access? Contact support.'
        ).trim(),
      },
      flash_offer: flashOffer,
      payments: {
        enabled: Boolean(
          paymentConfig.enabled &&
          paymentConfig.basicAuth &&
          Number(paymentConfig.channelId) ===
            HOTSPOT_PAYHERO_CHANNEL_ID
        ),
        channel_id:
          paymentConfig.channelId || null,
        provider: 'payhero',
      },
      plans: plans.rows,
    });
  } catch (err) {
    console.error('Public hotspot config error:', err.message);
    return res.status(500).json({ error: 'Could not load hotspot access options' });
  }
});

router.post('/checkout', [
  body('portal_token').trim().notEmpty(),
  body('plan_id').isInt({ min: 1 }),
  body('phone').trim().notEmpty(),
  body('mac')
    .optional({ checkFalsy: true })
    .isLength({ max: 80 }),
  body('ip')
    .optional({ checkFalsy: true })
    .isIP(),
], async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      error:
        'Enter a valid package and M-Pesa number',
      details: errors.array(),
    });
  }

  const account =
    await resolveClientId(req, res);

  if (!account) {
    return;
  }

  try {
    const phone =
      cleanPhone(req.body.phone);

    if (!/^254[17]\d{8}$/.test(phone)) {
      return res.status(400).json({
        error:
          'Enter a valid Safaricom M-Pesa number',
      });
    }

    const limiterKey = [
      account.id,
      phone,
      req.ip,
    ].join(':');

    if (!allowCheckout(limiterKey)) {
      return res.status(429).json({
        error:
          'Too many payment prompts. Wait five minutes before trying again.',
      });
    }

    const checkoutPlan =
      await resolveCheckoutPlan(
        account.id,
        Number(req.body.plan_id)
      );

    if (!checkoutPlan) {
      return res.status(404).json({
        error:
          'This hotspot package is no longer available',
      });
    }

    if (
      !Number.isInteger(checkoutPlan.amount) ||
      checkoutPlan.amount < 10 ||
      checkoutPlan.amount > 500000
    ) {
      return res.status(400).json({
        error:
          'This package must cost between KES 10 and KES 500,000 for M-Pesa checkout',
      });
    }

    const paymentConfig =
      await loadPayHeroConfig(account.id);

    if (
      !paymentConfig.enabled ||
      !paymentConfig.basicAuth
    ) {
      return res.status(503).json({
        error:
          'M-Pesa checkout is not enabled for this hotspot',
      });
    }

    if (
      Number(paymentConfig.channelId) !==
      HOTSPOT_PAYHERO_CHANNEL_ID
    ) {
      return res.status(503).json({
        error:
          `PayHero channel ${
            HOTSPOT_PAYHERO_CHANNEL_ID
          } is not active for this hotspot`,
      });
    }

    await ensureHotspotPaymentSchema();

    const result =
      await initiatePayHeroPayment({
        client: account,
        conversationId: null,
        customerPhone: phone,
        customerName:
          `${account.name || 'Nexa'} hotspot`,
        amount: checkoutPlan.amount,
        metadata: {
          purpose: 'hotspot',
          plan_id: checkoutPlan.plan.id,
          expected_amount:
            checkoutPlan.amount,
          normal_price:
            checkoutPlan.normal_price,
          discount_applied:
            checkoutPlan.discount_applied,
          mac:
            String(req.body.mac || '')
              .trim()
              .slice(0, 80),
          ip:
            String(req.body.ip || '')
              .trim()
              .slice(0, 80),
          payhero_channel_id:
            HOTSPOT_PAYHERO_CHANNEL_ID,
        },
      });

    if (!result.success) {
      return res.status(502).json({
        error:
          result.error ||
          'Could not send the M-Pesa prompt',
      });
    }

    return res.status(202).json({
      success: true,
      reference: result.externalReference,
      status: 'pending',
      amount: checkoutPlan.amount,
      discount_applied:
        checkoutPlan.discount_applied,
      plan: {
        id: checkoutPlan.plan.id,
        name: checkoutPlan.plan.name,
        duration_minutes:
          checkoutPlan.plan.duration_minutes,
      },
      message:
        `M-Pesa prompt sent to +${phone}`,
    });
  } catch (error) {
    console.error(
      'Public hotspot checkout error:',
      error.message
    );

    return res.status(500).json({
      error:
        'Could not start the hotspot payment',
    });
  }
});

router.get(
  '/checkout/:reference',
  async (req, res) => {
    try {
      const account =
        await resolveClientId(req, res);

      if (!account) {
        return;
      }

      const reference =
        String(req.params.reference || '')
          .trim()
          .slice(0, 120);

      if (
        !reference ||
        !/^[A-Za-z0-9_-]+$/.test(reference)
      ) {
        return res.status(400).json({
          error:
            'Payment reference is invalid',
        });
      }

      const status =
        await getHotspotPaymentStatus({
          clientId: account.id,
          externalReference: reference,
        });

      if (!status) {
        return res.status(404).json({
          error:
            'Payment request was not found',
        });
      }

      return res.json(status);
    } catch (error) {
      console.error(
        'Public hotspot payment status error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not check the payment status',
      });
    }
  }
);
router.post('/login', [
  body('portal_token').trim().notEmpty(),
  body('code').trim().notEmpty().isLength({ min: 3, max: 80 }),
  body('mac').optional({ checkFalsy: true }).isLength({ max: 80 }),
  body('ip').optional({ checkFalsy: true }).isIP(),
  body('link_login_only').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }),
  body('link_orig').optional({ checkFalsy: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Enter a valid voucher code', details: errors.array() });
  const account = await resolveClientId(req, res);
  if (!account) return;
  const client = await db.connect();
  try {    await client.query('BEGIN');
    const voucherResult = await client.query(`SELECT v.*, p.name AS plan_name, p.duration_minutes, p.data_limit_mb,
      p.mikrotik_rate_limit, p.price, p.router_id, p.fup_enabled, p.fup_threshold_mb,
      p.fup_download_speed_mbps, p.fup_upload_speed_mbps
      FROM billing_hotspot_vouchers v JOIN billing_hotspot_plans p ON p.id = v.plan_id AND p.client_id = v.client_id
      WHERE v.client_id = $1 AND LOWER(v.code) = LOWER($2) FOR UPDATE`, [account.id, req.body.code.trim()]);
    const voucher = voucherResult.rows[0];
    if (!voucher) { await client.query('ROLLBACK'); return res.status(401).json({ error: 'Voucher code not found' }); }
    if (voucher.status === 'active' && voucher.expires_at && new Date(voucher.expires_at) > new Date()) { await client.query('COMMIT'); return res.json({ success: true, already_active: true, voucher: { code: voucher.code, plan_name: voucher.plan_name, expires_at: voucher.expires_at, duration_minutes: voucher.duration_minutes }, login: { username: voucher.code, password: voucher.code, url: req.body.link_login_only || null, destination: req.body.link_orig || null } }); }
    if (voucher.status !== 'available') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This voucher is no longer available' }); }
    const usedBy = [req.body.mac && `mac:${req.body.mac}`, req.body.ip && `ip:${req.body.ip}`].filter(Boolean).join(' ') || 'Hotspot portal user';
    const updated = await client.query(`UPDATE billing_hotspot_vouchers SET status = 'active', used_by = $1, activated_at = NOW(), expires_at = NOW() + ($2::text || ' minutes')::interval WHERE id = $3 RETURNING *`, [usedBy, voucher.duration_minutes, voucher.id]);
    await client.query('COMMIT');
    let radiusSync = { status: 'not_configured' };
    if (radiusEnabled()) radiusSync = await syncHotspotVoucherRadius({
      ...updated.rows[0],
      mikrotik_rate_limit: voucher.mikrotik_rate_limit,
      data_limit_mb: voucher.data_limit_mb,
      fup_enabled: voucher.fup_enabled,
      fup_threshold_mb: voucher.fup_threshold_mb,
      fup_download_speed_mbps: voucher.fup_download_speed_mbps,
      fup_upload_speed_mbps: voucher.fup_upload_speed_mbps,
    });
    res.json({ success: true, voucher: { code: updated.rows[0].code, plan_name: voucher.plan_name, price: voucher.price, expires_at: updated.rows[0].expires_at, duration_minutes: voucher.duration_minutes, data_limit_mb: voucher.data_limit_mb }, login: { username: updated.rows[0].code, password: updated.rows[0].code, url: req.body.link_login_only || null, destination: req.body.link_orig || null }, radius_sync: radiusSync });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction may already be closed */ }
    console.error('Public hotspot login error:', err.message);
    res.status(500).json({ error: 'Could not activate this voucher' });
  } finally { client.release(); }
});

router.get('/session', async (req, res) => {
  try {
    const account = await resolveClientId(req, res);
    if (!account) return;
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Voucher code is required' });
    const result = await db.query(`SELECT v.code, v.status, v.activated_at, v.expires_at, p.name AS plan_name, p.duration_minutes, p.data_limit_mb FROM billing_hotspot_vouchers v LEFT JOIN billing_hotspot_plans p ON p.id = v.plan_id AND p.client_id = v.client_id WHERE v.client_id = $1 AND LOWER(v.code) = LOWER($2) LIMIT 1`, [account.id, code]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Session not found' });
    res.json({ session: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Could not load hotspot session' }); }
});

module.exports = router;
