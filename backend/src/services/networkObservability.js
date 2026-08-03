const crypto = require('crypto');
const db = require('../db');
const { appendBillingEvent, ensureEventSchema } = require('./events');
const { connectRouter, ensureMikrotikTables, getRouter } = require('./mikrotik');
const { observeTwinEntity } = require('./digitalTwin');

const COLLECTION_INTERVAL_MS = Math.max(60_000, Number(process.env.NETWORK_OBSERVABILITY_INTERVAL_MS || 300_000));
const BASELINE_DAYS = Math.max(7, Math.min(90, Number(process.env.NETWORK_BASELINE_DAYS || 30)));
const MIN_BASELINE_SAMPLES = Math.max(12, Number(process.env.NETWORK_BASELINE_MIN_SAMPLES || 30));
const ANOMALY_Z_THRESHOLD = Math.max(2.5, Number(process.env.NETWORK_ANOMALY_Z_THRESHOLD || 4));
const MAX_ROWS_PER_SOURCE = 2_000;

let schemaReady = false;
let schedulerStarted = false;
let schedulerBusy = false;

const READ_ONLY_SOURCES = [
  ['identity', '/system/identity/print'],
  ['resource', '/system/resource/print'],
  ['interfaces', '/interface/print'],
  ['neighbors', '/ip/neighbor/print'],
  ['routes', '/ip/route/print'],
  ['bridge_ports', '/interface/bridge/port/print'],
  ['bridge_vlans', '/interface/bridge/vlan/print'],
  ['vlans', '/interface/vlan/print'],
  ['arp', '/ip/arp/print'],
  ['ospf_neighbors', '/routing/ospf/neighbor/print'],
  ['bgp_sessions', '/routing/bgp/session/print'],
  ['wireguard_peers', '/interface/wireguard/peers/print'],
  ['ppp_active', '/ppp/active/print'],
  ['hotspot_active', '/ip/hotspot/active/print'],
  ['dhcp_leases', '/ip/dhcp-server/lease/print'],
];

