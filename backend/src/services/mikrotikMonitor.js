const db = require('../db');
const { sendWhatsAppMessage } = require('./whatsapp');
const { sendClientText } = require('./clientEvolution');
const { collectMonitoringSnapshot, ensureMikrotikTables } = require('./mikrotik');

let schemaReady = false;
let schedulerStarted = false;
let schedulerBusy = false;

const CHECK_INTERVAL_MS = 60 * 1000;
const COOLDOWNS = {
  router_offline: 5,
  router_back_online: 0,
  high_cpu: 10,
  storage_bad: 30,
  security_failed_login: 10,
};

const notificationTemplates = {
  router_offline: [
    'Router offline\n\n{{router_name}} is not responding right now.\nLast seen: {{last_seen}}\nDowntime so far: {{downtime_minutes}} minutes.\n\nPossible causes: power, uplink, reboot, or WireGuard/API tunnel issue.',
    'Boss, I cannot reach {{router_name}} at the moment.\n\nLast successful check: {{last_seen}}\nEstimated downtime: {{downtime_minutes}} minutes.\n\nPlease check power or uplink first.',
    'Network alert\n\n{{router_name}} appears offline. I tried reading PPPoE, hotspot and router health, but the API did not respond.',
    '{{router_name}} has gone silent.\n\nNo API response detected.\nLast seen: {{last_seen}}\nDowntime: {{downtime_minutes}} minutes.',
    'Possible outage detected\n\nRouter: {{router_name}}\nStatus: Unreachable\nLast seen: {{last_seen}}\n\nCustomers under this router may be affected.',
    'I have detected a possible router outage.\n\n{{router_name}} is unreachable for {{downtime_minutes}} minutes. Please confirm power and uplink.',
    '{{router_name}} is offline.\n\nI cannot read PPPoE, hotspot, WAN or router health data until it comes back online.',
  ],
  router_back_online: [
    'Router back online\n\n{{router_name}} is reachable again.\nDowntime: {{downtime_duration}}\nCPU: {{cpu_load}}%',
    'Good news, {{router_name}} is back online.\n\nIt was down for about {{downtime_duration}}. I will keep watching it for stability.',
    'Recovery detected\n\nRouter: {{router_name}}\nStatus: Online again\nDowntime: {{downtime_duration}}',
    '{{router_name}} has reconnected.\n\nCPU: {{cpu_load}}%\nStorage free: {{storage_free_percent}}%',
    'Boss, the router is back.\n\n{{router_name}} is responding again after {{downtime_duration}} of downtime.',
    '{{router_name}} is alive again.\n\nWAN traffic: {{wan_rx_mbps}} Mbps down / {{wan_tx_mbps}} Mbps up.',
    'Router recovery notice\n\n{{router_name}} is back online. Check logs later if the drop repeats.',
  ],
  high_cpu: [
    'Router CPU is high\n\nRouter: {{router_name}}\nCPU Load: {{cpu_load}}%\nFree memory: {{free_memory}}\n\nCustomers may feel slow browsing if this continues.',
    'Boss, {{router_name}} is under pressure.\n\nCPU: {{cpu_load}}%\nFree memory: {{free_memory}}\n\nWorth checking heavy traffic or queue/firewall load.',
    'Performance warning\n\n{{router_name}} CPU has stayed high at {{cpu_load}}%.\nWAN: {{wan_rx_mbps}} Mbps down / {{wan_tx_mbps}} Mbps up.',
    '{{router_name}} is working harder than normal.\n\nCPU: {{cpu_load}}%\nMemory free: {{free_memory}}\n\nCheck traffic spikes and heavy rules.',
    'Critical router load\n\n{{router_name}} CPU has reached {{cpu_load}}%. This can affect PPPoE login, hotspot auth and browsing speed.',
    'The router load is not looking normal.\n\n{{router_name}} is at {{cpu_load}}% CPU. Please check traffic spikes, queues and heavy firewall rules.',
    'CPU alert\n\n{{router_name}} may be overloaded.\nCPU: {{cpu_load}}%\n\nIf this continues, check traffic spikes or schedule maintenance.',
  ],
  storage_bad: [
    'Router storage warning\n\nRouter: {{router_name}}\nStorage free: {{storage_free_percent}}%\nFree storage: {{free_storage}}\nBad blocks: {{bad_blocks}}%\n\nPlease review storage health and logs.',
    'Boss, {{router_name}} needs a storage check.\n\nFree storage is {{storage_free_percent}}% and bad blocks are {{bad_blocks}}%. If this keeps getting worse, RouterOS stability can be affected.',
    'MikroTik resource alert\n\n{{router_name}} storage is not looking healthy.\nFree: {{free_storage}} of {{total_storage}}\nBad blocks: {{bad_blocks}}%',
  ],
  security_failed_login: [
    'Security alert\n\nRouter: {{router_name}}\nService: {{service}}\nSource IP: {{source_ip}}\nFailed attempts: {{attempt_count}}\n\nSomeone may be trying to access the router.',
    'Boss, I noticed repeated failed login attempts on {{router_name}}.\n\nService: {{service}}\nSource: {{source_ip}}\nAttempts: {{attempt_count}}\n\nPlease restrict access to trusted IPs or VPN.',
    'Router login attack possible\n\n{{attempt_count}} failed attempts were detected on {{router_name}} from {{source_ip}}.',
    'Security warning\n\n{{router_name}} received failed login attempts through {{service}}.\nSource IP: {{source_ip}}\nAttempts: {{attempt_count}}',
    'MikroTik access risk\n\nA device from {{source_ip}} is trying to login to {{router_name}} using {{service}}.',
    'Nexa security check found suspicious login activity.\n\nRouter: {{router_name}}\nAttempts: {{attempt_count}}\nService: {{service}}',
    'Failed login activity\n\n{{router_name}} may be exposed or under brute-force attempt.\nSource: {{source_ip}}\nService: {{service}}',
  ],
};

function cleanPhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function formatBytes(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return 'not shown';
  if (num >= 1024 * 1024 * 1024) return `${(num / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (num >= 1024 * 1024) return `${(num / 1024 / 1024).toFixed(1)} MB`;
  if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${num} B`;
}

function renderTemplate(template, variables = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = variables[key];
    if (value === null || value === undefined || value === '') return 'not available';
    return String(value);
  });
}

function chooseTemplate(eventType) {
  const templates = notificationTemplates[eventType] || [];
  const index = templates.length ? Math.floor(Math.random() * templates.length) : 0;
  return { index, template: templates[index] || `${eventType}: {{router_name}} needs attention.` };
}

async function ensureMonitorSchema() {
  if (schemaReady) return;
  await ensureMikrotikTables();
  await db.query(`
    CREATE TABLE IF NOT EXISTS router_snapshots (
      id SERIAL PRIMARY KEY,
      router_id INTEGER NOT NULL REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
      router_name VARCHAR(160),
      cpu_load NUMERIC,
      free_memory BIGINT,
      total_memory BIGINT,
      uptime VARCHAR(120),
      wan_rx_mbps NUMERIC,
      wan_tx_mbps NUMERIC,
      active_pppoe INTEGER,
      active_hotspot INTEGER,
      wan_link_status VARCHAR(60),
      wan_link_speed VARCHAR(80),
      gateway_status VARCHAR(60),
      dns_status VARCHAR(60),
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS router_states (
      router_id INTEGER PRIMARY KEY REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
      is_online BOOLEAN NOT NULL DEFAULT FALSE,
      last_seen TIMESTAMP WITH TIME ZONE,
      offline_since TIMESTAMP WITH TIME ZONE,
      previous_pppoe_count INTEGER DEFAULT 0,
      previous_hotspot_count INTEGER DEFAULT 0,
      last_cpu_status VARCHAR(40),
      last_security_signature TEXT,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notification_events (
      id SERIAL PRIMARY KEY,
      router_id INTEGER REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
      event_type VARCHAR(80) NOT NULL,
      severity VARCHAR(30) NOT NULL DEFAULT 'info',
      title VARCHAR(180),
      variables_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      selected_template_index INTEGER,
      message_sent TEXT,
      whatsapp_number VARCHAR(80),
      sent_at TIMESTAMP WITH TIME ZONE,
      cooldown_until TIMESTAMP WITH TIME ZONE,
      status VARCHAR(30) NOT NULL DEFAULT 'created',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_router_snapshots_router_time ON router_snapshots(router_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notification_events_router_type_time ON notification_events(router_id, event_type, created_at DESC)`);
  schemaReady = true;
}

