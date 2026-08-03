const assert = require('assert');
const {
  desiredAlerts,
  scoreTwinStability,
} = require('../src/services/twinStability');

function metrics(overrides = {}) {
  return {
    failed_events: 0,
    missing_relationship_endpoints: 0,
    pending_events: 0,
    oldest_pending_seconds: 0,
    sources: [
      { source: 'radius_accounting_live', entity_type: 'subscriber', expected: 100, fresh: 100, coverage_percent: 100 },
      { source: 'mikrotik_monitor_live', entity_type: 'router', expected: 10, fresh: 10, coverage_percent: 100 },
    ],
    runtime: { event_loop_p95_ms: 5, heap_used_percent: 10 },
    ...overrides,
  };
}

function run() {
  assert.deepStrictEqual(scoreTwinStability(metrics()), {
    status: 'healthy', availability_score: 100, freshness_score: 100,
  });
  const degraded = scoreTwinStability(metrics({
    sources: [{ source: 'radius_accounting_live', entity_type: 'subscriber', expected: 100, fresh: 90, coverage_percent: 90 }],
  }));
  assert.strictEqual(degraded.status, 'degraded');
  assert.strictEqual(degraded.freshness_score, 90);
  assert.strictEqual(scoreTwinStability(metrics({ oldest_pending_seconds: 301 })).status, 'critical');
  assert.strictEqual(scoreTwinStability(metrics({ failed_events: 1 })).status, 'critical');
  assert.strictEqual(scoreTwinStability(metrics({
    runtime: { event_loop_p95_ms: 1200, heap_used_percent: 10 },
  })).status, 'critical');
  assert.strictEqual(scoreTwinStability(metrics({
    runtime: { event_loop_p95_ms: 5, heap_used_percent: 75 },
  })).status, 'degraded');
  assert.strictEqual(scoreTwinStability(metrics({
    sources: [{ source: 'radius_accounting_live', entity_type: 'subscriber', expected: 100, fresh: 0, coverage_percent: 0 }],
  })).status, 'critical');
  assert.ok(desiredAlerts(metrics({ failed_events: 1 })).some((alert) => alert.key === 'projection_failed'));
  assert.ok(desiredAlerts(metrics({ oldest_pending_seconds: 301 })).some((alert) => alert.key === 'projection_stalled'));
  console.log('Twin stability scoring and alert tests passed.');
}

run();
