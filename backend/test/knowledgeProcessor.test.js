const assert = require('assert');
const {
  buildFactText,
  factDataForEvent,
  meaningfulState,
} = require('../src/services/knowledgeProcessor');
const {
  compactRow,
  relatedEntities,
} = require('../src/services/knowledgeBootstrap');

function sampleEvent(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    client_id: 7,
    event_type: 'payment.received',
    event_category: 'payment',
    source: 'billing.workspace',
    entity_type: 'payment',
    entity_id: '91',
    actor_type: 'admin',
    actor_id: '12',
    actor_name: 'Billing Admin',
    severity: 'info',
    sensitivity: 'confidential',
    title: 'Payment received',
    description: 'A subscriber payment was completed.',
    payload: { amount: 2000, method: 'M-Pesa', reference: 'ABC123' },
    previous_state: {},
    new_state: { status: 'completed', amount: 2000 },
    metadata: {},
    occurred_at: '2026-07-30T12:00:00.000Z',
    ...overrides,
  };
}

function run() {
  const event = sampleEvent();
  const fact = buildFactText(event);
  assert.match(fact, /Payment received/i);
  assert.match(fact, /payment 91/i);
  assert.match(fact, /status: completed/i);
  assert.match(fact, /amount: 2000/i);

  assert.deepStrictEqual(meaningfulState(event), { status: 'completed', amount: 2000 });
  assert.deepStrictEqual(
    meaningfulState(sampleEvent({ new_state: {}, payload: { status: 'paid' } })),
    { status: 'paid' }
  );

  const data = factDataForEvent(event);
  assert.strictEqual(data.source, 'billing.workspace');
  assert.strictEqual(data.actor_name, 'Billing Admin');
  assert.strictEqual(data.payload.reference, 'ABC123');

  assert.deepStrictEqual(
    compactRow({ id: 4, client_id: 9, name: 'Starter', empty: null, active: true }),
    { name: 'Starter', active: true }
  );

  const source = {
    related: (row) => [
      row.plan_id && { entityType: 'package', entityId: row.plan_id, relationship: 'subscribed_to' },
      null,
    ],
  };
  assert.deepStrictEqual(relatedEntities(source, { plan_id: 33 }), [{
    entityType: 'package',
    entityId: '33',
    relationship: 'subscribed_to',
  }]);

  console.log('Knowledge processor unit tests passed.');
}

run();