async function activeRouters() {
  await ensureMonitorSchema();
  const result = await db.query(`SELECT * FROM mikrotik_routers WHERE is_active = TRUE ORDER BY id ASC`);
  return result.rows;
}

async function loadClient(clientId) {
  const result = await db.query(`SELECT * FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
  return result.rows[0] || null;
}

async function routerAlertRecipients(clientId) {
  const result = await db.query(
    `SELECT e.name, e.phone
     FROM workflow_routes wr
     JOIN employees e ON e.client_id = wr.client_id
      AND (
        e.id = wr.employee_id
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(wr.employee_ids) AS employee_id(value)
          WHERE employee_id.value ~ '^[0-9]+$' AND employee_id.value::int = e.id
        )
      )
     WHERE wr.client_id = $1
       AND wr.intent_key = 'router_alerts'
       AND wr.is_enabled = TRUE
       AND COALESCE(e.phone, '') <> ''`,
    [clientId]
  ).catch(() => ({ rows: [] }));
  return result.rows.map((row) => ({ name: row.name, phone: cleanPhone(row.phone) })).filter((row) => row.phone);
}

async function sendAdminWhatsAppNotification(client, phoneNumber, message) {
  if (client?.connection_provider === 'evolution' && client.evolution_instance_name) {
    await sendClientText(client, phoneNumber, message);
    return;
  }
  await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, message);
}

async function storeSnapshot(snapshot) {
  await db.query(
    `INSERT INTO router_snapshots
       (router_id, router_name, cpu_load, free_memory, total_memory, uptime, wan_rx_mbps, wan_tx_mbps,
        active_pppoe, active_hotspot, wan_link_status, wan_link_speed, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      snapshot.router_id,
      snapshot.router_name,
      snapshot.cpu_load,
      snapshot.free_memory,
      snapshot.total_memory,
      snapshot.uptime,
      snapshot.wan_rx_mbps,
      snapshot.wan_tx_mbps,
      snapshot.active_pppoe,
      snapshot.active_hotspot,
      snapshot.wan_link_status,
      snapshot.wan_link_speed,
      JSON.stringify(snapshot),
    ]
  );
}

async function getState(routerId) {
  const result = await db.query(`SELECT * FROM router_states WHERE router_id = $1`, [routerId]);
  return result.rows[0] || null;
}

async function saveState(routerId, patch) {
  const current = await getState(routerId);
  const next = {
    is_online: patch.is_online ?? current?.is_online ?? false,
    last_seen: patch.last_seen ?? current?.last_seen ?? null,
    offline_since: patch.offline_since ?? current?.offline_since ?? null,
    previous_pppoe_count: patch.previous_pppoe_count ?? current?.previous_pppoe_count ?? 0,
    previous_hotspot_count: patch.previous_hotspot_count ?? current?.previous_hotspot_count ?? 0,
    last_cpu_status: patch.last_cpu_status ?? current?.last_cpu_status ?? null,
    last_security_signature: patch.last_security_signature ?? current?.last_security_signature ?? null,
    state_json: { ...(current?.state_json || {}), ...(patch.state_json || {}) },
  };
  await db.query(
    `INSERT INTO router_states
       (router_id, is_online, last_seen, offline_since, previous_pppoe_count, previous_hotspot_count,
        last_cpu_status, last_security_signature, state_json, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
     ON CONFLICT (router_id) DO UPDATE SET
       is_online = EXCLUDED.is_online,
       last_seen = EXCLUDED.last_seen,
       offline_since = EXCLUDED.offline_since,
       previous_pppoe_count = EXCLUDED.previous_pppoe_count,
       previous_hotspot_count = EXCLUDED.previous_hotspot_count,
       last_cpu_status = EXCLUDED.last_cpu_status,
       last_security_signature = EXCLUDED.last_security_signature,
       state_json = EXCLUDED.state_json,
       updated_at = NOW()`,
    [
      routerId,
      next.is_online,
      next.last_seen,
      next.offline_since,
      next.previous_pppoe_count,
      next.previous_hotspot_count,
      next.last_cpu_status,
      next.last_security_signature,
      JSON.stringify(next.state_json || {}),
    ]
  );
}

