const os = require('os');
const v8 = require('v8');
const { monitorEventLoopDelay } = require('perf_hooks');
const db = require('../db');
const { recordBillingEvent } = require('./events');
const {
  ensureDigitalTwinSchema,
  processDigitalTwinBatch,
} = require('./digitalTwin');

const TWIN_STABILITY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS billing_twin_health_samples (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'degraded', 'critical')),
    availability_score NUMERIC(5,2) NOT NULL CHECK (availability_score >= 0 AND availability_score <= 100),
    freshness_score NUMERIC(5,2) NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 100),
    total_events INTEGER NOT NULL DEFAULT 0,
    pending_events INTEGER NOT NULL DEFAULT 0,
    failed_events INTEGER NOT NULL DEFAULT 0,
    oldest_pending_seconds INTEGER NOT NULL DEFAULT 0,
    total_entities INTEGER NOT NULL DEFAULT 0,
    stale_entities INTEGER NOT NULL DEFAULT 0,
    total_relationships INTEGER NOT NULL DEFAULT 0,
    missing_relationship_endpoints INTEGER NOT NULL DEFAULT 0,
    source_health JSONB NOT NULL DEFAULT '[]'::jsonb,
    runtime JSONB NOT NULL DEFAULT '{}'::jsonb,
    sampled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_health_samples_tenant_time
    ON billing_twin_health_samples(client_id, sampled_at DESC);

  CREATE TABLE IF NOT EXISTS billing_twin_alerts (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    alert_key VARCHAR(180) NOT NULL,
    source VARCHAR(120) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'critical')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('open', 'resolved')),
    title VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, alert_key)
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_alerts_tenant_status
    ON billing_twin_alerts(client_id, status, severity, last_detected_at DESC);

  CREATE TABLE IF NOT EXISTS billing_twin_reconciliation_runs (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    worker_id VARCHAR(160) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_reconciliation_tenant_time
    ON billing_twin_reconciliation_runs(client_id, started_at DESC);
`;

const WORKER_ID = `${os.hostname()}:${process.pid}:twin-stability`;
const SAMPLE_INTERVAL_MS = Math.max(60000, Number(process.env.TWIN_STABILITY_INTERVAL_MS) || 300000);
const RECONCILE_INTERVAL_MS = Math.max(300000, Number(process.env.TWIN_RECONCILE_INTERVAL_MS) || 900000);
let schemaReady = false;
let schemaPromise;
let schedulerStarted = false;
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function runtimeSnapshot() {
  const memory = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  const snapshot = {
    worker_id: WORKER_ID,
    pid: process.pid,
    uptime_seconds: round(process.uptime()),
    rss_mb: round(memory.rss / 1048576),
    heap_used_mb: round(memory.heapUsed / 1048576),
    heap_limit_mb: round(heapLimit / 1048576),
    heap_used_percent: heapLimit ? round(memory.heapUsed / heapLimit * 100) : 0,
    event_loop_p95_ms: round(eventLoopDelay.percentile(95) / 1e6),
    event_loop_max_ms: round(eventLoopDelay.max / 1e6),
  };
  eventLoopDelay.reset();
  return snapshot;
}

async function ensureTwinStabilitySchema(queryable = db) {
  await ensureDigitalTwinSchema(queryable);
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = queryable.query(TWIN_STABILITY_SCHEMA_SQL)
      .then(() => { schemaReady = true; })
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

function scoreTwinStability(metrics) {
  const sources = metrics.sources || [];
  const applicable = sources.filter((source) => number(source.expected) > 0);
  const freshnessScore = applicable.length
    ? applicable.reduce((sum, source) => sum + Math.min(1, number(source.fresh) / number(source.expected)), 0)
      / applicable.length * 100
    : 100;
  let availabilityScore = 100;
  if (number(metrics.failed_events) > 0) availabilityScore -= 45;
  if (number(metrics.missing_relationship_endpoints) > 0) availabilityScore -= 45;
  if (number(metrics.oldest_pending_seconds) > 300) availabilityScore -= 35;
  else if (number(metrics.oldest_pending_seconds) > 120) availabilityScore -= 15;
  availabilityScore -= Math.min(35, (100 - freshnessScore) * 0.6);
  if (number(metrics.runtime?.event_loop_p95_ms) > 1000) availabilityScore -= 30;
  else if (number(metrics.runtime?.event_loop_p95_ms) > 250) availabilityScore -= 10;
  if (number(metrics.runtime?.heap_used_percent) > 85) availabilityScore -= 30;
  else if (number(metrics.runtime?.heap_used_percent) > 70) availabilityScore -= 10;
  availabilityScore = Math.max(0, round(availabilityScore));

  const sourceCompletelyDown = applicable.some((source) => number(source.fresh) === 0);
  let status = 'healthy';
  if (
    number(metrics.failed_events) > 0
    || number(metrics.missing_relationship_endpoints) > 0
    || number(metrics.oldest_pending_seconds) > 300
    || sourceCompletelyDown
    || number(metrics.runtime?.event_loop_p95_ms) > 1000
    || number(metrics.runtime?.heap_used_percent) > 85
  ) status = 'critical';
  else if (
    number(metrics.oldest_pending_seconds) > 120
    || freshnessScore < 95
    || number(metrics.runtime?.event_loop_p95_ms) > 250
    || number(metrics.runtime?.heap_used_percent) > 70
  ) status = 'degraded';
  return { status, availability_score: availabilityScore, freshness_score: round(freshnessScore) };
}

async function collectTenantMetrics(clientId, queryable = db, runtime = null) {
  await ensureTwinStabilitySchema(queryable);
  const totals = await queryable.query(
    `SELECT
       (SELECT COUNT(*)::int FROM billing_events WHERE client_id = $1) AS total_events,
       (SELECT COUNT(*)::int FROM billing_events event
          LEFT JOIN billing_twin_projection_events projection
            ON projection.event_id = event.id AND projection.client_id = event.client_id
          WHERE event.client_id = $1 AND projection.event_id IS NULL) AS pending_events,
       (SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(event.recorded_at))), 0)::int
          FROM billing_events event
          LEFT JOIN billing_twin_projection_events projection
            ON projection.event_id = event.id AND projection.client_id = event.client_id
          WHERE event.client_id = $1 AND projection.event_id IS NULL) AS oldest_pending_seconds,
       (SELECT COUNT(*)::int FROM billing_twin_projection_events
          WHERE client_id = $1 AND status = 'failed') AS failed_events,
       (SELECT COUNT(*)::int FROM billing_twin_entities WHERE client_id = $1) AS total_entities,
       (SELECT COUNT(*)::int FROM billing_twin_entities
          WHERE client_id = $1 AND freshness_expires_at IS NOT NULL AND freshness_expires_at < NOW()) AS stale_entities,
       (SELECT COUNT(*)::int FROM billing_twin_relationships
          WHERE client_id = $1 AND active = TRUE) AS total_relationships,
       (SELECT COUNT(*)::int FROM billing_twin_relationships rel
          WHERE rel.client_id = $1 AND rel.active = TRUE AND (
            NOT EXISTS (SELECT 1 FROM billing_twin_entities entity
              WHERE entity.client_id = rel.client_id AND entity.entity_type = rel.from_entity_type
                AND entity.entity_id = rel.from_entity_id)
            OR NOT EXISTS (SELECT 1 FROM billing_twin_entities entity
              WHERE entity.client_id = rel.client_id AND entity.entity_type = rel.to_entity_type
                AND entity.entity_id = rel.to_entity_id)
          )) AS missing_relationship_endpoints,
       (SELECT COUNT(*)::int FROM billing_subscribers
          WHERE client_id = $1 AND radius_username IS NOT NULL AND radius_username <> '') AS radius_expected,
       (SELECT COUNT(*)::int FROM mikrotik_routers
          WHERE client_id = $1 AND is_active = TRUE) AS mikrotik_expected,
       (SELECT COUNT(*)::int FROM tr069_configs
          WHERE client_id = $1 AND enabled = TRUE) AS tr069_account_expected,
       (SELECT COUNT(*)::int FROM tr069_device_cache WHERE client_id = $1) AS ont_expected,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'radius_accounting_live'
            AND observation.entity_type = 'subscriber'
            AND EXISTS (SELECT 1 FROM billing_subscribers subscriber
              WHERE subscriber.client_id = observation.client_id
                AND subscriber.id::text = observation.entity_id
                AND subscriber.radius_username IS NOT NULL AND subscriber.radius_username <> '')) AS radius_observed,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'radius_accounting_live'
            AND observation.entity_type = 'subscriber' AND observation.freshness_expires_at >= NOW()
            AND EXISTS (SELECT 1 FROM billing_subscribers subscriber
              WHERE subscriber.client_id = observation.client_id
                AND subscriber.id::text = observation.entity_id
                AND subscriber.radius_username IS NOT NULL AND subscriber.radius_username <> '')) AS radius_fresh,
       (SELECT MAX(observation.observed_at) FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'radius_accounting_live'
            AND observation.entity_type = 'subscriber') AS radius_last_observed_at,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'mikrotik_monitor_live'
            AND observation.entity_type = 'router'
            AND EXISTS (SELECT 1 FROM mikrotik_routers router
              WHERE router.client_id = observation.client_id AND router.id::text = observation.entity_id
                AND router.is_active = TRUE)) AS mikrotik_observed,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'mikrotik_monitor_live'
            AND observation.entity_type = 'router' AND observation.freshness_expires_at >= NOW()
            AND EXISTS (SELECT 1 FROM mikrotik_routers router
              WHERE router.client_id = observation.client_id AND router.id::text = observation.entity_id
                AND router.is_active = TRUE)) AS mikrotik_fresh,
       (SELECT MAX(observation.observed_at) FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'mikrotik_monitor_live'
            AND observation.entity_type = 'router') AS mikrotik_last_observed_at,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_monitor_live'
            AND observation.entity_type = 'tr069_configuration'
            AND EXISTS (SELECT 1 FROM tr069_configs config
              WHERE config.client_id = observation.client_id AND config.enabled = TRUE)) AS tr069_account_observed,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_monitor_live'
            AND observation.entity_type = 'tr069_configuration' AND observation.freshness_expires_at >= NOW()
            AND EXISTS (SELECT 1 FROM tr069_configs config
              WHERE config.client_id = observation.client_id AND config.enabled = TRUE)) AS tr069_account_fresh,
       (SELECT MAX(observation.observed_at) FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_monitor_live'
            AND observation.entity_type = 'tr069_configuration') AS tr069_account_last_observed_at,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_live'
            AND observation.entity_type = 'ont'
            AND EXISTS (SELECT 1 FROM tr069_device_cache ont
              WHERE ont.client_id = observation.client_id AND ont.device_id = observation.entity_id)) AS ont_observed,
       (SELECT COUNT(*)::int FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_live'
            AND observation.entity_type = 'ont' AND observation.freshness_expires_at >= NOW()
            AND EXISTS (SELECT 1 FROM tr069_device_cache ont
              WHERE ont.client_id = observation.client_id AND ont.device_id = observation.entity_id)) AS ont_fresh,
       (SELECT MAX(observation.observed_at) FROM billing_twin_source_observations observation
          WHERE observation.client_id = $1 AND observation.source = 'tr069_live'
            AND observation.entity_type = 'ont') AS ont_last_observed_at`,
    [clientId]
  );
  const row = totals.rows[0];
  const sources = [
    ['radius_accounting_live', 'subscriber', row.radius_expected, row.radius_observed, row.radius_fresh, row.radius_last_observed_at],
    ['mikrotik_monitor_live', 'router', row.mikrotik_expected, row.mikrotik_observed, row.mikrotik_fresh, row.mikrotik_last_observed_at],
    ['tr069_monitor_live', 'tr069_configuration', row.tr069_account_expected, row.tr069_account_observed, row.tr069_account_fresh, row.tr069_account_last_observed_at],
    ['tr069_live', 'ont', row.ont_expected, row.ont_observed, row.ont_fresh, row.ont_last_observed_at],
  ].map(([source, entityType, expectedValue, observedValue, freshValue, lastObservedAt]) => {
    const expected = number(expectedValue);
    const observed = number(observedValue);
    const fresh = number(freshValue);
    return {
      source,
      entity_type: entityType,
      expected,
      observed,
      fresh,
      coverage_percent: expected ? round(Math.min(1, fresh / expected) * 100) : 100,
      last_observed_at: lastObservedAt || null,
      applicable: expected > 0,
    };
  });
  return {
    client_id: clientId,
    total_events: number(row.total_events),
    pending_events: number(row.pending_events),
    failed_events: number(row.failed_events),
    oldest_pending_seconds: number(row.oldest_pending_seconds),
    total_entities: number(row.total_entities),
    stale_entities: number(row.stale_entities),
    total_relationships: number(row.total_relationships),
    missing_relationship_endpoints: number(row.missing_relationship_endpoints),
    sources,
    runtime: runtime || runtimeSnapshot(),
  };
}

function desiredAlerts(metrics) {
  const alerts = [];
  if (metrics.failed_events > 0) alerts.push({
    key: 'projection_failed', source: 'digital_twin_projector', severity: 'critical',
    title: 'Digital twin projection failures detected', details: { failed_events: metrics.failed_events },
  });
  if (metrics.oldest_pending_seconds > 120) alerts.push({
    key: 'projection_stalled', source: 'digital_twin_projector',
    severity: metrics.oldest_pending_seconds > 300 ? 'critical' : 'warning',
    title: 'Digital twin projection is delayed',
    details: { pending_events: metrics.pending_events, oldest_pending_seconds: metrics.oldest_pending_seconds },
  });
  if (metrics.missing_relationship_endpoints > 0) alerts.push({
    key: 'graph_integrity', source: 'digital_twin_graph', severity: 'critical',
    title: 'Digital twin graph has missing endpoints',
    details: { missing_relationship_endpoints: metrics.missing_relationship_endpoints },
  });
  for (const source of metrics.sources.filter((item) => item.expected > 0 && item.coverage_percent < 95)) {
    alerts.push({
      key: `source_stale:${source.source}:${source.entity_type}`,
      source: source.source,
      severity: source.fresh === 0 ? 'critical' : 'warning',
      title: `${source.source.replace(/_/g, ' ')} coverage is below target`,
      details: source,
    });
  }
  if (number(metrics.runtime?.event_loop_p95_ms) > 250) alerts.push({
    key: 'runtime_event_loop_delay', source: 'backend_runtime',
    severity: number(metrics.runtime.event_loop_p95_ms) > 1000 ? 'critical' : 'warning',
    title: 'Backend event-loop latency is above target',
    details: { event_loop_p95_ms: metrics.runtime.event_loop_p95_ms, threshold_ms: 250 },
  });
  if (number(metrics.runtime?.heap_used_percent) > 70) alerts.push({
    key: 'runtime_heap_pressure', source: 'backend_runtime',
    severity: number(metrics.runtime.heap_used_percent) > 85 ? 'critical' : 'warning',
    title: 'Backend memory pressure is above target',
    details: {
      heap_used_percent: metrics.runtime.heap_used_percent,
      heap_used_mb: metrics.runtime.heap_used_mb,
      heap_limit_mb: metrics.runtime.heap_limit_mb,
    },
  });
  return alerts;
}

async function emitAlertTransition(clientId, alert, transition) {
  await recordBillingEvent({
    clientId,
    eventType: transition === 'opened' ? 'digital_twin.alert_opened' : 'digital_twin.alert_resolved',
    category: 'system_health',
    source: 'digital_twin_watchdog',
    entityType: 'twin_alert',
    entityId: alert.id,
    actorType: 'system',
    severity: transition === 'opened' ? alert.severity : 'info',
    title: transition === 'opened' ? alert.title : `${alert.title} resolved`,
    payload: { alert_key: alert.alert_key, source: alert.source, details: alert.details },
    newState: { status: transition === 'opened' ? 'open' : 'resolved' },
    deduplicationKey: `twin-alert:${alert.id}:${transition}:${alert.updated_at}`,
    sensitivity: 'internal',
  }).catch((error) => console.error('Could not record twin alert transition:', error.message));
}

async function syncTenantAlerts(clientId, metrics, queryable = db) {
  const desired = desiredAlerts(metrics);
  const desiredKeys = desired.map((alert) => alert.key);
  const transitions = [];
  for (const alert of desired) {
    const previous = await queryable.query(
      `SELECT status FROM billing_twin_alerts WHERE client_id = $1 AND alert_key = $2`,
      [clientId, alert.key]
    );
    const result = await queryable.query(
      `INSERT INTO billing_twin_alerts (
         client_id, alert_key, source, severity, status, title, details
       ) VALUES ($1,$2,$3,$4,'open',$5,$6::jsonb)
       ON CONFLICT (client_id, alert_key) DO UPDATE SET
         source = EXCLUDED.source,
         severity = EXCLUDED.severity,
         status = 'open',
         title = EXCLUDED.title,
         details = EXCLUDED.details,
         first_detected_at = CASE WHEN billing_twin_alerts.status = 'resolved'
           THEN NOW() ELSE billing_twin_alerts.first_detected_at END,
         last_detected_at = NOW(),
         resolved_at = NULL,
         occurrence_count = billing_twin_alerts.occurrence_count + 1,
         updated_at = NOW()
       RETURNING *`,
      [clientId, alert.key, alert.source, alert.severity, alert.title, JSON.stringify(alert.details)]
    );
    if (!previous.rows[0] || previous.rows[0].status === 'resolved') {
      transitions.push({ transition: 'opened', alert: result.rows[0] });
    }
  }
  const resolved = await queryable.query(
    `UPDATE billing_twin_alerts
     SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
     WHERE client_id = $1 AND status = 'open'
       AND NOT (alert_key = ANY($2::text[]))
     RETURNING *`,
    [clientId, desiredKeys]
  );
  transitions.push(...resolved.rows.map((alert) => ({ transition: 'resolved', alert })));
  return transitions;
}

async function sampleTenantStability(clientId, options = {}) {
  const queryable = options.queryable || db;
  const metrics = await collectTenantMetrics(clientId, queryable, options.runtime || null);
  const score = scoreTwinStability(metrics);
  const transitions = await syncTenantAlerts(clientId, metrics, queryable);
  const sample = await queryable.query(
    `INSERT INTO billing_twin_health_samples (
       client_id, status, availability_score, freshness_score,
       total_events, pending_events, failed_events, oldest_pending_seconds,
       total_entities, stale_entities, total_relationships,
       missing_relationship_endpoints, source_health, runtime
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
     RETURNING *`,
    [
      clientId, score.status, score.availability_score, score.freshness_score,
      metrics.total_events, metrics.pending_events, metrics.failed_events,
      metrics.oldest_pending_seconds, metrics.total_entities, metrics.stale_entities,
      metrics.total_relationships, metrics.missing_relationship_endpoints,
      JSON.stringify(metrics.sources), JSON.stringify(metrics.runtime),
    ]
  );
  if (!options.suppressEvents) {
    for (const transition of transitions) await emitAlertTransition(clientId, transition.alert, transition.transition);
  }
  return { ...sample.rows[0], transitions };
}

async function withAdvisoryLock(lockName, fn) {
  const client = await db.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [lockName]);
    if (!lock.rows[0]?.acquired) return { skipped: true, reason: 'lock_not_acquired' };
    try {
      return await fn(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
    }
  } finally {
    client.release();
  }
}

async function runTwinWatchdogOnce() {
  await ensureTwinStabilitySchema();
  return withAdvisoryLock('nexa:twin:watchdog', async () => {
    const tenants = await db.query(
      `SELECT DISTINCT client_id AS id FROM (
         SELECT client_id FROM billing_events
         UNION SELECT client_id FROM billing_twin_entities
         UNION SELECT client_id FROM billing_subscribers
         UNION SELECT client_id FROM mikrotik_routers
         UNION SELECT client_id FROM tr069_configs
       ) tenant ORDER BY client_id`
    );
    const runtime = runtimeSnapshot();
    const results = [];
    for (const tenant of tenants.rows) {
      results.push(await sampleTenantStability(tenant.id, { runtime }));
    }
    return {
      tenants: results.length,
      healthy: results.filter((result) => result.status === 'healthy').length,
      degraded: results.filter((result) => result.status === 'degraded').length,
      critical: results.filter((result) => result.status === 'critical').length,
    };
  });
}

async function reconcileTenantSources(clientId, queryable = db) {
  const counts = { entities_inserted: 0, relationships_reconciled: 0, relationships_ended: 0 };
  const entityQueries = [
    `INSERT INTO billing_twin_entities (
       client_id, entity_type, entity_id, display_name, lifecycle_status,
       state, source, observed_at, first_seen_at, last_seen_at
     ) SELECT client_id, 'subscriber', id::text, full_name,
       CASE WHEN service_status IN ('active','inactive','expired','suspended','pending') THEN service_status ELSE 'unknown' END,
       jsonb_build_object('account_number', account_number, 'service_status', service_status,
         'expires_at', expires_at, 'access_mode', access_mode),
       'source_reconciliation', COALESCE(updated_at, created_at, NOW()),
       COALESCE(created_at, NOW()), COALESCE(updated_at, created_at, NOW())
     FROM billing_subscribers WHERE client_id = $1
     ON CONFLICT (client_id, entity_type, entity_id) DO NOTHING`,
    `INSERT INTO billing_twin_entities (
       client_id, entity_type, entity_id, display_name, lifecycle_status,
       state, source, observed_at, first_seen_at, last_seen_at
     ) SELECT client_id, 'package', id::text, name,
       CASE WHEN is_active THEN 'active' ELSE 'inactive' END,
       jsonb_build_object('price', price, 'validity_days', validity_days),
       'source_reconciliation', COALESCE(updated_at, created_at, NOW()),
       COALESCE(created_at, NOW()), COALESCE(updated_at, created_at, NOW())
     FROM billing_plans WHERE client_id = $1
     ON CONFLICT (client_id, entity_type, entity_id) DO NOTHING`,
    `INSERT INTO billing_twin_entities (
       client_id, entity_type, entity_id, display_name, lifecycle_status,
       state, source, observed_at, first_seen_at, last_seen_at
     ) SELECT client_id, 'hotspot_package', id::text, name,
       CASE WHEN is_active THEN 'active' ELSE 'inactive' END,
       jsonb_build_object('price', price, 'duration_minutes', duration_minutes),
       'source_reconciliation', COALESCE(updated_at, created_at, NOW()),
       COALESCE(created_at, NOW()), COALESCE(updated_at, created_at, NOW())
     FROM billing_hotspot_plans WHERE client_id = $1
     ON CONFLICT (client_id, entity_type, entity_id) DO NOTHING`,
    `INSERT INTO billing_twin_entities (
       client_id, entity_type, entity_id, display_name, lifecycle_status,
       state, source, observed_at, first_seen_at, last_seen_at
     ) SELECT client_id, 'router', id::text, name,
       CASE WHEN is_active THEN 'active' ELSE 'inactive' END,
       jsonb_build_object('last_status', last_status, 'last_seen_at', last_seen_at),
       'source_reconciliation', COALESCE(updated_at, created_at, NOW()),
       COALESCE(created_at, NOW()), COALESCE(updated_at, created_at, NOW())
     FROM mikrotik_routers WHERE client_id = $1
     ON CONFLICT (client_id, entity_type, entity_id) DO NOTHING`,
    `INSERT INTO billing_twin_entities (
       client_id, entity_type, entity_id, display_name, operational_status,
       health_status, state, source, observed_at, first_seen_at, last_seen_at
     ) SELECT client_id, 'ont', device_id,
       NULLIF(CONCAT_WS(' ', manufacturer, model_name, serial_number), ''),
       CASE WHEN status IN ('online','warning') THEN 'online' ELSE 'offline' END,
       CASE WHEN status = 'warning' THEN 'degraded' WHEN status = 'offline' THEN 'critical' ELSE 'healthy' END,
       jsonb_build_object('status', status, 'last_inform', last_inform),
       'source_reconciliation', COALESCE(last_inform, synced_at),
       synced_at, COALESCE(last_inform, synced_at)
     FROM tr069_device_cache WHERE client_id = $1
     ON CONFLICT (client_id, entity_type, entity_id) DO NOTHING`,
  ];
  for (const sql of entityQueries) counts.entities_inserted += (await queryable.query(sql, [clientId])).rowCount;

  const relationships = await queryable.query(
    `WITH desired AS (
       SELECT client_id, 'subscriber'::text from_type, id::text from_id,
              'subscribed_to'::text relationship, 'package'::text to_type, plan_id::text to_id
       FROM billing_subscribers WHERE client_id = $1 AND plan_id IS NOT NULL
       UNION ALL
       SELECT client_id, 'subscriber', id::text, 'connected_through', 'router', router_id::text
       FROM billing_subscribers WHERE client_id = $1 AND router_id IS NOT NULL
       UNION ALL
       SELECT client_id, 'package', id::text, 'allocated_to', 'router', router_id::text
       FROM billing_plans WHERE client_id = $1 AND router_id IS NOT NULL
       UNION ALL
       SELECT client_id, 'hotspot_package', id::text, 'allocated_to', 'router', router_id::text
       FROM billing_hotspot_plans WHERE client_id = $1 AND router_id IS NOT NULL
       UNION ALL
       SELECT client_id, 'ont', device_id, 'assigned_subscriber', 'subscriber', subscriber_id::text
       FROM tr069_device_locations WHERE client_id = $1 AND subscriber_id IS NOT NULL
     )
     INSERT INTO billing_twin_relationships (
       client_id, from_entity_type, from_entity_id, relationship,
       to_entity_type, to_entity_id, active, observed_at, valid_from, confidence
     ) SELECT client_id, from_type, from_id, relationship, to_type, to_id,
              TRUE, NOW(), NOW(), 1.000 FROM desired
     ON CONFLICT (
       client_id, from_entity_type, from_entity_id,
       relationship, to_entity_type, to_entity_id
     ) DO UPDATE SET active = TRUE, valid_to = NULL, observed_at = NOW(),
       version = billing_twin_relationships.version + 1, updated_at = NOW()
     WHERE billing_twin_relationships.active = FALSE`,
    [clientId]
  );
  counts.relationships_reconciled = relationships.rowCount;
  const ended = await queryable.query(
    `UPDATE billing_twin_relationships rel
     SET active = FALSE, valid_to = NOW(), observed_at = NOW(),
         version = version + 1, updated_at = NOW()
     WHERE rel.client_id = $1 AND rel.active = TRUE AND (
       (rel.from_entity_type = 'subscriber' AND rel.relationship = 'subscribed_to'
         AND NOT EXISTS (SELECT 1 FROM billing_subscribers subscriber
           WHERE subscriber.client_id = rel.client_id AND subscriber.id::text = rel.from_entity_id
             AND subscriber.plan_id::text = rel.to_entity_id))
       OR (rel.from_entity_type = 'subscriber' AND rel.relationship = 'connected_through'
         AND NOT EXISTS (SELECT 1 FROM billing_subscribers subscriber
           WHERE subscriber.client_id = rel.client_id AND subscriber.id::text = rel.from_entity_id
             AND subscriber.router_id::text = rel.to_entity_id))
       OR (rel.from_entity_type IN ('package','hotspot_package') AND rel.relationship = 'allocated_to'
         AND NOT EXISTS (
           SELECT 1 FROM billing_plans plan WHERE rel.from_entity_type = 'package'
             AND plan.client_id = rel.client_id AND plan.id::text = rel.from_entity_id
             AND plan.router_id::text = rel.to_entity_id
           UNION ALL
           SELECT 1 FROM billing_hotspot_plans plan WHERE rel.from_entity_type = 'hotspot_package'
             AND plan.client_id = rel.client_id AND plan.id::text = rel.from_entity_id
             AND plan.router_id::text = rel.to_entity_id
         ))
       OR (rel.from_entity_type = 'ont' AND rel.relationship = 'assigned_subscriber'
         AND NOT EXISTS (SELECT 1 FROM tr069_device_locations location
           WHERE location.client_id = rel.client_id AND location.device_id = rel.from_entity_id
             AND location.subscriber_id::text = rel.to_entity_id))
     )`,
    [clientId]
  );
  counts.relationships_ended = ended.rowCount;
  return counts;
}

async function runTwinReconciliationOnce() {
  await ensureTwinStabilitySchema();
  return withAdvisoryLock('nexa:twin:reconciliation', async () => {
    await processDigitalTwinBatch(500);
    const tenants = await db.query(
      `SELECT DISTINCT client_id AS id FROM (
         SELECT client_id FROM billing_events
         UNION SELECT client_id FROM billing_twin_entities
         UNION SELECT client_id FROM billing_subscribers
         UNION SELECT client_id FROM mikrotik_routers
         UNION SELECT client_id FROM tr069_configs
       ) tenant ORDER BY client_id`
    );
    const total = { tenants: 0, entities_inserted: 0, relationships_reconciled: 0, relationships_ended: 0, failed: 0 };
    for (const tenant of tenants.rows) {
      const started = await db.query(
        `INSERT INTO billing_twin_reconciliation_runs (client_id, worker_id, status)
         VALUES ($1,$2,'running') RETURNING id`,
        [tenant.id, WORKER_ID]
      );
      try {
        const counts = await reconcileTenantSources(tenant.id);
        await db.query(
          `UPDATE billing_twin_reconciliation_runs
           SET status = 'completed', counts = $2::jsonb, completed_at = NOW() WHERE id = $1`,
          [started.rows[0].id, JSON.stringify(counts)]
        );
        total.tenants += 1;
        for (const key of ['entities_inserted', 'relationships_reconciled', 'relationships_ended']) {
          total[key] += number(counts[key]);
        }
      } catch (error) {
        total.failed += 1;
        await db.query(
          `UPDATE billing_twin_reconciliation_runs
           SET status = 'failed', error = $2, completed_at = NOW() WHERE id = $1`,
          [started.rows[0].id, String(error.message || error).slice(0, 2000)]
        );
      }
    }
    return total;
  });
}

async function getTwinStabilityReport(clientId, options = {}) {
  const queryable = options.queryable || db;
  await ensureTwinStabilitySchema(queryable);
  const [latest, history, alerts, reconciliation] = await Promise.all([
    queryable.query(
      `SELECT * FROM billing_twin_health_samples
       WHERE client_id = $1 ORDER BY sampled_at DESC LIMIT 1`, [clientId]
    ),
    queryable.query(
      `SELECT status, availability_score, freshness_score, pending_events,
              failed_events, sampled_at
       FROM billing_twin_health_samples
       WHERE client_id = $1 AND sampled_at >= NOW() - INTERVAL '72 hours'
       ORDER BY sampled_at ASC LIMIT 1000`, [clientId]
    ),
    queryable.query(
      `SELECT id, alert_key, source, severity, status, title, details,
              first_detected_at, last_detected_at, resolved_at, occurrence_count
       FROM billing_twin_alerts WHERE client_id = $1
       ORDER BY (status = 'open') DESC, severity DESC, last_detected_at DESC LIMIT 100`, [clientId]
    ),
    queryable.query(
      `SELECT status, counts, error, started_at, completed_at
       FROM billing_twin_reconciliation_runs
       WHERE client_id = $1 ORDER BY started_at DESC LIMIT 1`, [clientId]
    ),
  ]);
  const samples = history.rows;
  const soakHours = samples.length
    ? (Date.now() - new Date(samples[0].sampled_at).getTime()) / 3600000 : 0;
  return {
    current: latest.rows[0] || null,
    alerts: alerts.rows,
    reconciliation: reconciliation.rows[0] || null,
    soak: {
      started_at: samples[0]?.sampled_at || null,
      elapsed_hours: round(soakHours),
      sample_count: samples.length,
      healthy_samples: samples.filter((sample) => sample.status === 'healthy').length,
      degraded_samples: samples.filter((sample) => sample.status === 'degraded').length,
      critical_samples: samples.filter((sample) => sample.status === 'critical').length,
      verdict: soakHours >= 48 ? 'eligible_for_verdict' : 'collecting',
    },
    history: samples,
  };
}

async function listTwinAlerts(clientId, options = {}) {
  const queryable = options.queryable || db;
  await ensureTwinStabilitySchema(queryable);
  const status = ['open', 'resolved'].includes(options.status) ? options.status : null;
  const result = await queryable.query(
    `SELECT id, alert_key, source, severity, status, title, details,
            first_detected_at, last_detected_at, resolved_at, occurrence_count
     FROM billing_twin_alerts
     WHERE client_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY (status = 'open') DESC, severity DESC, last_detected_at DESC
     LIMIT $3`,
    [clientId, status, Math.max(1, Math.min(Number(options.limit) || 100, 500))]
  );
  return result.rows;
}

function startTwinStabilitySchedulers() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setTimeout(() => {
    runTwinReconciliationOnce().catch((error) => console.error('Twin reconciliation startup failed:', error.message));
  }, 45000);
  setTimeout(() => {
    runTwinWatchdogOnce().catch((error) => console.error('Twin watchdog startup failed:', error.message));
  }, 90000);
  const watchdog = setInterval(() => {
    runTwinWatchdogOnce().catch((error) => console.error('Twin watchdog failed:', error.message));
  }, SAMPLE_INTERVAL_MS);
  const reconciliation = setInterval(() => {
    runTwinReconciliationOnce().catch((error) => console.error('Twin reconciliation failed:', error.message));
  }, RECONCILE_INTERVAL_MS);
  watchdog.unref?.();
  reconciliation.unref?.();
  console.log(`Twin stability watchdog ready (${SAMPLE_INTERVAL_MS}ms samples, ${RECONCILE_INTERVAL_MS}ms reconciliation).`);
}

module.exports = {
  TWIN_STABILITY_SCHEMA_SQL,
  collectTenantMetrics,
  desiredAlerts,
  ensureTwinStabilitySchema,
  getTwinStabilityReport,
  listTwinAlerts,
  reconcileTenantSources,
  runTwinReconciliationOnce,
  runTwinWatchdogOnce,
  sampleTenantStability,
  scoreTwinStability,
  startTwinStabilitySchedulers,
};
