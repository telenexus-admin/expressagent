const crypto = require('crypto');
const db = require('../db');
const { recordBillingEvent } = require('./events');
const { createHotspotPortalToken } = require('./hotspotPortalToken');
const { connectRouter, decryptSecret } = require('./mikrotik');
const { ensureNetworkEnrollmentSchema, hashJson } = require('./networkEnrollment');
const { ensureNetworkExecutorSchema } = require('./networkExecutor');
const { probeRouterRadius, registerRouterNas, testRouterNasRegistration, unregisterRouterNas } = require('./radiusSync');

const EXECUTION_ENABLED = /^(1|true|yes)$/i.test(String(process.env.ROUTER_PROVISIONING_EXECUTION_ENABLED || 'false'));
const PLAN_MAX_AGE_HOURS = Math.max(1, Math.min(168, Number(process.env.ROUTER_PROVISIONING_PLAN_MAX_AGE_HOURS || 24)));
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS router_provisioning_runs(id UUID PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,enrollment_id UUID NOT NULL,plan_id UUID NOT NULL,router_id INTEGER NOT NULL,status VARCHAR(30) NOT NULL,requested_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),finished_at TIMESTAMPTZ,result JSONB NOT NULL DEFAULT '{}'::jsonb,error TEXT,rollback_status VARCHAR(30) NOT NULL DEFAULT 'not_required',UNIQUE(client_id,id),FOREIGN KEY(client_id,enrollment_id) REFERENCES router_enrollments(client_id,id) ON DELETE CASCADE,FOREIGN KEY(client_id,plan_id) REFERENCES router_provisioning_plans(client_id,id) ON DELETE CASCADE,FOREIGN KEY(client_id,router_id) REFERENCES mikrotik_routers(client_id,id) ON DELETE CASCADE)",
  "CREATE TABLE IF NOT EXISTS router_provisioning_steps(id BIGSERIAL PRIMARY KEY,run_id UUID NOT NULL,client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,sequence_no INTEGER NOT NULL,stage VARCHAR(80) NOT NULL,operation_path VARCHAR(180) NOT NULL,status VARCHAR(20) NOT NULL,request_data JSONB NOT NULL DEFAULT '{}'::jsonb,response_data JSONB NOT NULL DEFAULT '{}'::jsonb,error TEXT,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),finished_at TIMESTAMPTZ,UNIQUE(run_id,sequence_no),FOREIGN KEY(client_id,run_id) REFERENCES router_provisioning_runs(client_id,id) ON DELETE CASCADE)",
  "CREATE INDEX IF NOT EXISTS idx_router_provisioning_runs_tenant ON router_provisioning_runs(client_id,router_id,started_at DESC)",
].join(';') + ';';

let schemaReady = false;

function provisioningFeatureState() {
  return {
    phase: 4,
    execution_enabled: EXECUTION_ENABLED,
    automatic_execution: false,
    approval_required: true,
    plan_seal_required: true,
    dedicated_wireguard_executor_required: true,
    pre_activation_radius_probe: true,
    structured_rollback: true,
  };
}

function confirmationPhrase(planHash) {
  return 'EXECUTE ' + String(planHash || '').slice(0, 12).toUpperCase();
}

function redact(value, depth = 0) {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 3000) : value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = /pass|secret|token|contents|private.?key/i.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return output;
}

async function ensureSchema(queryable = db) {
  if (schemaReady && queryable === db) return;
  await ensureNetworkEnrollmentSchema(queryable);
  await ensureNetworkExecutorSchema(queryable);
  await queryable.query(SCHEMA);
  if (queryable === db) schemaReady = true;
}

function rowMatches(row, selector = {}) {
  return Object.entries(selector).every(([key, value]) => String(row?.[key] ?? '') === String(value));
}

function selectorFor(operation) {
  if (operation.selector) return operation.selector;
  const args = operation.args || {};
  if (args.name) return { name: args.name };
  if (args.comment) return { comment: args.comment };
  if (args.address && args.interface) return { address: args.address, interface: args.interface };
  if (args.address) return { address: args.address };
  if (args['dst-host']) return { 'dst-host': args['dst-host'] };
  return {};
}

function printPath(path) {
  return path.endsWith('/add') ? path.slice(0, -4) + '/print' : path;
}

function setPath(path) {
  return path.endsWith('/add') ? path.slice(0, -4) + '/set' : path;
}

