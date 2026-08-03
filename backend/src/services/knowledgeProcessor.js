const os = require('os');
const db = require('../db');
const { ensureEventSchema } = require('./events');

const KNOWLEDGE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS billing_knowledge_entities (
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    entity_type VARCHAR(80) NOT NULL,
    entity_id VARCHAR(160) NOT NULL,
    display_name VARCHAR(255),
    summary TEXT,
    current_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    latest_event_id UUID,
    latest_event_type VARCHAR(120),
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, entity_type, entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_billing_knowledge_entities_tenant_recent
    ON billing_knowledge_entities(client_id, last_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_knowledge_entities_tenant_type
    ON billing_knowledge_entities(client_id, entity_type, last_seen_at DESC);

  CREATE TABLE IF NOT EXISTS billing_knowledge_facts (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL,
    client_id INTEGER NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    event_category VARCHAR(60) NOT NULL,
    entity_type VARCHAR(80),
    entity_id VARCHAR(160),
    severity VARCHAR(20) NOT NULL,
    sensitivity VARCHAR(20) NOT NULL,
    fact_text TEXT NOT NULL,
    fact_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    search_vector TSVECTOR GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(fact_text, ''))
    ) STORED,
    UNIQUE (event_id),
    FOREIGN KEY (event_id, client_id)
      REFERENCES billing_events(id, client_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_billing_knowledge_facts_search
    ON billing_knowledge_facts USING GIN(search_vector);
  CREATE INDEX IF NOT EXISTS idx_billing_knowledge_facts_tenant_recent
    ON billing_knowledge_facts(client_id, occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_knowledge_facts_tenant_category
    ON billing_knowledge_facts(client_id, event_category, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_knowledge_facts_tenant_entity
    ON billing_knowledge_facts(client_id, entity_type, entity_id, occurred_at DESC);

  CREATE TABLE IF NOT EXISTS billing_knowledge_relationships (
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    from_entity_type VARCHAR(80) NOT NULL,
    from_entity_id VARCHAR(160) NOT NULL,
    relationship VARCHAR(60) NOT NULL,
    to_entity_type VARCHAR(80) NOT NULL,
    to_entity_id VARCHAR(160) NOT NULL,
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count > 0),
    latest_event_id UUID NOT NULL,
    PRIMARY KEY (
      client_id, from_entity_type, from_entity_id,
      relationship, to_entity_type, to_entity_id
    )
  );

  CREATE INDEX IF NOT EXISTS idx_billing_knowledge_relationships_target
    ON billing_knowledge_relationships(client_id, to_entity_type, to_entity_id);

  CREATE TABLE IF NOT EXISTS billing_knowledge_daily_summaries (
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    summary_date DATE NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
    warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
    critical_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
    category_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    event_type_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_event_at TIMESTAMP WITH TIME ZONE,
    last_event_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, summary_date)
  );

  CREATE TABLE IF NOT EXISTS billing_knowledge_processor_state (
    worker_id VARCHAR(160) PRIMARY KEY,
    status VARCHAR(20) NOT NULL
      CHECK (status IN ('idle', 'running', 'stopped', 'error')),
    last_started_at TIMESTAMP WITH TIME ZONE,
    last_completed_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    processed_count BIGINT NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
    failed_count BIGINT NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
`;

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const DEFAULT_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;
let schemaReady = false;
let schemaPromise;
let processorRunning = false;

function cleanText(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function compactObject(value, depth = 0) {
  if (depth > 4) return '[nested data]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => compactObject(item, depth + 1));
  if (!isPlainObject(value)) {
    if (typeof value === 'string') return cleanText(value, 1000);
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 80)
      .map(([key, item]) => [key, compactObject(item, depth + 1)])
  );
}

function meaningfulState(event) {
  const nextState = isPlainObject(event.new_state) ? event.new_state : {};
  if (Object.keys(nextState).length) return compactObject(nextState);
  const payload = isPlainObject(event.payload) ? event.payload : {};
  return compactObject(payload);
}

function displayNameForEvent(event) {
  const candidates = [
    event.new_state?.full_name,
    event.new_state?.name,
    event.payload?.full_name,
    event.payload?.subscriber_name,
    event.payload?.employee_name,
    event.payload?.router_name,
    event.payload?.package_name,
    event.payload?.invoice_number,
    event.payload?.display_name,
    event.title,
  ];
  return cleanText(candidates.find((value) => cleanText(value)) || event.entity_id || '', 255) || null;
}

function flattenFactValues(value, prefix = '', depth = 0, output = []) {
  if (depth > 2 || output.length >= 18) return output;
  if (Array.isArray(value)) {
    value.slice(0, 6).forEach((item, index) => flattenFactValues(item, `${prefix}${index + 1}`, depth + 1, output));
    return output;
  }
  if (isPlainObject(value)) {
    Object.entries(value).slice(0, 24).forEach(([key, item]) => {
      const label = cleanText(key.replace(/_/g, ' '), 80);
      flattenFactValues(item, prefix ? `${prefix} ${label}` : label, depth + 1, output);
    });
    return output;
  }
  if (value === null || value === undefined || value === '' || typeof value === 'object') return output;
  const rendered = cleanText(value, 180);
  if (rendered) output.push(`${prefix}: ${rendered}`);
  return output;
}

function buildFactText(event) {
  const heading = cleanText(event.title || event.event_type.replace(/[._-]+/g, ' '), 255);
  const parts = [heading];
  const description = cleanText(event.description, 1200);
  if (description && description.toLowerCase() !== heading.toLowerCase()) parts.push(description);
  if (event.entity_type && event.entity_id) {
    parts.push(`${cleanText(event.entity_type, 80)} ${cleanText(event.entity_id, 160)}`);
  }
  const stateFacts = flattenFactValues(meaningfulState(event));
  if (stateFacts.length) parts.push(stateFacts.join('; '));
  return cleanText(parts.filter(Boolean).join('. '), 4000);
}

function factDataForEvent(event) {
  return compactObject({
    source: event.source,
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    actor_name: event.actor_name,
    correlation_id: event.correlation_id,
    payload: event.payload || {},
    previous_state: event.previous_state || {},
    new_state: event.new_state || {},
    metadata: event.metadata || {},
  });
}

async function ensureKnowledgeSchema(queryable = db) {
  await ensureEventSchema(queryable);
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = queryable.query(KNOWLEDGE_SCHEMA_SQL)
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

async function claimKnowledgeOutboxBatch(limit = DEFAULT_BATCH_SIZE) {
  await ensureKnowledgeSchema();
  const batchSize = Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH_SIZE, 100));
  const result = await db.query(
    `WITH candidates AS (
       SELECT id
       FROM billing_event_outbox
       WHERE (
         status IN ('pending', 'failed') AND available_at <= NOW()
       ) OR (
         status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes'
       )
       ORDER BY available_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE billing_event_outbox AS outbox
     SET status = 'processing',
         attempts = outbox.attempts + 1,
         locked_at = NOW(),
         locked_by = $2,
         last_error = NULL,
         updated_at = NOW()
     FROM candidates
     WHERE outbox.id = candidates.id
     RETURNING outbox.*`,
    [batchSize, WORKER_ID]
  );
  return result.rows;
}

async function upsertEntityProjection(client, event, factText) {
  if (!event.entity_type || !event.entity_id) return;
  await client.query(
    `INSERT INTO billing_knowledge_entities (
       client_id, entity_type, entity_id, display_name, summary, current_state,
       latest_event_id, latest_event_type, first_seen_at, last_seen_at, event_count
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$9,1)
     ON CONFLICT (client_id, entity_type, entity_id)
     DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, billing_knowledge_entities.display_name),
       summary = EXCLUDED.summary,
       current_state = billing_knowledge_entities.current_state || EXCLUDED.current_state,
       latest_event_id = EXCLUDED.latest_event_id,
       latest_event_type = EXCLUDED.latest_event_type,
       first_seen_at = LEAST(billing_knowledge_entities.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at = GREATEST(billing_knowledge_entities.last_seen_at, EXCLUDED.last_seen_at),
       event_count = billing_knowledge_entities.event_count + 1,
       updated_at = NOW()`,
    [
      event.client_id,
      event.entity_type,
      event.entity_id,
      displayNameForEvent(event),
      factText,
      JSON.stringify(meaningfulState(event)),
      event.id,
      event.event_type,
      event.occurred_at,
    ]
  );
}

async function upsertRelationships(client, event) {
  if (!event.entity_type || !event.entity_id) return;
  const related = await client.query(
    `SELECT entity_type, entity_id, relationship
     FROM billing_event_entities
     WHERE event_id = $1 AND client_id = $2 AND relationship <> 'primary'`,
    [event.id, event.client_id]
  );
  for (const entity of related.rows) {
    await client.query(
      `INSERT INTO billing_knowledge_relationships (
         client_id, from_entity_type, from_entity_id, relationship,
         to_entity_type, to_entity_id, first_seen_at, last_seen_at,
         event_count, latest_event_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,1,$8)
       ON CONFLICT (
         client_id, from_entity_type, from_entity_id,
         relationship, to_entity_type, to_entity_id
       )
       DO UPDATE SET
         first_seen_at = LEAST(billing_knowledge_relationships.first_seen_at, EXCLUDED.first_seen_at),
         last_seen_at = GREATEST(billing_knowledge_relationships.last_seen_at, EXCLUDED.last_seen_at),
         event_count = billing_knowledge_relationships.event_count + 1,
         latest_event_id = EXCLUDED.latest_event_id`,
      [
        event.client_id,
        event.entity_type,
        event.entity_id,
        entity.relationship,
        entity.entity_type,
        entity.entity_id,
        event.occurred_at,
        event.id,
      ]
    );
  }
}

async function incrementDailySummary(client, event) {
  await client.query(
    `INSERT INTO billing_knowledge_daily_summaries (
       client_id, summary_date, event_count, warning_count, critical_count,
       category_counts, event_type_counts, first_event_at, last_event_at
     ) VALUES (
       $1, ($2::timestamptz AT TIME ZONE 'Africa/Nairobi')::date, 1,
       CASE WHEN $3 = 'warning' THEN 1 ELSE 0 END,
       CASE WHEN $3 = 'critical' THEN 1 ELSE 0 END,
       jsonb_build_object($4::text, 1),
       jsonb_build_object($5::text, 1),
       $2, $2
     )
     ON CONFLICT (client_id, summary_date)
     DO UPDATE SET
       event_count = billing_knowledge_daily_summaries.event_count + 1,
       warning_count = billing_knowledge_daily_summaries.warning_count
         + CASE WHEN $3 = 'warning' THEN 1 ELSE 0 END,
       critical_count = billing_knowledge_daily_summaries.critical_count
         + CASE WHEN $3 = 'critical' THEN 1 ELSE 0 END,
       category_counts = jsonb_set(
         billing_knowledge_daily_summaries.category_counts,
         ARRAY[$4::text],
         to_jsonb(COALESCE((billing_knowledge_daily_summaries.category_counts ->> $4::text)::int, 0) + 1),
         true
       ),
       event_type_counts = jsonb_set(
         billing_knowledge_daily_summaries.event_type_counts,
         ARRAY[$5::text],
         to_jsonb(COALESCE((billing_knowledge_daily_summaries.event_type_counts ->> $5::text)::int, 0) + 1),
         true
       ),
       first_event_at = LEAST(billing_knowledge_daily_summaries.first_event_at, EXCLUDED.first_event_at),
       last_event_at = GREATEST(billing_knowledge_daily_summaries.last_event_at, EXCLUDED.last_event_at),
       updated_at = NOW()`,
    [event.client_id, event.occurred_at, event.severity, event.event_category, event.event_type]
  );
}

async function projectKnowledgeEvent(client, event, item) {
  const factText = buildFactText(event);
  const insertedFact = await client.query(
      `INSERT INTO billing_knowledge_facts (
         event_id, client_id, event_type, event_category, entity_type, entity_id,
         severity, sensitivity, fact_text, fact_data, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [
        event.id,
        event.client_id,
        event.event_type,
        event.event_category,
        event.entity_type,
        event.entity_id,
        event.severity,
        event.sensitivity,
        factText,
        JSON.stringify(factDataForEvent(event)),
        event.occurred_at,
    ]
  );

  if (insertedFact.rows[0]) {
    await upsertEntityProjection(client, event, factText);
    await upsertRelationships(client, event);
    await incrementDailySummary(client, event);
  }

  await client.query(
    `UPDATE billing_events
       SET ai_status = 'processed',
           ai_attempts = GREATEST(ai_attempts, $3),
           ai_last_error = NULL,
           ai_processed_at = NOW()
       WHERE id = $1 AND client_id = $2`,
    [event.id, event.client_id, item.attempts]
  );
  await client.query(
    `UPDATE billing_event_outbox
       SET status = 'published',
           published_at = COALESCE(published_at, NOW()),
           locked_at = NULL,
           locked_by = NULL,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1 AND client_id = $2`,
    [item.id, item.client_id]
  );
  return { eventId: event.id, duplicate: !insertedFact.rows[0] };
}

async function processKnowledgeOutboxItem(item) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query(
      `SELECT *
       FROM billing_events
       WHERE id = $1 AND client_id = $2
       FOR UPDATE`,
      [item.event_id, item.client_id]
    );
    const event = eventResult.rows[0];
    if (!event) throw new Error('Outbox event no longer exists for this tenant');

    const result = await projectKnowledgeEvent(client, event, item);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction did not start */ }
    throw error;
  } finally {
    client.release();
  }
}