const NETWORK_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS network_collection_runs (
    id UUID PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'running',
    source_status JSONB NOT NULL DEFAULT '{}'::jsonb,
    topology_nodes INTEGER NOT NULL DEFAULT 0,
    topology_edges INTEGER NOT NULL DEFAULT 0,
    metric_samples INTEGER NOT NULL DEFAULT 0,
    anomalies_detected INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    FOREIGN KEY (client_id, router_id) REFERENCES mikrotik_routers(client_id, id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_topology_nodes (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL,
    node_key VARCHAR(255) NOT NULL,
    node_type VARCHAR(80) NOT NULL,
    display_name VARCHAR(255),
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_run_id UUID,
    UNIQUE (client_id, router_id, node_key),
    FOREIGN KEY (client_id, router_id) REFERENCES mikrotik_routers(client_id, id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_topology_edges (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL,
    edge_key VARCHAR(255) NOT NULL,
    from_node_key VARCHAR(255) NOT NULL,
    relationship VARCHAR(80) NOT NULL,
    to_node_key VARCHAR(255) NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_run_id UUID,
    UNIQUE (client_id, router_id, edge_key),
    FOREIGN KEY (client_id, router_id) REFERENCES mikrotik_routers(client_id, id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_metric_samples (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL,
    metric_name VARCHAR(120) NOT NULL,
    subject_type VARCHAR(80) NOT NULL DEFAULT 'router',
    subject_key VARCHAR(255) NOT NULL DEFAULT 'router',
    value NUMERIC NOT NULL,
    unit VARCHAR(40),
    labels JSONB NOT NULL DEFAULT '{}'::jsonb,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_id UUID,
    FOREIGN KEY (client_id, router_id) REFERENCES mikrotik_routers(client_id, id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_metric_baselines (
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL,
    metric_name VARCHAR(120) NOT NULL,
    subject_type VARCHAR(80) NOT NULL,
    subject_key VARCHAR(255) NOT NULL,
    hour_of_week INTEGER NOT NULL CHECK (hour_of_week BETWEEN 0 AND 167),
    sample_count INTEGER NOT NULL,
    mean_value NUMERIC NOT NULL,
    stddev_value NUMERIC NOT NULL DEFAULT 0,
    p50_value NUMERIC NOT NULL,
    p95_value NUMERIC NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    window_ended_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, router_id, metric_name, subject_type, subject_key, hour_of_week),
    FOREIGN KEY (client_id, router_id) REFERENCES mikrotik_routers(client_id, id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS network_anomalies (
    id UUID PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    router_id INTEGER NOT NULL,
    metric_name VARCHAR(120) NOT NULL,
    subject_type VARCHAR(80) NOT NULL,
    subject_key VARCHAR(255) NOT NULL,
    observed_value NUMERIC NOT NULL,
    expected_value NUMERIC NOT NULL,
    deviation_score NUMERIC NOT NULL,
    severity VARCHAR(24) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'open',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurrences INTEGER NOT NULL DEFAULT 1,
    first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    FOREIGN KEY (client_id, router_id) REFERENCES mikrotik_routers(client_id, id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_network_runs_tenant_router_time
    ON network_collection_runs(client_id, router_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_network_nodes_tenant_router_active
    ON network_topology_nodes(client_id, router_id, active, node_type);
  CREATE INDEX IF NOT EXISTS idx_network_edges_tenant_router_active
    ON network_topology_edges(client_id, router_id, active, relationship);
  CREATE INDEX IF NOT EXISTS idx_network_metrics_tenant_router_metric_time
    ON network_metric_samples(client_id, router_id, metric_name, observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_network_anomalies_tenant_status_time
    ON network_anomalies(client_id, status, last_detected_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_network_anomalies_one_open
    ON network_anomalies(client_id, router_id, metric_name, subject_type, subject_key)
    WHERE status = 'open';
`;

function cleanText(value, maxLength = 255) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function truthy(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'yes';
}

function metricNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function safeRatio(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return Number(((used / total) * 100).toFixed(3));
}

function stablePart(value) {
  const text = cleanText(value, 500).toLowerCase();
  if (!text) return 'unknown';
  return text.replace(/[^a-z0-9_.:@/%-]+/g, '-').slice(0, 160);
}

function opaquePart(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
}

function redactRow(row) {
  const blocked = /(^|[-_.])(password|secret|private[-_]?key|token|community)([-_.]|$)/i;
  return Object.fromEntries(Object.entries(row || {})
    .filter(([key]) => !blocked.test(key))
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 1000) : value]));
}

function nodeKey(routerId, type, identity) {
  return `router:${routerId}:${stablePart(type)}:${stablePart(identity)}`.slice(0, 255);
}

function edgeKey(from, relationship, to) {
  return `${from}|${stablePart(relationship)}|${to}`.slice(0, 255);
}

function buildTopology(router, facts) {
  const nodes = new Map();
  const edges = new Map();
  const root = `router:${router.id}`;
  const addNode = (key, type, displayName, attributes = {}) => {
    if (!key || nodes.has(key)) return;
    nodes.set(key, { node_key: key, node_type: type, display_name: cleanText(displayName || key), attributes: redactRow(attributes) });
  };
  const addEdge = (from, relationship, to, attributes = {}) => {
    if (!from || !to) return;
    const key = edgeKey(from, relationship, to);
    edges.set(key, { edge_key: key, from_node_key: from, relationship, to_node_key: to, attributes: redactRow(attributes) });
  };

  const identity = facts.identity?.[0] || {};
  const resource = facts.resource?.[0] || {};
  addNode(root, 'router', identity.name || router.name, {
    router_id: router.id,
    version: resource.version || router.last_version || '',
    board_name: resource['board-name'] || '',
    architecture: resource['architecture-name'] || '',
  });

  for (const iface of facts.interfaces || []) {
    const name = cleanText(iface.name, 160); if (!name) continue;
    const key = nodeKey(router.id, 'interface', name);
    addNode(key, 'interface', name, {
      type: iface.type || '', running: truthy(iface.running), disabled: truthy(iface.disabled),
      mac_address: iface['mac-address'] || '', mtu: iface['actual-mtu'] || iface.mtu || '', comment: iface.comment || '',
    });
    addEdge(root, 'contains', key);
  }

  for (const bridge of facts.bridge_ports || []) {
    const bridgeName = bridge.bridge; const interfaceName = bridge.interface;
    if (!bridgeName || !interfaceName) continue;
    const bridgeKey = nodeKey(router.id, 'bridge', bridgeName);
    const interfaceKey = nodeKey(router.id, 'interface', interfaceName);
    addNode(bridgeKey, 'bridge', bridgeName);
    addNode(interfaceKey, 'interface', interfaceName);
    addEdge(bridgeKey, 'has_port', interfaceKey, { pvid: bridge.pvid || '', role: bridge.role || '' });
  }

  for (const vlan of facts.vlans || []) {
    const identityValue = vlan.name || vlan['vlan-id']; if (!identityValue) continue;
    const key = nodeKey(router.id, 'vlan', identityValue);
    addNode(key, 'vlan', vlan.name || `VLAN ${vlan['vlan-id']}`, { vlan_id: vlan['vlan-id'] || '', interface: vlan.interface || '' });
    addEdge(root, 'provides_vlan', key);
    if (vlan.interface) addEdge(key, 'runs_on', nodeKey(router.id, 'interface', vlan.interface));
  }

  for (const neighbor of facts.neighbors || []) {
    const identityValue = neighbor['mac-address'] || neighbor.address || neighbor.identity;
    if (!identityValue) continue;
    const key = nodeKey(router.id, 'neighbor', identityValue);
    addNode(key, 'neighbor', neighbor.identity || neighbor.address || identityValue, {
      address: neighbor.address || '', mac_address: neighbor['mac-address'] || '',
      platform: neighbor.platform || '', version: neighbor.version || '', board: neighbor.board || '',
    });
    const interfaceKey = neighbor.interface ? nodeKey(router.id, 'interface', neighbor.interface) : root;
    addEdge(interfaceKey, 'connected_to', key, { protocol: neighbor.discovered_by || neighbor['discovered-by'] || '' });
  }

  for (const route of (facts.routes || []).slice(0, 500)) {
    const destination = route['dst-address'] || route.dst || '';
    const gateway = route.gateway || route['immediate-gw'] || '';
    if (!gateway || (!truthy(route.active) && route.active !== undefined)) continue;
    const key = nodeKey(router.id, 'gateway', gateway);
    addNode(key, destination === '0.0.0.0/0' || destination === '::/0' ? 'upstream_gateway' : 'gateway', gateway, {
      destination, distance: route.distance || '', routing_table: route['routing-table'] || 'main', protocol: route['belongs-to'] || '',
    });
    addEdge(root, destination === '0.0.0.0/0' || destination === '::/0' ? 'uses_upstream' : 'routes_via', key, { destination });
  }

  for (const peer of facts.wireguard_peers || []) {
    const publicKey = peer['public-key'] || peer['client-public-key'] || peer.comment;
    if (!publicKey) continue;
    const key = nodeKey(router.id, 'wireguard_peer', opaquePart(publicKey));
    addNode(key, 'wireguard_peer', peer.comment || 'WireGuard peer', {
      interface: peer.interface || '', allowed_address: peer['allowed-address'] || '', endpoint_address: peer['current-endpoint-address'] || '',
    });
    addEdge(root, 'tunnels_to', key);
  }

  for (const [type, rows, relationship] of [
    ['ospf_peer', facts.ospf_neighbors || [], 'ospf_adjacent'],
    ['bgp_peer', facts.bgp_sessions || [], 'bgp_adjacent'],
  ]) {
    for (const peer of rows) {
      const identityValue = peer['remote-address'] || peer['remote.id'] || peer['remote-id'] || peer.name;
      if (!identityValue) continue;
      const key = nodeKey(router.id, type, identityValue);
      addNode(key, type, peer.name || identityValue, { state: peer.state || '', uptime: peer.uptime || '', remote_as: peer['remote.as'] || peer['remote-as'] || '' });
      addEdge(root, relationship, key);
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function buildMetrics(router, facts, observedAt = new Date()) {
  const metrics = [];
  const push = (metricName, value, unit, subjectType = 'router', subjectKey = `router:${router.id}`, labels = {}) => {
    if (!Number.isFinite(value)) return;
    metrics.push({ metric_name: metricName, value, unit, subject_type: subjectType, subject_key: cleanText(subjectKey), labels, observed_at: observedAt });
  };
  const resource = facts.resource?.[0] || {};
  const cpu = metricNumber(resource['cpu-load']);
  const freeMemory = metricNumber(resource['free-memory']);
  const totalMemory = metricNumber(resource['total-memory']);
  push('router.cpu_percent', cpu, 'percent');
  if (freeMemory !== null && totalMemory !== null) push('router.memory_used_percent', safeRatio(totalMemory - freeMemory, totalMemory), 'percent');
  push('sessions.pppoe_active', (facts.ppp_active || []).length, 'sessions');
  push('sessions.hotspot_active', (facts.hotspot_active || []).length, 'sessions');
  push('sessions.dhcp_bound', (facts.dhcp_leases || []).filter((row) => truthy(row.bound) || row.status === 'bound').length, 'leases');

  for (const iface of facts.interfaces || []) {
    const name = cleanText(iface.name, 160); if (!name) continue;
    const subjectKey = nodeKey(router.id, 'interface', name);
    const labels = { interface: name, type: iface.type || '', running: truthy(iface.running) };
    const traffic = facts.interface_traffic?.[name] || {};
    push('interface.rx_bps', metricNumber(traffic['rx-bits-per-second']), 'bps', 'interface', subjectKey, labels);
    push('interface.tx_bps', metricNumber(traffic['tx-bits-per-second']), 'bps', 'interface', subjectKey, labels);
    push('interface.rx_errors_total', metricNumber(iface['rx-error'] || iface['rx-errors']), 'errors', 'interface', subjectKey, labels);
    push('interface.tx_errors_total', metricNumber(iface['tx-error'] || iface['tx-errors']), 'errors', 'interface', subjectKey, labels);
    push('interface.rx_drops_total', metricNumber(iface['rx-drop'] || iface['rx-drops']), 'packets', 'interface', subjectKey, labels);
    push('interface.tx_drops_total', metricNumber(iface['tx-drop'] || iface['tx-drops']), 'packets', 'interface', subjectKey, labels);
  }
  return metrics;
}

function scoreMetric(sample, baseline, options = {}) {
  if (!baseline || Number(baseline.sample_count) < (options.minSamples || MIN_BASELINE_SAMPLES)) return null;
  const value = Number(sample.value); const mean = Number(baseline.mean_value);
  if (!Number.isFinite(value) || !Number.isFinite(mean)) return null;
  const p50 = Number(baseline.p50_value); const p95 = Number(baseline.p95_value);
  const stddev = Number(baseline.stddev_value || 0);
  const fallbackScale = Math.max(Math.abs(p95 - p50) / 1.645, Math.abs(mean) * 0.05, 1);
  const scale = stddev > 0.0001 ? stddev : fallbackScale;
  const deviation = (value - mean) / scale;
  const threshold = options.threshold || ANOMALY_Z_THRESHOLD;
  if (Math.abs(deviation) < threshold) return null;
  return {
    observed_value: value,
    expected_value: mean,
    deviation_score: Number(deviation.toFixed(3)),
    severity: Math.abs(deviation) >= threshold * 1.75 ? 'critical' : 'warning',
    sample_count: Number(baseline.sample_count),
    p50_value: p50,
    p95_value: p95,
  };
}

async function ensureNetworkObservabilitySchema(queryable = db) {
  if (schemaReady) return;
  if (queryable === db) await ensureMikrotikTables();
  await queryable.query(NETWORK_SCHEMA_SQL);
  if (queryable === db) schemaReady = true;
}

async function readRouterFacts(router) {
  const client = await connectRouter(router);
  const facts = {}; const sourceStatus = {};
  try {
    for (const [name, path] of READ_ONLY_SOURCES) {
      try {
        facts[name] = (await client.command(path)).slice(0, MAX_ROWS_PER_SOURCE).map(redactRow);
        sourceStatus[name] = { ok: true, rows: facts[name].length };
      } catch (error) {
        facts[name] = [];
        sourceStatus[name] = { ok: false, error: cleanText(error.message || 'command failed', 300) };
      }
    }
    facts.interface_traffic = {};
    const candidates = (facts.interfaces || [])
      .filter((row) => !truthy(row.disabled) && truthy(row.running))
      .sort((a, b) => Number(/wan|uplink|internet|sfp/i.test(`${b.name} ${b.comment}`)) - Number(/wan|uplink|internet|sfp/i.test(`${a.name} ${a.comment}`)))
      .slice(0, 12);
    for (const iface of candidates) {
      try {
        const rows = await client.command('/interface/monitor-traffic', { interface: iface.name, once: '' });
        facts.interface_traffic[iface.name] = redactRow(rows[0] || {});
      } catch (_) { facts.interface_traffic[iface.name] = {}; }
    }
    sourceStatus.interface_traffic = { ok: true, rows: Object.keys(facts.interface_traffic).length };
    return { facts, sourceStatus };
  } finally { client.close(); }
}

async function replaceTopology(client, router, runId, topology) {
  await client.query(`UPDATE network_topology_nodes SET active=FALSE WHERE client_id=$1 AND router_id=$2`, [router.client_id, router.id]);
  await client.query(`UPDATE network_topology_edges SET active=FALSE WHERE client_id=$1 AND router_id=$2`, [router.client_id, router.id]);
  for (const node of topology.nodes) {
    await client.query(
      `INSERT INTO network_topology_nodes
         (client_id,router_id,node_key,node_type,display_name,attributes,active,last_run_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,TRUE,$7)
       ON CONFLICT (client_id,router_id,node_key) DO UPDATE SET
         node_type=EXCLUDED.node_type, display_name=EXCLUDED.display_name,
         attributes=EXCLUDED.attributes, active=TRUE, last_seen_at=NOW(), last_run_id=EXCLUDED.last_run_id`,
      [router.client_id, router.id, node.node_key, node.node_type, node.display_name, JSON.stringify(node.attributes), runId]
    );
  }
  for (const edge of topology.edges) {
    await client.query(
      `INSERT INTO network_topology_edges
         (client_id,router_id,edge_key,from_node_key,relationship,to_node_key,attributes,active,last_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,TRUE,$8)
       ON CONFLICT (client_id,router_id,edge_key) DO UPDATE SET
         from_node_key=EXCLUDED.from_node_key, relationship=EXCLUDED.relationship,
         to_node_key=EXCLUDED.to_node_key, attributes=EXCLUDED.attributes,
         active=TRUE, last_seen_at=NOW(), last_run_id=EXCLUDED.last_run_id`,
      [router.client_id, router.id, edge.edge_key, edge.from_node_key, edge.relationship, edge.to_node_key, JSON.stringify(edge.attributes), runId]
    );
  }
}

async function storeMetrics(client, router, runId, metrics) {
  for (const metric of metrics) {
    await client.query(
      `INSERT INTO network_metric_samples
         (client_id,router_id,metric_name,subject_type,subject_key,value,unit,labels,observed_at,run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [router.client_id, router.id, metric.metric_name, metric.subject_type, metric.subject_key,
        metric.value, metric.unit, JSON.stringify(metric.labels || {}), metric.observed_at, runId]
    );
  }
}

async function rebuildBaselines(client, clientId, routerId) {
  const result = await client.query(
    `INSERT INTO network_metric_baselines
       (client_id,router_id,metric_name,subject_type,subject_key,hour_of_week,
        sample_count,mean_value,stddev_value,p50_value,p95_value,window_started_at,window_ended_at,updated_at)
     SELECT client_id,router_id,metric_name,subject_type,subject_key,
       (EXTRACT(DOW FROM observed_at)::int * 24 + EXTRACT(HOUR FROM observed_at)::int)::int,
       COUNT(*)::int, AVG(value), COALESCE(STDDEV_POP(value),0),
       percentile_cont(0.5) WITHIN GROUP (ORDER BY value),
       percentile_cont(0.95) WITHIN GROUP (ORDER BY value),
       MIN(observed_at), MAX(observed_at), NOW()
     FROM network_metric_samples
     WHERE client_id=$1 AND router_id=$2
       AND observed_at >= NOW() - ($3::text || ' days')::interval
       AND metric_name NOT LIKE '%_total'
     GROUP BY client_id,router_id,metric_name,subject_type,subject_key,
       (EXTRACT(DOW FROM observed_at)::int * 24 + EXTRACT(HOUR FROM observed_at)::int)::int
     ON CONFLICT (client_id,router_id,metric_name,subject_type,subject_key,hour_of_week)
     DO UPDATE SET sample_count=EXCLUDED.sample_count, mean_value=EXCLUDED.mean_value,
       stddev_value=EXCLUDED.stddev_value, p50_value=EXCLUDED.p50_value,
       p95_value=EXCLUDED.p95_value, window_started_at=EXCLUDED.window_started_at,
       window_ended_at=EXCLUDED.window_ended_at, updated_at=NOW()`,
    [clientId, routerId, BASELINE_DAYS]
  );
  return result.rowCount;
}

async function detectAnomalies(client, router, metrics) {
  const detected = [];
  const hour = new Date().getUTCDay() * 24 + new Date().getUTCHours();
  for (const metric of metrics.filter((item) => !item.metric_name.endsWith('_total'))) {
    const baselineResult = await client.query(
      `SELECT * FROM network_metric_baselines
       WHERE client_id=$1 AND router_id=$2 AND metric_name=$3
         AND subject_type=$4 AND subject_key=$5 AND hour_of_week=$6`,
      [router.client_id, router.id, metric.metric_name, metric.subject_type, metric.subject_key, hour]
    );
    const score = scoreMetric(metric, baselineResult.rows[0]);
    if (!score) continue;
    const details = { unit: metric.unit, labels: metric.labels, baseline_samples: score.sample_count, p50: score.p50_value, p95: score.p95_value };
    const updated = await client.query(
      `UPDATE network_anomalies SET observed_value=$1, expected_value=$2, deviation_score=$3,
         severity=$4, details=$5::jsonb, occurrences=occurrences+1, last_detected_at=NOW()
       WHERE client_id=$6 AND router_id=$7 AND metric_name=$8
         AND subject_type=$9 AND subject_key=$10 AND status='open' RETURNING *`,
      [score.observed_value, score.expected_value, score.deviation_score, score.severity, JSON.stringify(details),
        router.client_id, router.id, metric.metric_name, metric.subject_type, metric.subject_key]
    );
    let anomaly = updated.rows[0]; let opened = false;
    if (!anomaly) {
      const inserted = await client.query(
        `INSERT INTO network_anomalies
           (id,client_id,router_id,metric_name,subject_type,subject_key,observed_value,
            expected_value,deviation_score,severity,details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
        [crypto.randomUUID(), router.client_id, router.id, metric.metric_name, metric.subject_type,
          metric.subject_key, score.observed_value, score.expected_value, score.deviation_score,
          score.severity, JSON.stringify(details)]
      );
      anomaly = inserted.rows[0]; opened = true;
    }
    detected.push({ anomaly, opened });
  }
  return detected;
}

async function collectRouterObservability(clientId, routerId, options = {}) {
  await ensureNetworkObservabilitySchema();
  const router = await getRouter(clientId, routerId, { includePassword: true });
  if (!router || !router.is_active) throw new Error('Active tenant router not found');
  const runId = crypto.randomUUID();
  await db.query(`INSERT INTO network_collection_runs (id,client_id,router_id) VALUES ($1,$2,$3)`, [runId, clientId, routerId]);
  try {
    const { facts, sourceStatus } = options.facts
      ? { facts: options.facts, sourceStatus: options.sourceStatus || { synthetic: { ok: true } } }
      : await readRouterFacts(router);
    const topology = buildTopology(router, facts);
    const metrics = buildMetrics(router, facts, options.observedAt || new Date());
    const client = await db.connect();
    let anomalies;
    try {
      await client.query('BEGIN');
      await replaceTopology(client, router, runId, topology);
      await storeMetrics(client, router, runId, metrics);
      await rebuildBaselines(client, clientId, routerId);
      anomalies = await detectAnomalies(client, router, metrics);
      for (const item of anomalies.filter((entry) => entry.opened)) {
        await ensureEventSchema(client);
        await appendBillingEvent(client, {
          clientId,
          eventType: 'router.metric_anomaly', category: 'network', source: 'network_observability',
          entityType: 'router', entityId: routerId, severity: item.anomaly.severity,
          title: `${router.name}: unusual ${item.anomaly.metric_name}`,
          description: `Observed ${item.anomaly.observed_value}; learned expectation ${item.anomaly.expected_value}.`,
          payload: { anomaly_id: item.anomaly.id, metric_name: item.anomaly.metric_name,
            subject_type: item.anomaly.subject_type, subject_key: item.anomaly.subject_key,
            deviation_score: item.anomaly.deviation_score },
          deduplicationKey: `network-anomaly:${item.anomaly.id}`,
          sensitivity: 'restricted',
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* no transaction */ }
      throw error;
    } finally { client.release(); }

    await db.query(
      `UPDATE network_collection_runs SET status='completed',source_status=$1::jsonb,
         topology_nodes=$2,topology_edges=$3,metric_samples=$4,anomalies_detected=$5,completed_at=NOW()
       WHERE id=$6 AND client_id=$7`,
      [JSON.stringify(sourceStatus), topology.nodes.length, topology.edges.length, metrics.length, anomalies.length, runId, clientId]
    );
    await observeTwinEntity({
      clientId, eventType: 'router.topology_observed', category: 'network', source: 'network_observability',
      entityType: 'router', entityId: routerId, displayName: router.name,
      state: { topology_nodes: topology.nodes.length, topology_edges: topology.edges.length,
        metric_samples: metrics.length, active_anomalies: anomalies.length, observability_last_run: new Date().toISOString() },
      severity: anomalies.some((item) => item.anomaly.severity === 'critical') ? 'critical' : anomalies.length ? 'warning' : 'info',
      sensitivity: 'restricted',
    }).catch((error) => console.error('Network topology twin observation failed:', error.message));
    return { run_id: runId, router_id: routerId, topology_nodes: topology.nodes.length,
      topology_edges: topology.edges.length, metric_samples: metrics.length,
      anomalies_detected: anomalies.length, source_status: sourceStatus };
  } catch (error) {
    await db.query(`UPDATE network_collection_runs SET status='failed',error=$1,completed_at=NOW() WHERE id=$2 AND client_id=$3`,
      [cleanText(error.message || 'collection failed', 2000), runId, clientId]);
    throw error;
  }
}

async function activeRouterIds() {
  await ensureNetworkObservabilitySchema();
  const result = await db.query(`SELECT client_id,id FROM mikrotik_routers WHERE is_active=TRUE ORDER BY id`);
  return result.rows;
}

async function runNetworkObservabilityOnce() {
  const routers = await activeRouterIds();
  const summary = { routers: routers.length, completed: 0, failed: 0, errors: [] };
  for (const router of routers) {
    try { await collectRouterObservability(router.client_id, router.id); summary.completed += 1; }
    catch (error) { summary.failed += 1; summary.errors.push({ router_id: router.id, error: cleanText(error.message, 500) }); }
  }
  return summary;
}

function startNetworkObservabilityScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  ensureNetworkObservabilitySchema()
    .then(() => console.log(`Network observability ready for ${Math.round(COLLECTION_INTERVAL_MS / 1000)} second checks.`))
    .catch((error) => console.error('Network observability schema failed:', error.message));
  setInterval(() => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    runNetworkObservabilityOnce()
      .catch((error) => console.error('Network observability collection failed:', error.message))
      .finally(() => { schedulerBusy = false; });
  }, COLLECTION_INTERVAL_MS);
}

async function getNetworkOverview(clientId, queryable = db) {
  await ensureNetworkObservabilitySchema(queryable);
  const result = await queryable.query(
    `SELECT
       (SELECT COUNT(*)::int FROM mikrotik_routers WHERE client_id=$1 AND is_active=TRUE) routers,
       (SELECT COUNT(*)::int FROM network_topology_nodes WHERE client_id=$1 AND active=TRUE) topology_nodes,
       (SELECT COUNT(*)::int FROM network_topology_edges WHERE client_id=$1 AND active=TRUE) topology_edges,
       (SELECT COUNT(*)::int FROM network_anomalies WHERE client_id=$1 AND status='open') open_anomalies,
       (SELECT MAX(completed_at) FROM network_collection_runs WHERE client_id=$1 AND status='completed') last_collection_at,
       (SELECT COUNT(*)::int FROM network_collection_runs WHERE client_id=$1 AND status='failed' AND started_at > NOW()-INTERVAL '24 hours') failures_24h`,
    [clientId]
  );
  return { ...result.rows[0], read_only: true, automatic_execution: false };
}

async function getRouterTopology(clientId, routerId, queryable = db) {
  await ensureNetworkObservabilitySchema(queryable);
  const router = await queryable.query(`SELECT id,name,last_status,last_seen_at FROM mikrotik_routers WHERE client_id=$1 AND id=$2`, [clientId, routerId]);
  if (!router.rows[0]) return null;
  const nodes = await queryable.query(`SELECT node_key,node_type,display_name,attributes,last_seen_at FROM network_topology_nodes WHERE client_id=$1 AND router_id=$2 AND active=TRUE ORDER BY node_type,display_name`, [clientId, routerId]);
  const edges = await queryable.query(`SELECT edge_key,from_node_key,relationship,to_node_key,attributes,last_seen_at FROM network_topology_edges WHERE client_id=$1 AND router_id=$2 AND active=TRUE ORDER BY relationship,edge_key`, [clientId, routerId]);
  const run = await queryable.query(`SELECT * FROM network_collection_runs WHERE client_id=$1 AND router_id=$2 ORDER BY started_at DESC LIMIT 1`, [clientId, routerId]);
  return { router: router.rows[0], nodes: nodes.rows, edges: edges.rows, latest_run: run.rows[0] || null };
}

async function listMetricSamples(clientId, routerId, options = {}, queryable = db) {
  await ensureNetworkObservabilitySchema(queryable);
  const limit = Math.max(1, Math.min(2_000, Number(options.limit || 500)));
  const values = [clientId, routerId]; const where = ['client_id=$1', 'router_id=$2'];
  if (options.metric) { values.push(cleanText(options.metric, 120)); where.push(`metric_name=$${values.length}`); }
  if (options.from) { values.push(new Date(options.from)); where.push(`observed_at >= $${values.length}`); }
  if (options.to) { values.push(new Date(options.to)); where.push(`observed_at <= $${values.length}`); }
  values.push(limit);
  const result = await queryable.query(
    `SELECT metric_name,subject_type,subject_key,value,unit,labels,observed_at
     FROM network_metric_samples WHERE ${where.join(' AND ')}
     ORDER BY observed_at DESC LIMIT $${values.length}`, values);
  return result.rows;
}

async function listBaselines(clientId, routerId, queryable = db) {
  await ensureNetworkObservabilitySchema(queryable);
  const result = await queryable.query(`SELECT * FROM network_metric_baselines WHERE client_id=$1 AND router_id=$2 ORDER BY metric_name,subject_key,hour_of_week`, [clientId, routerId]);
  return result.rows;
}

async function listAnomalies(clientId, options = {}, queryable = db) {
  await ensureNetworkObservabilitySchema(queryable);
  const values = [clientId]; const where = ['a.client_id=$1'];
  if (options.routerId) { values.push(Number(options.routerId)); where.push(`a.router_id=$${values.length}`); }
  if (options.status) { values.push(cleanText(options.status, 24)); where.push(`a.status=$${values.length}`); }
  const result = await queryable.query(
    `SELECT a.*,r.name router_name FROM network_anomalies a
     JOIN mikrotik_routers r ON r.client_id=a.client_id AND r.id=a.router_id
     WHERE ${where.join(' AND ')} ORDER BY a.last_detected_at DESC LIMIT 500`, values);
  return result.rows;
}

module.exports = {
  NETWORK_SCHEMA_SQL,
  READ_ONLY_SOURCES,
  buildMetrics,
  buildTopology,
  collectRouterObservability,
  ensureNetworkObservabilitySchema,
  getNetworkOverview,
  getRouterTopology,
  listAnomalies,
  listBaselines,
  listMetricSamples,
  redactRow,
  runNetworkObservabilityOnce,
  scoreMetric,
  startNetworkObservabilityScheduler,
};
