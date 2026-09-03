const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { cleanPhone, initiatePayHeroPayment, loadPayHeroConfig } = require('../services/payhero');
const { activatePaidHotspotDevice, normalizeMac, revokeHotspotDeviceAccess } = require('../services/hotspotMacAccess');
const { verifyHotspotPortalToken } = require('../services/hotspotPortalToken');
const {
  ensureHotspotTvSchema,
  getHotspotTvPaymentStatus,
  loadPlan,
} = require('../services/hotspotTv');

const adminRouter = express.Router();
const publicRouter = express.Router();
const HOTSPOT_PAYHERO_CHANNEL_ID = Number(process.env.HOTSPOT_PAYHERO_CHANNEL_ID || 9010);
const checkoutAttempts = new Map();

function allowCheckout(key) {
  const now = Date.now();
  const previous = checkoutAttempts.get(key) || [];
  const current = previous.filter((time) => now - time < 5 * 60 * 1000);
  if (current.length >= 5) {
    checkoutAttempts.set(key, current);
    return false;
  }
  current.push(now);
  checkoutAttempts.set(key, current);
  if (checkoutAttempts.size > 4000) {
    for (const [storedKey, times] of checkoutAttempts.entries()) {
      if (!times.some((time) => now - time < 5 * 60 * 1000)) checkoutAttempts.delete(storedKey);
    }
  }
  return true;
}

async function requireAdminWorkspace(req, res, next) {
  if (req.scope?.isSuperadmin || !req.scope?.clientId) return res.status(403).json({ error: 'Billing workspace access required' });
  const result = await db.query(`SELECT account_type FROM clients WHERE id=$1 LIMIT 1`, [req.scope.clientId]);
  if (result.rows[0]?.account_type !== 'billing') return res.status(403).json({ error: 'This account is not a billing workspace' });
  await ensureHotspotTvSchema();
  return next();
}

adminRouter.use(authMiddleware, scopeMiddleware, requireAdminWorkspace);

adminRouter.get('/plans', async (req, res) => {
  const result = await db.query(
    `SELECT p.*, r.name AS router_name
     FROM billing_hotspot_tv_plans p
     LEFT JOIN mikrotik_routers r ON r.id=p.router_id AND r.client_id=p.client_id
     WHERE p.client_id=$1
     ORDER BY p.is_active DESC, p.price ASC, p.name ASC`,
    [req.scope.clientId]
  );
  res.json(result.rows);
});

