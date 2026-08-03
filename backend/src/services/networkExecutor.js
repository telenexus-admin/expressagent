const crypto = require('crypto');
const os = require('os');
const db = require('../db');
const { appendBillingEvent, ensureEventSchema } = require('./events');
const { connectRouter, decryptSecret, encryptSecret, getRouter } = require('./mikrotik');
const {
  ensureNetworkAutomationSchema,
  validateOperation,
} = require('./networkAutomation');

const EXECUTION_ENABLED = /^(1|true|yes)$/i.test(String(process.env.NETWORK_EXECUTION_ENABLED || 'false'));
const EXECUTION_INTERVAL_MS = Math.max(5_000, Number(process.env.NETWORK_EXECUTION_INTERVAL_MS || 10_000));
const REQUEST_TTL_MINUTES = Math.max(5, Math.min(1440, Number(process.env.NETWORK_EXECUTION_REQUEST_TTL_MINUTES || 60)));
const LEASE_SECONDS = Math.max(30, Math.min(600, Number(process.env.NETWORK_EXECUTION_LEASE_SECONDS || 120)));
const PLAN_MAX_AGE_HOURS = Math.max(1, Math.min(168, Number(process.env.NETWORK_EXECUTION_PLAN_MAX_AGE_HOURS || 24)));
const WORKER_ID = `${os.hostname()}:${process.pid}:network-executor`;
const ACTIVE_STATUSES = ['pending_approval', 'ready', 'executing', 'verifying', 'rolling_back'];
const TERMINAL_STATUSES = ['succeeded', 'verification_failed', 'rolled_back', 'rollback_failed', 'failed', 'denied', 'cancelled', 'expired', 'blocked'];

const ACTION_SUPPORT = Object.freeze({
  diagnose_router_health: { supported: true },
  diagnose_uplink: { supported: true },
  diagnose_radius_access: { supported: true },
  diagnose_security_exposure: { supported: true },
  diagnose_resource_pressure: { supported: true },
  restart_interface: { supported: true },
  disconnect_pppoe_session: { supported: true, irreversible: true },
  flush_dns_cache: { supported: true, irreversible: true },
  quarantine_source_ip: { supported: true },
  restart_wireguard_peer: { supported: true },
  enable_ppp_radius: { supported: true },
  enable_hotspot_radius: { supported: true },
  set_simple_queue_limit: { supported: true },
  update_radius_endpoint: { supported: false, reason: 'Tenant secret-vault resolution is not enabled yet.' },
  change_default_route: { supported: false, reason: 'An independent out-of-band rollback watchdog is required before route changes can execute.' },
});

