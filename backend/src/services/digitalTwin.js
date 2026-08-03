const os = require('os');
const db = require('../db');
const { ensureEventSchema } = require('./events');

const DIGITAL_TWIN_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS billing_twin_entities (
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    entity_type VARCHAR(80) NOT NULL,
    entity_id VARCHAR(160) NOT NULL,
    display_name VARCHAR(255),
    lifecycle_status VARCHAR(40) NOT NULL DEFAULT 'unknown',
    operational_status VARCHAR(40) NOT NULL DEFAULT 'unknown',
    health_status VARCHAR(40) NOT NULL DEFAULT 'unknown',
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    source VARCHAR(120),
    source_event_id UUID,
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    freshness_expires_at TIMESTAMP WITH TIME ZONE,
    confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000
      CHECK (confidence >= 0 AND confidence <= 1),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, entity_type, entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_entities_type_status
    ON billing_twin_entities(client_id, entity_type, operational_status, last_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_twin_entities_health
    ON billing_twin_entities(client_id, health_status, last_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_twin_entities_freshness
    ON billing_twin_entities(client_id, freshness_expires_at ASC)
    WHERE freshness_expires_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_billing_twin_entities_state
    ON billing_twin_entities USING GIN(state);

  CREATE TABLE IF NOT EXISTS billing_twin_source_observations (
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    source VARCHAR(120) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id VARCHAR(160) NOT NULL,
    operational_status VARCHAR(40) NOT NULL DEFAULT 'unknown',
    health_status VARCHAR(40) NOT NULL DEFAULT 'unknown',
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    freshness_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000
      CHECK (confidence >= 0 AND confidence <= 1),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, source, entity_type, entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_source_freshness
    ON billing_twin_source_observations(client_id, source, freshness_expires_at ASC);

  CREATE TABLE IF NOT EXISTS billing_twin_relationships (
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    from_entity_type VARCHAR(80) NOT NULL,
    from_entity_id VARCHAR(160) NOT NULL,
    relationship VARCHAR(60) NOT NULL,
    to_entity_type VARCHAR(80) NOT NULL,
    to_entity_id VARCHAR(160) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_event_id UUID,
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_to TIMESTAMP WITH TIME ZONE,
    confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000
      CHECK (confidence >= 0 AND confidence <= 1),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (
      client_id, from_entity_type, from_entity_id,
      relationship, to_entity_type, to_entity_id
    )
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_relationships_from
    ON billing_twin_relationships(client_id, from_entity_type, from_entity_id)
    WHERE active = TRUE;
  CREATE INDEX IF NOT EXISTS idx_billing_twin_relationships_to
    ON billing_twin_relationships(client_id, to_entity_type, to_entity_id)
    WHERE active = TRUE;

  CREATE TABLE IF NOT EXISTS billing_twin_projection_events (
    event_id UUID NOT NULL,
    client_id INTEGER NOT NULL,
    projector_version INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL CHECK (status IN ('processing', 'projected', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
    last_error TEXT,
    projected_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, client_id),
    FOREIGN KEY (event_id, client_id)
      REFERENCES billing_events(id, client_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_billing_twin_projection_status
    ON billing_twin_projection_events(status, updated_at ASC);

  CREATE TABLE IF NOT EXISTS billing_twin_projector_state (
    worker_id VARCHAR(160) PRIMARY KEY,
    status VARCHAR(20) NOT NULL CHECK (status IN ('idle', 'running', 'error')),
    last_started_at TIMESTAMP WITH TIME ZONE,
    last_completed_at TIMESTAMP WITH TIME ZONE,
    last_event_at TIMESTAMP WITH TIME ZONE,
    projected_count BIGINT NOT NULL DEFAULT 0 CHECK (projected_count >= 0),
    failed_count BIGINT NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    last_error TEXT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
`;

const PROJECTOR_VERSION = 1;
const WORKER_ID = `${os.hostname()}:${process.pid}:digital-twin`;
const DEFAULT_BATCH_SIZE = 50;
let schemaReady = false;
let schemaPromise;
let projectorRunning = false;

function cleanText(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function compactObject(value, depth = 0) {
  if (depth > 4) return '[nested data]';
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => compactObject(item, depth + 1));
  if (!isPlainObject(value)) {
    return typeof value === 'string' ? cleanText(value, 1000) : value;
  }
  return Object.fromEntries(
    Object.entries(value).slice(0, 100).map(([key, item]) => [key, compactObject(item, depth + 1)])
  );
}

function normalizedLimit(value, fallback = 50, maximum = 200) {
  return Math.max(1, Math.min(Number(value) || fallback, maximum));
}

function confidenceForEvent(event) {
  const candidate = Number(event.metadata?.confidence ?? event.payload?.confidence ?? 1);
  if (!Number.isFinite(candidate)) return 1;
  return Math.max(0, Math.min(candidate, 1));
}

function mergedEventState(event) {
  const payload = isPlainObject(event.payload) ? event.payload : {};
  const next = isPlainObject(event.new_state) ? event.new_state : {};
  return compactObject({ ...payload, ...next });
}

function displayNameForEvent(event) {
  const state = mergedEventState(event);
  const candidates = [
    state.display_name, state.full_name, state.name, state.subscriber_name,
    state.router_name, state.employee_name, state.package_name,
    state.invoice_number, event.title, event.entity_id,
  ];
  return cleanText(candidates.find((value) => cleanText(value)) || '', 255) || null;
}

function deriveTwinStatuses(event) {
  const state = mergedEventState(event);
  const type = cleanText(event.event_type, 120).toLowerCase();
  const explicit = cleanText(
    state.status ?? state.account_status ?? state.lifecycle_status,
    40
  ).toLowerCase();
  const connection = cleanText(
    state.operational_status ?? state.connection_status ?? state.session_status
      ?? (['online', 'offline', 'up', 'down', 'connected', 'disconnected'].includes(explicit) ? explicit : null),
    40
  ).toLowerCase();

  let lifecycle = ['active', 'inactive', 'expired', 'suspended', 'deleted', 'pending']
    .includes(explicit) ? explicit : 'unknown';
  if (type.includes('expired')) lifecycle = 'expired';
  else if (type.includes('suspended')) lifecycle = 'suspended';
  else if (type.includes('deleted') || type.includes('removed')) lifecycle = 'deleted';
  else if (state.active === true || type.includes('activated') || type.includes('recharged')) lifecycle = 'active';
  else if (state.active === false || type.includes('deactivated')) lifecycle = 'inactive';

  let operational = ['online', 'offline', 'up', 'down', 'connected', 'disconnected']
    .includes(connection) ? connection : 'unknown';
  if (state.online === true || /(^|[._-])(connected|online|up|authenticated|started)$/.test(type)) operational = 'online';
  if (state.online === false || /(^|[._-])(disconnected|offline|down|stopped|terminated)$/.test(type)) operational = 'offline';

  let health = cleanText(state.health_status ?? state.health, 40).toLowerCase();
  if (!['healthy', 'degraded', 'critical', 'unknown'].includes(health)) health = 'unknown';
  if (event.severity === 'critical') health = 'critical';
  else if (event.severity === 'warning' && health !== 'critical') health = 'degraded';
  else if (/recover(ed|y)|restored|healthy/.test(type)) health = 'healthy';

  return { lifecycle, operational, health };
}

function freshnessSecondsForEvent(event) {
  const type = `${event.event_category || ''}.${event.entity_type || ''}.${event.event_type || ''}`.toLowerCase();
  if (/radius|session|traffic|interface|router|mikrotik|olt|ont|tr069|network/.test(type)) return 300;
  if (/payment|invoice|subscriber|package|voucher|employee|ticket/.test(type)) return 86400;
  return 604800;
}

async function ensureDigitalTwinSchema(queryable = db) {
  await ensureEventSchema(queryable);
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = queryable.query(DIGITAL_TWIN_SCHEMA_SQL)
      .then(() => { schemaReady = true; })
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

async function upsertTwinEntity(client, event, override = {}) {
  const entityType = cleanText(override.entityType ?? event.entity_type, 80).toLowerCase();
  const entityId = cleanText(override.entityId ?? event.entity_id, 160);
  if (!entityType || !entityId) return;
  const observedAt = event.occurred_at;
  const statuses = override.stub
    ? { lifecycle: 'unknown', operational: 'unknown', health: 'unknown' }
    : deriveTwinStatuses(event);
  const state = override.stub ? {} : mergedEventState(event);
  const attributes = override.stub ? {} : compactObject({
    category: event.event_category,
    severity: event.severity,
    sensitivity: event.sensitivity,
    correlation_id: event.correlation_id,
  });
  const freshnessSeconds = freshnessSecondsForEvent(event);
  await client.query(
    `INSERT INTO billing_twin_entities (
       client_id, entity_type, entity_id, display_name,
       lifecycle_status, operational_status, health_status,
       state, attributes, source, source_event_id, observed_at,
       freshness_expires_at, confidence, first_seen_at, last_seen_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,
       $12::timestamptz + ($13::text || ' seconds')::interval,$14,$12,$12
     )
     ON CONFLICT (client_id, entity_type, entity_id)
     DO UPDATE SET
       display_name = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         THEN COALESCE(EXCLUDED.display_name, billing_twin_entities.display_name)
         ELSE billing_twin_entities.display_name END,
       lifecycle_status = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         AND EXCLUDED.lifecycle_status <> 'unknown' THEN EXCLUDED.lifecycle_status
         ELSE billing_twin_entities.lifecycle_status END,
       operational_status = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         AND EXCLUDED.operational_status <> 'unknown' THEN EXCLUDED.operational_status
         ELSE billing_twin_entities.operational_status END,
       health_status = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         AND EXCLUDED.health_status <> 'unknown' THEN EXCLUDED.health_status
         ELSE billing_twin_entities.health_status END,
       state = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         THEN billing_twin_entities.state || EXCLUDED.state ELSE billing_twin_entities.state END,
       attributes = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         THEN billing_twin_entities.attributes || EXCLUDED.attributes ELSE billing_twin_entities.attributes END,
       source = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         THEN COALESCE(EXCLUDED.source, billing_twin_entities.source)
         ELSE billing_twin_entities.source END,
       source_event_id = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         THEN EXCLUDED.source_event_id ELSE billing_twin_entities.source_event_id END,
       observed_at = GREATEST(billing_twin_entities.observed_at, EXCLUDED.observed_at),
       freshness_expires_at = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         THEN EXCLUDED.freshness_expires_at ELSE billing_twin_entities.freshness_expires_at END,
       confidence = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
         THEN EXCLUDED.confidence ELSE billing_twin_entities.confidence END,
       version = billing_twin_entities.version + 1,
       first_seen_at = LEAST(billing_twin_entities.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at = GREATEST(billing_twin_entities.last_seen_at, EXCLUDED.last_seen_at),
       updated_at = NOW()`,
    [
      event.client_id, entityType, entityId,
      Object.prototype.hasOwnProperty.call(override, 'displayName')
        ? override.displayName
        : (override.stub ? null : displayNameForEvent(event)),
      statuses.lifecycle, statuses.operational, statuses.health,
      JSON.stringify(state), JSON.stringify(attributes), override.stub ? null : (cleanText(event.source, 120) || null),
      event.id, observedAt, freshnessSeconds, confidenceForEvent(event),
    ]
  );
}

async function upsertTwinRelationships(client, event) {
  if (!event.entity_type || !event.entity_id) return;
  const related = await client.query(
    `SELECT entity_type, entity_id, relationship
     FROM billing_event_entities
     WHERE event_id = $1 AND client_id = $2 AND relationship <> 'primary'`,
    [event.id, event.client_id]
  );
  for (const entity of related.rows) {
    await upsertTwinEntity(client, event, {
      entityType: entity.entity_type,
      entityId: entity.entity_id,
      stub: true,
    });
    await client.query(
      `INSERT INTO billing_twin_relationships (
         client_id, from_entity_type, from_entity_id, relationship,
         to_entity_type, to_entity_id, active, attributes, source_event_id,
         observed_at, valid_from, confidence
       ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,'{}'::jsonb,$7,$8,$8,$9)
       ON CONFLICT (
         client_id, from_entity_type, from_entity_id,
         relationship, to_entity_type, to_entity_id
       ) DO UPDATE SET
         active = CASE WHEN EXCLUDED.observed_at >= billing_twin_relationships.observed_at
           THEN TRUE ELSE billing_twin_relationships.active END,
         source_event_id = CASE WHEN EXCLUDED.observed_at >= billing_twin_relationships.observed_at
           THEN EXCLUDED.source_event_id ELSE billing_twin_relationships.source_event_id END,
         observed_at = GREATEST(billing_twin_relationships.observed_at, EXCLUDED.observed_at),
         valid_to = CASE WHEN EXCLUDED.observed_at >= billing_twin_relationships.observed_at
           THEN NULL ELSE billing_twin_relationships.valid_to END,
         confidence = CASE WHEN EXCLUDED.observed_at >= billing_twin_relationships.observed_at
           THEN EXCLUDED.confidence ELSE billing_twin_relationships.confidence END,
         version = billing_twin_relationships.version + 1,
         updated_at = NOW()`,
      [
        event.client_id, event.entity_type, event.entity_id, entity.relationship,
        entity.entity_type, entity.entity_id, event.id, event.occurred_at,
        confidenceForEvent(event),
      ]
    );
  }
}

async function projectDigitalTwinEvent(client, event) {
  const claimed = await client.query(
    `INSERT INTO billing_twin_projection_events (
       event_id, client_id, projector_version, status
     ) VALUES ($1,$2,$3,'processing')
     ON CONFLICT (event_id, client_id) DO NOTHING
     RETURNING event_id`,
    [event.id, event.client_id, PROJECTOR_VERSION]
  );
  if (!claimed.rows[0]) return { eventId: event.id, duplicate: true };

  await upsertTwinEntity(client, event);
  await upsertTwinRelationships(client, event);
  await client.query(
    `UPDATE billing_twin_projection_events
     SET status = 'projected', projected_at = NOW(), last_error = NULL, updated_at = NOW()
     WHERE event_id = $1 AND client_id = $2`,
    [event.id, event.client_id]
  );
  return { eventId: event.id, duplicate: false };
}

function normalizeTwinObservation(input) {
  const clientId = Number(input.clientId ?? input.client_id);
  if (!Number.isInteger(clientId) || clientId <= 0) throw new Error('A valid twin observation clientId is required');
  const entityType = cleanText(input.entityType ?? input.entity_type, 80).toLowerCase();
  const entityId = cleanText(input.entityId ?? input.entity_id, 160);
  if (!entityType || !entityId) throw new Error('Twin observation entityType and entityId are required');
  const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
  const safeObservedAt = Number.isNaN(observedAt.getTime()) ? new Date() : observedAt;
  const event = {
    id: null,
    client_id: clientId,
    event_type: cleanText(input.eventType ?? input.event_type, 120).toLowerCase() || `${entityType}.observed`,
    event_category: cleanText(input.category ?? input.event_category, 60).toLowerCase() || 'telemetry',
    entity_type: entityType,
    entity_id: entityId,
    source: cleanText(input.source, 120) || 'digital_twin_observation',
    severity: ['info', 'warning', 'critical'].includes(input.severity) ? input.severity : 'info',
    sensitivity: cleanText(input.sensitivity, 20).toLowerCase() || 'internal',
    title: cleanText(input.displayName ?? input.display_name, 255) || entityId,
    payload: isPlainObject(input.payload) ? input.payload : {},
    new_state: isPlainObject(input.state ?? input.newState ?? input.new_state)
      ? (input.state ?? input.newState ?? input.new_state) : {},
    metadata: {
      ...(isPlainObject(input.metadata) ? input.metadata : {}),
      confidence: input.confidence ?? input.metadata?.confidence,
    },
    occurred_at: safeObservedAt.toISOString(),
  };
  const statuses = deriveTwinStatuses(event);
  return {
    client_id: clientId,
    entity_type: entityType,
    entity_id: entityId,
    display_name: cleanText(input.displayName ?? input.display_name, 255) || null,
    lifecycle_status: statuses.lifecycle,
    operational_status: statuses.operational,
    health_status: statuses.health,
    state: mergedEventState(event),
    attributes: compactObject({
      category: event.event_category,
      severity: event.severity,
      sensitivity: event.sensitivity,
    }),
    source: event.source,
    observed_at: safeObservedAt.toISOString(),
    freshness_expires_at: new Date(safeObservedAt.getTime() + freshnessSecondsForEvent(event) * 1000).toISOString(),
    confidence: confidenceForEvent(event),
  };
}

async function observeTwinEntities(inputs, options = {}) {
  const queryable = options.queryable || db;
  await ensureDigitalTwinSchema(queryable);
  const observations = (Array.isArray(inputs) ? inputs : []).map(normalizeTwinObservation);
  for (let offset = 0; offset < observations.length; offset += 500) {
    const chunk = observations.slice(offset, offset + 500);
    await queryable.query(
      `INSERT INTO billing_twin_entities (
         client_id, entity_type, entity_id, display_name,
         lifecycle_status, operational_status, health_status,
         state, attributes, source, source_event_id, observed_at,
         freshness_expires_at, confidence, first_seen_at, last_seen_at
       )
       SELECT row.client_id, row.entity_type, row.entity_id, row.display_name,
              row.lifecycle_status, row.operational_status, row.health_status,
              row.state, row.attributes, row.source, NULL, row.observed_at,
              row.freshness_expires_at, row.confidence, row.observed_at, row.observed_at
       FROM jsonb_to_recordset($1::jsonb) AS row(
         client_id INTEGER, entity_type TEXT, entity_id TEXT, display_name TEXT,
         lifecycle_status TEXT, operational_status TEXT, health_status TEXT,
         state JSONB, attributes JSONB, source TEXT, observed_at TIMESTAMPTZ,
         freshness_expires_at TIMESTAMPTZ, confidence NUMERIC
       )
       ON CONFLICT (client_id, entity_type, entity_id)
       DO UPDATE SET
         display_name = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           THEN COALESCE(EXCLUDED.display_name, billing_twin_entities.display_name)
           ELSE billing_twin_entities.display_name END,
         lifecycle_status = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           AND EXCLUDED.lifecycle_status <> 'unknown' THEN EXCLUDED.lifecycle_status
           ELSE billing_twin_entities.lifecycle_status END,
         operational_status = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           AND EXCLUDED.operational_status <> 'unknown' THEN EXCLUDED.operational_status
           ELSE billing_twin_entities.operational_status END,
         health_status = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           AND EXCLUDED.health_status <> 'unknown' THEN EXCLUDED.health_status
           ELSE billing_twin_entities.health_status END,
         state = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           THEN billing_twin_entities.state || EXCLUDED.state ELSE billing_twin_entities.state END,
         attributes = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           THEN billing_twin_entities.attributes || EXCLUDED.attributes ELSE billing_twin_entities.attributes END,
         source = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           THEN COALESCE(EXCLUDED.source, billing_twin_entities.source) ELSE billing_twin_entities.source END,
         observed_at = GREATEST(billing_twin_entities.observed_at, EXCLUDED.observed_at),
         freshness_expires_at = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           THEN EXCLUDED.freshness_expires_at ELSE billing_twin_entities.freshness_expires_at END,
         confidence = CASE WHEN EXCLUDED.observed_at >= billing_twin_entities.observed_at
           THEN EXCLUDED.confidence ELSE billing_twin_entities.confidence END,
         version = billing_twin_entities.version + 1,
         first_seen_at = LEAST(billing_twin_entities.first_seen_at, EXCLUDED.first_seen_at),
         last_seen_at = GREATEST(billing_twin_entities.last_seen_at, EXCLUDED.last_seen_at),
         updated_at = NOW()`,
      [JSON.stringify(chunk)]
    );
    await queryable.query(
      `INSERT INTO billing_twin_source_observations (
         client_id, source, entity_type, entity_id, operational_status,
         health_status, observed_at, freshness_expires_at, confidence, metadata
       )
       SELECT row.client_id, row.source, row.entity_type, row.entity_id,
              row.operational_status, row.health_status, row.observed_at,
              row.freshness_expires_at, row.confidence, row.attributes
       FROM jsonb_to_recordset($1::jsonb) AS row(
         client_id INTEGER, source TEXT, entity_type TEXT, entity_id TEXT,
         operational_status TEXT, health_status TEXT, observed_at TIMESTAMPTZ,
         freshness_expires_at TIMESTAMPTZ, confidence NUMERIC, attributes JSONB
       )
       ON CONFLICT (client_id, source, entity_type, entity_id)
       DO UPDATE SET
         operational_status = CASE WHEN EXCLUDED.observed_at >= billing_twin_source_observations.observed_at
           THEN EXCLUDED.operational_status ELSE billing_twin_source_observations.operational_status END,
         health_status = CASE WHEN EXCLUDED.observed_at >= billing_twin_source_observations.observed_at
           THEN EXCLUDED.health_status ELSE billing_twin_source_observations.health_status END,
         observed_at = GREATEST(billing_twin_source_observations.observed_at, EXCLUDED.observed_at),
         freshness_expires_at = CASE WHEN EXCLUDED.observed_at >= billing_twin_source_observations.observed_at
           THEN EXCLUDED.freshness_expires_at ELSE billing_twin_source_observations.freshness_expires_at END,
         confidence = CASE WHEN EXCLUDED.observed_at >= billing_twin_source_observations.observed_at
           THEN EXCLUDED.confidence ELSE billing_twin_source_observations.confidence END,
         metadata = CASE WHEN EXCLUDED.observed_at >= billing_twin_source_observations.observed_at
           THEN billing_twin_source_observations.metadata || EXCLUDED.metadata
           ELSE billing_twin_source_observations.metadata END,
         updated_at = NOW()`,
      [JSON.stringify(chunk)]
    );
  }
  return { observed: observations.length };
}

async function observeTwinEntity(input, options = {}) {
  const observation = normalizeTwinObservation(input);
  await observeTwinEntities([input], options);
  return {
    entity_type: observation.entity_type,
    entity_id: observation.entity_id,
    observed_at: observation.observed_at,
  };
}

async function observeTwinRelationship(input, options = {}) {
  const queryable = options.queryable || db;
  await ensureDigitalTwinSchema(queryable);
  const clientId = Number(input.clientId ?? input.client_id);
  const fromType = cleanText(input.fromEntityType ?? input.from_entity_type, 80).toLowerCase();
  const fromId = cleanText(input.fromEntityId ?? input.from_entity_id, 160);
  const relationship = cleanText(input.relationship, 60).toLowerCase();
  const toType = cleanText(input.toEntityType ?? input.to_entity_type, 80).toLowerCase();
  const toId = cleanText(input.toEntityId ?? input.to_entity_id, 160);
  if (!Number.isInteger(clientId) || clientId <= 0 || !fromType || !fromId || !relationship || !toType || !toId) {
    throw new Error('A complete tenant-scoped twin relationship observation is required');
  }
  const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
  const safeObservedAt = Number.isNaN(observedAt.getTime()) ? new Date() : observedAt;
  const active = input.active !== false;
  for (const [entityType, entityId] of [[fromType, fromId], [toType, toId]]) {
    await queryable.query(
      `INSERT INTO billing_twin_entities (
         client_id, entity_type, entity_id, display_name, observed_at,
         first_seen_at, last_seen_at, source
       ) VALUES ($1,$2,$3,NULL,$4,$4,$4,'relationship_observation')
       ON CONFLICT (client_id, entity_type, entity_id) DO NOTHING`,
      [clientId, entityType, entityId, safeObservedAt.toISOString()]
    );
  }
  await queryable.query(
    `INSERT INTO billing_twin_relationships (
       client_id, from_entity_type, from_entity_id, relationship,
       to_entity_type, to_entity_id, active, attributes, source_event_id,
       observed_at, valid_from, valid_to, confidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NULL,$9::timestamptz,$9::timestamptz,
       CASE WHEN $7 = FALSE THEN $9::timestamptz ELSE NULL END,$10)
     ON CONFLICT (
       client_id, from_entity_type, from_entity_id,
       relationship, to_entity_type, to_entity_id
     ) DO UPDATE SET
       active = CASE WHEN EXCLUDED.observed_at >= billing_twin_relationships.observed_at
         THEN EXCLUDED.active ELSE billing_twin_relationships.active END,
       attributes = CASE WHEN EXCLUDED.observed_at >= billing_twin_relationships.observed_at
         THEN billing_twin_relationships.attributes || EXCLUDED.attributes
         ELSE billing_twin_relationships.attributes END,
       observed_at = GREATEST(billing_twin_relationships.observed_at, EXCLUDED.observed_at),
       valid_to = CASE WHEN EXCLUDED.observed_at >= billing_twin_relationships.observed_at
         THEN EXCLUDED.valid_to ELSE billing_twin_relationships.valid_to END,
       confidence = CASE WHEN EXCLUDED.observed_at >= billing_twin_relationships.observed_at
         THEN EXCLUDED.confidence ELSE billing_twin_relationships.confidence END,
       version = billing_twin_relationships.version + 1,
       updated_at = NOW()`,
    [
      clientId, fromType, fromId, relationship, toType, toId, active,
      JSON.stringify(compactObject(input.attributes || {})), safeObservedAt.toISOString(),
      Math.max(0, Math.min(Number(input.confidence) || 1, 1)),
    ]
  );
}

async function updateProjectorState(status, values = {}, queryable = db) {
  await queryable.query(
    `INSERT INTO billing_twin_projector_state (
       worker_id, status, last_started_at, last_completed_at, last_event_at,
       projected_count, failed_count, last_error
     ) VALUES (
       $1,$2::text,
       CASE WHEN $2::text = 'running' THEN NOW() ELSE NULL END,
       CASE WHEN $2::text = 'idle' THEN NOW() ELSE NULL END,
       $3,$4,$5,$6
     )
     ON CONFLICT (worker_id) DO UPDATE SET
       status = EXCLUDED.status,
       last_started_at = CASE WHEN EXCLUDED.status = 'running' THEN NOW()
         ELSE billing_twin_projector_state.last_started_at END,
       last_completed_at = CASE WHEN EXCLUDED.status = 'idle' THEN NOW()
         ELSE billing_twin_projector_state.last_completed_at END,
       last_event_at = GREATEST(billing_twin_projector_state.last_event_at, EXCLUDED.last_event_at),
       projected_count = billing_twin_projector_state.projected_count + EXCLUDED.projected_count,
       failed_count = billing_twin_projector_state.failed_count + EXCLUDED.failed_count,
       last_error = EXCLUDED.last_error,
       updated_at = NOW()`,
    [
      WORKER_ID, status, values.lastEventAt || null,
      Number(values.projectedCount) || 0, Number(values.failedCount) || 0,
      cleanText(values.lastError, 2000) || null,
    ]
  );
}

async function processDigitalTwinBatch(limit = DEFAULT_BATCH_SIZE) {
  if (projectorRunning) return { skipped: true, projected: 0, failed: 0 };
  projectorRunning = true;
  let projected = 0;
  let failed = 0;
  let lastEventAt = null;
  try {
    await ensureDigitalTwinSchema();
    await updateProjectorState('running');
    const events = await db.query(
      `SELECT event.*
       FROM billing_events event
       LEFT JOIN billing_twin_projection_events projection
         ON projection.event_id = event.id AND projection.client_id = event.client_id
       WHERE projection.event_id IS NULL
       ORDER BY event.occurred_at ASC, event.recorded_at ASC, event.id ASC
       LIMIT $1`,
      [normalizedLimit(limit, DEFAULT_BATCH_SIZE, 500)]
    );
    for (const event of events.rows) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await projectDigitalTwinEvent(client, event);
        await client.query('COMMIT');
        projected += 1;
        lastEventAt = event.occurred_at;
      } catch (error) {
        failed += 1;
        try { await client.query('ROLLBACK'); } catch (_) { /* transaction did not begin */ }
        console.error(`Digital twin projection failed for event ${event.id}:`, error.message);
      } finally {
        client.release();
      }
    }
    await updateProjectorState('idle', { projectedCount: projected, failedCount: failed, lastEventAt });
    return { projected, failed, scanned: events.rows.length };
  } catch (error) {
    try { await updateProjectorState('error', { failedCount: 1, lastError: error.message }); } catch (_) { /* original wins */ }
    throw error;
  } finally {
    projectorRunning = false;
  }
}

function startDigitalTwinScheduler() {
  const intervalMs = Math.max(5000, Number(process.env.DIGITAL_TWIN_INTERVAL_MS) || 15000);
  const batchSize = Math.max(1, Number(process.env.DIGITAL_TWIN_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
  setTimeout(() => {
    processDigitalTwinBatch(batchSize).catch((error) => {
      console.error('Digital twin startup projection failed:', error.message);
    });
  }, 2000);
  const timer = setInterval(() => {
    processDigitalTwinBatch(batchSize).catch((error) => {
      console.error('Digital twin polling failed:', error.message);
    });
  }, intervalMs);
  timer.unref?.();
  console.log(`Nexa digital twin ready (${intervalMs}ms interval, batch ${batchSize}).`);
  return timer;
}

async function listTwinEntities(clientId, options = {}) {
  const queryable = options.queryable || db;
  await ensureDigitalTwinSchema(queryable);
  const entityType = cleanText(options.entityType, 80).toLowerCase() || null;
  const operationalStatus = cleanText(options.operationalStatus, 40).toLowerCase() || null;
  const healthStatus = cleanText(options.healthStatus, 40).toLowerCase() || null;
  const query = cleanText(options.query, 255) || null;
  const result = await queryable.query(
    `SELECT entity_type, entity_id, display_name, lifecycle_status,
            operational_status, health_status, state, attributes, source,
            source_event_id, observed_at, freshness_expires_at,
            (freshness_expires_at IS NOT NULL AND freshness_expires_at < NOW()) AS stale,
            confidence, version, first_seen_at, last_seen_at
     FROM billing_twin_entities
     WHERE client_id = $1
       AND ($2::text IS NULL OR entity_type = $2)
       AND ($3::text IS NULL OR operational_status = $3)
       AND ($4::text IS NULL OR health_status = $4)
       AND ($5::text IS NULL OR display_name ILIKE '%' || $5 || '%' OR entity_id ILIKE '%' || $5 || '%')
     ORDER BY last_seen_at DESC
     LIMIT $6`,
    [clientId, entityType, operationalStatus, healthStatus, query, normalizedLimit(options.limit)]
  );
  return result.rows;
}

async function getTwinEntity(clientId, entityType, entityId, options = {}) {
  const queryable = options.queryable || db;
  await ensureDigitalTwinSchema(queryable);
  const type = cleanText(entityType, 80).toLowerCase();
  const id = cleanText(entityId, 160);
  const entity = await queryable.query(
      `SELECT entity_type, entity_id, display_name, lifecycle_status,
              operational_status, health_status, state, attributes, source,
              source_event_id, observed_at, freshness_expires_at,
              (freshness_expires_at IS NOT NULL AND freshness_expires_at < NOW()) AS stale,
              confidence, version, first_seen_at, last_seen_at
       FROM billing_twin_entities
      WHERE client_id = $1 AND entity_type = $2 AND entity_id = $3`,
      [clientId, type, id]
    );
  const outgoing = await queryable.query(
      `SELECT relationship, to_entity_type AS entity_type, to_entity_id AS entity_id,
              active, attributes, observed_at, confidence
       FROM billing_twin_relationships
       WHERE client_id = $1 AND from_entity_type = $2 AND from_entity_id = $3 AND active = TRUE
      ORDER BY relationship, to_entity_type, to_entity_id`,
      [clientId, type, id]
    );
  const incoming = await queryable.query(
      `SELECT relationship, from_entity_type AS entity_type, from_entity_id AS entity_id,
              active, attributes, observed_at, confidence
       FROM billing_twin_relationships
       WHERE client_id = $1 AND to_entity_type = $2 AND to_entity_id = $3 AND active = TRUE
      ORDER BY relationship, from_entity_type, from_entity_id`,
      [clientId, type, id]
    );
  if (!entity.rows[0]) return null;
  return { ...entity.rows[0], relationships: { outgoing: outgoing.rows, incoming: incoming.rows } };
}

async function getTwinImpact(clientId, entityType, entityId, options = {}) {
  const queryable = options.queryable || db;
  await ensureDigitalTwinSchema(queryable);
  const maxDepth = Math.max(1, Math.min(Number(options.depth) || 4, 8));
  const type = cleanText(entityType, 80).toLowerCase();
  const id = cleanText(entityId, 160);
  const result = await queryable.query(
    `WITH RECURSIVE impact AS (
       SELECT $2::text AS entity_type, $3::text AS entity_id, 0 AS depth,
              ARRAY[$2::text || ':' || $3::text]::text[] AS path,
              NULL::text AS via_relationship
       UNION ALL
       SELECT
         CASE WHEN rel.from_entity_type = impact.entity_type AND rel.from_entity_id = impact.entity_id
              THEN rel.to_entity_type ELSE rel.from_entity_type END,
         CASE WHEN rel.from_entity_type = impact.entity_type AND rel.from_entity_id = impact.entity_id
              THEN rel.to_entity_id ELSE rel.from_entity_id END,
         impact.depth + 1,
         impact.path || (
           CASE WHEN rel.from_entity_type = impact.entity_type AND rel.from_entity_id = impact.entity_id
                THEN rel.to_entity_type || ':' || rel.to_entity_id
                ELSE rel.from_entity_type || ':' || rel.from_entity_id END
         ),
         rel.relationship
       FROM impact
       JOIN billing_twin_relationships rel
         ON rel.client_id = $1 AND rel.active = TRUE AND (
           (rel.from_entity_type = impact.entity_type AND rel.from_entity_id = impact.entity_id) OR
           (rel.to_entity_type = impact.entity_type AND rel.to_entity_id = impact.entity_id)
         )
       WHERE impact.depth < $4
         AND NOT (
           CASE WHEN rel.from_entity_type = impact.entity_type AND rel.from_entity_id = impact.entity_id
                THEN rel.to_entity_type || ':' || rel.to_entity_id
                ELSE rel.from_entity_type || ':' || rel.from_entity_id END
           = ANY(impact.path)
         )
     )
     SELECT DISTINCT ON (impact.entity_type, impact.entity_id)
       impact.entity_type, impact.entity_id, entity.display_name,
       entity.lifecycle_status, entity.operational_status, entity.health_status,
       entity.observed_at, entity.freshness_expires_at,
       (entity.freshness_expires_at IS NOT NULL AND entity.freshness_expires_at < NOW()) AS stale,
       entity.confidence, impact.depth, impact.via_relationship
     FROM impact
     LEFT JOIN billing_twin_entities entity
       ON entity.client_id = $1 AND entity.entity_type = impact.entity_type AND entity.entity_id = impact.entity_id
     ORDER BY impact.entity_type, impact.entity_id, impact.depth ASC`,
    [clientId, type, id, maxDepth]
  );
  const nodes = result.rows.sort((a, b) => Number(a.depth) - Number(b.depth));
  return {
    root: { entity_type: type, entity_id: id },
    depth: maxDepth,
    affected_count: Math.max(0, nodes.length - 1),
    counts_by_type: nodes.filter((node) => Number(node.depth) > 0).reduce((counts, node) => {
      counts[node.entity_type] = (counts[node.entity_type] || 0) + 1;
      return counts;
    }, {}),
    nodes,
  };
}

async function getTwinHealth(clientId, options = {}) {
  const queryable = options.queryable || db;
  await ensureDigitalTwinSchema(queryable);
  const result = await queryable.query(
    `SELECT
       (SELECT COUNT(*)::int FROM billing_twin_entities WHERE client_id = $1) AS entities,
       (SELECT COUNT(*)::int FROM billing_twin_relationships WHERE client_id = $1 AND active = TRUE) AS relationships,
       (SELECT COUNT(*)::int FROM billing_twin_entities
          WHERE client_id = $1 AND freshness_expires_at IS NOT NULL AND freshness_expires_at < NOW()) AS stale_entities,
       (SELECT COUNT(*)::int FROM billing_twin_entities
          WHERE client_id = $1 AND health_status IN ('degraded', 'critical')) AS unhealthy_entities,
       (SELECT COUNT(*)::int FROM billing_events event
          LEFT JOIN billing_twin_projection_events projection
            ON projection.event_id = event.id AND projection.client_id = event.client_id
          WHERE event.client_id = $1 AND projection.event_id IS NULL) AS pending_events,
       (SELECT MAX(projected_at) FROM billing_twin_projection_events WHERE client_id = $1) AS last_projected_at`,
    [clientId]
  );
  return result.rows[0];
}

function questionTokens(question) {
  return [...new Set(
    cleanText(question, 1000)
      .toLowerCase()
      .split(/[^a-z0-9_.:-]+/)
      .filter((token) => token.length >= 3)
      .slice(0, 20)
      .map((token) => `%${token}%`)
  )];
}

async function buildNexaTwinContext(clientId, question, options = {}) {
  const queryable = options.queryable || db;
  await ensureDigitalTwinSchema(queryable);
  const tokens = questionTokens(question);
  const limit = normalizedLimit(options.limit, 12, 25);
  const result = await queryable.query(
    `SELECT entity_type, entity_id, display_name, lifecycle_status,
            operational_status, health_status, state, source, observed_at,
            freshness_expires_at,
            (freshness_expires_at IS NOT NULL AND freshness_expires_at < NOW()) AS stale,
            confidence
     FROM billing_twin_entities
     WHERE client_id = $1 AND (
       cardinality($2::text[]) = 0
       OR entity_type ILIKE ANY($2::text[])
       OR entity_id ILIKE ANY($2::text[])
       OR COALESCE(display_name, '') ILIKE ANY($2::text[])
       OR lifecycle_status ILIKE ANY($2::text[])
       OR operational_status ILIKE ANY($2::text[])
       OR health_status ILIKE ANY($2::text[])
       OR state::text ILIKE ANY($2::text[])
     )
     ORDER BY
       CASE WHEN health_status = 'critical' THEN 0 WHEN health_status = 'degraded' THEN 1 ELSE 2 END,
       CASE WHEN operational_status IN ('offline', 'down', 'disconnected') THEN 0 ELSE 1 END,
       (freshness_expires_at IS NOT NULL AND freshness_expires_at < NOW()) ASC,
       last_seen_at DESC
     LIMIT $3`,
    [clientId, tokens, limit]
  );
  if (!result.rows.length) return { context: '', sources: [], entities: [] };

  const asksForImpact = /\b(affect|affected|impact|depend|dependency|outage|offline|down|connected)\b/i.test(question);
  let impact = null;
  if (asksForImpact) {
    const root = result.rows[0];
    impact = await getTwinImpact(clientId, root.entity_type, root.entity_id, {
      queryable,
      depth: Math.max(1, Math.min(Number(options.depth) || 3, 5)),
    });
  }

  const lines = result.rows.map((entity) => {
    const state = compactObject(entity.state || {});
    return [
      `[twin:${entity.entity_type}:${entity.entity_id}]`,
      entity.display_name || entity.entity_id,
      `lifecycle=${entity.lifecycle_status}`,
      `operational=${entity.operational_status}`,
      `health=${entity.health_status}`,
      `observed=${new Date(entity.observed_at).toISOString()}`,
      `stale=${entity.stale}`,
      `confidence=${entity.confidence}`,
      `state=${JSON.stringify(state)}`,
    ].join(' | ');
  });
  if (impact) {
    lines.push(
      `[impact:${impact.root.entity_type}:${impact.root.entity_id}] affected=${impact.affected_count}`
      + ` counts=${JSON.stringify(impact.counts_by_type)}`
    );
  }
  return {
    context: lines.join('\n'),
    entities: result.rows,
    impact,
    sources: result.rows.map((entity) => ({
      source_type: 'digital_twin',
      entity_type: entity.entity_type,
      entity_id: entity.entity_id,
      observed_at: entity.observed_at,
      stale: entity.stale,
      confidence: entity.confidence,
    })),
  };
}

module.exports = {
  DIGITAL_TWIN_SCHEMA_SQL,
  PROJECTOR_VERSION,
  buildNexaTwinContext,
  deriveTwinStatuses,
  ensureDigitalTwinSchema,
  freshnessSecondsForEvent,
  getTwinEntity,
  getTwinHealth,
  getTwinImpact,
  listTwinEntities,
  mergedEventState,
  observeTwinEntity,
  observeTwinEntities,
  observeTwinRelationship,
  processDigitalTwinBatch,
  projectDigitalTwinEvent,
  startDigitalTwinScheduler,
};
