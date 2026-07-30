const crypto = require('crypto');

const EVENT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS billing_events (
    id UUID PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    event_type VARCHAR(120) NOT NULL,
    event_category VARCHAR(60) NOT NULL,
    event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version > 0),
    source VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80),
    entity_id VARCHAR(160),
    actor_type VARCHAR(40) NOT NULL DEFAULT 'system',
    actor_id VARCHAR(160),
    actor_name VARCHAR(255),
    severity VARCHAR(20) NOT NULL DEFAULT 'info'
      CHECK (severity IN ('debug', 'info', 'warning', 'critical')),
    title VARCHAR(255),
    description TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    correlation_id VARCHAR(128),
    causation_id UUID,
    deduplication_key VARCHAR(255),
    sensitivity VARCHAR(20) NOT NULL DEFAULT 'internal'
      CHECK (sensitivity IN ('public', 'internal', 'confidential', 'restricted')),
    ai_status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (ai_status IN ('pending', 'processing', 'processed', 'ignored', 'failed')),
    ai_attempts INTEGER NOT NULL DEFAULT 0 CHECK (ai_attempts >= 0),
    ai_last_error TEXT,
    ai_processed_at TIMESTAMP WITH TIME ZONE,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    retention_until TIMESTAMP WITH TIME ZONE,
    UNIQUE (id, client_id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_tenant_dedupe
    ON billing_events(client_id, deduplication_key)
    WHERE deduplication_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_billing_events_tenant_time
    ON billing_events(client_id, occurred_at DESC, id);
  CREATE INDEX IF NOT EXISTS idx_billing_events_tenant_type_time
    ON billing_events(client_id, event_type, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_events_tenant_category_time
    ON billing_events(client_id, event_category, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_events_tenant_entity
    ON billing_events(client_id, entity_type, entity_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_events_tenant_correlation
    ON billing_events(client_id, correlation_id, occurred_at ASC)
    WHERE correlation_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_billing_events_ai_queue
    ON billing_events(ai_status, recorded_at ASC)
    WHERE ai_status IN ('pending', 'failed');

  CREATE TABLE IF NOT EXISTS billing_event_entities (
    event_id UUID NOT NULL,
    client_id INTEGER NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id VARCHAR(160) NOT NULL,
    relationship VARCHAR(60) NOT NULL DEFAULT 'related',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, entity_type, entity_id, relationship),
    FOREIGN KEY (event_id, client_id)
      REFERENCES billing_events(id, client_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_billing_event_entities_tenant_entity
    ON billing_event_entities(client_id, entity_type, entity_id, event_id);

  CREATE TABLE IF NOT EXISTS billing_event_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL,
    client_id INTEGER NOT NULL,
    topic VARCHAR(180) NOT NULL,
    event_envelope JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'published', 'failed', 'dead_letter')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by VARCHAR(160),
    last_error TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (event_id),
    FOREIGN KEY (event_id, client_id)
      REFERENCES billing_events(id, client_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_billing_event_outbox_pending
    ON billing_event_outbox(status, available_at ASC, id)
    WHERE status IN ('pending', 'failed');
  CREATE INDEX IF NOT EXISTS idx_billing_event_outbox_tenant
    ON billing_event_outbox(client_id, created_at DESC);
`;

const SENSITIVE_KEY = /(^|_)(password|passwd|secret|token|api_?key|access_?key|private_?key|authorization|cookie|credential|radius_password|meta_access_token)($|_)/i;
const ALLOWED_SEVERITIES = new Set(['debug', 'info', 'warning', 'critical']);
const ALLOWED_SENSITIVITIES = new Set(['public', 'internal', 'confidential', 'restricted']);
let schemaReady = false;
let schemaPromise;
let applicationDb;

function getApplicationDb() {
  if (!applicationDb) applicationDb = require('../db');
  return applicationDb;
}

function redactSensitive(value, depth = 0) {
  if (depth > 12) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, depth + 1),
  ]));
}

function requiredText(value, name, maxLength) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > maxLength) throw new Error(`${name} must not exceed ${maxLength} characters`);
  return normalized;
}

function optionalText(value, maxLength) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error(`Value must not exceed ${maxLength} characters`);
  return normalized;
}

function buildEventEnvelope(input = {}) {
  const clientId = Number(input.clientId ?? input.client_id);
  if (!Number.isInteger(clientId) || clientId <= 0) throw new Error('clientId must be a positive integer');

  const eventType = requiredText(input.eventType ?? input.event_type, 'eventType', 120).toLowerCase();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(eventType)) {
    throw new Error('eventType must be a namespaced value such as subscriber.created');
  }

  const category = requiredText(
    input.category ?? input.eventCategory ?? input.event_category ?? eventType.split('.')[0],
    'category',
    60
  ).toLowerCase();
  const severity = String(input.severity || 'info').toLowerCase();
  if (!ALLOWED_SEVERITIES.has(severity)) throw new Error('Unsupported event severity');
  const sensitivity = String(input.sensitivity || 'internal').toLowerCase();
  if (!ALLOWED_SENSITIVITIES.has(sensitivity)) throw new Error('Unsupported event sensitivity');

  const occurredAt = input.occurredAt ?? input.occurred_at ?? new Date();
  const occurredDate = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(occurredDate.getTime())) throw new Error('occurredAt must be a valid date');
  const causationId = optionalText(input.causationId ?? input.causation_id, 36);
  if (causationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(causationId)) {
    throw new Error('causationId must be a valid UUID');
  }
  const retentionValue = input.retentionUntil ?? input.retention_until ?? null;
  const retentionDate = retentionValue ? new Date(retentionValue) : null;
  if (retentionDate && Number.isNaN(retentionDate.getTime())) throw new Error('retentionUntil must be a valid date');

  const event = {
    id: input.id || crypto.randomUUID(),
    client_id: clientId,
    event_type: eventType,
    event_category: category,
    event_version: Number(input.eventVersion ?? input.event_version ?? 1),
    source: requiredText(input.source, 'source', 80).toLowerCase(),
    entity_type: optionalText(input.entityType ?? input.entity_type, 80)?.toLowerCase() || null,
    entity_id: optionalText(input.entityId ?? input.entity_id, 160),
    actor_type: optionalText(input.actorType ?? input.actor_type ?? 'system', 40)?.toLowerCase() || 'system',
    actor_id: optionalText(input.actorId ?? input.actor_id, 160),
    actor_name: optionalText(input.actorName ?? input.actor_name, 255),
    severity,
    title: optionalText(input.title, 255),
    description: input.description === null || input.description === undefined
      ? null
      : String(input.description).trim() || null,
    payload: redactSensitive(input.payload || {}),
    previous_state: redactSensitive(input.previousState ?? input.previous_state ?? {}),
    new_state: redactSensitive(input.newState ?? input.new_state ?? {}),
    metadata: redactSensitive(input.metadata || {}),
    correlation_id: optionalText(input.correlationId ?? input.correlation_id, 128),
    causation_id: causationId,
    deduplication_key: optionalText(input.deduplicationKey ?? input.deduplication_key, 255),
    sensitivity,
    occurred_at: occurredDate.toISOString(),
    retention_until: retentionDate ? retentionDate.toISOString() : null,
    related_entities: (input.relatedEntities ?? input.related_entities ?? []).map((entity) => ({
      entity_type: requiredText(entity.entityType ?? entity.entity_type, 'related entity type', 80).toLowerCase(),
      entity_id: requiredText(entity.entityId ?? entity.entity_id, 'related entity id', 160),
      relationship: optionalText(entity.relationship || 'related', 60)?.toLowerCase() || 'related',
    })),
  };

  if (!Number.isInteger(event.event_version) || event.event_version <= 0) {
    throw new Error('eventVersion must be a positive integer');
  }
  if ((event.entity_type && !event.entity_id) || (!event.entity_type && event.entity_id)) {
    throw new Error('entityType and entityId must be supplied together');
  }
  return event;
}

async function ensureEventSchema(queryable = getApplicationDb()) {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = queryable.query(EVENT_SCHEMA_SQL)
      .then(() => {
        schemaReady = true;
      })
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

async function appendBillingEvent(queryable, input) {
  if (!queryable || typeof queryable.query !== 'function') throw new Error('A database queryable is required');
  const event = buildEventEnvelope(input);
  const inserted = await queryable.query(
    `INSERT INTO billing_events (
       id, client_id, event_type, event_category, event_version, source,
       entity_type, entity_id, actor_type, actor_id, actor_name, severity,
       title, description, payload, previous_state, new_state, metadata,
       correlation_id, causation_id, deduplication_key, sensitivity,
       occurred_at, retention_until
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       $13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,
       $19,$20::uuid,$21,$22,$23,$24
     )
     ON CONFLICT (client_id, deduplication_key)
       WHERE deduplication_key IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      event.id,
      event.client_id,
      event.event_type,
      event.event_category,
      event.event_version,
      event.source,
      event.entity_type,
      event.entity_id,
      event.actor_type,
      event.actor_id,
      event.actor_name,
      event.severity,
      event.title,
      event.description,
      JSON.stringify(event.payload),
      JSON.stringify(event.previous_state),
      JSON.stringify(event.new_state),
      JSON.stringify(event.metadata),
      event.correlation_id,
      event.causation_id,
      event.deduplication_key,
      event.sensitivity,
      event.occurred_at,
      event.retention_until,
    ]
  );

  if (!inserted.rows[0]) {
    const duplicate = await queryable.query(
      `SELECT * FROM billing_events
       WHERE client_id = $1 AND deduplication_key = $2
       LIMIT 1`,
      [event.client_id, event.deduplication_key]
    );
    return { event: duplicate.rows[0], duplicate: true };
  }

  const savedEvent = inserted.rows[0];
  const entities = [
    ...(event.entity_type ? [{
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      relationship: 'primary',
    }] : []),
    ...event.related_entities,
  ];
  for (const entity of entities) {
    await queryable.query(
      `INSERT INTO billing_event_entities
         (event_id, client_id, entity_type, entity_id, relationship)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [savedEvent.id, event.client_id, entity.entity_type, entity.entity_id, entity.relationship]
    );
  }

  const envelope = {
    ...event,
    related_entities: entities,
    recorded_at: savedEvent.recorded_at,
  };
  await queryable.query(
    `INSERT INTO billing_event_outbox
       (event_id, client_id, topic, event_envelope)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [savedEvent.id, event.client_id, `billing.${event.client_id}.${event.event_type}`, JSON.stringify(envelope)]
  );
  return { event: savedEvent, duplicate: false };
}

async function recordBillingEvent(input) {
  const db = getApplicationDb();
  await ensureEventSchema(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await appendBillingEvent(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction did not start */ }
    throw error;
  } finally {
    client.release();
  }
}

function eventActorFromRequest(req) {
  const user = req?.user || {};
  return {
    actorType: user.role === 'superadmin' || user.role === 'admin' ? 'admin' : (user.role || 'system'),
    actorId: user.id || null,
    actorName: user.name || user.email || null,
    metadata: {
      request_id: req?.headers?.['x-request-id'] || null,
      ip_address: req?.ip || null,
      user_agent: req?.headers?.['user-agent'] || null,
    },
  };
}

function clientIdFromRequest(req) {
  const value = Number(
    req?.scope?.clientId
    ?? req?.body?.client_id
    ?? req?.query?.clientId
  );
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('A tenant client id is required for this event');
  }
  return value;
}

async function appendRequestEvent(queryable, req, input = {}) {
  return appendBillingEvent(queryable, {
    clientId: input.clientId ?? clientIdFromRequest(req),
    ...eventActorFromRequest(req),
    ...input,
    metadata: {
      ...eventActorFromRequest(req).metadata,
      ...(input.metadata || {}),
    },
  });
}

async function recordRequestEvent(req, input = {}) {
  return recordBillingEvent({
    clientId: input.clientId ?? clientIdFromRequest(req),
    ...eventActorFromRequest(req),
    ...input,
    metadata: {
      ...eventActorFromRequest(req).metadata,
      ...(input.metadata || {}),
    },
  });
}

module.exports = {
  EVENT_SCHEMA_SQL,
  appendBillingEvent,
  appendRequestEvent,
  buildEventEnvelope,
  clientIdFromRequest,
  ensureEventSchema,
  eventActorFromRequest,
  recordBillingEvent,
  recordRequestEvent,
  redactSensitive,
};