const NETWORK_EXECUTOR_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS network_router_executor_credentials (
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL,
    username VARCHAR(120) NOT NULL,
    password_encrypted TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    verification_status VARCHAR(24) NOT NULL DEFAULT 'unverified'
      CHECK (verification_status IN ('unverified','verified','failed','disabled')),
    last_tested_at TIMESTAMPTZ,
    last_error TEXT,
    created_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id,router_id),
    FOREIGN KEY (client_id,router_id) REFERENCES mikrotik_routers(client_id,id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_execution_requests (
    id UUID PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL,
    router_id INTEGER NOT NULL,
    action_type VARCHAR(100) NOT NULL,
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
    status VARCHAR(30) NOT NULL DEFAULT 'pending_approval'
      CHECK (status IN ('pending_approval','ready','executing','verifying','succeeded',
        'verification_failed','rolling_back','rolled_back','rollback_failed','failed',
        'denied','cancelled','expired','blocked')),
    plan_seal VARCHAR(64) NOT NULL,
    approvals_required INTEGER NOT NULL CHECK (approvals_required BETWEEN 1 AND 2),
    approvals_received INTEGER NOT NULL DEFAULT 0 CHECK (approvals_received BETWEEN 0 AND 2),
    irreversible_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    idempotency_key VARCHAR(160) NOT NULL,
    requested_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    maintenance_window_start TIMESTAMPTZ,
    maintenance_window_end TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    lease_owner VARCHAR(255),
    lease_expires_at TIMESTAMPTZ,
    backup_name VARCHAR(180),
    verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    rollback_status VARCHAR(30) NOT NULL DEFAULT 'not_required',
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id,idempotency_key),
    UNIQUE (client_id,id),
    FOREIGN KEY (client_id,plan_id) REFERENCES network_action_plans(client_id,id) ON DELETE CASCADE,
    FOREIGN KEY (client_id,router_id) REFERENCES mikrotik_routers(client_id,id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_execution_approvals (
    id UUID PRIMARY KEY,
    request_id UUID NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved','rejected')),
    reason TEXT,
    decided_by INTEGER NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id,decided_by),
    FOREIGN KEY (client_id,request_id) REFERENCES network_execution_requests(client_id,id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_execution_steps (
    id BIGSERIAL PRIMARY KEY,
    request_id UUID NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    sequence_no INTEGER NOT NULL,
    phase VARCHAR(24) NOT NULL CHECK (phase IN ('backup','inspect','change','verify','rollback','connectivity')),
    operation_path VARCHAR(180) NOT NULL,
    description TEXT,
    status VARCHAR(24) NOT NULL CHECK (status IN ('started','succeeded','failed')),
    request_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    UNIQUE (request_id,sequence_no),
    FOREIGN KEY (client_id,request_id) REFERENCES network_execution_requests(client_id,id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_network_execution_requests_tenant_id
    ON network_execution_requests(client_id,id);
  CREATE INDEX IF NOT EXISTS idx_network_execution_requests_tenant_status
    ON network_execution_requests(client_id,status,created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_network_execution_one_active_router
    ON network_execution_requests(client_id,router_id)
    WHERE status IN ('executing','verifying','rolling_back');
  CREATE INDEX IF NOT EXISTS idx_network_execution_approvals_tenant
    ON network_execution_approvals(client_id,request_id,created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_network_execution_steps_tenant
    ON network_execution_steps(client_id,request_id,sequence_no ASC);
`;

let schemaReady = false;
let schedulerStarted = false;
let schedulerBusy = false;

function cleanText(value, maxLength = 255) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function eventSeverity(risk) {
  if (risk === 'critical') return 'critical';
  if (risk === 'high') return 'warning';
  return 'info';
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function planSeal(plan) {
  const sealed = canonical({
    id: plan.id,
    client_id: plan.client_id,
    router_id: plan.router_id,
    action_type: plan.action_type,
    action_version: plan.action_version,
    risk_level: plan.risk_level,
    parameters: plan.parameters || {},
    command_preview: plan.command_preview || [],
    rollback_preview: plan.rollback_preview || [],
    verification: plan.verification || [],
    plan_fingerprint: plan.plan_fingerprint,
  });
  return crypto.createHash('sha256').update(JSON.stringify(sealed)).digest('hex');
}

function approvalPolicy(plan) {
  const requested = Number(plan.future_approval?.approvals || 0);
  return {
    approvals_required: plan.risk_level === 'critical' ? 2 : Math.max(1, Math.min(2, requested || 1)),
    maintenance_window_required: Boolean(plan.future_approval?.maintenance_window),
    requester_may_approve: plan.risk_level !== 'critical',
  };
}

function actionSupport(actionType) {
  return ACTION_SUPPORT[actionType] || { supported: false, reason: 'This action has no reviewed Phase 3 executor.' };
}

function executionFeatureState() {
  return {
    phase: 3,
    execution_enabled: EXECUTION_ENABLED,
    automatic_execution: EXECUTION_ENABLED,
    approval_required: true,
    dedicated_credentials_required: true,
    worker_id: WORKER_ID,
  };
}

function redact(value, depth = 0) {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 2000) : value;
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/pass|secret|token|private.?key|auth|credential/i.test(key)) output[key] = '[redacted]';
    else output[key] = redact(item, depth + 1);
  }
  return output;
}

function normalizeIdempotencyKey(value, planId, adminId) {
  const text = cleanText(value, 160);
  if (text && !/^[a-zA-Z0-9_.:-]{8,160}$/.test(text)) throw new Error('Invalid idempotency key');
  return text || `plan:${planId}:requester:${adminId || 'system'}:${crypto.randomUUID()}`;
}

function parseWindow(start, end, required) {
  if (!start && !end && !required) return { start: null, end: null };
  if (!start || !end) throw new Error('Both maintenance_window_start and maintenance_window_end are required');
  const from = new Date(start); const to = new Date(end);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new Error('Invalid maintenance window');
  if ((to.getTime() - from.getTime()) > 4 * 60 * 60 * 1000) throw new Error('Maintenance window cannot exceed four hours');
  return { start: from, end: to };
}

async function ensureNetworkExecutorSchema(queryable = db) {
  if (schemaReady) return;
  if (queryable === db) {
    await ensureNetworkAutomationSchema();
    await ensureEventSchema();
  }
  await queryable.query(NETWORK_EXECUTOR_SCHEMA_SQL);
  if (queryable === db) schemaReady = true;
}

async function setRouterExecutorCredential(clientId, routerId, input = {}, options = {}) {
  const queryable = options.queryable || db;
  await ensureNetworkExecutorSchema(queryable);
  const username = cleanText(input.username, 120);
  const password = String(input.password || '');
  if (!username || !/^[a-zA-Z0-9_.@-]{3,120}$/.test(username)) throw new Error('A safe executor username is required');
  if (password.length < 16 || password.length > 240) throw new Error('Executor password must be between 16 and 240 characters');
  const router = await queryable.query('SELECT id FROM mikrotik_routers WHERE client_id=$1 AND id=$2 LIMIT 1', [clientId, routerId]);
  if (!router.rows[0]) throw new Error('Tenant router not found');
  const result = await queryable.query(
    `INSERT INTO network_router_executor_credentials
       (client_id,router_id,username,password_encrypted,enabled,verification_status,created_by)
     VALUES ($1,$2,$3,$4,FALSE,'unverified',$5)
     ON CONFLICT (client_id,router_id) DO UPDATE SET
       username=EXCLUDED.username,password_encrypted=EXCLUDED.password_encrypted,
       enabled=FALSE,verification_status='unverified',last_error=NULL,updated_at=NOW()
     RETURNING client_id,router_id,username,enabled,verification_status,last_tested_at,last_error,created_at,updated_at`,
    [clientId, routerId, username, encryptSecret(password), options.adminId || null]
  );
  return result.rows[0];
}

async function getExecutorCredentialStatus(clientId, routerId, queryable = db) {
  await ensureNetworkExecutorSchema(queryable);
  const result = await queryable.query(
    `SELECT client_id,router_id,username,enabled,verification_status,last_tested_at,last_error,created_at,updated_at
     FROM network_router_executor_credentials WHERE client_id=$1 AND router_id=$2 LIMIT 1`, [clientId, routerId]);
  return result.rows[0] || null;
}

async function testRouterExecutorCredential(clientId, routerId, options = {}) {
  const queryable = options.queryable || db;
  await ensureNetworkExecutorSchema(queryable);
  const result = await queryable.query(
    `SELECT credential.*,router.host,router.port,router.connection_type,router.connection_method
     FROM network_router_executor_credentials credential
     JOIN mikrotik_routers router ON router.client_id=credential.client_id AND router.id=credential.router_id
     WHERE credential.client_id=$1 AND credential.router_id=$2 LIMIT 1`, [clientId, routerId]);
  const credential = result.rows[0];
  if (!credential) throw new Error('Executor credentials are not configured');
  if (credential.connection_method !== 'wireguard') throw new Error('Write execution is allowed only through the private WireGuard management plane');
  const connect = options.connect || connectRouter;
  let client;
  try {
    client = await connect({ host: credential.host, port: credential.port, connection_type: credential.connection_type,
      username: credential.username, password: decryptSecret(credential.password_encrypted) });
    const identity = await client.command('/system/identity/print');
    await queryable.query(
      `UPDATE network_router_executor_credentials SET enabled=TRUE,verification_status='verified',
       last_tested_at=NOW(),last_error=NULL,updated_at=NOW() WHERE client_id=$1 AND router_id=$2`, [clientId, routerId]);
    return { ok: true, enabled: true, verification_status: 'verified', identity: cleanText(identity[0]?.name, 180) || null };
  } catch (error) {
    await queryable.query(
      `UPDATE network_router_executor_credentials SET enabled=FALSE,verification_status='failed',
       last_tested_at=NOW(),last_error=$3,updated_at=NOW() WHERE client_id=$1 AND router_id=$2`,
      [clientId, routerId, cleanText(error.message, 1000)]);
    throw error;
  } finally { client?.close?.(); }
}

async function loadPlanForExecution(queryable, clientId, planId) {
  const result = await queryable.query(
    `SELECT plan.*,router.name router_name,router.is_active,router.connection_method
     FROM network_action_plans plan
     JOIN mikrotik_routers router ON router.client_id=plan.client_id AND router.id=plan.router_id
     WHERE plan.client_id=$1 AND plan.id=$2 LIMIT 1`, [clientId, planId]);
  return result.rows[0] || null;
}

async function createExecutionRequest(clientId, planId, input = {}, options = {}) {
  await ensureNetworkExecutorSchema(options.queryable || db);
  const external = options.queryable || null; const queryable = external || await db.connect();
  try {
    if (!external) await queryable.query('BEGIN');
    const plan = await loadPlanForExecution(queryable, clientId, planId);
    if (!plan) throw new Error('Tenant shadow plan not found');
    if (plan.review_status !== 'confirmed') throw new Error('The shadow plan must pass technical review before execution can be requested');
    if (!plan.is_active) throw new Error('The assigned router is inactive');
    if (plan.connection_method !== 'wireguard') throw new Error('Write execution requires the private WireGuard management plane');
    const ageHours = (Date.now() - new Date(plan.last_refreshed_at).getTime()) / 3600000;
    if (!Number.isFinite(ageHours) || ageHours > PLAN_MAX_AGE_HOURS) throw new Error('The shadow plan is stale and must be regenerated');
    const support = actionSupport(plan.action_type);
    if (!support.supported) throw new Error(support.reason);
    if (support.irreversible && input.irreversible_acknowledged !== true) {
      throw new Error('This action has no direct rollback; irreversible_acknowledged must be true');
    }
    const credential = await queryable.query(
      `SELECT enabled,verification_status FROM network_router_executor_credentials
       WHERE client_id=$1 AND router_id=$2 LIMIT 1`, [clientId, plan.router_id]);
    if (!credential.rows[0] || !credential.rows[0].enabled || credential.rows[0].verification_status !== 'verified') {
      throw new Error('A verified dedicated executor credential is required for this router');
    }
    const policy = approvalPolicy(plan);
    const window = parseWindow(input.maintenance_window_start, input.maintenance_window_end, policy.maintenance_window_required);
    const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey || input.idempotency_key, plan.id, options.adminId);
    const id = crypto.randomUUID();
    const inserted = await queryable.query(
      `INSERT INTO network_execution_requests
       (id,client_id,plan_id,router_id,action_type,risk_level,plan_seal,approvals_required,
        irreversible_acknowledged,idempotency_key,requested_by,expires_at,
        maintenance_window_start,maintenance_window_end,rollback_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()+($12::text || ' minutes')::interval,$13,$14,$15)
       ON CONFLICT (client_id,idempotency_key) DO NOTHING RETURNING *`,
      [id, clientId, plan.id, plan.router_id, plan.action_type, plan.risk_level, planSeal(plan),
        policy.approvals_required, Boolean(input.irreversible_acknowledged), idempotencyKey,
        options.adminId || null, String(REQUEST_TTL_MINUTES), window.start, window.end,
        (plan.rollback_preview || []).length ? 'pending' : 'not_available']
    );
    let request = inserted.rows[0];
    if (!request) {
      const existing = await queryable.query('SELECT * FROM network_execution_requests WHERE client_id=$1 AND idempotency_key=$2 LIMIT 1', [clientId, idempotencyKey]);
      request = existing.rows[0];
    } else {
      await appendBillingEvent(queryable, {
        clientId, eventType: 'network.execution_requested', category: 'network', source: 'network_executor',
        entityType: 'router', entityId: plan.router_id, severity: eventSeverity(plan.risk_level),
        title: `Execution requested: ${plan.title}`,
        description: `Approval-gated execution request ${id} was created. No RouterOS command was executed.`,
        payload: { request_id: id, plan_id: plan.id, action_type: plan.action_type,
          approvals_required: policy.approvals_required, execution_enabled: EXECUTION_ENABLED, commands_executed: 0 },
        relatedEntities: [{ entityType: 'network_action_plan', entityId: plan.id, relationship: 'execution_request' }],
        deduplicationKey: `network-execution-request:${id}`, sensitivity: 'restricted',
      });
    }
    if (!external) await queryable.query('COMMIT');
    return { ...request, execution_enabled: EXECUTION_ENABLED, commands_executed: 0 };
  } catch (error) {
    if (!external) try { await queryable.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { if (!external) queryable.release(); }
}

async function decideExecutionRequest(clientId, requestId, decision, options = {}) {
  await ensureNetworkExecutorSchema(options.queryable || db);
  const normalized = cleanText(decision, 20).toLowerCase();
  if (!['approved', 'rejected'].includes(normalized)) throw new Error('Decision must be approved or rejected');
  if (!options.adminId) throw new Error('An authenticated administrator is required');
  const external = options.queryable || null; const queryable = external || await db.connect();
  try {
    if (!external) await queryable.query('BEGIN');
    const admin = await queryable.query(
      `SELECT id,role,client_id FROM admins WHERE id=$1 AND (client_id=$2 OR role='superadmin') LIMIT 1`,
      [options.adminId, clientId]);
    if (!admin.rows[0]) throw new Error('Administrator does not belong to this billing account');
    const requestResult = await queryable.query(
      `SELECT request.*,plan.future_approval FROM network_execution_requests request
       JOIN network_action_plans plan ON plan.client_id=request.client_id AND plan.id=request.plan_id
       WHERE request.client_id=$1 AND request.id=$2 FOR UPDATE`, [clientId, requestId]);
    const request = requestResult.rows[0];
    if (!request) return null;
    if (!['pending_approval', 'ready'].includes(request.status)) throw new Error(`Request cannot be decided while ${request.status}`);
    if (new Date(request.expires_at) <= new Date()) {
      await queryable.query(`UPDATE network_execution_requests SET status='expired',updated_at=NOW() WHERE client_id=$1 AND id=$2`, [clientId, requestId]);
      throw new Error('Execution request expired');
    }
    if (request.risk_level === 'critical' && Number(request.requested_by) === Number(options.adminId)) {
      throw new Error('The requester cannot approve their own critical-risk execution');
    }
    const priorDecision = await queryable.query(
      'SELECT id FROM network_execution_approvals WHERE client_id=$1 AND request_id=$2 AND decided_by=$3 LIMIT 1',
      [clientId, requestId, options.adminId]);
    if (priorDecision.rows[0]) throw new Error('Administrator already decided this execution request');
    await queryable.query(
      `INSERT INTO network_execution_approvals (id,request_id,client_id,decision,reason,decided_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), requestId, clientId, normalized, cleanText(options.reason, 2000) || null, options.adminId]);
    const counts = await queryable.query(
      `SELECT COUNT(*) FILTER (WHERE decision='approved')::int approved,
              COUNT(*) FILTER (WHERE decision='rejected')::int rejected
       FROM network_execution_approvals WHERE client_id=$1 AND request_id=$2`, [clientId, requestId]);
    const denied = counts.rows[0].rejected > 0;
    const ready = !denied && counts.rows[0].approved >= request.approvals_required;
    const updated = await queryable.query(
      `UPDATE network_execution_requests SET approvals_received=$3,status=$4::varchar,
       approved_at=CASE WHEN $4::text='ready' THEN NOW() ELSE approved_at END,updated_at=NOW()
       WHERE client_id=$1 AND id=$2 RETURNING *`,
      [clientId, requestId, counts.rows[0].approved, denied ? 'denied' : ready ? 'ready' : 'pending_approval']);
    await appendBillingEvent(queryable, {
      clientId, eventType: `network.execution_${normalized}`, category: 'network', source: 'network_executor',
      entityType: 'router', entityId: request.router_id, severity: eventSeverity(request.risk_level),
      title: `Network execution ${normalized}`,
      description: `Administrator decision recorded for request ${requestId}. No command was executed by this decision.`,
      payload: { request_id: requestId, decision: normalized, approvals_received: counts.rows[0].approved,
        approvals_required: request.approvals_required, status: updated.rows[0].status, commands_executed: 0 },
      relatedEntities: [{ entityType: 'network_execution_request', entityId: requestId, relationship: 'approval' }],
      deduplicationKey: `network-execution-decision:${requestId}:${options.adminId}`, sensitivity: 'restricted',
    });
    if (!external) await queryable.query('COMMIT');
    return { ...updated.rows[0], execution_enabled: EXECUTION_ENABLED, commands_executed: 0 };
  } catch (error) {
    if (!external) try { await queryable.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { if (!external) queryable.release(); }
}

function selectorPrintPath(path) {
  const suffix = path.match(/\/(disable|enable|set|remove)$/)?.[1];
  return suffix ? `${path.slice(0, -(suffix.length + 1))}/print` : path;
}

function rowMatches(row, selector = {}) {
  return Object.entries(selector).every(([key, expected]) => {
    if (key === 'id') return String(row['.id'] || '') === String(expected);
    if (key === 'comment_or_id') return String(row.comment || '') === String(expected) || String(row['.id'] || '') === String(expected);
    return String(row[key] ?? '') === String(expected);
  });
}

async function resolveTarget(client, operation) {
  if (!operation.selector) return { attrs: { ...(operation.args || {}) }, rows: null };
  if (operation.selector.id && String(operation.selector.id).startsWith('*')) {
    return { attrs: { '.id': operation.selector.id, ...(operation.args || {}) }, rows: null };
  }
  const printPath = selectorPrintPath(operation.path);
  const rows = await client.command(printPath);
  const matches = rows.filter((row) => rowMatches(row, operation.selector));
  if (matches.length !== 1 || !matches[0]['.id']) throw new Error(`Expected exactly one RouterOS target for ${operation.path}; found ${matches.length}`);
  return { attrs: { '.id': matches[0]['.id'], ...(operation.args || {}) }, rows: matches };
}

function snapshotValue(expression, snapshots) {
  const match = expression.match(/^\{\{snapshot\.([a-z_]+)\.([^}]+)\}\}$/);
  if (!match) return expression;
  const [, group, field] = match;
  const paths = {
    ppp_aaa: '/ppp/aaa/print', hotspot_profile: '/ip/hotspot/profile/print',
    queue: '/queue/simple/print', route: '/ip/route/print',
  };
  const row = snapshots[paths[group]]?.[0];
  if (!row || row[field] === undefined) throw new Error(`Rollback snapshot value missing: ${group}.${field}`);
  return row[field];
}

function resolveSnapshotArgs(args = {}, snapshots = {}) {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key,
    typeof value === 'string' ? snapshotValue(value, snapshots) : value]));
}

async function recordStep(queryable, request, sequence, phase, operationPath, description, requestData, runner) {
  await queryable.query(
    `UPDATE network_execution_requests SET lease_expires_at=NOW()+($3::text || ' seconds')::interval,updated_at=NOW()
     WHERE client_id=$1 AND id=$2 AND status IN ('executing','verifying','rolling_back')`,
    [request.client_id, request.id, String(LEASE_SECONDS)]
  );
  const inserted = await queryable.query(
    `INSERT INTO network_execution_steps
       (request_id,client_id,sequence_no,phase,operation_path,description,status,request_data)
     VALUES ($1,$2,$3,$4,$5,$6,'started',$7::jsonb) RETURNING id`,
    [request.id, request.client_id, sequence, phase, operationPath, cleanText(description, 2000) || null,
      JSON.stringify(redact(requestData || {}))]);
  try {
    const response = await runner();
    await queryable.query(
      `UPDATE network_execution_steps SET status='succeeded',response_data=$2::jsonb,finished_at=NOW() WHERE id=$1`,
      [inserted.rows[0].id, JSON.stringify(redact(response || {}))]);
    return response;
  } catch (error) {
    await queryable.query(
      `UPDATE network_execution_steps SET status='failed',error=$2,finished_at=NOW() WHERE id=$1`,
      [inserted.rows[0].id, cleanText(error.message, 2000)]);
    throw error;
  }
}

async function executeStructuredOperation(client, operation, snapshots) {
  validateOperation(operation);
  if (operation.phase === 'inspect') {
    const rows = await client.command(operation.path, operation.args || {});
    const selected = operation.selector ? rows.filter((row) => rowMatches(row, operation.selector)) : rows;
    snapshots[operation.path] = selected;
    return selected;
  }
  const resolved = await resolveTarget(client, operation);
  const attrs = resolveSnapshotArgs(resolved.attrs, snapshots);
  return client.command(operation.path, attrs);
}

async function selectRows(client, path, selector) {
  const rows = await client.command(path);
  return selector ? rows.filter((row) => rowMatches(row, selector)) : rows;
}

function yes(value) { return value === true || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'yes'; }
function no(value) { return value === false || String(value).toLowerCase() === 'false' || String(value).toLowerCase() === 'no'; }

async function verifyRepair(client, plan) {
  const checks = [];
  const check = (name, passed, evidence = {}) => checks.push({ name, passed: Boolean(passed), evidence: redact(evidence) });
  const p = plan.parameters || {};
  if (plan.action_type === 'restart_interface') {
    const rows = await selectRows(client, '/interface/print', { name: p.interface }); const row = rows[0] || {};
    check('interface_enabled', rows.length === 1 && no(row.disabled), row);
    check('interface_running', rows.length === 1 && yes(row.running), row);
  } else if (plan.action_type === 'disconnect_pppoe_session') {
    const rows = await selectRows(client, '/ppp/active/print', { name: p.username });
    check('old_session_absent', rows.length === 0, { active_matches: rows.length });
  } else if (plan.action_type === 'flush_dns_cache') {
    const rows = await client.command('/ip/dns/print');
    check('dns_service_responds', Array.isArray(rows), { rows: rows.length });
  } else if (plan.action_type === 'quarantine_source_ip') {
    const rows = await selectRows(client, '/ip/firewall/address-list/print', { list: 'nexa-quarantine', address: p.source_ip });
    check('quarantine_present', rows.length === 1, { matches: rows.length });
  } else if (plan.action_type === 'restart_wireguard_peer') {
    const rows = await selectRows(client, '/interface/wireguard/peers/print', { comment_or_id: p.peer }); const row = rows[0] || {};
    check('wireguard_peer_enabled', rows.length === 1 && no(row.disabled), row);
  } else if (plan.action_type === 'enable_ppp_radius') {
    const row = (await client.command('/ppp/aaa/print'))[0] || {};
    check('ppp_radius_enabled', yes(row['use-radius']), row);
    check('ppp_accounting_enabled', yes(row.accounting), row);
  } else if (plan.action_type === 'enable_hotspot_radius') {
    const rows = await selectRows(client, '/ip/hotspot/profile/print', { name: p.profile }); const row = rows[0] || {};
    check('hotspot_radius_enabled', rows.length === 1 && yes(row['use-radius']), row);
  } else if (plan.action_type === 'set_simple_queue_limit') {
    const rows = await selectRows(client, '/queue/simple/print', { name: p.queue }); const row = rows[0] || {};
    check('queue_limit_applied', rows.length === 1 && String(row['max-limit']) === String(p.max_limit), row);
  } else {
    check('diagnostic_commands_completed', true, { action_type: plan.action_type });
  }
  const identity = await client.command('/system/identity/print');
  check('management_connectivity', Boolean(identity[0]?.name), { identity: identity[0]?.name || null });
  return { passed: checks.every((item) => item.passed), checks };
}

async function claimExecutionRequest(requestId, options = {}) {
  const queryable = options.queryable || db;
  await ensureNetworkExecutorSchema(queryable);
  const result = await queryable.query(
    `UPDATE network_execution_requests request SET status='executing',started_at=COALESCE(started_at,NOW()),
       lease_owner=$3,lease_expires_at=NOW()+($4::text || ' seconds')::interval,updated_at=NOW()
     FROM network_action_plans plan
     WHERE request.client_id=$1 AND request.id=$2 AND request.status='ready'
       AND request.expires_at>NOW() AND request.plan_id=plan.id AND request.client_id=plan.client_id
       AND plan.review_status='confirmed'
       AND (request.maintenance_window_start IS NULL OR NOW() BETWEEN request.maintenance_window_start AND request.maintenance_window_end)
     RETURNING request.*`, [options.clientId, requestId, options.workerId || WORKER_ID, String(LEASE_SECONDS)]);
  return result.rows[0] || null;
}

async function finalizeRequest(queryable, request, status, data = {}) {
  const result = await queryable.query(
    `UPDATE network_execution_requests SET status=$3,verification_status=$4,rollback_status=$5,
       result=$6::jsonb,error=$7,finished_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW()
     WHERE client_id=$1 AND id=$2 RETURNING *`,
    [request.client_id, request.id, status, data.verificationStatus || 'pending', data.rollbackStatus || 'not_required',
      JSON.stringify(redact(data.result || {})), cleanText(data.error, 4000) || null]);
  return result.rows[0];
}

async function executeApprovedRequest(clientId, requestId, options = {}) {
  await ensureNetworkExecutorSchema(options.queryable || db);
  const enabled = options.executionEnabled === true || (options.executionEnabled !== false && EXECUTION_ENABLED);
  if (!enabled) throw new Error('Network execution is disabled by deployment policy');
  const queryable = options.queryable || db;
  const request = await claimExecutionRequest(requestId, { queryable, clientId, workerId: options.workerId });
  if (!request) throw new Error('Execution request is not ready, is expired, outside its maintenance window, or already claimed');
  const plan = await loadPlanForExecution(queryable, clientId, request.plan_id);
  if (!plan || planSeal(plan) !== request.plan_seal) {
    return finalizeRequest(queryable, request, 'blocked', { error: 'Plan seal mismatch; execution blocked', verificationStatus: 'blocked', rollbackStatus: 'not_required' });
  }
  const support = actionSupport(plan.action_type);
  if (!support.supported) return finalizeRequest(queryable, request, 'blocked', { error: support.reason, verificationStatus: 'blocked' });
  const credentialResult = await queryable.query(
    `SELECT credential.*,router.host,router.port,router.connection_type,router.connection_method
     FROM network_router_executor_credentials credential
     JOIN mikrotik_routers router ON router.client_id=credential.client_id AND router.id=credential.router_id
     WHERE credential.client_id=$1 AND credential.router_id=$2 AND credential.enabled=TRUE
       AND credential.verification_status='verified' LIMIT 1`, [clientId, request.router_id]);
  const credential = credentialResult.rows[0];
  if (!credential || credential.connection_method !== 'wireguard') {
    return finalizeRequest(queryable, request, 'blocked', { error: 'Verified WireGuard executor credential is unavailable', verificationStatus: 'blocked' });
  }
  const connect = options.connect || connectRouter;
  let client; let sequence = 0; let mutated = false; const snapshots = {}; const commandResults = [];
  const next = () => { sequence += 1; return sequence; };
  try {
    client = await connect({ host: credential.host, port: credential.port, connection_type: credential.connection_type,
      username: credential.username, password: decryptSecret(credential.password_encrypted) });
    await recordStep(queryable, request, next(), 'connectivity', '/system/identity/print', 'Confirm dedicated executor connectivity', {},
      () => client.command('/system/identity/print'));
    if ((plan.command_preview || []).some((item) => item.phase === 'change')) {
      const backupName = `nexa-exec-${request.id.slice(0, 8)}-${Date.now()}`;
      await recordStep(queryable, request, next(), 'backup', '/system/backup/save', 'Create pre-change RouterOS backup', { name: backupName },
        () => client.command('/system/backup/save', { name: backupName }));
      request.backup_name = backupName;
      await queryable.query('UPDATE network_execution_requests SET backup_name=$3,updated_at=NOW() WHERE client_id=$1 AND id=$2', [clientId, request.id, backupName]);
    }
    for (const operation of plan.command_preview || []) {
      const response = await recordStep(queryable, request, next(), operation.phase, operation.path, operation.description,
        { args: operation.args || {}, selector: operation.selector || null },
        () => executeStructuredOperation(client, operation, snapshots));
      commandResults.push({ path: operation.path, phase: operation.phase, rows: Array.isArray(response) ? response.length : 0 });
      if (operation.phase === 'change') mutated = true;
    }
    await queryable.query(`UPDATE network_execution_requests SET status='verifying',updated_at=NOW() WHERE client_id=$1 AND id=$2`, [clientId, request.id]);
    const verification = await recordStep(queryable, request, next(), 'verify', '/nexa/verify', 'Verify that service was restored', {},
      () => verifyRepair(client, plan));
    if (!verification.passed) {
      const error = new Error('Post-change verification failed'); error.verification = verification; throw error;
    }
    const completed = await finalizeRequest(queryable, request, 'succeeded', {
      verificationStatus: 'passed', rollbackStatus: (plan.rollback_preview || []).length ? 'not_needed' : 'not_available',
      result: { command_results: commandResults, verification, backup_name: request.backup_name || null },
    });
    await appendBillingEvent(queryable, {
      clientId, eventType: 'network.execution_succeeded', category: 'network', source: 'network_executor',
      entityType: 'router', entityId: request.router_id, severity: 'info', title: `Network repair succeeded: ${plan.title}`,
      description: `Approved request ${request.id} completed and verification passed.`,
      payload: { request_id: request.id, plan_id: plan.id, action_type: plan.action_type,
        commands_executed: commandResults.filter((item) => item.phase === 'change').length, verification_passed: true },
      relatedEntities: [{ entityType: 'network_execution_request', entityId: request.id, relationship: 'result' }],
      deduplicationKey: `network-execution-result:${request.id}:succeeded`, sensitivity: 'restricted',
    });
    return completed;
  } catch (error) {
    const verification = error.verification || null;
    if (mutated && (plan.rollback_preview || []).length) {
      try {
        await queryable.query(`UPDATE network_execution_requests SET status='rolling_back',rollback_status='running',updated_at=NOW() WHERE client_id=$1 AND id=$2`, [clientId, request.id]);
        for (const operation of [...plan.rollback_preview].reverse()) {
          await recordStep(queryable, request, next(), 'rollback', operation.path, operation.description,
            { args: operation.args || {}, selector: operation.selector || null },
            () => executeStructuredOperation(client, operation, snapshots));
        }
        await recordStep(queryable, request, next(), 'connectivity', '/system/identity/print', 'Verify management connectivity after rollback', {},
          () => client.command('/system/identity/print'));
        const rolledBack = await finalizeRequest(queryable, request, 'rolled_back', {
          verificationStatus: verification ? 'failed' : 'not_completed', rollbackStatus: 'succeeded',
          error: error.message, result: { command_results: commandResults, verification, backup_name: request.backup_name || null },
        });
        await appendBillingEvent(queryable, {
          clientId, eventType: 'network.execution_rolled_back', category: 'network', source: 'network_executor',
          entityType: 'router', entityId: request.router_id, severity: 'warning', title: `Network repair rolled back: ${plan.title}`,
          description: `Request ${request.id} failed verification or execution and its structured rollback completed.`,
          payload: { request_id: request.id, action_type: plan.action_type, rollback_succeeded: true,
            commands_executed: commandResults.filter((item) => item.phase === 'change').length },
          deduplicationKey: `network-execution-result:${request.id}:rolled_back`, sensitivity: 'restricted',
        });
        return rolledBack;
      } catch (rollbackError) {
        return finalizeRequest(queryable, request, 'rollback_failed', {
          verificationStatus: verification ? 'failed' : 'not_completed', rollbackStatus: 'failed',
          error: `${error.message}; rollback failed: ${rollbackError.message}`,
          result: { command_results: commandResults, verification, backup_name: request.backup_name || null },
        });
      }
    }
    return finalizeRequest(queryable, request, verification ? 'verification_failed' : 'failed', {
      verificationStatus: verification ? 'failed' : 'not_completed',
      rollbackStatus: mutated ? 'not_available' : 'not_required', error: error.message,
      result: { command_results: commandResults, verification, backup_name: request.backup_name || null },
    });
  } finally { client?.close?.(); }
}

async function getExecutionRequest(clientId, requestId, queryable = db) {
  await ensureNetworkExecutorSchema(queryable);
  const result = await queryable.query(
    `SELECT request.*,plan.title plan_title,router.name router_name
     FROM network_execution_requests request
     JOIN network_action_plans plan ON plan.client_id=request.client_id AND plan.id=request.plan_id
     JOIN mikrotik_routers router ON router.client_id=request.client_id AND router.id=request.router_id
     WHERE request.client_id=$1 AND request.id=$2 LIMIT 1`, [clientId, requestId]);
  if (!result.rows[0]) return null;
  const [approvals, steps] = await Promise.all([
    queryable.query(`SELECT id,decision,reason,decided_by,created_at FROM network_execution_approvals WHERE client_id=$1 AND request_id=$2 ORDER BY created_at`, [clientId, requestId]),
    queryable.query(`SELECT * FROM network_execution_steps WHERE client_id=$1 AND request_id=$2 ORDER BY sequence_no`, [clientId, requestId]),
  ]);
  return { ...result.rows[0], approvals: approvals.rows, steps: steps.rows, execution_enabled: EXECUTION_ENABLED };
}

async function listExecutionRequests(clientId, options = {}, queryable = db) {
  await ensureNetworkExecutorSchema(queryable);
  const values = [clientId]; const where = ['request.client_id=$1'];
  if (options.status) { values.push(cleanText(options.status, 30)); where.push(`request.status=$${values.length}`); }
  if (options.routerId) { values.push(Number(options.routerId)); where.push(`request.router_id=$${values.length}`); }
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100))); values.push(limit);
  const result = await queryable.query(
    `SELECT request.*,plan.title plan_title,router.name router_name
     FROM network_execution_requests request
     JOIN network_action_plans plan ON plan.client_id=request.client_id AND plan.id=request.plan_id
     JOIN mikrotik_routers router ON router.client_id=request.client_id AND router.id=request.router_id
     WHERE ${where.join(' AND ')} ORDER BY request.created_at DESC LIMIT $${values.length}`, values);
  return result.rows.map((row) => ({ ...row, execution_enabled: EXECUTION_ENABLED }));
}