function removePath(path) {
  return path.endsWith('/add') ? path.slice(0, -4) + '/remove' : path;
}

function portalContent(contentRef, clientId) {
  const base = String(process.env.FRONTEND_URL || 'https://nexa.telenexustechnologies.com').replace(/\/$/, '');
  const token = createHotspotPortalToken(clientId);
  const portal = base + '/hotspot?portalToken=' + encodeURIComponent(token);
  if (contentRef === 'tenant-hotspot-login') {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening Nexa Wi-Fi</title></head><body><p>Opening your internet packages...</p><script>var q=new URLSearchParams({mac:"$(mac)",ip:"$(ip)","link-login-only":"$(link-login-only)","link-orig":"$(link-orig)"});location.replace(' + JSON.stringify(portal) + '+\"&\"+q.toString());</script></body></html>';
  }
  if (contentRef === 'tenant-hotspot-status') {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title></head><body><h2>You are connected</h2><p>Address: $(ip)</p><p>Used: $(bytes-in-nice) / $(bytes-out-nice)</p><p>Remaining: $(session-time-left)</p><a href="$(link-logout)">Disconnect</a></body></html>';
  }
  if (contentRef === 'tenant-hotspot-logout') {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Disconnected</title></head><body><h2>You are disconnected</h2><a href="$(link-login)">Reconnect</a></body></html>';
  }
  throw new Error('Unknown captive portal content reference');
}

async function recordStep(queryable, run, sequence, operation, runner) {
  const inserted = await queryable.query(
    "INSERT INTO router_provisioning_steps(run_id,client_id,sequence_no,stage,operation_path,status,request_data)VALUES($1,$2,$3,$4,$5,'started',$6::jsonb)RETURNING id",
    [run.id, run.client_id, sequence, operation.stage || 'system', operation.path, JSON.stringify(redact(operation))]
  );
  try {
    const response = await runner();
    await queryable.query("UPDATE router_provisioning_steps SET status='succeeded',response_data=$2::jsonb,finished_at=NOW() WHERE id=$1",
      [inserted.rows[0].id, JSON.stringify(redact(response || {}))]);
    return response;
  } catch (error) {
    await queryable.query("UPDATE router_provisioning_steps SET status='failed',error=$2,finished_at=NOW() WHERE id=$1",
      [inserted.rows[0].id, String(error.message || error).slice(0, 3000)]);
    throw error;
  }
}

async function ensureManagedResource(client, operation, state) {
  const selector = selectorFor(operation);
  const rows = await client.command(printPath(operation.path));
  const existing = rows.find((row) => rowMatches(row, selector));
  if (existing) {
    const managed = String(existing.comment || '').startsWith('NEXA managed') ||
      String(existing.name || '').startsWith('NEXA-') || String(existing.name || '').startsWith('nexa-');
    if (!managed) throw new Error('Refusing to change an unmanaged RouterOS resource');
    const original = Object.fromEntries(Object.keys(operation.args || {}).filter((key) => existing[key] !== undefined).map((key) => [key, existing[key]]));
    state.updated.push({ path: setPath(operation.path), id: existing['.id'], args: original });
    const attrs = { ...operation.args, '.id': existing['.id'] };
    await client.command(setPath(operation.path), attrs);
    return { action: 'updated', id: existing['.id'] || null };
  }
  await client.command(operation.path, operation.args || {});
  const after = await client.command(printPath(operation.path));
  const created = after.find((row) => rowMatches(row, selector));
  if (!created?.['.id']) throw new Error('RouterOS did not confirm the managed resource');
  state.created.push({ path: removePath(operation.path), id: created['.id'] });
  return { action: 'created', id: created['.id'] };
}

async function executeRouterOperation(client, operation, context) {
  if (operation.path === 'nexa://snapshot/capture') {
    for (const path of operation.args.paths || []) context.snapshots[path] = await client.command(path);
    return { captured: Object.keys(context.snapshots).length };
  }
  if (operation.path === 'nexa://radius/register-nas') {
    const result = await context.radiusOps.registerRouterNas({
      clientId: context.run.client_id, routerId: context.run.router_id,
      nasIp: context.radius.nas_ip, nasIdentifier: context.radius.nas_identifier, secret: context.radius.secret,
    });
    context.radiusRegistered = true;
    return result;
  }
  if (operation.path === 'nexa://file/ensure-directory') {
    const rows = await client.command('/file/print');
    if (rows.some((row) => row.name === operation.args.name)) return { action: 'exists' };
    await client.command('/file/make-directory', { path: operation.args.name });
    const directory = (await client.command('/file/print')).find((row) => row.name === operation.args.name);
    if (directory?.['.id']) context.created.push({ path: '/file/remove', id: directory['.id'] });
    return { action: 'created' };
  }
  if (operation.path === 'nexa://file/write') {
    const rows = await client.command('/file/print');
    const existing = rows.find((row) => row.name === operation.args.name);
    const contents = portalContent(operation.args.content_ref, context.run.client_id);
    if (existing) {
      context.fileSnapshots.push({ id: existing['.id'], contents: existing.contents || '' });
      await client.command('/file/set', { '.id': existing['.id'], contents });
      return { action: 'updated', name: operation.args.name };
    }
    await client.command('/file/add', { name: operation.args.name, contents });
    const created = (await client.command('/file/print')).find((row) => row.name === operation.args.name);
    if (created?.['.id']) context.created.push({ path: '/file/remove', id: created['.id'] });
    return { action: 'created', name: operation.args.name };
  }
  const args = Object.fromEntries(Object.entries(operation.args || {}).map(([key, value]) => [key, typeof value === 'string' ? value.replace('{{run_id}}', context.run.id.slice(0, 8)) : value]));
  if (operation.secret_ref === 'router-radius-secret') args.secret = context.radius.secret;
  if (operation.path.endsWith('/add') && operation.ensure === 'managed') {
    return ensureManagedResource(client, { ...operation, args }, context);
  }
  if (operation.path.endsWith('/set') && operation.selector) {
    const rows = await client.command(operation.path.slice(0, -4) + '/print');
    const target = rows.find((row) => rowMatches(row, operation.selector));
    if (!target?.['.id']) throw new Error('Staged RouterOS resource was not found for activation');
    await client.command(operation.path, { ...args, '.id': target['.id'] });
    return { action: 'set', id: target['.id'] };
  }
  await client.command(operation.path, args);
  return { action: 'executed' };
}

async function preActivationCheck(client, context) {
  const identity = await client.command('/system/identity/print');
  if (!identity[0]?.name) throw new Error('Router management verification failed');
  let registration = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    registration = await context.radiusOps.testRouterNasRegistration({
      clientId: context.run.client_id, routerId: context.run.router_id, nasIp: context.radius.nas_ip,
    });
    if (registration.registered) break;
    if (registration.activation_status === 'failed') throw new Error(registration.error || 'FreeRADIUS NAS activation failed');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!registration?.registered) throw new Error('FreeRADIUS NAS registration verification timed out');
  const probe = await context.radiusOps.probeRouterRadius({
    clientId: context.run.client_id, routerId: context.run.router_id,
    host: context.radius.host, nasIp: context.radius.nas_ip,
    nasIdentifier: context.radius.nas_identifier, secret: context.radius.secret,
  });
  if (!probe.passed) throw new Error('RADIUS authentication/accounting probe failed');
  return { management: true, radius_registration: true, radius_probe: probe };
}

