const db = require('../src/db');
const { pollRadiusSessionEvents } = require('../src/services/radiusSessionEvents');
const { runMikrotikMonitorOnce } = require('../src/services/mikrotikMonitor');
const tr069Routes = require('../src/routes/tr069');
const {
  runTwinReconciliationOnce,
  runTwinWatchdogOnce,
} = require('../src/services/twinStability');

async function run() {
  await pollRadiusSessionEvents();
  const mikrotik = await runMikrotikMonitorOnce();
  const tr069 = await tr069Routes.runTr069TelemetryOnce();
  const reconciliation = await runTwinReconciliationOnce();
  const watchdog = await runTwinWatchdogOnce();

  const latest = await db.query(
    `SELECT DISTINCT ON (client_id)
       client_id, status, availability_score, freshness_score, source_health, sampled_at
     FROM billing_twin_health_samples
     ORDER BY client_id, sampled_at DESC`
  );
  const alertGroups = await db.query(
    `SELECT source, severity, COUNT(*)::int AS count
     FROM billing_twin_alerts WHERE status = 'open'
     GROUP BY source, severity ORDER BY severity, source`
  );
  const integrity = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM billing_events event
          LEFT JOIN billing_twin_projection_events projection
            ON projection.event_id = event.id AND projection.client_id = event.client_id
          WHERE projection.event_id IS NULL) AS pending_events,
       (SELECT COUNT(*)::int FROM billing_twin_projection_events WHERE status = 'failed') AS failed_events,
       (SELECT COUNT(*)::int FROM billing_twin_relationships rel
          WHERE rel.active = TRUE AND (
            NOT EXISTS (SELECT 1 FROM billing_twin_entities entity
              WHERE entity.client_id = rel.client_id AND entity.entity_type = rel.from_entity_type
                AND entity.entity_id = rel.from_entity_id)
            OR NOT EXISTS (SELECT 1 FROM billing_twin_entities entity
              WHERE entity.client_id = rel.client_id AND entity.entity_type = rel.to_entity_type
                AND entity.entity_id = rel.to_entity_id)
          )) AS missing_relationship_endpoints,
       (SELECT COUNT(*)::int FROM billing_twin_reconciliation_runs
          WHERE status = 'failed' AND started_at >= NOW() - INTERVAL '1 hour') AS reconciliation_failures,
       (SELECT MIN(sampled_at) FROM billing_twin_health_samples) AS soak_started_at`
  );
  const sourceCoverage = {};
  for (const sample of latest.rows) {
    for (const source of sample.source_health || []) {
      if (!source.applicable) continue;
      if (!sourceCoverage[source.source]) sourceCoverage[source.source] = { expected: 0, fresh: 0 };
      sourceCoverage[source.source].expected += Number(source.expected) || 0;
      sourceCoverage[source.source].fresh += Number(source.fresh) || 0;
    }
  }
  for (const source of Object.values(sourceCoverage)) {
    source.coverage_percent = source.expected
      ? Math.round((source.fresh / source.expected) * 10000) / 100 : 100;
  }
  console.log(JSON.stringify({
    runs: { radius: 'completed', mikrotik, tr069, reconciliation, watchdog },
    status_counts: latest.rows.reduce((counts, sample) => {
      counts[sample.status] = (counts[sample.status] || 0) + 1;
      return counts;
    }, {}),
    source_coverage: sourceCoverage,
    open_alerts: alertGroups.rows,
    integrity: integrity.rows[0],
    latest_sample_at: latest.rows.reduce((latestAt, sample) => (
      !latestAt || new Date(sample.sampled_at) > new Date(latestAt) ? sample.sampled_at : latestAt
    ), null),
  }, null, 2));
  const problems = integrity.rows[0];
  if (
    Number(problems.pending_events) > 0
    || Number(problems.failed_events) > 0
    || Number(problems.missing_relationship_endpoints) > 0
    || Number(problems.reconciliation_failures) > 0
  ) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
