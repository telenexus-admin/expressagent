const assert = require('assert');
const {
  buildCommandBrief,
  classifyIncidentEvent,
  recommendationTemplates,
} = require('../src/services/incidentCommander');

function event(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    event_type: 'router.offline', event_category: 'network', source: 'mikrotik_monitor',
    entity_type: 'router', entity_id: '12', severity: 'critical',
    title: 'Core router offline', description: 'Router stopped responding.',
    ...overrides,
  };
}

function run() {
  const incident = classifyIncidentEvent(event());
  assert.strictEqual(incident.result, 'correlated');
  assert.strictEqual(incident.category, 'network');
  assert.strictEqual(incident.severity, 'critical');
  assert.strictEqual(incident.incident_key, 'network:router:12');
  assert.ok(incident.recommendations.some((item) => item.action_type === 'inspect_router_path'));

  const recovery = classifyIncidentEvent(event({ event_type: 'router.online', severity: 'info' }));
  assert.strictEqual(recovery.result, 'resolved');
  assert.strictEqual(recovery.incident_key, incident.incident_key);
  assert.strictEqual(classifyIncidentEvent(event({ event_type: 'subscriber.updated', severity: 'info' })).result, 'ignored');
  assert.strictEqual(classifyIncidentEvent(event({ event_type: 'incident.opened', event_category: 'incident', source: 'incident_commander' })).result, 'ignored');
  assert.strictEqual(classifyIncidentEvent(event({ occurred_at: '2020-01-01T00:00:00.000Z' })).reason, 'historical_signal');
  assert.ok(recommendationTemplates('billing').every((item) => item.rationale && item.steps.length));

  const brief = buildCommandBrief({ title: 'Router offline', summary: 'No heartbeat.', status: 'investigating', impact: { affected_entities: 8 } });
  assert.match(brief, /8 directly connected entities may be affected/);
  assert.match(brief, /advisory mode/);
  console.log('Incident Commander classification, recovery, recommendation, and brief tests passed.');
}

run();