async function verifyApplied(client, plan) {
  const checks = [];
  for (const operation of plan.stages.flatMap((stage) => stage.operations)) {
    if (!operation.path.startsWith('/') || operation.path === '/system/backup/save' || operation.path === '/ip/dns/set' || operation.path === '/ppp/aaa/set') continue;
    if (operation.path.endsWith('/add')) {
      const rows = await client.command(printPath(operation.path));
      checks.push({ path: operation.path, present: rows.some((row) => rowMatches(row, selectorFor(operation))) });
    }
    if (operation.path === '/radius/incoming/set') {
      const incoming = (await client.command('/radius/incoming/print'))[0];
      checks.push({
        path: operation.path,
        present: String(incoming?.accept || '') === String(operation.args.accept)
          && String(incoming?.port || '') === String(operation.args.port),
      });
    }
  }
  const identity = await client.command('/system/identity/print');
  const passed = Boolean(identity[0]?.name) && checks.every((item) => item.present);
  return { passed, management: Boolean(identity[0]?.name), checks };
}

async function rollback(client, context) {
  const errors = [];
  for (const item of [...context.created].reverse()) {
    try { await client.command(item.path, { '.id': item.id }); } catch (error) { errors.push(error.message); }
  }
  for (const item of [...context.updated].reverse()) {
    try { await client.command(item.path, { ...item.args, '.id': item.id }); } catch (error) { errors.push(error.message); }
  }
  for (const file of context.fileSnapshots) {
    try { await client.command('/file/set', { '.id': file.id, contents: file.contents }); } catch (error) { errors.push(error.message); }
  }
  const dns = context.snapshots['/ip/dns/print']?.[0];
  if (dns) {
    try { await client.command('/ip/dns/set', { 'allow-remote-requests': dns['allow-remote-requests'], servers: dns.servers || '' }); } catch (error) { errors.push(error.message); }
  }
  const aaa = context.snapshots['/ppp/aaa/print']?.[0];
  if (aaa) {
    try { await client.command('/ppp/aaa/set', { 'use-radius': aaa['use-radius'], accounting: aaa.accounting, 'interim-update': aaa['interim-update'] }); } catch (error) { errors.push(error.message); }
  }
  const radiusIncoming = context.snapshots['/radius/incoming/print']?.[0];
  if (radiusIncoming) {
    try {
      await client.command('/radius/incoming/set', {
        accept: radiusIncoming.accept,
        port: radiusIncoming.port,
      });
    } catch (error) { errors.push(error.message); }
  }
  if (context.radiusRegistered) {
    try {
      await context.radiusOps.unregisterRouterNas({ clientId: context.run.client_id, routerId: context.run.router_id, nasIp: context.radius.nas_ip });
    } catch (error) { errors.push(error.message); }
  }
  return { passed: errors.length === 0, errors };
}