async function cancelExecutionRequest(clientId, requestId, options = {}) {
  const queryable = options.queryable || db;
  await ensureNetworkExecutorSchema(queryable);
  const result = await queryable.query(
    `UPDATE network_execution_requests SET status='cancelled',finished_at=NOW(),updated_at=NOW()
     WHERE client_id=$1 AND id=$2 AND status IN ('pending_approval','ready') RETURNING *`, [clientId, requestId]);
  return result.rows[0] || null;
}

async function expireExecutionRequests(queryable = db) {
  await ensureNetworkExecutorSchema(queryable);
  const result = await queryable.query(
    `UPDATE network_execution_requests SET status='expired',finished_at=NOW(),updated_at=NOW()
     WHERE status IN ('pending_approval','ready') AND expires_at<=NOW() RETURNING id`);
  return result.rowCount;
}

async function recoverExpiredExecutions(options = {}) {
  const enabled = options.executionEnabled === true || (options.executionEnabled !== false && EXECUTION_ENABLED);
  if (!enabled) return { enabled: false, recovered: 0 };
  const queryable = options.queryable || db;
  await ensureNetworkExecutorSchema(queryable);
  const expired = await queryable.query(
    `SELECT * FROM network_execution_requests
     WHERE status IN ('executing','verifying','rolling_back') AND lease_expires_at<NOW()
     ORDER BY lease_expires_at ASC LIMIT $1`, [Math.max(1, Math.min(25, Number(options.limit || 5)))]);
  const results = [];
  for (const candidate of expired.rows) {
    const claimed = await queryable.query(
      `UPDATE network_execution_requests SET status='rolling_back',rollback_status='running',lease_owner=$3,
       lease_expires_at=NOW()+($4::text || ' seconds')::interval,updated_at=NOW()
       WHERE client_id=$1 AND id=$2 AND status IN ('executing','verifying','rolling_back')
         AND lease_expires_at<NOW() RETURNING *`,
      [candidate.client_id, candidate.id, options.workerId || `${WORKER_ID}:watchdog`, String(LEASE_SECONDS)]);
    const request = claimed.rows[0];
    if (!request) continue;
    const plan = await loadPlanForExecution(queryable, request.client_id, request.plan_id);
    const changed = await queryable.query(
      `SELECT COUNT(*)::int count FROM network_execution_steps
       WHERE client_id=$1 AND request_id=$2 AND phase='change' AND status='succeeded'`,
      [request.client_id, request.id]);
    if (!plan || planSeal(plan) !== request.plan_seal) {
      results.push(await finalizeRequest(queryable, request, 'rollback_failed', {
        verificationStatus: 'unknown', rollbackStatus: 'blocked', error: 'Watchdog found a plan-seal mismatch',
      }));
      continue;
    }
    if (changed.rows[0].count === 0) {
      results.push(await finalizeRequest(queryable, request, 'failed', {
        verificationStatus: 'not_completed', rollbackStatus: 'not_required',
        error: 'Execution worker lease expired before any mutation completed',
      }));
      continue;
    }
    if (!(plan.rollback_preview || []).length) {
      results.push(await finalizeRequest(queryable, request, 'rollback_failed', {
        verificationStatus: 'unknown', rollbackStatus: 'not_available',
        error: 'Execution worker lease expired after a mutation and this action has no direct rollback',
      }));
      continue;
    }
    const credentialResult = await queryable.query(
      `SELECT credential.*,router.host,router.port,router.connection_type,router.connection_method
       FROM network_router_executor_credentials credential
       JOIN mikrotik_routers router ON router.client_id=credential.client_id AND router.id=credential.router_id
       WHERE credential.client_id=$1 AND credential.router_id=$2 AND credential.enabled=TRUE
         AND credential.verification_status='verified' LIMIT 1`, [request.client_id, request.router_id]);
    const credential = credentialResult.rows[0];
    if (!credential || credential.connection_method !== 'wireguard') {
      results.push(await finalizeRequest(queryable, request, 'rollback_failed', {
        verificationStatus: 'unknown', rollbackStatus: 'blocked', error: 'Watchdog could not obtain a verified WireGuard executor credential',
      }));
      continue;
    }
    const snapshotRows = await queryable.query(
      `SELECT operation_path,response_data FROM network_execution_steps
       WHERE client_id=$1 AND request_id=$2 AND phase='inspect' AND status='succeeded' ORDER BY sequence_no`,
      [request.client_id, request.id]);
    const snapshots = Object.fromEntries(snapshotRows.rows.map((item) => [item.operation_path, item.response_data]));
    const sequenceResult = await queryable.query(
      `SELECT COALESCE(MAX(sequence_no),0)::int sequence FROM network_execution_steps WHERE client_id=$1 AND request_id=$2`,
      [request.client_id, request.id]);
    let sequence = sequenceResult.rows[0].sequence;
    const connect = options.connect || connectRouter; let client;
    try {
      client = await connect({ host: credential.host, port: credential.port, connection_type: credential.connection_type,
        username: credential.username, password: decryptSecret(credential.password_encrypted) });
      for (const operation of [...plan.rollback_preview].reverse()) {
        sequence += 1;
        await recordStep(queryable, request, sequence, 'rollback', operation.path,
          `Watchdog recovery: ${operation.description || operation.path}`,
          { args: operation.args || {}, selector: operation.selector || null },
          () => executeStructuredOperation(client, operation, snapshots));
      }
      sequence += 1;
      await recordStep(queryable, request, sequence, 'connectivity', '/system/identity/print',
        'Watchdog verifies management connectivity after rollback', {}, () => client.command('/system/identity/print'));
      const recovered = await finalizeRequest(queryable, request, 'rolled_back', {
        verificationStatus: 'unknown', rollbackStatus: 'succeeded',
        error: 'Execution worker lease expired; watchdog rollback completed',
        result: { watchdog_recovery: true, recovered_at: new Date().toISOString() },
      });
      await appendBillingEvent(queryable, {
        clientId: request.client_id, eventType: 'network.execution_watchdog_rollback', category: 'network', source: 'network_executor',
        entityType: 'router', entityId: request.router_id, severity: 'critical',
        title: `Watchdog rollback completed: ${plan.title}`,
        description: `Request ${request.id} lost its worker lease after a mutation; the watchdog completed its structured rollback.`,
        payload: { request_id: request.id, action_type: request.action_type, watchdog_recovery: true, rollback_succeeded: true },
        deduplicationKey: `network-execution-watchdog:${request.id}`, sensitivity: 'restricted',
      });
      results.push(recovered);
    } catch (error) {
      results.push(await finalizeRequest(queryable, request, 'rollback_failed', {
        verificationStatus: 'unknown', rollbackStatus: 'failed', error: `Watchdog rollback failed: ${error.message}`,
      }));
    } finally { client?.close?.(); }
  }
  return { enabled: true, recovered: results.length, results };
}

