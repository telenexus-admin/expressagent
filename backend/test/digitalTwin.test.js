const assert = require('assert');
const {
  deriveTwinStatuses,
  freshnessSecondsForEvent,
  mergedEventState,
} = require('../src/services/digitalTwin');

function sampleEvent(overrides = {}) {
  return {
    event_type: 'radius.session.connected',
    event_category: 'radius',
    entity_type: 'subscriber',
    severity: 'info',
    payload: { online: true, router_name: 'Core Router' },
    new_state: { status: 'active', ip_address: '10.0.0.2' },
    metadata: {},
    ...overrides,
  };
}

function run() {
  assert.deepStrictEqual(mergedEventState(sampleEvent()), {
    online: true,
    router_name: 'Core Router',
    status: 'active',
    ip_address: '10.0.0.2',
  });
  assert.deepStrictEqual(deriveTwinStatuses(sampleEvent()), {
    lifecycle: 'active',
    operational: 'online',
    health: 'unknown',
  });
  assert.strictEqual(
    deriveTwinStatuses(sampleEvent({ event_type: 'router.offline', severity: 'critical' })).operational,
    'offline'
  );
  assert.strictEqual(
    deriveTwinStatuses(sampleEvent({ event_type: 'router.offline', severity: 'critical' })).health,
    'critical'
  );
  assert.strictEqual(
    deriveTwinStatuses(sampleEvent({
      event_type: 'ont.status_changed',
      payload: {},
      new_state: { status: 'offline' },
    })).operational,
    'offline'
  );
  assert.strictEqual(
    deriveTwinStatuses(sampleEvent({ event_type: 'subscriber.expired' })).lifecycle,
    'expired'
  );
  assert.strictEqual(freshnessSecondsForEvent(sampleEvent()), 300);
  assert.strictEqual(freshnessSecondsForEvent(sampleEvent({
    event_type: 'payment.received',
    event_category: 'payment',
    entity_type: 'payment',
  })), 86400);
  console.log('Digital twin unit tests passed.');
}

run();