async function markKnowledgeOutboxFailure(item, error) {
  const attempts = Number(item.attempts) || 1;
  const deadLetter = attempts >= MAX_ATTEMPTS;
  const delaySeconds = Math.min(15 * (2 ** Math.max(0, attempts - 1)), 3600);
  const message = cleanText(error?.message || error || 'Unknown knowledge processing error', 2000);
  await db.query(
    `UPDATE billing_event_outbox
     SET status = $3,
         available_at = CASE
           WHEN $3 = 'dead_letter' THEN available_at
           ELSE NOW() + ($4::text || ' seconds')::interval
         END,
         locked_at = NULL,
         locked_by = NULL,
         last_error = $5,
         updated_at = NOW()
     WHERE id = $1 AND client_id = $2`,
    [item.id, item.client_id, deadLetter ? 'dead_letter' : 'failed', delaySeconds, message]
  );
  await db.query(
    `UPDATE billing_events
     SET ai_status = 'failed',
         ai_attempts = GREATEST(ai_attempts, $3),
         ai_last_error = $4
     WHERE id = $1 AND client_id = $2`,
    [item.event_id, item.client_id, attempts, message]
  );
}

async function updateWorkerState(status, values = {}, queryable = db) {
  await queryable.query(
    `INSERT INTO billing_knowledge_processor_state (
       worker_id, status, last_started_at, last_completed_at,
       last_error, processed_count, failed_count
     ) VALUES (
       $1, $2::text,
       CASE WHEN $2::text = 'running' THEN NOW() ELSE NULL END,
       CASE WHEN $2::text = 'idle' THEN NOW() ELSE NULL END,
       $3, $4, $5
     )
     ON CONFLICT (worker_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       last_started_at = CASE
         WHEN EXCLUDED.status = 'running' THEN NOW()
         ELSE billing_knowledge_processor_state.last_started_at
       END,
       last_completed_at = CASE
         WHEN EXCLUDED.status = 'idle' THEN NOW()
         ELSE billing_knowledge_processor_state.last_completed_at
       END,
       last_error = EXCLUDED.last_error,
       processed_count = billing_knowledge_processor_state.processed_count + EXCLUDED.processed_count,
       failed_count = billing_knowledge_processor_state.failed_count + EXCLUDED.failed_count,
       updated_at = NOW()`,
    [
      WORKER_ID,
      status,
      values.lastError || null,
      Number(values.processedCount) || 0,
      Number(values.failedCount) || 0,
    ]
  );
}

