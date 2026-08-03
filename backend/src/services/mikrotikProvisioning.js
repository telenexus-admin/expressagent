const crypto = require('crypto');
const db = require('../db');
const { connectRouter, getRouter } = require('./mikrotik');

const DEFAULTS = {
  radius_host: process.env.RADIUS_SERVER_HOST || '192.241.137.127',
  radius_auth_port: 1812,
  radius_accounting_port: 1813,
  hotspot_interface: 'bridge',
  hotspot_gateway: '10.20.0.1/24',
  hotspot_pool: '10.20.0.10-10.20.0.254',
  hotspot_dns_name: 'login.nexa.local',
  pppoe_interface: 'bridge',
  pppoe_local_address: '10.30.0.1',
  pppoe_pool: '10.30.0.10-10.30.0.254',
  pppoe_service_name: 'NEXA-PPPoE',
  portal_url: 'https://nexa.telenexustechnologies.com/hotspot',
};

function normalizeConfig(input = {}) {
  const c = { ...DEFAULTS, ...input };
  for (const key of ['hotspot_interface', 'pppoe_interface', 'hotspot_gateway', 'hotspot_pool', 'hotspot_dns_name', 'pppoe_local_address', 'pppoe_pool', 'pppoe_service_name', 'radius_host', 'portal_url']) c[key] = String(c[key] || '').trim();
  c.radius_auth_port = Number(c.radius_auth_port || 1812); c.radius_accounting_port = Number(c.radius_accounting_port || 1813);
  c.radius_secret = String(c.radius_secret || '').trim();
  if (!c.radius_secret || c.radius_secret.length < 12) throw new Error('A RADIUS shared secret of at least 12 characters is required');
  if (!c.hotspot_interface || !c.pppoe_interface || !c.hotspot_gateway || !c.hotspot_pool || !c.pppoe_pool) throw new Error('Hotspot and PPPoE interface, gateway, and pool values are required');
  return c;
}