async function processReadyExecutions(limit = 5) {
  if (!EXECUTION_ENABLED) return { enabled: false, processed: 0, commands_executed: 0 };
  await ensureNetworkExecutorSchema();
  await expireExecutionRequests();
  await recoverExpiredExecutions();
  const ready = await db.query(
    `SELECT id,client_id FROM network_execution_requests WHERE status='ready' AND expires_at>NOW()
       AND (maintenance_window_start IS NULL OR NOW() BETWEEN maintenance_window_start AND maintenance_window_end)
     ORDER BY approved_at ASC LIMIT $1`, [Math.max(1, Math.min(25, Number(limit || 5)))]);
  const results = [];
  for (const item of ready.rows) {
    try { results.push(await executeApprovedRequest(item.client_id, item.id)); }
    catch (error) { results.push({ id: item.id, error: cleanText(error.message, 1000) }); }
  }
  return { enabled: true, processed: results.length, results };
}

function startNetworkExecutorScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  ensureNetworkExecutorSchema()
    .then(() => console.log(`Network executor ready (${EXECUTION_ENABLED ? 'approval-gated execution enabled' : 'execution disabled'}, ${WORKER_ID}).`))
    .catch((error) => console.error('Network executor schema failed:', error.message));
  if (!EXECUTION_ENABLED) return;
  const timer = setInterval(() => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    processReadyExecutions().catch((error) => console.error('Network executor failed:', error.message))
      .finally(() => { schedulerBusy = false; });
  }, EXECUTION_INTERVAL_MS);
  timer.unref?.();
}

