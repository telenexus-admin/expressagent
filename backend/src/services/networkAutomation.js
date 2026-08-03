const crypto = require('crypto');
const net = require('net');
const db = require('../db');
const { appendBillingEvent, ensureEventSchema } = require('./events');
const { ensureIncidentSchema } = require('./incidentCommander');
const { ensureNetworkObservabilitySchema } = require('./networkObservability');

const SHADOW_INTERVAL_MS = Math.max(30_000, Number(process.env.NETWORK_SHADOW_PLANNER_INTERVAL_MS || 60_000));
const PLAN_VERSION = 1;
const FORBIDDEN_PATHS = [
  '/system/reset-configuration', '/system/reboot', '/system/shutdown',
  '/system/package/update/install', '/system/package/downgrade', '/import',
  '/system/script/run', '/tool/netwatch/add',
];

let schemaReady = false;
let schedulerStarted = false;
let schedulerBusy = false;

const NETWORK_AUTOMATION_SCHEMA_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_incidents_tenant_id
    ON billing_incidents(client_id,id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_network_anomalies_tenant_id
    ON network_anomalies(client_id,id);

  CREATE TABLE IF NOT EXISTS network_action_plans (
    id UUID PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL,
    incident_id UUID,
    anomaly_id UUID,
    action_type VARCHAR(100) NOT NULL,
    action_version INTEGER NOT NULL DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
    mode VARCHAR(20) NOT NULL DEFAULT 'shadow' CHECK (mode='shadow'),
    status VARCHAR(24) NOT NULL DEFAULT 'shadow' CHECK (status IN ('shadow','superseded')),
    review_status VARCHAR(24) NOT NULL DEFAULT 'pending'
      CHECK (review_status IN ('pending','confirmed','rejected','needs_changes')),
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    preconditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    command_preview JSONB NOT NULL DEFAULT '[]'::jsonb,
    rollback_preview JSONB NOT NULL DEFAULT '[]'::jsonb,
    verification JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    future_approval JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence NUMERIC(5,2) NOT NULL DEFAULT 80 CHECK (confidence >= 0 AND confidence <= 100),
    rollback_guarantee VARCHAR(20) NOT NULL DEFAULT 'partial'
      CHECK (rollback_guarantee IN ('full','partial','none','not_required')),
    plan_fingerprint VARCHAR(64) NOT NULL,
    source VARCHAR(80) NOT NULL DEFAULT 'network_shadow_planner',
    created_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    reviewed_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    review_note TEXT,
    reviewed_at TIMESTAMPTZ,
    last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id,plan_fingerprint),
    FOREIGN KEY (client_id,router_id) REFERENCES mikrotik_routers(client_id,id) ON DELETE CASCADE,
    FOREIGN KEY (client_id,incident_id) REFERENCES billing_incidents(client_id,id) ON DELETE CASCADE,
    FOREIGN KEY (client_id,anomaly_id) REFERENCES network_anomalies(client_id,id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_action_plan_reviews (
    id UUID PRIMARY KEY,
    plan_id UUID NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    decision VARCHAR(24) NOT NULL CHECK (decision IN ('confirmed','rejected','needs_changes')),
    note TEXT,
    reviewed_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_network_action_plans_tenant_router
    ON network_action_plans(client_id,router_id,status,review_status,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_network_action_plans_incident
    ON network_action_plans(client_id,incident_id,created_at DESC) WHERE incident_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_network_action_plans_tenant_id
    ON network_action_plans(client_id,id);
  CREATE INDEX IF NOT EXISTS idx_network_action_plan_reviews_tenant
    ON network_action_plan_reviews(client_id,plan_id,created_at DESC);
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='network_action_plan_reviews_tenant_plan_fk') THEN
      ALTER TABLE network_action_plan_reviews
        ADD CONSTRAINT network_action_plan_reviews_tenant_plan_fk
        FOREIGN KEY (client_id,plan_id) REFERENCES network_action_plans(client_id,id) ON DELETE CASCADE;
    END IF;
  END $$;
`;

function cleanText(value, maxLength = 255) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeName(value, label = 'name', maxLength = 160) {
  const text = cleanText(value, maxLength);
  if (!text || !/^[a-zA-Z0-9*_.:@+%/ -]+$/.test(text) || /[;{}\[\]"'`\\]/.test(text)) {
    throw new Error(`${label} contains unsupported RouterOS characters`);
  }
  return text;
}

function optionalName(value, label) {
  return value === null || value === undefined || String(value).trim() === '' ? null : safeName(value, label);
}

function ipAddress(value, label = 'IP address') {
  const text = cleanText(value, 80);
  if (!net.isIP(text)) throw new Error(`${label} must be a valid IPv4 or IPv6 address`);
  return text;
}

function integer(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return number;
}

function enumValue(value, label, allowed) {
  const text = cleanText(value, 80).toLowerCase();
  if (!allowed.includes(text)) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  return text;
}

function rateLimit(value) {
  const text = cleanText(value, 40);
  if (!/^\d+(?:\.\d+)?[kKmMgG]?(?:\/\d+(?:\.\d+)?[kKmMgG]?)?$/.test(text)) {
    throw new Error('max_limit must be a RouterOS rate such as 10M/5M');
  }
  return text;
}

