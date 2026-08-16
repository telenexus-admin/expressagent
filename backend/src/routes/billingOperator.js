const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { logActivity } = require('../services/audit');
const { ensureClientDomainSchema, getDomainSettings, saveDomainSettings, createClientSubdomain, verifyDomainAutomation } = require('../services/clientDomains');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

let schemaReady;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db.query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_account_status VARCHAR(20) NOT NULL DEFAULT 'active';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_plan VARCHAR(80) NOT NULL DEFAULT 'Starter';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_trial_ends_at TIMESTAMP WITH TIME ZONE;
      CREATE INDEX IF NOT EXISTS idx_clients_billing_accounts ON clients(account_type, billing_account_status, created_at DESC);
    `);
  }
  await schemaReady;
  await ensureClientDomainSchema();
}

function accountSummaryQuery() {
  return `
    SELECT c.id, c.name, c.business_name, c.contact_email, c.status, c.billing_account_status,
           c.billing_plan, c.billing_trial_ends_at, c.created_at,
           (SELECT d.domain FROM client_domains d WHERE d.client_id = c.id AND d.domain_type = 'subdomain' ORDER BY d.created_at DESC LIMIT 1) AS domain,
           (SELECT d.status FROM client_domains d WHERE d.client_id = c.id AND d.domain_type = 'subdomain' ORDER BY d.created_at DESC LIMIT 1) AS domain_status,
           (SELECT COUNT(*)::int FROM admins a WHERE a.client_id = c.id) AS admin_count,
           (SELECT COUNT(*)::int FROM billing_subscribers s WHERE s.client_id = c.id) AS subscriber_count,
           ((SELECT COUNT(*)::int FROM billing_plans p WHERE p.client_id = c.id AND p.is_active = TRUE) +
            (SELECT COUNT(*)::int FROM billing_hotspot_plans hp WHERE hp.client_id = c.id AND hp.is_active = TRUE)) AS plan_count,
           COALESCE((SELECT SUM(pay.amount) FROM billing_payments pay WHERE pay.client_id = c.id AND pay.status = 'completed'), 0)::numeric AS revenue
      FROM clients c
      WHERE c.account_type = 'billing'
  `;
}

router.get('/overview', async (_req, res) => {
  try {
    await ensureSchema();
    const [totals, plans, recent] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total_isps,
                COUNT(*) FILTER (WHERE billing_account_status = 'active' AND status = 'active')::int AS active_isps,
                COUNT(*) FILTER (WHERE billing_account_status = 'trial' AND status = 'active')::int AS trial_isps,
                COUNT(*) FILTER (WHERE billing_account_status = 'suspended' OR status = 'suspended')::int AS suspended_isps,
                COALESCE((SELECT SUM(amount) FROM billing_payments WHERE status = 'completed'), 0)::numeric AS revenue
                FROM clients WHERE account_type = 'billing'`),
      db.query(`SELECT ((SELECT COUNT(*) FROM billing_plans WHERE is_active = TRUE) +
                         (SELECT COUNT(*) FROM billing_hotspot_plans WHERE is_active = TRUE))::int AS total_plans`),
      db.query(`${accountSummaryQuery()} ORDER BY c.created_at DESC LIMIT 8`),
    ]);
    res.json({ summary: { ...totals.rows[0], total_plans: plans.rows[0].total_plans }, recent_isps: recent.rows });
  } catch (err) {
    console.error('GET /billing-operator/overview error:', err.message);
    res.status(500).json({ error: 'Could not load ISP account overview' });
  }
});