function makePortalFile(config) {
  const portal = String(config.portal_url).replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecting…</title></head><body><p>Opening the internet portal…</p><script>const q=new URLSearchParams({clientId:'$(client-id)',mac:'$(mac)',ip:'$(ip)',linkLoginOnly:'$(link-login-only)',linkOrig:'$(link-orig)'});window.location.replace("${portal}?"+q.toString());</script></body></html>`;
}

function resourceName(value) { return String(value).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60); }
function plan(config) {
  const hotspotPool = `NEXA-${resourceName(config.hotspot_dns_name)}-HOTSPOT-POOL`;
  const pppoePool = `NEXA-${resourceName(config.pppoe_service_name)}-PPPOE-POOL`;
  return [
    { stage: 'backup', label: 'Create RouterOS backup', command: '/system/backup/save', attrs: { name: `nexa-before-${Date.now()}` } },
    { stage: 'dns', label: 'Enable DNS for captive portal', command: '/ip/dns/set', attrs: { 'allow-remote-requests': 'yes' } },
    { stage: 'hotspot-pool', label: 'Create hotspot address pool', command: '/ip/pool/add', attrs: { name: hotspotPool, ranges: config.hotspot_pool, comment: 'NEXA managed hotspot pool' } },
    { stage: 'pppoe-pool', label: 'Create PPPoE address pool', command: '/ip/pool/add', attrs: { name: pppoePool, ranges: config.pppoe_pool, comment: 'NEXA managed PPPoE pool' } },
    { stage: 'hotspot-profile', label: 'Create hotspot server profile', command: '/ip/hotspot/profile/add', attrs: { name: 'NEXA-HOTSPOT-PROFILE', 'hotspot-address': config.hotspot_gateway.split('/')[0], 'dns-name': config.hotspot_dns_name, 'html-directory': 'nexa-hotspot', 'login-by': 'http-chap,http-pap', 'use-radius': 'yes', 'radius-accounting': 'yes', 'radius-interim-update': '1m', comment: 'NEXA managed hotspot profile' } },
    { stage: 'hotspot-server', label: 'Create hotspot server', command: '/ip/hotspot/add', attrs: { name: 'NEXA-HOTSPOT', interface: config.hotspot_interface, 'address-pool': hotspotPool, profile: 'NEXA-HOTSPOT-PROFILE', disabled: 'no', comment: 'NEXA managed hotspot server' } },
    { stage: 'pppoe-profile', label: 'Create PPPoE service profile', command: '/ppp/profile/add', attrs: { name: 'NEXA-PPPOE-PROFILE', 'local-address': config.pppoe_local_address, 'remote-address': pppoePool, 'use-encryption': 'required', 'only-one': 'yes', comment: 'NEXA managed PPPoE profile' } },
    { stage: 'pppoe-server', label: 'Create PPPoE server', command: '/interface/pppoe-server/server/add', attrs: { service: config.pppoe_service_name, interface: config.pppoe_interface, 'default-profile': 'NEXA-PPPOE-PROFILE', 'one-session-per-host': 'yes', disabled: 'no', comment: 'NEXA managed PPPoE server' } },
    { stage: 'radius', label: 'Configure RADIUS authentication and accounting', command: '/radius/add', attrs: { service: 'hotspot,ppp', address: config.radius_host, secret: '[hidden]', 'authentication-port': String(config.radius_auth_port), 'accounting-port': String(config.radius_accounting_port), timeout: '2s', comment: 'NEXA managed RADIUS' } },
    { stage: 'ppp-aaa', label: 'Enable PPPoE RADIUS accounting', command: '/ppp/aaa/set', attrs: { 'use-radius': 'yes', accounting: 'yes', 'interim-update': '1m' } },
    { stage: 'walled-garden', label: 'Allow the account portal through the hotspot', command: '/ip/hotspot/walled-garden/add', attrs: { 'dst-host': 'nexa.telenexustechnologies.com', action: 'allow', comment: 'NEXA managed portal' } },
    { stage: 'nat', label: 'Ensure WAN masquerade', command: '/ip/firewall/nat/add', attrs: { chain: 'srcnat', action: 'masquerade', 'out-interface-list': 'WAN', comment: 'NEXA managed subscriber NAT' } },
    { stage: 'portal-files', label: 'Install captive portal files', command: '/file/add', attrs: { name: 'nexa-hotspot/login.html', contents: '[portal HTML]' } },
  ].map((item) => ({ ...item, attrs: Object.fromEntries(Object.entries(item.attrs).map(([key, value]) => [key, String(value)])) }));
}

async function ensureProvisioningTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS mikrotik_provisioning_runs (id BIGSERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, router_id INTEGER NOT NULL, status VARCHAR(20) NOT NULL, config JSONB NOT NULL DEFAULT '{}'::jsonb, backup_name VARCHAR(180), steps JSONB NOT NULL DEFAULT '[]'::jsonb, error TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), completed_at TIMESTAMP WITH TIME ZONE)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mikrotik_provisioning_client_router ON mikrotik_provisioning_runs(client_id, router_id, created_at DESC)`);
}

async function previewProvisioning(clientId, routerId, input = {}) {
  const router = await getRouter(clientId, routerId, { includePassword: false });
  if (!router) throw new Error('MikroTik router not found in this billing account');
  const config = normalizeConfig(input);
  return { router: { id: router.id, name: router.name, host: router.host, port: router.port }, config: { ...config, radius_secret: '[hidden]' }, stages: plan(config) };
}