function secretReference(value) {
  const text = cleanText(value, 120);
  if (!/^secret:[a-zA-Z0-9_.:-]{4,100}$/.test(text)) {
    throw new Error('secret_ref must reference an encrypted secret and must not contain the secret value');
  }
  return text;
}

function operation(phase, path, args = {}, selector = null, description = '') {
  return { phase, path, args, selector, description };
}

const ACTIONS = {
  diagnose_router_health: {
    title: 'Diagnose router health', risk: 'low', mutates: false, rollback: 'not_required',
    parameters: {}, futureApproval: { required: false, approvals: 0 },
    build: () => ({
      preconditions: ['Router belongs to the active billing account', 'Nexa management tunnel is expected to be reachable'],
      commands: [
        operation('inspect', '/system/resource/print', {}, null, 'Read CPU, memory, uptime and RouterOS version'),
        operation('inspect', '/system/health/print', {}, null, 'Read voltage, temperature and hardware health when supported'),
        operation('inspect', '/interface/print', {}, null, 'Read interface state and counters'),
        operation('inspect', '/ip/route/print', {}, null, 'Read route and gateway state'),
        operation('inspect', '/log/print', {}, null, 'Read recent router logs'),
      ],
      rollback: [],
      verification: ['Router responds to all supported health queries', 'Management connectivity remains available'],
    }),
  },
  diagnose_uplink: {
    title: 'Diagnose uplink path', risk: 'low', mutates: false, rollback: 'not_required',
    parameters: { interface: { required: false, type: 'router_name' }, gateway: { required: false, type: 'ip' } },
    futureApproval: { required: false, approvals: 0 },
    normalize: (params) => ({ interface: optionalName(params.interface, 'interface'), gateway: params.gateway ? ipAddress(params.gateway, 'gateway') : null }),
    build: (params) => ({
      preconditions: ['Router is reachable through the management plane'],
      commands: [
        operation('inspect', '/interface/print', {}, params.interface ? { name: params.interface } : null, 'Inspect the suspected uplink'),
        operation('inspect', '/ip/route/print', {}, null, 'Inspect active and default routes'),
        ...(params.gateway ? [operation('inspect', '/ping', { address: params.gateway, count: 5, interval: '200ms' }, null, 'Measure gateway reachability and latency')] : []),
      ],
      rollback: [],
      verification: ['Uplink running state is known', 'Gateway status and route selection are known'],
    }),
  },
  diagnose_radius_access: {
    title: 'Diagnose RADIUS and subscriber access', risk: 'low', mutates: false, rollback: 'not_required',
    parameters: {}, futureApproval: { required: false, approvals: 0 },
    build: () => ({
      preconditions: ['Router is reachable', 'RADIUS inspection policy is available to the Nexa account'],
      commands: [
        operation('inspect', '/radius/print', {}, null, 'Inspect configured RADIUS endpoints'),
        operation('inspect', '/radius/monitor', { once: '' }, null, 'Read RADIUS requests, rejects, timeouts and bad replies'),
        operation('inspect', '/ppp/aaa/print', {}, null, 'Inspect PPP RADIUS policy'),
        operation('inspect', '/ppp/active/print', {}, null, 'Inspect live PPP sessions'),
        operation('inspect', '/ip/hotspot/active/print', {}, null, 'Inspect live hotspot sessions'),
      ],
      rollback: [],
      verification: ['RADIUS endpoint state is known', 'Timeout, reject and bad-reply counters are captured'],
    }),
  },
  diagnose_security_exposure: {
    title: 'Diagnose router security exposure', risk: 'low', mutates: false, rollback: 'not_required',
    parameters: {}, futureApproval: { required: false, approvals: 0 },
    build: () => ({
      preconditions: ['Router is reachable through the private management plane'],
      commands: [
        operation('inspect', '/ip/service/print', {}, null, 'Inspect listening RouterOS services'),
        operation('inspect', '/ip/firewall/filter/print', {}, null, 'Inspect management-plane firewall rules'),
        operation('inspect', '/ip/firewall/address-list/print', {}, null, 'Inspect security address lists'),
        operation('inspect', '/user/active/print', {}, null, 'Inspect active administrative sessions'),
        operation('inspect', '/log/print', {}, null, 'Inspect authentication failures'),
      ],
      rollback: [],
      verification: ['Exposed services and active sessions are identified', 'No firewall state is changed'],
    }),
  },
  diagnose_resource_pressure: {
    title: 'Diagnose CPU, memory and traffic pressure', risk: 'low', mutates: false, rollback: 'not_required',
    parameters: {}, futureApproval: { required: false, approvals: 0 },
    build: () => ({
      preconditions: ['Router is reachable'],
      commands: [
        operation('inspect', '/system/resource/print', {}, null, 'Inspect CPU, memory and storage'),
        operation('inspect', '/tool/profile', { once: '' }, null, 'Identify RouterOS processes consuming CPU'),
        operation('inspect', '/ip/firewall/connection/print', { count_only: '' }, null, 'Estimate connection-tracking load'),
        operation('inspect', '/queue/simple/print', {}, null, 'Inspect subscriber queues'),
        operation('inspect', '/interface/print', {}, null, 'Inspect link counters and traffic pressure'),
      ],
      rollback: [],
      verification: ['Resource bottleneck and affected subsystem are identified'],
    }),
  },
  restart_interface: {
    title: 'Restart an interface', risk: 'high', mutates: true, rollback: 'partial',
    parameters: { interface: { required: true, type: 'router_name' } },
    futureApproval: { required: true, approvals: 1, maintenance_window: true },
    normalize: (params) => ({ interface: safeName(params.interface, 'interface') }),
    build: (params) => ({
      preconditions: ['Capture current interface state', 'Confirm the interface is not the only Nexa management path', 'Confirm affected subscriber count', 'Create router-side rollback watchdog'],
      commands: [
        operation('inspect', '/interface/print', {}, { name: params.interface }, 'Capture current interface state'),
        operation('change', '/interface/disable', {}, { name: params.interface }, 'Disable the selected interface'),
        operation('change', '/interface/enable', {}, { name: params.interface }, 'Re-enable the selected interface'),
      ],
      rollback: [operation('rollback', '/interface/enable', {}, { name: params.interface }, 'Ensure the interface is enabled if verification fails')],
      verification: ['Interface returns to running state', 'Management tunnel remains reachable', 'Gateway reachability recovers', 'Subscriber sessions begin recovering'],
    }),
  },
  disconnect_pppoe_session: {
    title: 'Disconnect a PPPoE session', risk: 'medium', mutates: true, rollback: 'none',
    parameters: { username: { required: true, type: 'router_name' } },
    futureApproval: { required: true, approvals: 1 },
    normalize: (params) => ({ username: safeName(params.username, 'username') }),
    build: (params) => ({
      preconditions: ['Confirm the subscriber belongs to this tenant and router', 'Confirm the session is currently active'],
      commands: [
        operation('inspect', '/ppp/active/print', {}, { name: params.username }, 'Resolve the active session identifier'),
        operation('change', '/ppp/active/remove', {}, { name: params.username }, 'Disconnect only the selected PPPoE session'),
      ],
      rollback: [],
      verification: ['Old session is absent', 'Subscriber is allowed to authenticate again', 'A fresh RADIUS accounting session appears'],
    }),
  },
  flush_dns_cache: {
    title: 'Flush RouterOS DNS cache', risk: 'medium', mutates: true, rollback: 'none',
    parameters: {}, futureApproval: { required: true, approvals: 1 },
    build: () => ({
      preconditions: ['Confirm upstream DNS servers are configured and reachable'],
      commands: [operation('change', '/ip/dns/cache/flush', {}, null, 'Flush cached DNS entries')],
      rollback: [],
      verification: ['Router resolves approved test domains', 'DNS response time returns to the expected range'],
    }),
  },
  quarantine_source_ip: {
    title: 'Quarantine a hostile source IP', risk: 'high', mutates: true, rollback: 'full',
    parameters: { source_ip: { required: true, type: 'ip' }, duration: { required: true, type: 'enum', values: ['10m','1h','6h','1d','7d'] } },
    futureApproval: { required: true, approvals: 1 },
    normalize: (params) => ({ source_ip: ipAddress(params.source_ip, 'source_ip'), duration: enumValue(params.duration, 'duration', ['10m','1h','6h','1d','7d']) }),
    build: (params) => ({
      preconditions: ['Confirm the source is not a Nexa, ISP office, upstream or emergency-management address', 'Confirm matching security evidence'],
      commands: [operation('change', '/ip/firewall/address-list/add', {
        list: 'nexa-quarantine', address: params.source_ip, timeout: params.duration,
        comment: 'Nexa approved security quarantine',
      }, null, 'Add the hostile source to a time-limited quarantine list')],
      rollback: [operation('rollback', '/ip/firewall/address-list/remove', {}, { list: 'nexa-quarantine', address: params.source_ip }, 'Remove the quarantine entry')],
      verification: ['Management access from trusted sources remains available', 'Failed-login rate falls', 'The quarantined address cannot reach protected services'],
    }),
  },
  restart_wireguard_peer: {
    title: 'Restart a WireGuard peer', risk: 'high', mutates: true, rollback: 'partial',
    parameters: { peer: { required: true, type: 'router_name' } },
    futureApproval: { required: true, approvals: 1, management_path_guard: true },
    normalize: (params) => ({ peer: safeName(params.peer, 'peer') }),
    build: (params) => ({
      preconditions: ['Confirm this peer is not the only active Nexa management path', 'Capture peer state and latest handshake'],
      commands: [
        operation('inspect', '/interface/wireguard/peers/print', {}, { comment_or_id: params.peer }, 'Capture current peer state'),
        operation('change', '/interface/wireguard/peers/disable', {}, { comment_or_id: params.peer }, 'Disable the selected peer'),
        operation('change', '/interface/wireguard/peers/enable', {}, { comment_or_id: params.peer }, 'Re-enable the selected peer'),
      ],
      rollback: [operation('rollback', '/interface/wireguard/peers/enable', {}, { comment_or_id: params.peer }, 'Ensure the peer is enabled')],
      verification: ['Latest handshake advances', 'Tunnel traffic resumes', 'Nexa management access remains available'],
    }),
  },
  enable_ppp_radius: {
    title: 'Enable RADIUS for PPP', risk: 'high', mutates: true, rollback: 'full',
    parameters: {}, futureApproval: { required: true, approvals: 1 },
    build: () => ({
      preconditions: ['A healthy tenant RADIUS endpoint is already configured', 'Authentication and accounting ports are reachable', 'Capture current PPP AAA state'],
      commands: [operation('inspect', '/ppp/aaa/print', {}, null, 'Capture current PPP AAA state'), operation('change', '/ppp/aaa/set', { 'use-radius': 'yes', accounting: 'yes' }, null, 'Enable PPP RADIUS authentication and accounting')],
      rollback: [operation('rollback', '/ppp/aaa/set', { 'use-radius': '{{snapshot.ppp_aaa.use-radius}}', accounting: '{{snapshot.ppp_aaa.accounting}}' }, null, 'Restore captured PPP AAA state')],
      verification: ['Test subscriber authentication succeeds', 'RADIUS accounting packets arrive', 'Local fallback policy matches the ISP decision'],
    }),
  },
  enable_hotspot_radius: {
    title: 'Enable RADIUS for a hotspot profile', risk: 'high', mutates: true, rollback: 'full',
    parameters: { profile: { required: true, type: 'router_name' } },
    futureApproval: { required: true, approvals: 1 },
    normalize: (params) => ({ profile: safeName(params.profile, 'profile') }),
    build: (params) => ({
      preconditions: ['A healthy tenant RADIUS endpoint is configured', 'Capture current hotspot profile state'],
      commands: [operation('inspect', '/ip/hotspot/profile/print', {}, { name: params.profile }, 'Capture hotspot profile'), operation('change', '/ip/hotspot/profile/set', { 'use-radius': 'yes' }, { name: params.profile }, 'Enable RADIUS on the selected profile')],
      rollback: [operation('rollback', '/ip/hotspot/profile/set', { 'use-radius': '{{snapshot.hotspot_profile.use-radius}}' }, { name: params.profile }, 'Restore captured profile state')],
      verification: ['Test hotspot login succeeds through RADIUS', 'Accounting starts', 'Captive portal remains reachable'],
    }),
  },
  update_radius_endpoint: {
    title: 'Update a RADIUS endpoint', risk: 'critical', mutates: true, rollback: 'full',
    parameters: {
      radius_id: { required: true, type: 'router_name' }, address: { required: true, type: 'ip' },
      authentication_port: { required: true, type: 'integer', min: 1, max: 65535 },
      accounting_port: { required: true, type: 'integer', min: 1, max: 65535 },
      secret_ref: { required: true, type: 'secret_reference' },
    },
    futureApproval: { required: true, approvals: 2, maintenance_window: true },
    normalize: (params) => ({
      radius_id: safeName(params.radius_id, 'radius_id'), address: ipAddress(params.address),
      authentication_port: integer(params.authentication_port, 'authentication_port', 1, 65535),
      accounting_port: integer(params.accounting_port, 'accounting_port', 1, 65535),
      secret_ref: secretReference(params.secret_ref),
    }),
    build: (params) => ({
      preconditions: ['Resolve secret_ref from the encrypted tenant vault only at execution time', 'Test new endpoint reachability', 'Capture current RADIUS item', 'Confirm maintenance window and dual approval'],
      commands: [
        operation('inspect', '/radius/print', {}, { id: params.radius_id }, 'Capture current RADIUS endpoint'),
        operation('change', '/radius/set', {
          address: params.address, 'authentication-port': params.authentication_port,
          'accounting-port': params.accounting_port, secret: `{{${params.secret_ref}}}`,
        }, { id: params.radius_id }, 'Update the selected RADIUS endpoint using a vault-resolved secret'),
      ],
      rollback: [operation('rollback', '/radius/set', { snapshot: '{{snapshot.radius_item}}' }, { id: params.radius_id }, 'Restore the captured RADIUS endpoint')],
      verification: ['RADIUS monitor shows replies without bad-reply growth', 'Authentication and accounting tests pass'],
    }),
  },
  change_default_route: {
    title: 'Change the default-route gateway', risk: 'critical', mutates: true, rollback: 'full',
    parameters: { route_id: { required: true, type: 'router_name' }, gateway: { required: true, type: 'ip' }, distance: { required: true, type: 'integer', min: 1, max: 255 } },
    futureApproval: { required: true, approvals: 2, maintenance_window: true, out_of_band_recovery: true },
    normalize: (params) => ({ route_id: safeName(params.route_id, 'route_id'), gateway: ipAddress(params.gateway, 'gateway'), distance: integer(params.distance, 'distance', 1, 255) }),
    build: (params) => ({
      preconditions: ['Capture the current default route', 'Verify the proposed gateway from the router', 'Confirm an independent management path', 'Arm router-side rollback watchdog', 'Confirm dual approval'],
      commands: [operation('inspect', '/ip/route/print', {}, { id: params.route_id }, 'Capture current route'), operation('inspect', '/ping', { address: params.gateway, count: 5, interval: '200ms' }, null, 'Test the proposed gateway'), operation('change', '/ip/route/set', { gateway: params.gateway, distance: params.distance }, { id: params.route_id }, 'Change only the selected route')],
      rollback: [operation('rollback', '/ip/route/set', { gateway: '{{snapshot.route.gateway}}', distance: '{{snapshot.route.distance}}' }, { id: params.route_id }, 'Restore the captured route')],
      verification: ['New gateway responds', 'Default route is active', 'Internet probes pass', 'Management tunnel and subscriber traffic remain healthy'],
    }),
  },
  set_simple_queue_limit: {
    title: 'Correct a simple-queue speed limit', risk: 'high', mutates: true, rollback: 'full',
    parameters: { queue: { required: true, type: 'router_name' }, max_limit: { required: true, type: 'rate' } },
    futureApproval: { required: true, approvals: 1 },
    normalize: (params) => ({ queue: safeName(params.queue, 'queue'), max_limit: rateLimit(params.max_limit) }),
    build: (params) => ({
      preconditions: ['Confirm queue ownership and package entitlement', 'Capture current queue settings'],
      commands: [operation('inspect', '/queue/simple/print', {}, { name: params.queue }, 'Capture current queue'), operation('change', '/queue/simple/set', { 'max-limit': params.max_limit }, { name: params.queue }, 'Apply the approved package speed')],
      rollback: [operation('rollback', '/queue/simple/set', { 'max-limit': '{{snapshot.queue.max-limit}}' }, { name: params.queue }, 'Restore captured queue limit')],
      verification: ['Queue reports the expected limit', 'Subscriber speed test stays within package tolerance'],
    }),
  },
};