router.get('/accounts', async (_req, res) => {
  try {
    await ensureSchema();
    const result = await db.query(`${accountSummaryQuery()} ORDER BY c.created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /billing-operator/accounts error:', err.message);
    res.status(500).json({ error: 'Could not load ISP accounts' });
  }
});

router.post('/accounts', [
  body('isp_name').trim().notEmpty().withMessage('ISP name is required'),
  body('business_name').optional().trim(),
  body('contact_email').isEmail().normalizeEmail().withMessage('A valid account email is required'),
  body('admin_name').trim().notEmpty().withMessage('Account owner name is required'),
  body('admin_email').isEmail().normalizeEmail().withMessage('A valid administrator email is required'),
  body('admin_password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('account_status').optional().isIn(['trial', 'active', 'suspended']).withMessage('Invalid account status'),
  body('billing_plan').optional().trim().isLength({ max: 80 }),
  body('domain_slug').optional().trim().matches(/^[a-zA-Z0-9-]*$/).withMessage('Domain slug can only use letters, numbers and hyphens'),
  body('trial_ends_at').optional({ checkFalsy: true }).isISO8601().withMessage('Trial end date is invalid'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const client = await db.connect();
  try {
    await ensureSchema();
    const accountStatus = req.body.account_status || 'trial';
    await client.query('BEGIN');
    const createdClient = await client.query(`INSERT INTO clients (
        name, business_name, contact_email, status, account_type, connection_provider,
        billing_account_status, billing_plan, billing_trial_ends_at, system_prompt
      ) VALUES ($1, $2, $3, $4, 'billing', 'website', $5, $6, $7, $8)
      RETURNING id, name, business_name, contact_email, status, account_type,
                billing_account_status, billing_plan, billing_trial_ends_at, created_at`, [
      req.body.isp_name.trim(), (req.body.business_name || '').trim() || null, req.body.contact_email,
      accountStatus === 'suspended' ? 'suspended' : 'active', accountStatus,
      (req.body.billing_plan || 'Starter').trim() || 'Starter',
      accountStatus === 'trial' && req.body.trial_ends_at ? req.body.trial_ends_at : null,
      'You are Nexa, the billing assistant for this ISP account.',
    ]);
    const passwordHash = await bcrypt.hash(req.body.admin_password, 12);
    const createdAdmin = await client.query(`INSERT INTO admins (name, email, password_hash, role, client_id)
      VALUES ($1, $2, $3, 'admin', $4) RETURNING id, name, email, role, client_id, created_at`,
      [req.body.admin_name.trim(), req.body.admin_email, passwordHash, createdClient.rows[0].id]);
    await client.query('COMMIT');
    await logActivity({ req, action: 'billing_isp_account_created', module: 'billing_operator', entityType: 'client', entityId: createdClient.rows[0].id, description: `${req.user.name || 'System operator'} created billing ISP ${createdClient.rows[0].name}.`, metadata: { account_status: accountStatus, billing_plan: createdClient.rows[0].billing_plan } });
    let domain = null;
    let domainError = null;
    const domainSettings = await getDomainSettings();
    if (domainSettings.configured) {
      try {
        domain = await createClientSubdomain(createdClient.rows[0], req.body.domain_slug || '');
        await logActivity({ req, action: 'billing_isp_domain_created', module: 'billing_operator', entityType: 'client_domain', entityId: domain.id, description: `${req.user.name || 'System operator'} assigned ${domain.domain} to ${createdClient.rows[0].name}.`, metadata: { domain: domain.domain, client_id: createdClient.rows[0].id } });
      } catch (domainErr) {
        domainError = domainErr.message;
        console.error('Billing ISP domain creation failed:', domainErr.message);
      }
    }
    res.status(201).json({ account: createdClient.rows[0], admin: createdAdmin.rows[0], domain, domain_error: domainError });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'That administrator email is already in use' });
    console.error('POST /billing-operator/accounts error:', err.message);
    res.status(500).json({ error: 'Could not create ISP account' });
  } finally { client.release(); }
});

router.get('/domains/settings', async (_req, res) => {
  try { await ensureSchema(); res.json(await getDomainSettings()); }
  catch (err) { console.error('GET /billing-operator/domains/settings error:', err.message); res.status(500).json({ error: 'Could not load domain automation settings' }); }
});

router.put('/domains/settings', async (req, res) => {
  try {
    await ensureSchema();
    const settings = await saveDomainSettings(req.body || {});
    await logActivity({ req, action: 'billing_domain_automation_updated', module: 'billing_operator', entityType: 'operator_domain_settings', entityId: 1, description: `${req.user.name || 'System operator'} updated billing domain automation.`, metadata: { root_domain: settings.root_domain, target_domain: settings.target_domain, proxied: settings.proxied } });
    res.json(settings);
  } catch (err) { console.error('PUT /billing-operator/domains/settings error:', err.message); res.status(500).json({ error: 'Could not save domain automation settings' }); }
});

router.post('/domains/verify', async (_req, res) => {
  try { await ensureSchema(); res.json(await verifyDomainAutomation()); }
  catch (err) { res.status(400).json({ error: err.message || 'Cloudflare verification failed' }); }
});

router.post('/accounts/:id/domain', async (req, res) => {
  try {
    await ensureSchema();
    const account = await db.query("SELECT id, name, business_name, account_type FROM clients WHERE id = $1 AND account_type = 'billing' LIMIT 1", [req.params.id]);
    if (!account.rows[0]) return res.status(404).json({ error: 'ISP account not found' });
    const domain = await createClientSubdomain(account.rows[0], req.body?.domain_slug || '');
    await logActivity({ req, action: 'billing_isp_domain_created', module: 'billing_operator', entityType: 'client_domain', entityId: domain.id, description: `${req.user.name || 'System operator'} assigned ${domain.domain} to ${account.rows[0].name}.`, metadata: { domain: domain.domain, client_id: account.rows[0].id } });
    res.status(201).json(domain);
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message || 'Could not create ISP domain' }); }
});
router.patch('/accounts/:id/status', [body('account_status').isIn(['trial', 'active', 'suspended'])], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureSchema();
    const status = req.body.account_status;
    const result = await db.query(`UPDATE clients SET billing_account_status = $1, status = $2
      WHERE id = $3 AND account_type = 'billing' RETURNING id, name, status, billing_account_status`,
      [status, status === 'suspended' ? 'suspended' : 'active', req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'ISP account not found' });
    await logActivity({ req, action: 'billing_isp_status_changed', module: 'billing_operator', entityType: 'client', entityId: result.rows[0].id, description: `${req.user.name || 'System operator'} changed ${result.rows[0].name} to ${status}.`, metadata: { account_status: status } });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /billing-operator/accounts/:id/status error:', err.message);
    res.status(500).json({ error: 'Could not update ISP account status' });
  }
});

router.patch('/accounts/:id', [
  body('isp_name').optional().trim().isLength({ min: 1, max: 255 }),
  body('business_name').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('contact_email').optional().isEmail().normalizeEmail(),
  body('billing_plan').optional().trim().isLength({ min: 1, max: 80 }),
  body('trial_ends_at').optional({ nullable: true, checkFalsy: true }).isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureSchema();
    const result = await db.query(`UPDATE clients SET
      name = COALESCE($1, name), business_name = $2, contact_email = COALESCE($3, contact_email),
      billing_plan = COALESCE($4, billing_plan), billing_trial_ends_at = $5
      WHERE id = $6 AND account_type = 'billing'
      RETURNING id, name, business_name, contact_email, billing_plan, billing_trial_ends_at, billing_account_status`, [
      req.body.isp_name?.trim() || null,
      req.body.business_name === undefined ? null : (req.body.business_name?.trim() || null),
      req.body.contact_email || null,
      req.body.billing_plan?.trim() || null,
      req.body.trial_ends_at || null,
      req.params.id,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'ISP account not found' });
    await logActivity({ req, action: 'billing_isp_account_updated', module: 'billing_operator', entityType: 'client', entityId: result.rows[0].id, description: `${req.user.name || 'System operator'} updated ISP ${result.rows[0].name}.`, metadata: { client_id: result.rows[0].id } });
    res.json(result.rows[0]);
  } catch (err) { console.error('PATCH /billing-operator/accounts/:id error:', err.message); res.status(500).json({ error: 'Could not update ISP account' }); }
});

router.post('/accounts/:id/extend', [body('trial_ends_at').isISO8601().withMessage('Choose a valid subscription end date.')], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureSchema();
    const result = await db.query(`UPDATE clients SET billing_trial_ends_at = $1
      WHERE id = $2 AND account_type = 'billing'
      RETURNING id, name, billing_trial_ends_at, billing_account_status`, [req.body.trial_ends_at, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'ISP account not found' });
    await logActivity({ req, action: 'billing_isp_subscription_extended', module: 'billing_operator', entityType: 'client', entityId: result.rows[0].id, description: `${req.user.name || 'System operator'} extended ${result.rows[0].name}'s subscription.`, metadata: { client_id: result.rows[0].id, ends_at: result.rows[0].billing_trial_ends_at } });
    res.json(result.rows[0]);
  } catch (err) { console.error('POST /billing-operator/accounts/:id/extend error:', err.message); res.status(500).json({ error: 'Could not extend subscription' }); }
});

router.delete('/accounts/:id', [body('confirm_name').trim().notEmpty().withMessage('Type the ISP name to confirm deletion.')], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const client = await db.connect();
  try {
    await ensureSchema();
    await client.query('BEGIN');
    const account = await client.query(`SELECT c.id, c.name, (SELECT COUNT(*)::int FROM billing_subscribers s WHERE s.client_id = c.id) AS subscriber_count
      FROM clients c WHERE c.id = $1 AND c.account_type = 'billing' FOR UPDATE`, [req.params.id]);
    if (!account.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ISP account not found' }); }
    const target = account.rows[0];
    if (target.name !== req.body.confirm_name.trim()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The ISP name does not match. Nothing was deleted.' }); }
    if (target.subscriber_count > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This ISP has subscribers and cannot be deleted. Suspend it instead to preserve its records.' }); }
    await client.query(`DELETE FROM clients WHERE id = $1 AND account_type = 'billing'`, [target.id]);
    await client.query('COMMIT');
    await logActivity({ req, action: 'billing_isp_account_deleted', module: 'billing_operator', entityType: 'client', entityId: target.id, description: `${req.user.name || 'System operator'} deleted empty ISP ${target.name}.`, metadata: { client_id: target.id } });
    res.json({ deleted: true, id: target.id, name: target.name });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') return res.status(409).json({ error: 'This ISP still has protected records. Suspend it instead to preserve its history.' });
    console.error('DELETE /billing-operator/accounts/:id error:', err.message);
    res.status(500).json({ error: 'Could not delete ISP account' });
  } finally { client.release(); }
});
module.exports = router;