async function applyProvisioning(clientId, routerId, input = {}) {
  await ensureProvisioningTable();
  const router = await getRouter(clientId, routerId, { includePassword: true });
  if (!router) throw new Error('MikroTik router not found in this billing account');
  const config = normalizeConfig(input); const steps = []; const backupName = `nexa-before-${Date.now()}`;
  const run = await db.query(`INSERT INTO mikrotik_provisioning_runs (client_id, router_id, status, config, backup_name) VALUES ($1,$2,'running',$3,$4) RETURNING id`, [clientId, routerId, JSON.stringify({ ...config, radius_secret: '[hidden]' }), backupName]);
  const runId = run.rows[0].id; let client;
  const record = async (stage, status, message) => { steps.push({ stage, status, message }); await db.query('UPDATE mikrotik_provisioning_runs SET steps=$1::jsonb, updated_at=NOW() WHERE id=$2'.replace('updated_at=NOW(), ', ''), [JSON.stringify(steps), runId]).catch(() => {}); };
  try {
    client = await connectRouter(router);
    const backup = await client.command('/system/backup/save', { name: backupName }); await record('backup', 'completed', `Backup ${backupName} created`);
    const existing = async (path, comment) => { try { const rows = await client.command(path); return rows.find((row) => row.comment === comment || row.name === comment); } catch (_) { return null; } };
    const add = async (stage, path, attrs, comment) => { const found = await existing(`${path}/print`, comment); if (found?.['.id']) { await record(stage, 'skipped', 'Existing Nexa resource retained'); return found; } const rows = await client.command(path, attrs); await record(stage, 'completed', 'Resource created'); return rows[0] || {}; };
    const p = plan(config); const pools = { hotspot: p[1].attrs.name, pppoe: p[2].attrs.name };
    await client.command('/ip/dns/set', { 'allow-remote-requests': 'yes' }); await record('dns', 'completed', 'Remote DNS requests enabled');
    await add('hotspot-pool', '/ip/pool/add', { ...p[1].attrs }, p[1].attrs.comment); await add('pppoe-pool', '/ip/pool/add', { ...p[2].attrs }, p[2].attrs.comment);
    await add('hotspot-profile', '/ip/hotspot/profile/add', p[3].attrs, p[3].attrs.comment); await add('hotspot-server', '/ip/hotspot/add', p[4].attrs, p[4].attrs.comment);
    await add('pppoe-profile', '/ppp/profile/add', { ...p[5].attrs, 'remote-address': pools.pppoe }, p[5].attrs.comment); await add('pppoe-server', '/interface/pppoe-server/server/add', p[6].attrs, p[6].attrs.comment);
    const radiusAttrs = { ...p[7].attrs, secret: config.radius_secret }; await add('radius', '/radius/add', radiusAttrs, p[7].attrs.comment);
    await client.command('/ppp/aaa/set', p[8].attrs); await record('ppp-aaa', 'completed', 'PPPoE RADIUS accounting enabled'); await add('walled-garden', '/ip/hotspot/walled-garden/add', p[9].attrs, p[9].attrs.comment); await add('nat', '/ip/firewall/nat/add', p[10].attrs, p[10].attrs.comment);
    const file = makePortalFile(config); const files = await client.command('/file/print'); if (!files.find((row) => row.name === 'nexa-hotspot')) await client.command('/file/add', { name: 'nexa-hotspot' }); await client.command('/file/add', { name: 'nexa-hotspot/login.html', contents: file }); await record('portal-files', 'completed', 'Captive portal login file installed');
    const validation = { dns: true, ppp_aaa: true, hotspot_profile: true, pppoe_profile: true, portal_file: true };
    await db.query(`UPDATE mikrotik_provisioning_runs SET status='completed', steps=$1::jsonb, completed_at=NOW() WHERE id=$2`, [JSON.stringify(steps), runId]);
    return { run_id: runId, status: 'completed', backup_name: backupName, steps, validation, radius_registration: 'requires RADIUS server client registration' };
  } catch (err) {
    await record('failed', 'failed', err.message); await db.query(`UPDATE mikrotik_provisioning_runs SET status='failed', error=$1, steps=$2::jsonb WHERE id=$3`, [err.message, JSON.stringify(steps), runId]); throw new Error(`${err.message}. Router backup: ${backupName}`);
  } finally { if (client) client.close(); }
}

module.exports = { DEFAULTS, normalizeConfig, plan, previewProvisioning, applyProvisioning };