function catalogEntry(actionType, definition) {
  return {
    action_type: actionType,
    version: PLAN_VERSION,
    title: definition.title,
    risk_level: definition.risk,
    mutates_router: definition.mutates,
    rollback_guarantee: definition.rollback,
    parameters: definition.parameters,
    future_approval: definition.futureApproval,
    phase_2_mode: 'shadow',
    execution_allowed: false,
  };
}

function getActionCatalog() {
  return Object.entries(ACTIONS).map(([type, definition]) => catalogEntry(type, definition));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function validateOperation(item) {
  if (!item || typeof item !== 'object' || !['inspect','change','rollback','verify'].includes(item.phase)) throw new Error('Invalid action operation');
  if (!/^\/[a-z0-9/-]+$/i.test(item.path) || FORBIDDEN_PATHS.some((path) => item.path === path || item.path.startsWith(`${path}/`))) {
    throw new Error(`Forbidden RouterOS operation: ${item.path}`);
  }
  const serialized = JSON.stringify(item);
  if (/[\r\n;]/.test(serialized) || /\/system\/reset-configuration|\/system\/reboot|\/import/i.test(serialized)) {
    throw new Error('Unsafe RouterOS operation content rejected');
  }
}

function normalizeParameters(actionType, definition, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('parameters must be an object');
  const allowed = new Set(Object.keys(definition.parameters));
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unsupported parameters for ${actionType}: ${unknown.join(', ')}`);
  for (const [key, spec] of Object.entries(definition.parameters)) {
    if (spec.required && (input[key] === undefined || input[key] === null || String(input[key]).trim() === '')) throw new Error(`${key} is required`);
  }
  return definition.normalize ? definition.normalize(input) : {};
}

function buildActionPlan(actionType, input = {}, context = {}) {
  const type = cleanText(actionType, 100).toLowerCase();
  const definition = ACTIONS[type];
  if (!definition) throw new Error(`Unknown network action type: ${type || 'empty'}`);
  const parameters = normalizeParameters(type, definition, input);
  const built = definition.build(parameters, context);
  const commands = built.commands || []; const rollback = built.rollback || [];
  [...commands, ...rollback].forEach(validateOperation);
  if (!definition.mutates && commands.some((item) => item.phase === 'change')) throw new Error('Read-only action contains a mutation');
  const fingerprintPayload = canonical({ action_type: type, router_id: Number(context.routerId || context.router_id), parameters,
    incident_id: context.incidentId || context.incident_id || null, anomaly_id: context.anomalyId || context.anomaly_id || null });
  return {
    action_type: type,
    action_version: PLAN_VERSION,
    title: definition.title,
    reason: cleanText(context.reason || `Shadow preview for ${definition.title}`, 2000),
    risk_level: definition.risk,
    mode: 'shadow', status: 'shadow', review_status: 'pending',
    parameters,
    preconditions: built.preconditions || [],
    command_preview: commands,
    rollback_preview: rollback,
    verification: built.verification || [],
    future_approval: definition.futureApproval,
    rollback_guarantee: definition.rollback,
    confidence: Math.max(0, Math.min(100, Number(context.confidence || (definition.mutates ? 75 : 90)))),
    plan_fingerprint: crypto.createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex'),
    execution_allowed: false,
    commands_executed: false,
  };
}

async function ensureNetworkAutomationSchema(queryable = db) {
  if (schemaReady) return;
  if (queryable === db) {
    await ensureIncidentSchema();
    await ensureNetworkObservabilitySchema();
    await ensureEventSchema();
  }
  await queryable.query(NETWORK_AUTOMATION_SCHEMA_SQL);
  if (queryable === db) schemaReady = true;
}

async function createShadowPlan(clientId, routerId, actionType, parameters = {}, options = {}) {
  await ensureNetworkAutomationSchema(options.queryable || db);
  const external = options.queryable || null;
  const queryable = external || await db.connect();
  try {
    if (!external) await queryable.query('BEGIN');
    const router = await queryable.query('SELECT id,name,is_active FROM mikrotik_routers WHERE client_id=$1 AND id=$2 LIMIT 1', [clientId, routerId]);
    if (!router.rows[0]) throw new Error('Tenant router not found');
    if (options.incidentId) {
      const incident = await queryable.query('SELECT id FROM billing_incidents WHERE client_id=$1 AND id=$2 LIMIT 1', [clientId, options.incidentId]);
      if (!incident.rows[0]) throw new Error('Tenant incident not found');
    }
    if (options.anomalyId) {
      const anomaly = await queryable.query('SELECT id FROM network_anomalies WHERE client_id=$1 AND id=$2 LIMIT 1', [clientId, options.anomalyId]);
      if (!anomaly.rows[0]) throw new Error('Tenant anomaly not found');
    }
    const plan = buildActionPlan(actionType, parameters, {
      routerId, incidentId: options.incidentId, anomalyId: options.anomalyId,
      reason: options.reason, confidence: options.confidence,
    });
    const id = crypto.randomUUID();
    const inserted = await queryable.query(
      `INSERT INTO network_action_plans
       (id,client_id,router_id,incident_id,anomaly_id,action_type,action_version,title,reason,
        risk_level,parameters,preconditions,command_preview,rollback_preview,verification,evidence,
        future_approval,confidence,rollback_guarantee,plan_fingerprint,source,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,
         $15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21,$22)
       ON CONFLICT (client_id,plan_fingerprint) DO UPDATE SET
         evidence=network_action_plans.evidence || EXCLUDED.evidence,
         reason=EXCLUDED.reason, confidence=GREATEST(network_action_plans.confidence,EXCLUDED.confidence),
         last_refreshed_at=NOW(),updated_at=NOW()
       RETURNING *, (xmax=0) AS newly_created`,
      [id, clientId, routerId, options.incidentId || null, options.anomalyId || null,
        plan.action_type, plan.action_version, plan.title, plan.reason, plan.risk_level,
        JSON.stringify(plan.parameters), JSON.stringify(plan.preconditions), JSON.stringify(plan.command_preview),
        JSON.stringify(plan.rollback_preview), JSON.stringify(plan.verification), JSON.stringify(options.evidence || {}),
        JSON.stringify(plan.future_approval), plan.confidence, plan.rollback_guarantee,
        plan.plan_fingerprint, cleanText(options.source || 'network_shadow_planner', 80), options.createdBy || null]
    );
    const saved = inserted.rows[0];
    if (saved.newly_created) {
      await appendBillingEvent(queryable, {
        clientId, eventType: 'network.shadow_plan_created', category: 'network', source: 'network_shadow_planner',
        entityType: 'router', entityId: routerId, severity: 'info',
        title: `${router.rows[0].name}: ${plan.title}`,
        description: `${plan.reason} This is a shadow plan; no router command was executed.`,
        payload: { plan_id: saved.id, action_type: plan.action_type, risk_level: plan.risk_level,
          mode: 'shadow', execution_allowed: false, commands_executed: false },
        relatedEntities: [
          ...(options.incidentId ? [{ entityType: 'incident', entityId: options.incidentId, relationship: 'planned_for' }] : []),
          ...(options.anomalyId ? [{ entityType: 'network_anomaly', entityId: options.anomalyId, relationship: 'planned_for' }] : []),
        ],
        deduplicationKey: `network-shadow-plan:${saved.id}`, sensitivity: 'restricted',
      });
    }
    if (!external) await queryable.query('COMMIT');
    return { ...saved, execution_allowed: false, commands_executed: false };
  } catch (error) {
    if (!external) try { await queryable.query('ROLLBACK'); } catch (_) { /* no transaction */ }
    throw error;
  } finally { if (!external) queryable.release(); }
}

function suggestedActionForText(value) {
  const text = cleanText(value, 4000).toLowerCase();
  if (/failed login|brute|security|attack|unauthori[sz]ed/.test(text)) return 'diagnose_security_exposure';
  if (/radius|authentication|pppoe|hotspot|session/.test(text)) return 'diagnose_radius_access';
  if (/cpu|memory|storage|resource|overload|pressure/.test(text)) return 'diagnose_resource_pressure';
  if (/uplink|gateway|route|interface|wan|link|packet loss|latency/.test(text)) return 'diagnose_uplink';
  return 'diagnose_router_health';
}

async function planTenantSignals(clientId, queryable = db) {
  await ensureNetworkAutomationSchema(queryable);
  const incidents = await queryable.query(
    `SELECT id,title,summary,severity,primary_entity_type,primary_entity_id
     FROM billing_incidents WHERE client_id=$1 AND status NOT IN ('resolved','closed')
       AND primary_entity_type='router' AND primary_entity_id ~ '^[0-9]+$'
     ORDER BY last_signal_at DESC LIMIT 100`, [clientId]);
  const anomalies = await queryable.query(
    `SELECT id,router_id,metric_name,severity,details,deviation_score
     FROM network_anomalies WHERE client_id=$1 AND status='open'
     ORDER BY last_detected_at DESC LIMIT 100`, [clientId]);
  const plans = [];
  for (const incident of incidents.rows) {
    const actionType = suggestedActionForText(`${incident.title} ${incident.summary}`);
    const params = actionType === 'diagnose_uplink'
      ? { interface: incident.summary?.match(/(?:interface|link)\s+([a-zA-Z0-9_.:@+%/ -]{1,80})/i)?.[1]?.trim() || undefined }
      : {};
    plans.push(await createShadowPlan(clientId, Number(incident.primary_entity_id), actionType, params, {
      queryable, incidentId: incident.id, source: 'incident_commander', confidence: incident.severity === 'critical' ? 95 : 85,
      reason: `Incident Commander requested a shadow diagnosis for: ${incident.title}`,
      evidence: { incident_id: incident.id, severity: incident.severity },
    }));
  }
  for (const anomaly of anomalies.rows) {
    const actionType = suggestedActionForText(`${anomaly.metric_name} ${JSON.stringify(anomaly.details || {})}`);
    const interfaceName = anomaly.details?.labels?.interface;
    const params = actionType === 'diagnose_uplink' && interfaceName ? { interface: interfaceName } : {};
    plans.push(await createShadowPlan(clientId, anomaly.router_id, actionType, params, {
      queryable, anomalyId: anomaly.id, source: 'network_observability', confidence: anomaly.severity === 'critical' ? 95 : 85,
      reason: `Network telemetry detected unusual ${anomaly.metric_name}.`,
      evidence: { anomaly_id: anomaly.id, metric_name: anomaly.metric_name, deviation_score: anomaly.deviation_score },
    }));
  }
  return { incidents: incidents.rows.length, anomalies: anomalies.rows.length, plans: plans.length };
}

async function runShadowPlannerOnce() {
  await ensureNetworkAutomationSchema();
  const tenants = await db.query(`SELECT id FROM clients WHERE account_type='billing' ORDER BY id`);
  const summary = { tenants: tenants.rows.length, incidents: 0, anomalies: 0, plans: 0, failures: [] };
  for (const tenant of tenants.rows) {
    try {
      const result = await planTenantSignals(tenant.id);
      summary.incidents += result.incidents; summary.anomalies += result.anomalies; summary.plans += result.plans;
    } catch (error) { summary.failures.push({ client_id: tenant.id, error: cleanText(error.message, 500) }); }
  }
  return { ...summary, mode: 'shadow', automatic_execution: false, commands_executed: 0 };
}

function startNetworkShadowPlannerScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  ensureNetworkAutomationSchema()
    .then(() => console.log(`Network shadow planner ready (${SHADOW_INTERVAL_MS}ms, execution disabled).`))
    .catch((error) => console.error('Network shadow planner schema failed:', error.message));
  setTimeout(() => runShadowPlannerOnce().catch((error) => console.error('Network shadow startup failed:', error.message)), 90_000);
  const timer = setInterval(() => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    runShadowPlannerOnce().catch((error) => console.error('Network shadow planner failed:', error.message))
      .finally(() => { schedulerBusy = false; });
  }, SHADOW_INTERVAL_MS);
  timer.unref?.();
}

async function listShadowPlans(clientId, options = {}, queryable = db) {
  await ensureNetworkAutomationSchema(queryable);
  const values = [clientId]; const where = ['plan.client_id=$1'];
  if (options.routerId) { values.push(Number(options.routerId)); where.push(`plan.router_id=$${values.length}`); }
  if (options.incidentId) { values.push(cleanText(options.incidentId, 80)); where.push(`plan.incident_id=$${values.length}`); }
  if (options.reviewStatus) { values.push(cleanText(options.reviewStatus, 24)); where.push(`plan.review_status=$${values.length}`); }
  if (options.actionType) { values.push(cleanText(options.actionType, 100)); where.push(`plan.action_type=$${values.length}`); }
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100))); values.push(limit);
  const result = await queryable.query(
    `SELECT plan.*,router.name router_name FROM network_action_plans plan
     JOIN mikrotik_routers router ON router.client_id=plan.client_id AND router.id=plan.router_id
     WHERE ${where.join(' AND ')} ORDER BY plan.created_at DESC LIMIT $${values.length}`, values);
  return result.rows.map((row) => ({ ...row, execution_allowed: false, commands_executed: false }));
}

async function getShadowPlan(clientId, planId, queryable = db) {
  await ensureNetworkAutomationSchema(queryable);
  const result = await queryable.query(
    `SELECT plan.*,router.name router_name FROM network_action_plans plan
     JOIN mikrotik_routers router ON router.client_id=plan.client_id AND router.id=plan.router_id
     WHERE plan.client_id=$1 AND plan.id=$2 LIMIT 1`, [clientId, planId]);
  if (!result.rows[0]) return null;
  const reviews = await queryable.query('SELECT * FROM network_action_plan_reviews WHERE client_id=$1 AND plan_id=$2 ORDER BY created_at DESC', [clientId, planId]);
  return { ...result.rows[0], reviews: reviews.rows, execution_allowed: false, commands_executed: false };
}

async function reviewShadowPlan(clientId, planId, decision, options = {}) {
  await ensureNetworkAutomationSchema(options.queryable || db);
  const normalized = enumValue(decision, 'decision', ['confirmed','rejected','needs_changes']);
  const external = options.queryable || null; const queryable = external || await db.connect();
  try {
    if (!external) await queryable.query('BEGIN');
    const result = await queryable.query(
      `UPDATE network_action_plans SET review_status=$3,reviewed_by=$4,review_note=$5,reviewed_at=NOW(),updated_at=NOW()
       WHERE client_id=$1 AND id=$2 AND status='shadow' RETURNING *`,
      [clientId, planId, normalized, options.adminId || null, cleanText(options.note, 2000) || null]);
    if (!result.rows[0]) { if (!external) await queryable.query('ROLLBACK'); return null; }
    await queryable.query(
      `INSERT INTO network_action_plan_reviews (id,plan_id,client_id,decision,note,reviewed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), planId, clientId, normalized, cleanText(options.note, 2000) || null, options.adminId || null]);
    await appendBillingEvent(queryable, {
      clientId, eventType: 'network.shadow_plan_reviewed', category: 'network', source: 'network_shadow_planner',
      entityType: 'router', entityId: result.rows[0].router_id, severity: 'info',
      title: `Shadow plan ${normalized}`, description: `Plan ${planId} was reviewed. No router command was executed.`,
      payload: { plan_id: planId, decision: normalized, action_type: result.rows[0].action_type,
        execution_allowed: false, commands_executed: false },
      relatedEntities: [{ entityType: 'network_action_plan', entityId: planId, relationship: 'review' }],
      deduplicationKey: `network-shadow-review:${planId}:${crypto.randomUUID()}`, sensitivity: 'restricted',
    });
    if (!external) await queryable.query('COMMIT');
    return { ...result.rows[0], execution_allowed: false, commands_executed: false };
  } catch (error) {
    if (!external) try { await queryable.query('ROLLBACK'); } catch (_) { /* no transaction */ }
    throw error;
  } finally { if (!external) queryable.release(); }
}