async function processKnowledgeOutbox(limit = DEFAULT_BATCH_SIZE) {
  if (processorRunning) return { skipped: true, processed: 0, failed: 0 };
  processorRunning = true;
  let processed = 0;
  let failed = 0;
  try {
    await ensureKnowledgeSchema();
    await updateWorkerState('running');
    const items = await claimKnowledgeOutboxBatch(limit);
    for (const item of items) {
      try {
        await processKnowledgeOutboxItem(item);
        processed += 1;
      } catch (error) {
        failed += 1;
        await markKnowledgeOutboxFailure(item, error);
        console.error(`Knowledge processor failed for outbox ${item.id}:`, error.message);
      }
    }
    await updateWorkerState('idle', { processedCount: processed, failedCount: failed });
    return { processed, failed, claimed: items.length };
  } catch (error) {
    try {
      await updateWorkerState('error', { lastError: cleanText(error.message, 2000), failedCount: 1 });
    } catch (_) { /* preserve the original processor error */ }
    throw error;
  } finally {
    processorRunning = false;
  }
}

function startKnowledgeProcessorScheduler() {
  const intervalMs = Math.max(2000, Number(process.env.KNOWLEDGE_PROCESSOR_INTERVAL_MS) || 5000);
  const batchSize = Math.max(1, Number(process.env.KNOWLEDGE_PROCESSOR_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
  setTimeout(() => {
    processKnowledgeOutbox(batchSize).catch((error) => {
      console.error('Knowledge processor startup run failed:', error.message);
    });
  }, 1500);
  const timer = setInterval(() => {
    processKnowledgeOutbox(batchSize).catch((error) => {
      console.error('Knowledge processor polling failed:', error.message);
    });
  }, intervalMs);
  timer.unref?.();
  console.log(`Nexa knowledge processor ready (${intervalMs}ms interval, batch ${batchSize}).`);
  return timer;
}

function normalizedLimit(value, fallback = 20, maximum = 100) {
  return Math.max(1, Math.min(Number(value) || fallback, maximum));
}

async function searchKnowledge(clientId, query, options = {}) {
  const queryable = options.queryable || db;
  await ensureKnowledgeSchema(queryable);
  const q = cleanText(query, 500) || null;
  const category = cleanText(options.category, 60).toLowerCase() || null;
  const entityType = cleanText(options.entityType, 80).toLowerCase() || null;
  const from = options.from ? new Date(options.from) : null;
  const to = options.to ? new Date(options.to) : null;
  const limit = normalizedLimit(options.limit);
  const result = await queryable.query(
    `SELECT
       id, event_id, event_type, event_category, entity_type, entity_id,
       severity, sensitivity, fact_text, occurred_at,
       CASE WHEN $2::text IS NULL THEN 0
            ELSE ts_rank(search_vector, websearch_to_tsquery('simple', $2)) END AS rank
     FROM billing_knowledge_facts
     WHERE client_id = $1
       AND ($2::text IS NULL OR search_vector @@ websearch_to_tsquery('simple', $2))
       AND ($3::text IS NULL OR event_category = $3)
       AND ($4::text IS NULL OR entity_type = $4)
       AND ($5::timestamptz IS NULL OR occurred_at >= $5)
       AND ($6::timestamptz IS NULL OR occurred_at <= $6)
     ORDER BY rank DESC, occurred_at DESC, id DESC
     LIMIT $7`,
    [
      clientId,
      q,
      category,
      entityType,
      from && !Number.isNaN(from.getTime()) ? from.toISOString() : null,
      to && !Number.isNaN(to.getTime()) ? to.toISOString() : null,
      limit,
    ]
  );
  return result.rows;
}

async function listKnowledgeEntities(clientId, options = {}) {
  const queryable = options.queryable || db;
  await ensureKnowledgeSchema(queryable);
  const entityType = cleanText(options.entityType, 80).toLowerCase() || null;
  const query = cleanText(options.query, 255) || null;
  const result = await queryable.query(
    `SELECT
       client_id, entity_type, entity_id, display_name, summary, current_state,
       latest_event_id, latest_event_type, first_seen_at, last_seen_at, event_count
     FROM billing_knowledge_entities
     WHERE client_id = $1
       AND ($2::text IS NULL OR entity_type = $2)
       AND (
         $3::text IS NULL
         OR display_name ILIKE '%' || $3 || '%'
         OR entity_id ILIKE '%' || $3 || '%'
         OR summary ILIKE '%' || $3 || '%'
       )
     ORDER BY last_seen_at DESC
     LIMIT $4`,
    [clientId, entityType, query, normalizedLimit(options.limit)]
  );
  return result.rows;
}

async function getKnowledgeEntity(clientId, entityType, entityId, limit = 30) {
  await ensureKnowledgeSchema();
  const [entity, timeline, outgoing, incoming] = await Promise.all([
    db.query(
      `SELECT * FROM billing_knowledge_entities
       WHERE client_id = $1 AND entity_type = $2 AND entity_id = $3`,
      [clientId, cleanText(entityType, 80).toLowerCase(), cleanText(entityId, 160)]
    ),
    db.query(
      `SELECT event_id, event_type, event_category, severity, sensitivity, fact_text, occurred_at
       FROM billing_knowledge_facts
       WHERE client_id = $1 AND entity_type = $2 AND entity_id = $3
       ORDER BY occurred_at DESC, id DESC
       LIMIT $4`,
      [clientId, cleanText(entityType, 80).toLowerCase(), cleanText(entityId, 160), normalizedLimit(limit, 30)]
    ),
    db.query(
      `SELECT relationship, to_entity_type AS entity_type, to_entity_id AS entity_id,
              first_seen_at, last_seen_at, event_count
       FROM billing_knowledge_relationships
       WHERE client_id = $1 AND from_entity_type = $2 AND from_entity_id = $3
       ORDER BY last_seen_at DESC`,
      [clientId, cleanText(entityType, 80).toLowerCase(), cleanText(entityId, 160)]
    ),
    db.query(
      `SELECT relationship, from_entity_type AS entity_type, from_entity_id AS entity_id,
              first_seen_at, last_seen_at, event_count
       FROM billing_knowledge_relationships
       WHERE client_id = $1 AND to_entity_type = $2 AND to_entity_id = $3
       ORDER BY last_seen_at DESC`,
      [clientId, cleanText(entityType, 80).toLowerCase(), cleanText(entityId, 160)]
    ),
  ]);
  if (!entity.rows[0]) return null;
  return {
    ...entity.rows[0],
    timeline: timeline.rows,
    relationships: {
      outgoing: outgoing.rows,
      incoming: incoming.rows,
    },
  };
}

async function getKnowledgeSummary(clientId, options = {}) {
  await ensureKnowledgeSchema();
  const from = options.from ? new Date(options.from) : new Date(Date.now() - 30 * 86400000);
  const to = options.to ? new Date(options.to) : new Date();
  const safeFrom = Number.isNaN(from.getTime()) ? new Date(Date.now() - 30 * 86400000) : from;
  const safeTo = Number.isNaN(to.getTime()) ? new Date() : to;
  const [totals, categories, daily, critical, entities] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*)::int AS event_count,
         COUNT(*) FILTER (WHERE severity = 'warning')::int AS warning_count,
         COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical_count,
         COUNT(DISTINCT NULLIF(concat(entity_type, ':', entity_id), ':'))::int AS affected_entities
       FROM billing_knowledge_facts
       WHERE client_id = $1 AND occurred_at >= $2 AND occurred_at <= $3`,
      [clientId, safeFrom.toISOString(), safeTo.toISOString()]
    ),
    db.query(
      `SELECT event_category AS category, COUNT(*)::int AS count
       FROM billing_knowledge_facts
       WHERE client_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY event_category ORDER BY count DESC`,
      [clientId, safeFrom.toISOString(), safeTo.toISOString()]
    ),
    db.query(
      `SELECT summary_date, event_count, warning_count, critical_count, category_counts
       FROM billing_knowledge_daily_summaries
       WHERE client_id = $1 AND summary_date BETWEEN $2::date AND $3::date
       ORDER BY summary_date`,
      [clientId, safeFrom.toISOString(), safeTo.toISOString()]
    ),
    db.query(
      `SELECT event_id, event_type, entity_type, entity_id, fact_text, occurred_at
       FROM billing_knowledge_facts
       WHERE client_id = $1 AND severity IN ('warning', 'critical')
         AND occurred_at >= $2 AND occurred_at <= $3
       ORDER BY occurred_at DESC LIMIT 10`,
      [clientId, safeFrom.toISOString(), safeTo.toISOString()]
    ),
    db.query(
      `SELECT entity_type, entity_id, display_name, summary, last_seen_at, event_count
       FROM billing_knowledge_entities
       WHERE client_id = $1
       ORDER BY event_count DESC, last_seen_at DESC LIMIT 10`,
      [clientId]
    ),
  ]);
  return {
    range: { from: safeFrom.toISOString(), to: safeTo.toISOString() },
    totals: totals.rows[0],
    categories: categories.rows,
    daily: daily.rows,
    recent_attention: critical.rows,
    most_active_entities: entities.rows,
  };
}

async function getKnowledgeHealth(clientId) {
  await ensureKnowledgeSchema();
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter,
       COUNT(*) FILTER (WHERE status = 'published')::int AS published,
       MAX(published_at) AS last_processed_at
     FROM billing_event_outbox
     WHERE client_id = $1`,
    [clientId]
  );
  const counts = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM billing_knowledge_facts WHERE client_id = $1) AS facts,
       (SELECT COUNT(*)::int FROM billing_knowledge_entities WHERE client_id = $1) AS entities,
       (SELECT COUNT(*)::int FROM billing_knowledge_relationships WHERE client_id = $1) AS relationships`,
    [clientId]
  );
  return { ...result.rows[0], ...counts.rows[0] };
}

async function buildNexaKnowledgeContext(clientId, question, options = {}) {
  const facts = await searchKnowledge(clientId, question, {
    ...options,
    limit: normalizedLimit(options.limit, 12, 30),
  });
  if (!facts.length) return { context: '', sources: [] };
  const context = facts.map((fact) => (
    `[event:${fact.event_id} | ${new Date(fact.occurred_at).toISOString()} | ${fact.event_type}] ${fact.fact_text}`
  )).join('\n');
  return {
    context,
    sources: facts.map((fact) => ({
      event_id: fact.event_id,
      event_type: fact.event_type,
      entity_type: fact.entity_type,
      entity_id: fact.entity_id,
      occurred_at: fact.occurred_at,
    })),
  };
}

module.exports = {
  KNOWLEDGE_SCHEMA_SQL,
  WORKER_ID,
  buildFactText,
  buildNexaKnowledgeContext,
  claimKnowledgeOutboxBatch,
  ensureKnowledgeSchema,
  factDataForEvent,
  getKnowledgeEntity,
  getKnowledgeHealth,
  getKnowledgeSummary,
  listKnowledgeEntities,
  markKnowledgeOutboxFailure,
  meaningfulState,
  processKnowledgeOutbox,
  processKnowledgeOutboxItem,
  projectKnowledgeEvent,
  searchKnowledge,
  startKnowledgeProcessorScheduler,
  updateWorkerState,
};