async function cooldownBlocked(routerId, eventType, key = '') {
  const result = await db.query(
    `SELECT cooldown_until
     FROM notification_events
     WHERE router_id = $1
       AND event_type = $2
       AND COALESCE(variables_json->>'key', '') = $3
       AND cooldown_until > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [routerId, eventType, key]
  );
  return Boolean(result.rows[0]);
}

async function notifyEvent({ router, client, eventType, severity, variables, key = '' }) {
  const cooldown = COOLDOWNS[eventType] ?? 10;
  if (cooldown > 0 && await cooldownBlocked(router.id, eventType, key)) return { skipped: true, reason: 'cooldown' };
  const recipients = await routerAlertRecipients(router.client_id);
  if (!recipients.length) return { skipped: true, reason: 'no_router_alert_workflow_recipient' };
  const { index, template } = chooseTemplate(eventType);
  const message = renderTemplate(template, variables);
  const cooldownUntil = new Date(Date.now() + cooldown * 60 * 1000);
  for (const recipient of recipients) {
    try {
      await sendAdminWhatsAppNotification(client, recipient.phone, message);
      await db.query(
        `INSERT INTO notification_events
           (router_id, event_type, severity, title, variables_json, selected_template_index, message_sent,
            whatsapp_number, sent_at, cooldown_until, status)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,NOW(),$9,'sent')`,
        [
          router.id,
          eventType,
          severity,
          variables.router_name || router.name,
          JSON.stringify({ ...variables, key }),
          index,
          message,
          recipient.phone,
          cooldownUntil,
        ]
      );
    } catch (err) {
      await db.query(
        `INSERT INTO notification_events
           (router_id, event_type, severity, title, variables_json, selected_template_index, message_sent,
            whatsapp_number, cooldown_until, status)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'failed')`,
        [
          router.id,
          eventType,
          severity,
          variables.router_name || router.name,
          JSON.stringify({ ...variables, key, error: err.message }),
          index,
          message,
          recipient.phone,
          cooldownUntil,
        ]
      );
    }
  }
  return { sent: true, recipients: recipients.length, message };
}

function securityFailures(logs = []) {
  const counts = new Map();
  for (const row of logs || []) {
    const message = String(row.message || '');
    const match = message.match(/login failure for user\s+(.+?)\s+from\s+([0-9a-fA-F:.]+)\s+via\s+([a-z0-9-]+)/i);
    if (!match) continue;
    const key = `${match[2]}|${String(match[3]).toLowerCase()}`;
    const current = counts.get(key) || { source_ip: match[2], service: String(match[3]).toLowerCase(), attempt_count: 0 };
    current.attempt_count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].filter((item) => item.attempt_count >= 3);
}

function cpuStatus(cpu) {
  if (!Number.isFinite(Number(cpu))) return 'unknown';
  if (Number(cpu) >= 90) return 'critical';
  if (Number(cpu) >= 80) return 'warning';
  return 'normal';
}

function numeric(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function percentFree(free, total) {
  const freeNum = numeric(free);
  const totalNum = numeric(total);
  if (freeNum === null || totalNum === null || totalNum <= 0) return null;
  return Math.round((freeNum / totalNum) * 100);
}

function storageStatus(snapshot) {
  const badBlocks = numeric(snapshot.bad_blocks);
  const freePercent = percentFree(snapshot.free_storage, snapshot.total_storage);
  if ((badBlocks !== null && badBlocks >= 5) || (freePercent !== null && freePercent <= 10)) return 'critical';
  if ((badBlocks !== null && badBlocks >= 1) || (freePercent !== null && freePercent <= 20)) return 'warning';
  return 'normal';
}

async function processSnapshot(router, client, snapshot, state) {
  await storeSnapshot(snapshot);
  const variables = {
    router_name: snapshot.router_name || router.name,
    cpu_load: numeric(snapshot.cpu_load),
    free_memory: formatBytes(snapshot.free_memory),
    total_memory: formatBytes(snapshot.total_memory),
    free_storage: formatBytes(snapshot.free_storage),
    total_storage: formatBytes(snapshot.total_storage),
    storage_free_percent: percentFree(snapshot.free_storage, snapshot.total_storage),
    bad_blocks: numeric(snapshot.bad_blocks),
    wan_rx_mbps: numeric(snapshot.wan_rx_mbps),
    wan_tx_mbps: numeric(snapshot.wan_tx_mbps),
  };
  const previousJson = state?.state_json || {};
  const previousFailureCount = Number(previousJson.failure_count || 0);
  if (state && state.is_online === false && previousFailureCount >= 2) {
    const offlineSince = state.offline_since ? new Date(state.offline_since) : new Date();
    const downtimeMinutes = Math.max(1, Math.round((Date.now() - offlineSince.getTime()) / 60000));
    await notifyEvent({
      router,
      client,
      eventType: 'router_back_online',
      severity: 'recovery',
      variables: { ...variables, downtime_duration: `${downtimeMinutes} minutes` },
    });
  }

  const currentCpuStatus = cpuStatus(snapshot.cpu_load);
  const previousCpuStatus = state?.last_cpu_status || 'normal';
  const cpuConfirmCount = currentCpuStatus === previousCpuStatus
    ? Number(previousJson.cpu_confirm_count || 0) + 1
    : 1;
  const requiredCpuChecks = currentCpuStatus === 'critical' ? 2 : 3;
  if (['warning', 'critical'].includes(currentCpuStatus) && cpuConfirmCount >= requiredCpuChecks && currentCpuStatus !== previousJson.last_cpu_alert_status) {
    await notifyEvent({ router, client, eventType: 'high_cpu', severity: currentCpuStatus, variables });
  }

  const currentStorageStatus = storageStatus(snapshot);
  const storageConfirmCount = currentStorageStatus === previousJson.last_storage_status
    ? Number(previousJson.storage_confirm_count || 0) + 1
    : 1;
  if (['warning', 'critical'].includes(currentStorageStatus) && storageConfirmCount >= 2 && currentStorageStatus !== previousJson.last_storage_alert_status) {
    await notifyEvent({ router, client, eventType: 'storage_bad', severity: currentStorageStatus, variables });
  }

  const failures = securityFailures(snapshot.logs).sort((a, b) => b.attempt_count - a.attempt_count);
  const topFailure = failures[0] || null;
  const securitySignature = topFailure ? `${topFailure.source_ip}|${topFailure.service}|${topFailure.attempt_count}` : state?.last_security_signature || null;
  if (topFailure && securitySignature !== state?.last_security_signature) {
    await notifyEvent({
      router,
      client,
      eventType: 'security_failed_login',
      severity: 'critical',
      key: `${topFailure.source_ip}|${topFailure.service}`,
      variables: { ...variables, ...topFailure },
    });
  }

  await saveState(router.id, {
    is_online: true,
    last_seen: new Date(),
    offline_since: null,
    previous_pppoe_count: state?.previous_pppoe_count ?? 0,
    previous_hotspot_count: state?.previous_hotspot_count ?? 0,
    last_cpu_status: currentCpuStatus,
    last_security_signature: securitySignature,
    state_json: {
      failure_count: 0,
      cpu_confirm_count: cpuConfirmCount,
      last_cpu_alert_status: ['warning', 'critical'].includes(currentCpuStatus) && cpuConfirmCount >= requiredCpuChecks
        ? currentCpuStatus
        : null,
      last_storage_status: currentStorageStatus,
      storage_confirm_count: storageConfirmCount,
      last_storage_alert_status: ['warning', 'critical'].includes(currentStorageStatus) && storageConfirmCount >= 2
        ? currentStorageStatus
        : null,
      pppoe_drop_candidate: null,
      hotspot_drop_candidate: null,
      source_ok: snapshot.source_ok || {},
    },
  });
}

async function processRouter(router) {
  const client = await loadClient(router.client_id);
  if (!client) return;
  const state = await getState(router.id);
  try {
    const snapshot = await collectMonitoringSnapshot(router);
    await processSnapshot(router, client, snapshot, state);
  } catch (err) {
    const now = new Date();
    const failureCount = Number(state?.state_json?.failure_count || 0) + 1;
    const offlineSince = state?.offline_since ? new Date(state.offline_since) : now;
    const downtimeMinutes = Math.max(1, Math.round((Date.now() - offlineSince.getTime()) / 60000));
    await saveState(router.id, {
      is_online: false,
      offline_since: state?.offline_since || now,
      previous_pppoe_count: state?.previous_pppoe_count || 0,
      previous_hotspot_count: state?.previous_hotspot_count || 0,
      state_json: {
        ...(state?.state_json || {}),
        failure_count: failureCount,
        last_error: err.message || 'router check failed',
      },
    });
    if (failureCount >= 2 && (!state || state.is_online !== false || Number(state?.state_json?.failure_count || 0) < 2)) {
      await notifyEvent({
        router,
        client,
        eventType: 'router_offline',
        severity: 'critical',
        variables: {
          router_name: router.last_identity || router.name,
          last_seen: state?.last_seen || router.last_seen_at || 'not confirmed',
          downtime_minutes: downtimeMinutes,
          possible_causes: 'power, uplink, router reboot, API, or WireGuard tunnel problem',
        },
      });
    }
  }
}

async function runMikrotikMonitorOnce() {
  await ensureMonitorSchema();
  const routers = await activeRouters();
  for (const router of routers) {
    await processRouter(router);
  }
  return { routers: routers.length };
}

function startMikrotikMonitorScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  ensureMonitorSchema()
    .then(() => console.log('MikroTik monitor scheduler ready for 1 minute checks.'))
    .catch((err) => console.error('MikroTik monitor schema failed:', err.message));
  setInterval(() => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    runMikrotikMonitorOnce()
      .catch((err) => console.error('MikroTik monitor failed:', err.message))
      .finally(() => {
        schedulerBusy = false;
      });
  }, CHECK_INTERVAL_MS);
}

async function previewMikrotikAlert({ clientId, routerId, eventType, variables = {}, send = false }) {
  await ensureMonitorSchema();
  const routerResult = await db.query(
    `SELECT * FROM mikrotik_routers WHERE client_id = $1 AND id = $2 LIMIT 1`,
    [clientId, routerId]
  );
  const router = routerResult.rows[0];
  if (!router) throw new Error('Router not found');
  const client = await loadClient(clientId);
  const vars = { router_name: router.name, ...variables };
  const { index, template } = chooseTemplate(eventType);
  const message = renderTemplate(template, vars);
  if (send) {
    await notifyEvent({ router, client, eventType, severity: 'info', variables: vars });
  }
  return { event_type: eventType, template_index: index, message };
}

module.exports = {
  ensureMonitorSchema,
  previewMikrotikAlert,
  runMikrotikMonitorOnce,
  startMikrotikMonitorScheduler,
};