async function getExecutionOverview(clientId, queryable = db) {
  await ensureNetworkExecutorSchema(queryable);
  const result = await queryable.query(
    `SELECT COUNT(*)::int total,
       COUNT(*) FILTER (WHERE status='pending_approval')::int pending_approval,
       COUNT(*) FILTER (WHERE status='ready')::int ready,
       COUNT(*) FILTER (WHERE status='succeeded')::int succeeded,
       COUNT(*) FILTER (WHERE status IN ('rolled_back','rollback_failed'))::int rollback_events,
       MAX(finished_at) last_finished_at
     FROM network_execution_requests WHERE client_id=$1`, [clientId]);
  const credentials = await queryable.query(
    `SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE enabled AND verification_status='verified')::int verified
     FROM network_router_executor_credentials WHERE client_id=$1`, [clientId]);
  return { ...result.rows[0], executor_credentials: credentials.rows[0], ...executionFeatureState() };
}

async function buildNetworkExecutionContext(clientId, question = '', options = {}) {
  const requests = await listExecutionRequests(clientId, { limit: options.limit || 10 });
  const terms = cleanText(question, 500).toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
  const selected = terms.length ? requests.filter((item) => terms.some((term) =>
    `${item.plan_title} ${item.action_type} ${item.router_name} ${item.status}`.toLowerCase().includes(term))).slice(0, options.limit || 10) : requests;
  return {
    context: selected.map((item) =>
      `Network execution ${item.id}: ${item.plan_title} for ${item.router_name}. Status ${item.status}; ` +
      `approvals ${item.approvals_received}/${item.approvals_required}; verification ${item.verification_status}; rollback ${item.rollback_status}.`
    ).join('\n'),
    sources: selected.map((item) => ({ type: 'network_execution_request', id: item.id,
      status: item.status, router_id: item.router_id, action_type: item.action_type })),
  };
}

module.exports = {
  ACTION_SUPPORT,
  ACTIVE_STATUSES,
  EXECUTION_ENABLED,
  NETWORK_EXECUTOR_SCHEMA_SQL,
  TERMINAL_STATUSES,
  actionSupport,
  approvalPolicy,
  buildNetworkExecutionContext,
  cancelExecutionRequest,
  claimExecutionRequest,
  createExecutionRequest,
  decideExecutionRequest,
  ensureNetworkExecutorSchema,
  executeApprovedRequest,
  executionFeatureState,
  expireExecutionRequests,
  getExecutionOverview,
  getExecutionRequest,
  getExecutorCredentialStatus,
  listExecutionRequests,
  planSeal,
  processReadyExecutions,
  recoverExpiredExecutions,
  redact,
  resolveSnapshotArgs,
  rowMatches,
  setRouterExecutorCredential,
  startNetworkExecutorScheduler,
  testRouterExecutorCredential,
  verifyRepair,
};