async function executeProvisioningPlan(clientId, enrollmentId, planId, input = {}, options = {}) {
  const queryable = options.queryable || db;
  await ensureSchema(queryable);
  const enabled = options.executionEnabled === true || (options.executionEnabled !== false && EXECUTION_ENABLED);
  if (!enabled) throw new Error('Router provisioning execution is disabled until lab validation is enabled');
  const loaded = await queryable.query(
    "SELECT p.*,e.status enrollment_status,r.host,r.port,r.connection_type,r.connection_method,c.username executor_username,c.password_encrypted executor_password,c.enabled executor_enabled,c.verification_status executor_status,rc.nas_identifier,rc.nas_ip,rc.shared_secret_encrypted FROM router_provisioning_plans p JOIN router_enrollments e ON e.client_id=p.client_id AND e.id=p.enrollment_id JOIN mikrotik_routers r ON r.client_id=p.client_id AND r.id=p.router_id LEFT JOIN network_router_executor_credentials c ON c.client_id=p.client_id AND c.router_id=p.router_id JOIN router_radius_credentials rc ON rc.client_id=p.client_id AND rc.router_id=p.router_id WHERE p.client_id=$1 AND p.enrollment_id=$2 AND p.id=$3 LIMIT 1",
    [clientId, enrollmentId, planId]
  );
  const row = loaded.rows[0];
  if (!row || row.status !== 'approved') throw new Error('An approved tenant provisioning plan is required');
  if (hashJson(row.plan) !== row.plan_hash) throw new Error('Provisioning plan seal mismatch');
  if (String(input.confirmation || '').trim().toUpperCase() !== confirmationPhrase(row.plan_hash)) {
    throw new Error('Confirmation phrase does not match the approved plan');
  }
  if (row.connection_method !== 'wireguard' || !row.executor_enabled || row.executor_status !== 'verified') {
    throw new Error('A verified dedicated WireGuard executor credential is required');
  }
  if ((Date.now() - new Date(row.approved_at).getTime()) / 3600000 > PLAN_MAX_AGE_HOURS) {
    throw new Error('The approved provisioning plan is stale and must be regenerated');
  }
  if (!row.plan.execution_ready) throw new Error('The provisioning plan has unresolved conflicts');
  const run = { id: crypto.randomUUID(), client_id: Number(clientId), enrollment_id: enrollmentId, plan_id: planId, router_id: row.router_id };
  await queryable.query("INSERT INTO router_provisioning_runs(id,client_id,enrollment_id,plan_id,router_id,status,requested_by)VALUES($1,$2,$3,$4,$5,'executing',$6)",
    [run.id, clientId, enrollmentId, planId, row.router_id, options.adminId || null]);
  const context = {
    run, snapshots: {}, created: [], updated: [], fileSnapshots: [], radiusRegistered: false,
    radiusOps: options.radiusOps || { probeRouterRadius, registerRouterNas, testRouterNasRegistration, unregisterRouterNas },
    radius: { host: process.env.RADIUS_WIREGUARD_HOST || '10.78.0.2', nas_identifier: row.nas_identifier,
      nas_ip: row.nas_ip, secret: decryptSecret(row.shared_secret_encrypted) },
  };
  const connect = options.connect || connectRouter;
  let routerClient; let sequence = 0; let changed = false;
  try {
    routerClient = await connect({ host: row.host, port: row.port, connection_type: row.connection_type,
      username: row.executor_username, password: decryptSecret(row.executor_password) });
    await recordStep(queryable, run, ++sequence, { stage: 'connectivity', path: '/system/identity/print' },
      () => routerClient.command('/system/identity/print'));
    for (const stage of row.plan.stages) {
      if (stage.name === 'activate_after_validation') {
        await recordStep(queryable, run, ++sequence, { stage: 'pre_activation', path: 'nexa://verify/radius' },
          () => preActivationCheck(routerClient, context));
      }
      for (const operation of stage.operations) {
        await recordStep(queryable, run, ++sequence, operation, () => executeRouterOperation(routerClient, operation, context));
        if (stage.name !== 'checkpoint') changed = true;
      }
    }
    const verification = await recordStep(queryable, run, ++sequence, { stage: 'verification', path: 'nexa://verify/config' },
      () => verifyApplied(routerClient, row.plan));
    if (!verification.passed) throw new Error('Post-provisioning RouterOS verification failed');
    await queryable.query("UPDATE router_provisioning_runs SET status='succeeded',finished_at=NOW(),result=$3::jsonb WHERE client_id=$1 AND id=$2",
      [clientId, run.id, JSON.stringify(redact({ verification }))]);
    await queryable.query("UPDATE router_provisioning_plans SET status='applied' WHERE client_id=$1 AND id=$2", [clientId, planId]);
    await queryable.query("UPDATE router_enrollments SET status='provisioned',updated_at=NOW() WHERE client_id=$1 AND id=$2", [clientId, enrollmentId]);
    await queryable.query("UPDATE router_radius_credentials SET registration_status='registered',registered_at=NOW(),last_error=NULL WHERE client_id=$1 AND router_id=$2", [clientId, row.router_id]);
    await recordBillingEvent({ clientId, eventType: 'router.billing_provisioned', category: 'router', source: 'router_provisioning_executor',
      entityType: 'router', entityId: row.router_id, title: 'MikroTik billing services provisioned',
      payload: { enrollment_id: enrollmentId, plan_id: planId, run_id: run.id, services: row.plan.desired_state },
      deduplicationKey: 'router-provisioning:' + run.id + ':succeeded', sensitivity: 'restricted' }).catch(() => {});
    return { id: run.id, status: 'succeeded', verification, ...provisioningFeatureState() };
  } catch (error) {
    let rollbackResult = { passed: true, errors: [] };
    if (changed && routerClient) rollbackResult = await rollback(routerClient, context);
    const status = changed ? (rollbackResult.passed ? 'rolled_back' : 'rollback_failed') : 'failed';
    await queryable.query("UPDATE router_provisioning_runs SET status=$3,finished_at=NOW(),rollback_status=$4,error=$5,result=$6::jsonb WHERE client_id=$1 AND id=$2",
      [clientId, run.id, status, changed ? (rollbackResult.passed ? 'succeeded' : 'failed') : 'not_required',
        String(error.message || error).slice(0, 4000), JSON.stringify(redact({ rollback: rollbackResult }))]);
    await queryable.query("UPDATE router_radius_credentials SET registration_status='failed',last_error=$3 WHERE client_id=$1 AND router_id=$2",
      [clientId, row.router_id, String(error.message || error).slice(0, 2000)]).catch(() => {});
    throw Object.assign(new Error(error.message), { run_id: run.id, status, rollback: rollbackResult });
  } finally {
    routerClient?.close?.();
  }
}

module.exports = {
  EXECUTION_ENABLED,
  SCHEMA,
  confirmationPhrase,
  ensureRouterProvisioningExecutorSchema: ensureSchema,
  executeProvisioningPlan,
  executeRouterOperation,
  portalContent,
  preActivationCheck,
  provisioningFeatureState,
  rollback,
  selectorFor,
  verifyApplied,
};