async function getAutomationOverview(clientId, queryable = db) {
  await ensureNetworkAutomationSchema(queryable);
  const result = await queryable.query(
    `SELECT COUNT(*)::int total_plans,
       COUNT(*) FILTER (WHERE review_status='pending')::int pending_review,
       COUNT(*) FILTER (WHERE review_status='confirmed')::int confirmed,
       COUNT(*) FILTER (WHERE risk_level='critical')::int critical_risk,
       MAX(last_refreshed_at) last_planned_at
     FROM network_action_plans WHERE client_id=$1 AND status='shadow'`, [clientId]);
  return { ...result.rows[0], catalog_actions: getActionCatalog().length, mode: 'shadow',
    automatic_execution: false, execution_allowed: false, commands_executed: 0 };
}

async function buildNetworkAutomationContext(clientId, question = '', options = {}) {
  const plans = await listShadowPlans(clientId, { limit: options.limit || 10 });
  const terms = cleanText(question, 500).toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
  const selected = terms.length ? plans.filter((plan) => terms.some((term) =>
    `${plan.title} ${plan.reason} ${plan.action_type} ${plan.router_name}`.toLowerCase().includes(term))).slice(0, options.limit || 10) : plans;
  return {
    context: selected.map((plan) => [
      `Shadow network plan ${plan.id}: ${plan.title} for ${plan.router_name}.`,
      `Risk ${plan.risk_level}; review ${plan.review_status}; confidence ${plan.confidence}%.`,
      `Reason: ${plan.reason}`,
      `Preconditions: ${(plan.preconditions || []).join('; ')}.`,
      `Verification: ${(plan.verification || []).join('; ')}.`,
      'Execution state: preview only; no RouterOS command was executed.',
    ].join('\n')).join('\n\n'),
    sources: selected.map((plan) => ({ type: 'network_action_plan', id: plan.id,
      action_type: plan.action_type, review_status: plan.review_status, router_id: plan.router_id })),
  };
}

module.exports = {
  ACTIONS,
  FORBIDDEN_PATHS,
  NETWORK_AUTOMATION_SCHEMA_SQL,
  buildActionPlan,
  buildNetworkAutomationContext,
  createShadowPlan,
  ensureNetworkAutomationSchema,
  getActionCatalog,
  getAutomationOverview,
  getShadowPlan,
  listShadowPlans,
  planTenantSignals,
  reviewShadowPlan,
  runShadowPlannerOnce,
  startNetworkShadowPlannerScheduler,
  suggestedActionForText,
  validateOperation,
};
