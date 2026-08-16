const express = require('express');
const net = require('net');
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
const { ensureHotspotPlanSchema } = require('../services/hotspotPlanSchema');
const { verifyHotspotPortalToken, verifyHotspotPortalBootstrapToken, createHotspotPortalToken } = require('../services/hotspotPortalToken');

const router = express.Router();

router.use(
  express.urlencoded({
    extended: false,
    limit: '32kb',
  })
);

router.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin':
      '*',

    'Access-Control-Allow-Methods':
      'GET,POST,OPTIONS',

    'Access-Control-Allow-Headers':
      'Content-Type',

    'Access-Control-Max-Age':
      '86400',

    'Cross-Origin-Resource-Policy':
      'cross-origin',
  });

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});
function getPortalClientId(req, res) {
  const token = req.query.portalToken || req.body?.portal_token;
  const decoded = verifyHotspotPortalToken(token);
  if (!decoded) { res.status(403).json({ error: 'This hotspot portal link is invalid, expired, or not configured' }); return null; }
  req.hotspotPortalClaims = decoded;
  return decoded.client_id;
}

async function resolveClientId(req, res) {
  const clientId = getPortalClientId(req, res);
  if (!clientId) return null;
  const result = await db.query(`SELECT id, name, account_type FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
  if (result.rows[0]?.account_type !== 'billing') { res.status(404).json({ error: 'Hotspot account not found' }); return null; }
  return { id: clientId, ...result.rows[0] };
}
function privateIpv4(value) {
  const parts = String(value || '').split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

function samePrivateSubnet(a, b) {
  const left = String(a || '').split('.'); const right = String(b || '').split('.');
  return left.length === 4 && right.length === 4 && left.slice(0, 3).join('.') === right.slice(0, 3).join('.');
}

function safeRouterLoginUrl(value, clientIp) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/login') return null;
    if (net.isIP(url.hostname) !== 4 || !privateIpv4(url.hostname) || !privateIpv4(clientIp) || !samePrivateSubnet(url.hostname, clientIp)) return null;
    return url.toString();
  } catch (_) { return null; }
}

function portalOrigin(req) {
  return String(process.env.FRONTEND_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');
}

router.get('/bootstrap', (req, res) => {
  const bootstrap = verifyHotspotPortalBootstrapToken(req.query.bootstrapToken);
  const mac = String(req.query.mac || '').trim().toLowerCase();
  const ip = String(req.query.ip || '').trim();
  if (!bootstrap || !mac || mac.length > 80 || net.isIP(ip) !== 4) return res.status(403).send('This hotspot portal link is invalid or expired.');
  const portalToken = createHotspotPortalToken(bootstrap.client_id, { routerId: bootstrap.router_id, mac, ip, ttlSeconds: 600 });
  const target = new URL('/hotspot', portalOrigin(req));
  target.searchParams.set('portalToken', portalToken);
  target.searchParams.set('mac', mac); target.searchParams.set('ip', ip);
  ['link-login-only', 'link-orig'].forEach((key) => { if (req.query[key]) target.searchParams.set(key, String(req.query[key])); });
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' });
  return res.redirect(303, target.toString());
});
let hotspotPortalSchemaPromise = null;

const hotspotConfigCache =
  new Map();

const HOTSPOT_CONFIG_CACHE_TTL_MS =
  5 * 1000;

async function ensureHotspotPortalConfigColumn() {
  if (!hotspotPortalSchemaPromise) {
    hotspotPortalSchemaPromise =
      db.query(`
        ALTER TABLE clients
        ADD COLUMN IF NOT EXISTS
          hotspot_portal_config
          JSONB NOT NULL
          DEFAULT '{}'::jsonb
      `).catch(error => {
        hotspotPortalSchemaPromise =
          null;

        throw error;
      });
  }

  return hotspotPortalSchemaPromise;
}

function setHotspotConfigHeaders(
  res,
  cacheStatus
) {
  res.set({
    'Cache-Control':
      'private, no-store, max-age=0',

    'X-Hotspot-Config-Cache':
      cacheStatus,

    Vary:
      'Accept-Encoding',
  });
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
  await ensureHotspotPlanSchema();

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
router.get(
  '/theme-background',
  async (
    req,
    res
  ) => {
    try {
      const clientId =
        getPortalClientId(
          req,
          res
        );

      if (!clientId) {
        return;
      }

      await ensureHotspotPortalConfigColumn();

      const result =
        await db.query(`
          SELECT
            hotspot_portal_config

          FROM clients

          WHERE id = $1
            AND account_type =
                'billing'

          LIMIT 1
        `, [
          clientId,
        ]);

      const source =
        String(
          result.rows[0]
            ?.hotspot_portal_config
            ?.background_image_data ||
          ''
        );

      if (!source) {
        return res
          .status(404)
          .end();
      }

      const match =
        source.match(
          /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/is
        );

      if (!match) {
        return res
          .status(404)
          .end();
      }

      const type =
        match[1]
          .toLowerCase() ===
          'jpg'
          ? 'jpeg'
          : match[1]
              .toLowerCase();

      const data =
        Buffer.from(
          match[2],
          'base64'
        );

      if (
        !data.length ||
        data.length >
          1000000
      ) {
        return res
          .status(413)
          .end();
      }

      res.set({
        'Content-Type':
          `image/${type}`,

        'Cache-Control':
          'public, max-age=3600, stale-while-revalidate=86400',

        'Content-Length':
          String(
            data.length
          ),
      });

      return res.send(
        data
      );
    } catch (
      error
    ) {
      console.error(
        'Hotspot background image error:',
        error.message
      );

      return res
        .status(500)
        .end();
    }
  }
);


router.get('/promo-slide', async (req, res) => {
  try {
    const clientId = getPortalClientId(req, res);
    if (!clientId) return;
    const index = Number.parseInt(String(req.query.index || ''), 10);
    if (!Number.isInteger(index) || index < 0 || index > 4) return res.status(404).end();
    await ensureHotspotPortalConfigColumn();
    const result = await db.query("SELECT hotspot_portal_config FROM clients WHERE id = $1 AND account_type = 'billing' LIMIT 1", [clientId]);
    const slide = result.rows[0]?.hotspot_portal_config?.promo_slides?.[index];
    const source = String(slide?.image_data || '');
    const match = source.match(/^data:image\/(webp|jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return res.status(404).end();
    const type = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > 270000) return res.status(404).end();
    res.set({ 'Content-Type': `image/${type}`, 'Content-Length': String(data.length), 'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600', Vary: 'Accept-Encoding' });
    return res.send(data);
  } catch (error) {
    console.error('Hotspot promo slide error:', error.message);
    return res.status(500).end();
  }
});

router.get('/config', async (req, res) => {
  try {
    const clientId =
      getPortalClientId(req, res);

    if (!clientId) {
      return;
    }

    const cacheKey =
      String(clientId);

    const cached =
      hotspotConfigCache.get(
        cacheKey
      );

    if (
      cached &&
      cached.expires_at >
        Date.now()
    ) {
      setHotspotConfigHeaders(
        res,
        'HIT'
      );

      return res.json(
        cached.payload
      );
    }

    await ensureHotspotPortalConfigColumn();
    await ensureHotspotPlanSchema();

    const clientResult =
      await db.query(
        `SELECT
           id,
           name,
           account_type
         FROM clients
         WHERE id = $1
         LIMIT 1`,
        [
          clientId,
        ]
      );

    if (
      clientResult.rows[0]
        ?.account_type !==
      'billing'
    ) {
      return res.status(404).json({
        error:
          'Hotspot account not found',
      });
    }

    const client = {
      ...clientResult.rows[0],
      id: clientId,
    };

    const [plans, settings, portalConfigResult] = await Promise.all([
      db.query(
        `SELECT id, name, price, duration_minutes, max_devices, data_limit_mb, mikrotik_rate_limit, router_id,
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
        max_devices: flashPlan.max_devices,
        data_limit_mb: flashPlan.data_limit_mb,
        mikrotik_rate_limit: flashPlan.mikrotik_rate_limit,
      };
    }

    const payload = {
      server_now: new Date().toISOString(),
      client: {
        id: client.id,
        name: brandName,
        domain: null,
      },
      portal: {
        brand_name:
          brandName,

        tagline:
          String(
            saved.tagline ||
            `Stay connected with ${brandName} Hotspot`
          ).trim(),

        hero_heading:
          String(
            saved.hero_heading ||
            'Fast Internet. Everywhere.'
          ).trim(),

        wallet_enabled:
          saved.wallet_enabled ===
            undefined
            ? true
            : publicBoolean(
                saved.wallet_enabled
              ),

        wallet_label:
          String(
            saved.wallet_label ||
            'MY WALLET'
          ).trim(),

        wallet_balance:
          Number.isFinite(
            Number(
              saved.wallet_balance
            )
          )
            ? Math.max(
                0,
                Number(
                  saved.wallet_balance
                )
              )
            : 0,

        popular_plan_id:
          saved.popular_plan_id
            ? Number(
                saved.popular_plan_id
              )
            : null,

        package_layout:
          [
            'featured',
            'grid2',
            'compact',
            'list',
            'circles',
          ].includes(
            String(
              saved.package_layout ||
              ''
            )
          )
            ? String(
                saved.package_layout
              )
            : 'featured',

        theme_preset:
          [
            'blue',
            'dark',
            'orange',
            'green',
            'purple',
          ].includes(
            String(
              saved.theme_preset ||
              ''
            )
          )
            ? String(
                saved.theme_preset
              )
            : 'blue',

        design_template:
          String(saved.design_template || '') === 'green_portrait'
            ? 'green_portrait'
            : 'classic',

        accent_color:
          /^#[0-9A-Fa-f]{6}$/
            .test(
              String(
                saved.accent_color ||
                ''
              )
            )
              ? String(
                  saved.accent_color
                )
              : '#0878f9',

        background_image_enabled:
          Boolean(
            saved.background_image_data
          ),

        background_image_version:
          saved.background_image_updated_at ||
          saved.updated_at ||
          '',

        promo_slides: Array.isArray(saved.promo_slides) ? saved.promo_slides.slice(0, 5).map((slide, index) => ({ index, id: String(slide?.id || ''), version: String(slide?.updated_at || saved.updated_at || '') })).filter((slide) => slide.id) : [],

        campaign_enabled:
          saved.campaign_enabled === undefined
            ? false
            : publicBoolean(saved.campaign_enabled),

        campaign_message:
          String(saved.campaign_message || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 180),

        background_overlay:
          Number.isFinite(
            Number(
              saved.background_overlay
            )
          )
            ? Math.max(
                0,
                Math.min(
                  85,
                  Number(
                    saved.background_overlay
                  )
                )
              )
            : 46,

        show_support:
          saved.show_support ===
            undefined
            ? true
            : publicBoolean(
                saved.show_support
              ),

        show_whatsapp:
          saved.show_whatsapp ===
            undefined
            ? true
            : publicBoolean(
                saved.show_whatsapp
              ),

        show_voucher_login:
          saved.show_voucher_login ===
            undefined
            ? true
            : publicBoolean(
                saved.show_voucher_login
              ),
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
    };

    hotspotConfigCache.set(
      cacheKey,
      {
        payload,
        expires_at:
          Date.now() +
          HOTSPOT_CONFIG_CACHE_TTL_MS,
      }
    );

    if (
      hotspotConfigCache.size >
      5000
    ) {
      const now = Date.now();

      for (
        const [
          key,
          entry,
        ]
        of hotspotConfigCache
      ) {
        if (
          entry.expires_at <= now
        ) {
          hotspotConfigCache
            .delete(key);
        }
      }
    }

    setHotspotConfigHeaders(
      res,
      'MISS'
    );

    return res.json(payload);
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
        max_devices:
          checkoutPlan.plan.max_devices || 1,
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
  body('link_login_only').optional({ checkFalsy: true }).isString().isLength({ max: 512 }),
  body('link_orig').optional({ checkFalsy: true }).isString().isLength({ max: 1024 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Enter a valid voucher code', details: errors.array() });
  const account = await resolveClientId(req, res);
  if (!account) return;
  const loginTarget = safeRouterLoginUrl(req.body.link_login_only, req.body.ip);
  if (req.body.link_login_only && !loginTarget) return res.status(400).json({ error: 'The router login target must be this hotspot gateway\'s local /login address.' });
  const client = await db.connect();
  try {    await client.query('BEGIN');
    const voucherResult = await client.query(`
      SELECT
        v.*,

        COALESCE(
          v.agent_plan_name,
          p.name,
          'Agent voucher'
        ) AS plan_name,

        COALESCE(
          v.agent_duration_minutes,
          p.duration_minutes
        ) AS duration_minutes,

        p.data_limit_mb,

        COALESCE(
          v.agent_rate_limit,
          p.mikrotik_rate_limit
        ) AS mikrotik_rate_limit,

        COALESCE(
          v.face_value,
          p.price,
          0
        ) AS price,

        p.router_id,
        p.fup_enabled,
        p.fup_threshold_mb,
        p.fup_download_speed_mbps,
        p.fup_upload_speed_mbps

      FROM billing_hotspot_vouchers v

      LEFT JOIN billing_hotspot_plans p
        ON p.id = v.plan_id
       AND p.client_id = v.client_id

      WHERE v.client_id = $1
        AND LOWER(v.code) =
            LOWER($2)

      FOR UPDATE
    `, [
      account.id,
      req.body.code.trim(),
    ]);
    const voucher = voucherResult.rows[0];
    if (!voucher) { await client.query('ROLLBACK'); return res.status(401).json({ error: 'Voucher code not found' }); }
    const claims = req.hotspotPortalClaims || {};
    if (claims.router_id && voucher.router_id && Number(claims.router_id) !== Number(voucher.router_id)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This voucher belongs to a different router.' }); }
    if (claims.mac && req.body.mac && String(claims.mac).toLowerCase() !== String(req.body.mac).toLowerCase()) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This portal link is bound to a different device.' }); }
    if (claims.ip && req.body.ip && String(claims.ip) !== String(req.body.ip)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This portal link is bound to a different device.' }); }
    if (voucher.status === 'active' && voucher.expires_at && new Date(voucher.expires_at) > new Date()) { await client.query('COMMIT'); return res.json({ success: true, already_active: true, voucher: { code: voucher.code, plan_name: voucher.plan_name, expires_at: voucher.expires_at, duration_minutes: voucher.duration_minutes }, login: { username: voucher.code, password: voucher.code, url: loginTarget || null, destination: req.body.link_orig || null } }); }
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
    res.json({ success: true, voucher: { code: updated.rows[0].code, plan_name: voucher.plan_name, price: voucher.price, expires_at: updated.rows[0].expires_at, duration_minutes: voucher.duration_minutes, data_limit_mb: voucher.data_limit_mb }, login: { username: updated.rows[0].code, password: updated.rows[0].code, url: loginTarget || null, destination: req.body.link_orig || null }, radius_sync: radiusSync });
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
    const result = await db.query(`
      SELECT
        v.code,
        v.status,
        v.activated_at,
        v.expires_at,

        COALESCE(
          v.agent_plan_name,
          p.name,
          'Agent voucher'
        ) AS plan_name,

        COALESCE(
          v.agent_duration_minutes,
          p.duration_minutes
        ) AS duration_minutes,

        p.data_limit_mb

      FROM billing_hotspot_vouchers v

      LEFT JOIN billing_hotspot_plans p
        ON p.id = v.plan_id
       AND p.client_id = v.client_id

      WHERE v.client_id = $1
        AND LOWER(v.code) =
            LOWER($2)

      LIMIT 1
    `, [
      account.id,
      code,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Session not found' });
    res.json({ session: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Could not load hotspot session' }); }
});

module.exports = router;
