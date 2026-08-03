const assert = require('assert');
const {
  appendBillingEvent,
  appendRequestEvent,
  buildEventEnvelope,
  redactSensitive,
} = require('../src/services/events');

function sampleEvent(overrides = {}) {
  return {
    clientId: 42,
    eventType: 'subscriber.created',
    category: 'subscriber',
    source: 'billing_api',
    entityType: 'subscriber',
    entityId: 7001,
    actorType: 'admin',
    actorId: 3,
    title: 'Subscriber created',
    payload: {
      account_number: 'ACC-7001',
      radius_password: 'must-not-be-stored',
      nested: { apiKey: 'also-secret', package_name: 'Starter' },
    },
    relatedEntities: [
      { entityType: 'router', entityId: 15, relationship: 'served_by' },
    ],
    ...overrides,
  };
}

function testEnvelope() {
  const envelope = buildEventEnvelope(sampleEvent());
  assert.equal(envelope.client_id, 42);
  assert.equal(envelope.event_type, 'subscriber.created');
  assert.equal(envelope.entity_id, '7001');
  assert.equal(envelope.payload.radius_password, '[REDACTED]');
  assert.equal(envelope.payload.nested.apiKey, '[REDACTED]');
  assert.equal(envelope.payload.nested.package_name, 'Starter');
  assert.equal(envelope.related_entities[0].entity_id, '15');
  assert.match(envelope.id, /^[0-9a-f-]{36}$/i);
}

function testValidation() {
  assert.throws(() => buildEventEnvelope(sampleEvent({ clientId: null })), /clientId/);
  assert.throws(() => buildEventEnvelope(sampleEvent({ eventType: 'created' })), /namespaced/);
  assert.throws(() => buildEventEnvelope(sampleEvent({ severity: 'urgent' })), /severity/);
  assert.throws(() => buildEventEnvelope(sampleEvent({ causationId: 'not-a-uuid' })), /causationId/);
  assert.throws(() => buildEventEnvelope(sampleEvent({ retentionUntil: 'not-a-date' })), /retentionUntil/);
  assert.throws(
    () => buildEventEnvelope(sampleEvent({ entityType: 'subscriber', entityId: null })),
    /supplied together/
  );
}

function testRedaction() {
  const result = redactSensitive({
    password: 'one',
    authorization: 'two',
    safe: 'visible',
    list: [{ private_key: 'three', status: 'ok' }],
  });
  assert.equal(result.password, '[REDACTED]');
  assert.equal(result.authorization, '[REDACTED]');
  assert.equal(result.safe, 'visible');
  assert.equal(result.list[0].private_key, '[REDACTED]');
  assert.equal(result.list[0].status, 'ok');
}

async function testAppend() {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO billing_events')) {
        return {
          rows: [{
            id: params[0],
            client_id: params[1],
            event_type: params[2],
            recorded_at: new Date().toISOString(),
          }],
        };
      }
      return { rows: [] };
    },
  };
  const result = await appendBillingEvent(queryable, sampleEvent());
  assert.equal(result.duplicate, false);
  assert.equal(calls.filter((call) => call.sql.includes('billing_event_entities')).length, 2);
  const outbox = calls.find((call) => call.sql.includes('INSERT INTO billing_event_outbox'));
  assert(outbox);
  assert.equal(outbox.params[1], 42);
  assert.equal(outbox.params[2], 'billing.42.subscriber.created');
  assert.equal(JSON.parse(outbox.params[3]).payload.radius_password, '[REDACTED]');
}

async function testDeduplication() {
  const existing = { id: 'bc0ff04f-6d9f-4d40-a36f-05393746472e', client_id: 42 };
  let call = 0;
  const queryable = {
    async query() {
      call += 1;
      return call === 1 ? { rows: [] } : { rows: [existing] };
    },
  };
  const result = await appendBillingEvent(queryable, sampleEvent({ deduplicationKey: 'subscriber:7001:created' }));
  assert.equal(result.duplicate, true);
  assert.deepEqual(result.event, existing);
  assert.equal(call, 2);
}

async function testRequestEvent() {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO billing_events')) {
        return { rows: [{ id: params[0], client_id: params[1], recorded_at: new Date().toISOString() }] };
      }
      return { rows: [] };
    },
  };
  await appendRequestEvent(queryable, {
    scope: { clientId: 81 },
    user: { id: 9, role: 'admin', name: 'Test Admin' },
    headers: { 'x-request-id': 'req-81', 'user-agent': 'test-agent' },
    ip: '127.0.0.1',
  }, {
    eventType: 'invoice.issued',
    category: 'invoice',
    source: 'billing_workspace',
    entityType: 'invoice',
    entityId: 501,
    payload: { amount: 2000 },
  });
  const insert = calls.find((call) => call.sql.includes('INSERT INTO billing_events'));
  assert(insert);
  assert.equal(insert.params[1], 81);
  assert.equal(insert.params[8], 'admin');
  assert.equal(insert.params[9], '9');
  assert.equal(insert.params[10], 'Test Admin');
  const metadata = JSON.parse(insert.params[17]);
  assert.equal(metadata.request_id, 'req-81');
  assert.equal(metadata.ip_address, '127.0.0.1');
}

async function main() {
  testEnvelope();
  testValidation();
  testRedaction();
  await testAppend();
  await testDeduplication();
  await testRequestEvent();
  console.log('Event schema service tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
