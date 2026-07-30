const express = require('express');
const crypto = require('crypto');
const net = require('net');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { encryptPassword, getOnlineUsernames, getSubscriberUsage, loadSubscriber, radiusEnabled, syncHotspotVoucherRadius, syncSubscriberRadius } = require('../services/radiusSync');
const { enqueueRadiusSyncJob, processRadiusSyncJobs } = require('../services/radiusJobs');
const { ensureMikrotikTables, syncStaticDhcpLease } = require('../services/mikrotik');
const { createHotspotPortalToken } = require('../services/hotspotPortalToken');
const {
  appendBillingEvent,
  ensureEventSchema,
  eventActorFromRequest,
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
    const clientId = req.scope.clientId;
    const [subscribers, plans, invoices, payments, recentPayments] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE service_status = \'active\')::int AS active FROM billing_subscribers WHERE client_id = $1', [clientId]),
      db.query('SELECT COUNT(*)::int AS total FROM billing_plans WHERE client_id = $1 AND is_active = TRUE', [clientId]),
      db.query('SELECT COUNT(*)::int AS total, COALESCE(SUM(amount), 0)::numeric AS outstanding FROM billing_invoices WHERE client_id = $1 AND status IN (\'issued\', \'overdue\')', [clientId]),
      db.query('SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM billing_payments WHERE client_id = $1 AND status = \'completed\' AND paid_at >= CURRENT_DATE AND paid_at < CURRENT_DATE + INTERVAL \'1 day\'', [clientId]),
      db.query(`SELECT p.id, p.amount, p.method, p.reference, p.status, p.paid_at, i.invoice_number
                FROM billing_payments p
                LEFT JOIN billing_invoices i ON i.id = p.invoice_id AND i.client_id = p.client_id
                WHERE p.client_id = $1 ORDER BY p.paid_at DESC, p.created_at DESC LIMIT 4`, [clientId]),
    ]);
    res.json({
      subscribers: subscribers.rows[0],
      plans: plans.rows[0],
      invoices: invoices.rows[0],
      payments: payments.rows[0],
      recent_payments: recentPayments.rows,
    });
  } catch (err) {
    console.error('Billing summary error:', err.message);
    res.status(500).json({ error: 'Failed to load billing summary' });
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
  try {
    const { name, description, download_speed_mbps, upload_speed_mbps, price, validity_days, radius_profile, router_id,
      fup_enabled, fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps } = req.body;
    if (router_id) {
      const selectedRouter = await db.query(
        'SELECT id FROM mikrotik_routers WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1',
        [router_id, req.scope.clientId]
      );
      if (!selectedRouter.rows[0]) return res.status(400).json({ error: 'Selected router does not belong to this billing account or is inactive' });
    }
    if (fup_enabled && (!fup_threshold_mb || !fup_download_speed_mbps || !fup_upload_speed_mbps)) {
      return res.status(400).json({ error: 'FUP requires a usage threshold and reduced download and upload speeds' });
    }
    const result = await db.query(
      `INSERT INTO billing_plans
       (client_id, name, description, download_speed_mbps, upload_speed_mbps, price, validity_days, radius_profile,
        router_id, fup_enabled, fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.scope.clientId, name.trim(), description?.trim() || null, download_speed_mbps || null, upload_speed_mbps || null,
        price || 0, validity_days || 30, radius_profile?.trim() || null, router_id || null, Boolean(fup_enabled),
        fup_enabled ? fup_threshold_mb : null, fup_enabled ? fup_download_speed_mbps : null, fup_enabled ? fup_upload_speed_mbps : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A plan with that name already exists' });
    console.error('Create billing plan error:', err.message);
    res.status(500).json({ error: 'Failed to create billing plan' });
  }
});

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
  res.json({ success: true });
});

router.post('/invoices', [
  body('subscriber_id').isInt({ min: 1 }),
  body('amount').isFloat({ min: 0.01 }),
  body('due_date').optional({ nullable: true }).isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const subscriber = await db.query('SELECT id FROM billing_subscribers WHERE id = $1 AND client_id = $2 LIMIT 1', [req.body.subscriber_id, req.scope.clientId]);
    if (!subscriber.rows[0]) return res.status(400).json({ error: 'Selected subscriber does not belong to this billing workspace' });
    const invoiceNumber = `INV-${req.scope.clientId}-${Date.now()}`;
    const result = await db.query(
      `INSERT INTO billing_invoices (client_id, subscriber_id, invoice_number, amount, status, due_date)
       VALUES ($1, $2, $3, $4, 'issued', $5) RETURNING *`,
      [req.scope.clientId, req.body.subscriber_id, invoiceNumber, req.body.amount, req.body.due_date || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create invoice error:', err.message);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

router.get('/payments', async (req, res) => {
  const result = await db.query(
    `SELECT p.*, s.full_name AS subscriber_name, s.account_number, i.invoice_number
     FROM billing_payments p
     LEFT JOIN billing_subscribers s ON s.id = p.subscriber_id AND s.client_id = p.client_id
     LEFT JOIN billing_invoices i ON i.id = p.invoice_id AND i.client_id = p.client_id
     WHERE p.client_id = $1
     ORDER BY p.paid_at DESC, p.created_at DESC`,
    [req.scope.clientId]
  );
  res.json(result.rows);
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
  try {
    if (req.body.router_id) {
      const selectedRouter = await db.query(
        'SELECT id FROM mikrotik_routers WHERE id = $1 AND client_id = $2 AND is_active = TRUE LIMIT 1',
        [req.body.router_id, req.scope.clientId]
      );
      if (!selectedRouter.rows[0]) return res.status(400).json({ error: 'Selected router does not belong to this billing account or is inactive' });
    }
    if (req.body.fup_enabled && (!req.body.fup_threshold_mb || !req.body.fup_download_speed_mbps || !req.body.fup_upload_speed_mbps)) {
      return res.status(400).json({ error: 'FUP requires a usage threshold and reduced download and upload speeds' });
    }
    const result = await db.query(
      `INSERT INTO billing_hotspot_plans
       (client_id, name, price, duration_minutes, data_limit_mb, mikrotik_rate_limit, router_id,
        fup_enabled, fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.scope.clientId, req.body.name.trim(), req.body.price, req.body.duration_minutes, req.body.data_limit_mb || null,
        req.body.mikrotik_rate_limit?.trim() || null, req.body.router_id || null, Boolean(req.body.fup_enabled),
        req.body.fup_enabled ? req.body.fup_threshold_mb : null,
        req.body.fup_enabled ? req.body.fup_download_speed_mbps : null,
        req.body.fup_enabled ? req.body.fup_upload_speed_mbps : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A hotspot package with that name already exists' });
    console.error('Create hotspot plan error:', err.message);
    res.status(500).json({ error: 'Failed to create hotspot package' });
  }
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

router.post('/hotspot/vouchers/:id/simulate-login', async (req, res) => {
  try {
    const voucherResult = await db.query(
      `SELECT v.*, p.duration_minutes, p.data_limit_mb, p.mikrotik_rate_limit, p.fup_enabled,
              p.fup_threshold_mb, p.fup_download_speed_mbps, p.fup_upload_speed_mbps
       FROM billing_hotspot_vouchers v
       JOIN billing_hotspot_plans p ON p.id = v.plan_id AND p.client_id = v.client_id
       WHERE v.id = $1 AND v.client_id = $2 FOR UPDATE`,
      [req.params.id, req.scope.clientId]
    );
    const voucher = voucherResult.rows[0];
    if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
    if (voucher.status !== 'available') return res.status(400).json({ error: 'Only an available voucher can be activated' });
    const result = await db.query(
      `UPDATE billing_hotspot_vouchers SET status = 'active', used_by = 'Simulated hotspot user', activated_at = NOW(), expires_at = NOW() + ($1::text || ' minutes')::interval
       WHERE id = $2 AND client_id = $3 RETURNING *`,
      [voucher.duration_minutes, voucher.id, req.scope.clientId]
    );
    let radiusSync = { status: 'not_configured' };
    if (radiusEnabled()) radiusSync = await syncHotspotVoucherRadius({
      ...result.rows[0],
      mikrotik_rate_limit: voucher.mikrotik_rate_limit,
      data_limit_mb: voucher.data_limit_mb,
      fup_enabled: voucher.fup_enabled,
      fup_threshold_mb: voucher.fup_threshold_mb,
      fup_download_speed_mbps: voucher.fup_download_speed_mbps,
      fup_upload_speed_mbps: voucher.fup_upload_speed_mbps,
    });
    res.json({ simulated: true, voucher: result.rows[0], radius_sync: radiusSync });
  } catch (err) {
    console.error('Simulate hotspot login error:', err.message);
    res.status(500).json({ error: 'Failed to simulate hotspot login' });
  }
});

module.exports = router;