adminRouter.post('/plans', [
  body('name').trim().notEmpty().isLength({ max: 180 }),
  body('price').isFloat({ min: 10, max: 500000 }),
  body('duration_minutes').isInt({ min: 1, max: 525600 }),
  body('router_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
  body('mikrotik_rate_limit').optional({ nullable: true }).isLength({ max: 120 }),
  body('data_limit_mb').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const routerId = req.body.router_id ? Number(req.body.router_id) : null;
    if (routerId) {
      const router = await db.query(`SELECT id FROM mikrotik_routers WHERE id=$1 AND client_id=$2 AND is_active=TRUE LIMIT 1`, [routerId, req.scope.clientId]);
      if (!router.rows[0]) return res.status(400).json({ error: 'Selected MikroTik is not active in this billing workspace' });
    }
    const result = await db.query(
      `INSERT INTO billing_hotspot_tv_plans
         (client_id,router_id,name,price,duration_minutes,mikrotik_rate_limit,data_limit_mb,is_active,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW()) RETURNING *`,
      [req.scope.clientId, routerId, req.body.name.trim(), Number(req.body.price), Number(req.body.duration_minutes),
        String(req.body.mikrotik_rate_limit || '').trim() || null, req.body.data_limit_mb ? Number(req.body.data_limit_mb) : null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A TV package with that name already exists' });
    console.error('Create TV package error:', error.message);
    return res.status(500).json({ error: 'Could not create TV package' });
  }
});

adminRouter.patch('/plans/:id', [
  body('name').optional().trim().notEmpty().isLength({ max: 180 }),
  body('price').optional().isFloat({ min: 10, max: 500000 }),
  body('duration_minutes').optional().isInt({ min: 1, max: 525600 }),
  body('router_id').optional({ nullable: true }).custom((value) => value === null || value === '' || (Number.isInteger(Number(value)) && Number(value) > 0)),
  body('mikrotik_rate_limit').optional({ nullable: true }).isLength({ max: 120 }),
  body('data_limit_mb').optional({ nullable: true }).custom((value) => value === null || value === '' || (Number.isInteger(Number(value)) && Number(value) > 0)),
  body('is_active').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const current = await loadPlan(req.scope.clientId, req.params.id);
  if (!current) return res.status(404).json({ error: 'TV package not found' });
  const nextRouterId = Object.prototype.hasOwnProperty.call(req.body, 'router_id')
    ? (req.body.router_id ? Number(req.body.router_id) : null) : current.router_id;
  if (nextRouterId) {
    const router = await db.query(`SELECT id FROM mikrotik_routers WHERE id=$1 AND client_id=$2 AND is_active=TRUE LIMIT 1`, [nextRouterId, req.scope.clientId]);
    if (!router.rows[0]) return res.status(400).json({ error: 'Selected MikroTik is not active in this billing workspace' });
  }
  try {
    const result = await db.query(
      `UPDATE billing_hotspot_tv_plans
       SET name=$3, price=$4, duration_minutes=$5, router_id=$6, mikrotik_rate_limit=$7,
           data_limit_mb=$8, is_active=$9, updated_at=NOW()
       WHERE id=$1 AND client_id=$2 RETURNING *`,
      [current.id, req.scope.clientId,
        req.body.name?.trim() || current.name,
        req.body.price === undefined ? current.price : Number(req.body.price),
        req.body.duration_minutes === undefined ? current.duration_minutes : Number(req.body.duration_minutes),
        nextRouterId,
        req.body.mikrotik_rate_limit === undefined ? current.mikrotik_rate_limit : (String(req.body.mikrotik_rate_limit || '').trim() || null),
        req.body.data_limit_mb === undefined ? current.data_limit_mb : (req.body.data_limit_mb ? Number(req.body.data_limit_mb) : null),
        req.body.is_active === undefined ? current.is_active : Boolean(req.body.is_active)]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A TV package with that name already exists' });
    return res.status(500).json({ error: 'Could not update TV package' });
  }
});

adminRouter.delete('/plans/:id', async (req, res) => {
  const plan = await loadPlan(req.scope.clientId, req.params.id);
  if (!plan) return res.status(404).json({ error: 'TV package not found' });
  const inUse = await db.query(`SELECT 1 FROM billing_hotspot_tv_subscribers WHERE client_id=$1 AND plan_id=$2 LIMIT 1`, [req.scope.clientId, plan.id]);
  if (inUse.rows[0]) {
    const result = await db.query(`UPDATE billing_hotspot_tv_plans SET is_active=FALSE,updated_at=NOW() WHERE id=$1 AND client_id=$2 RETURNING *`, [plan.id, req.scope.clientId]);
    return res.json({ ...result.rows[0], archived: true });
  }
  await db.query(`DELETE FROM billing_hotspot_tv_plans WHERE id=$1 AND client_id=$2`, [plan.id, req.scope.clientId]);
  return res.json({ success: true });
});

adminRouter.get('/subscribers', async (req, res) => {
  const result = await db.query(
    `SELECT s.*, p.name AS plan_name, p.price, p.mikrotik_rate_limit, r.name AS router_name,
            live.ip_address, live.uptime, live.last_seen, COALESCE(live.is_online,FALSE) AS is_online
     FROM billing_hotspot_tv_subscribers s
     LEFT JOIN billing_hotspot_tv_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
     LEFT JOIN mikrotik_routers r ON r.id=s.router_id AND r.client_id=s.client_id
     LEFT JOIN LATERAL (
       SELECT m.ip_address,m.uptime,m.last_seen,m.is_online
       FROM mikrotik_clients m
       WHERE m.client_id=s.client_id AND m.router_id=s.router_id AND m.service_type='hotspot'
         AND regexp_replace(UPPER(COALESCE(m.mac_address,m.username,'')),'[^A-F0-9]','','g') = regexp_replace(UPPER(s.mac_address),'[^A-F0-9]','','g')
       ORDER BY m.is_online DESC,m.last_seen DESC NULLS LAST LIMIT 1
     ) live ON TRUE
     WHERE s.client_id=$1
     ORDER BY CASE WHEN s.status='active' THEN 0 WHEN s.status='activation_pending' THEN 1 ELSE 2 END, s.updated_at DESC`,
    [req.scope.clientId]
  );
  res.json(result.rows);
});

async function loadSubscriber(clientId, id) {
  const result = await db.query(
    `SELECT s.*,p.name AS plan_name,p.mikrotik_rate_limit,p.data_limit_mb
     FROM billing_hotspot_tv_subscribers s
     LEFT JOIN billing_hotspot_tv_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
     WHERE s.id=$1 AND s.client_id=$2 LIMIT 1`,
    [id, clientId]
  );
  return result.rows[0] || null;
}

adminRouter.patch('/subscribers/:id/status', [body('status').isIn(['active','suspended'])], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const subscriber = await loadSubscriber(req.scope.clientId, req.params.id);
  if (!subscriber) return res.status(404).json({ error: 'TV subscription not found' });
  try {
    if (req.body.status === 'suspended') {
      await revokeHotspotDeviceAccess({ clientId: subscriber.client_id, routerId: subscriber.router_id, macAddress: subscriber.mac_address, ipAddress: '' });
      const result = await db.query(
        `UPDATE billing_hotspot_tv_subscribers SET status='suspended',device_activation_status='suspended',updated_at=NOW() WHERE id=$1 RETURNING *`,
        [subscriber.id]
      );
      return res.json(result.rows[0]);
    }
    if (!subscriber.expires_at || new Date(subscriber.expires_at) <= new Date()) return res.status(400).json({ error: 'This TV package has expired. Extend or renew it first.' });
    const device = await activatePaidHotspotDevice({
      clientId: subscriber.client_id, routerId: subscriber.router_id, macAddress: subscriber.mac_address,
      ipAddress: '', expiresAt: subscriber.expires_at, rateLimit: subscriber.mikrotik_rate_limit || null,
      dataLimitMb: subscriber.data_limit_mb || null,
    });
    const result = await db.query(
      `UPDATE billing_hotspot_tv_subscribers SET status='active',device_activation_status=$2,activation_error=NULL,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [subscriber.id, device.status === 'active' ? 'online' : 'ready']
    );
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not update TV subscription' });
  }
});

adminRouter.post('/subscribers/:id/extend', [body('days').isInt({ min: 1, max: 365 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const subscriber = await loadSubscriber(req.scope.clientId, req.params.id);
  if (!subscriber) return res.status(404).json({ error: 'TV subscription not found' });
  const result = await db.query(
    `UPDATE billing_hotspot_tv_subscribers
     SET expires_at=GREATEST(COALESCE(expires_at,NOW()),NOW()) + ($3::int * INTERVAL '1 day'),
         status='activation_pending',device_activation_status='pending',activation_error=NULL,cleanup_completed_at=NULL,cleanup_error=NULL,updated_at=NOW()
     WHERE id=$1 AND client_id=$2 RETURNING *`,
    [subscriber.id, req.scope.clientId, Number(req.body.days)]
  );
  try {
    const refreshed = { ...subscriber, ...result.rows[0] };
    const device = await activatePaidHotspotDevice({ clientId: refreshed.client_id, routerId: refreshed.router_id,
      macAddress: refreshed.mac_address, expiresAt: refreshed.expires_at, rateLimit: refreshed.mikrotik_rate_limit || null,
      dataLimitMb: refreshed.data_limit_mb || null, ipAddress: '' });
    const activated = await db.query(`UPDATE billing_hotspot_tv_subscribers SET status='active',device_activation_status=$2,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [subscriber.id, device.status === 'active' ? 'online' : 'ready']);
    return res.json(activated.rows[0]);
  } catch (error) {
    return res.status(202).json({ ...result.rows[0], warning: 'Expiry extended. MikroTik activation will retry automatically.' });
  }
});

adminRouter.delete('/subscribers/:id', async (req, res) => {
  const subscriber = await loadSubscriber(req.scope.clientId, req.params.id);
  if (!subscriber) return res.status(404).json({ error: 'TV subscription not found' });
  try {
    await revokeHotspotDeviceAccess({ clientId: subscriber.client_id, routerId: subscriber.router_id, macAddress: subscriber.mac_address, ipAddress: '' });
  } catch (error) {
    return res.status(409).json({
      error: `Polyizon could not confirm that ${subscriber.mac_address} was removed from MikroTik. The TV record was kept for safety. ${error.message || ''}`.trim(),
    });
  }
  await db.query(`DELETE FROM billing_hotspot_tv_subscribers WHERE id=$1 AND client_id=$2`, [subscriber.id, req.scope.clientId]);
  return res.json({ success: true });
});

function publicClaims(req, res) {
  const token = String(req.query.portalToken || req.body?.portal_token || '').trim();
  const claims = verifyHotspotPortalToken(token);
  if (!claims) {
    res.status(403).json({ error: 'This hotspot portal link is invalid or expired' });
    return null;
  }
  return claims;
}

async function validatePublicClient(claims, res) {
  await ensureHotspotTvSchema();
  const result = await db.query(`SELECT id,name,account_type FROM clients WHERE id=$1 LIMIT 1`, [claims.client_id]);
  if (result.rows[0]?.account_type !== 'billing') {
    res.status(404).json({ error: 'Hotspot account not found' });
    return null;
  }
  return result.rows[0];
}

publicRouter.get('/config', async (req, res) => {
  const claims = publicClaims(req, res); if (!claims) return;
  const client = await validatePublicClient(claims, res); if (!client) return;
  const routerId = Number(claims.router_id || 0) || null;
  const result = await db.query(
    `SELECT id,name,price,duration_minutes,mikrotik_rate_limit,data_limit_mb,router_id
     FROM billing_hotspot_tv_plans
     WHERE client_id=$1 AND is_active=TRUE AND ($2::int IS NULL OR router_id IS NULL OR router_id=$2)
     ORDER BY price ASC,duration_minutes ASC`,
    [client.id, routerId]
  );
  const payment = await loadPayHeroConfig(client.id).catch(() => ({ enabled: false, basicAuth: '', channelId: null }));
  return res.json({
    enabled: result.rows.length > 0,
    plans: result.rows,
    router_id: routerId,
    payment_enabled: Boolean(payment.enabled && payment.basicAuth && Number(payment.channelId) === HOTSPOT_PAYHERO_CHANNEL_ID),
  });
});

publicRouter.post('/lookup', [body('portal_token').trim().notEmpty(), body('mac').trim().notEmpty().isLength({ max: 32 })], async (req, res) => {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ error: 'Enter a valid TV MAC address' });
  const claims = publicClaims(req, res); if (!claims) return;
  const client = await validatePublicClient(claims, res); if (!client) return;
  const mac = normalizeMac(req.body.mac);
  if (!mac) return res.status(400).json({ error: 'Enter a valid TV MAC address such as AA:BB:CC:DD:EE:FF' });
  const routerId = Number(claims.router_id || 0) || null;
  if (!routerId) return res.json({ found: false, mac_address: mac, preview: true });
  const result = await db.query(
    `SELECT s.status,s.expires_at,s.device_activation_status,p.name AS plan_name
     FROM billing_hotspot_tv_subscribers s
     LEFT JOIN billing_hotspot_tv_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
     WHERE s.client_id=$1 AND s.router_id=$2 AND s.mac_address=$3 LIMIT 1`,
    [client.id, routerId, mac]
  );
  const item = result.rows[0];
  return res.json({ found: Boolean(item), mac_address: mac, subscription: item ? {
    status: item.expires_at && new Date(item.expires_at) <= new Date() ? 'expired' : item.status,
    expires_at: item.expires_at,
    plan_name: item.plan_name,
    device_activation_status: item.device_activation_status,
  } : null });
});

