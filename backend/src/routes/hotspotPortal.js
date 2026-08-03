const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { radiusEnabled, syncHotspotVoucherRadius } = require('../services/radiusSync');
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
router.get('/config', async (req, res) => {
  try {
    const client = await resolveClientId(req, res);
    if (!client) return;
    const [plans, settings] = await Promise.all([
      db.query(`SELECT id, name, price, duration_minutes, data_limit_mb, mikrotik_rate_limit, router_id,
                       fup_enabled, fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps
                FROM billing_hotspot_plans WHERE client_id = $1 AND is_active = TRUE
                ORDER BY price ASC, duration_minutes ASC`, [client.id]),
      db.query(`SELECT key, value FROM client_settings WHERE client_id = $1 AND key IN ('hotspot_brand_name','hotspot_support_phone','hotspot_support_text')`, [client.id]).catch(() => ({ rows: [] })),
    ]);
    const settingMap = Object.fromEntries(settings.rows.map((row) => [row.key, row.value]));
    res.json({ client: { id: client.id, name: settingMap.hotspot_brand_name || client.name, domain: null }, support: { phone: settingMap.hotspot_support_phone || '', text: settingMap.hotspot_support_text || 'Need access? Contact support.' }, plans: plans.rows });
  } catch (err) {
    console.error('Public hotspot config error:', err.message);
    res.status(500).json({ error: 'Could not load hotspot access options' });
  }
});

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