publicRouter.post('/checkout', [
  body('portal_token').trim().notEmpty(), body('plan_id').isInt({ min: 1 }),
  body('phone').trim().notEmpty(), body('mac').trim().notEmpty().isLength({ max: 32 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Enter a TV MAC address, package and valid M-Pesa number', details: errors.array() });
  const claims = publicClaims(req, res); if (!claims) return;
  const client = await validatePublicClient(claims, res); if (!client) return;
  try {
    const phone = cleanPhone(req.body.phone);
    const mac = normalizeMac(req.body.mac);
    const routerId = Number(claims.router_id || 0) || null;
    if (!/^254[17]\d{8}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid Safaricom M-Pesa number' });
    if (!mac) return res.status(400).json({ error: 'Enter a valid TV MAC address such as AA:BB:CC:DD:EE:FF' });
    if (!routerId) return res.status(400).json({ error: 'Open TV Packages from the live hotspot before paying so Polyizon knows which MikroTik serves the TV' });
    if (!allowCheckout(`${client.id}:${routerId}:${mac}:${phone}:${req.ip}`)) return res.status(429).json({ error: 'Too many payment prompts. Wait five minutes before trying again.' });

    const plan = await loadPlan(client.id, Number(req.body.plan_id), { activeOnly: true });
    if (!plan || (plan.router_id && Number(plan.router_id) !== routerId)) return res.status(404).json({ error: 'This TV package is not available on this hotspot router' });
    const amount = Math.round(Number(plan.price));
    if (!Number.isInteger(amount) || amount < 10 || amount > 500000) return res.status(400).json({ error: 'TV package price must be between KES 10 and KES 500,000' });

    const paymentConfig = await loadPayHeroConfig(client.id);
    if (!paymentConfig.enabled || !paymentConfig.basicAuth || Number(paymentConfig.channelId) !== HOTSPOT_PAYHERO_CHANNEL_ID) {
      return res.status(503).json({ error: 'M-Pesa checkout is not enabled for TV packages on this hotspot' });
    }

    const result = await initiatePayHeroPayment({
      client,
      conversationId: null,
      customerPhone: phone,
      customerName: `${client.name || 'Polyizon'} TV package`,
      amount,
      metadata: {
        purpose: 'hotspot_tv',
        tv_plan_id: plan.id,
        expected_amount: amount,
        mac,
        router_id: routerId,
        payhero_channel_id: HOTSPOT_PAYHERO_CHANNEL_ID,
      },
    });
    if (!result.success) return res.status(502).json({ error: result.error || 'Could not send the M-Pesa prompt' });
    return res.status(202).json({ success: true, reference: result.externalReference, status: 'pending', amount,
      mac_address: mac, plan: { id: plan.id, name: plan.name, duration_minutes: plan.duration_minutes },
      message: `M-Pesa prompt sent to +${phone}` });
  } catch (error) {
    console.error('TV package checkout error:', error.message);
    return res.status(500).json({ error: 'Could not start the TV package payment' });
  }
});

publicRouter.get('/checkout/:reference', async (req, res) => {
  const claims = publicClaims(req, res); if (!claims) return;
  const client = await validatePublicClient(claims, res); if (!client) return;
  const reference = String(req.params.reference || '').trim().slice(0, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(reference)) return res.status(400).json({ error: 'Payment reference is invalid' });
  try {
    const status = await getHotspotTvPaymentStatus({ clientId: client.id, externalReference: reference });
    if (!status) return res.status(404).json({ error: 'TV payment request was not found' });
    return res.json(status);
  } catch (error) {
    console.error('TV payment status error:', error.message);
    return res.status(500).json({ error: 'Could not check the TV package payment' });
  }
});

module.exports = { adminRouter, publicRouter };
