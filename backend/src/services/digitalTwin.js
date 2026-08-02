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
         to_entity_type, to_entity_id, active, attributes, souã®µ¶‰ËkºwµçQ•Ìñğíô¤¤°Í…™•=‰Í•ÉÙ•‘Ğ¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸¡9Õµ‰•È¡¥¹ÁÕĞ¹½¹™¥‘•¹”¤ñğ€Ä°€Ä¤¤°(€€€t(€€¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÕÁ‘…Ñ•AÉ½©•Ñ½ÉMÑ…Ñ”¡ÍÑ…ÑÕÌ°Ù…±Õ•Ì€ôíô°ÅÕ•Éå…‰±”€ô‘ˆ¤ì(€…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€%9MIP%9Q<‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ½É}ÍÑ…Ñ”€ (€€€€€€İ½É­•É}¥°ÍÑ…ÑÕÌ°±…ÍÑ}ÍÑ…ÉÑ•‘}…Ğ°±…ÍÑ}½µÁ±•Ñ•‘}…Ğ°±…ÍÑ}•Ù•¹Ñ}…Ğ°(€€€€€€ÁÉ½©•Ñ•‘}½Õ¹Ğ°™…¥±•‘}½Õ¹Ğ°±…ÍÑ}•ÉÉ½È(€€€€€¤Y1UL€ (€€€€€€€Ä°ÈèéÑ•áĞ°(€€€€€€M]!8€ÈèéÑ•áĞ€ô€ÉÕ¹¹¥¹œœQ!89=\ ¤1M9U109°(€€€€€€M]!8€ÈèéÑ•áĞ€ô€¥‘±”œQ!89=\ ¤1M9U109°(€€€€€€€Ì°Ğ°Ô°Ø(€€€€€¤(€€€€=8=91%P€¡İ½É­•É}¥¤<UAQMP(€€€€€€ÍÑ…ÑÕÌ€ôa1U¹ÍÑ…ÑÕÌ°(€€€€€€±…ÍÑ}ÍÑ…ÉÑ•‘}…Ğ€ôM]!8a1U¹ÍÑ…ÑÕÌ€ô€ÉÕ¹¹¥¹œœQ!89=\ ¤(€€€€€€€€1M‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ½É}ÍÑ…Ñ”¹±…ÍÑ}ÍÑ…ÉÑ•‘}…Ğ9°(€€€€€€±…ÍÑ}½µÁ±•Ñ•‘}…Ğ€ôM]!8a1U¹ÍÑ…ÑÕÌ€ô€¥‘±”œQ!89=\ ¤(€€€€€€€€1M‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ½É}ÍÑ…Ñ”¹±…ÍÑ}½µÁ±•Ñ•‘}…Ğ9°(€€€€€€±…ÍÑ}•Ù•¹Ñ}…Ğ€ôIQMP¡‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ½É}ÍÑ…Ñ”¹±…ÍÑ}•Ù•¹Ñ}…Ğ°a1U¹±…ÍÑ}•Ù•¹Ñ}…Ğ¤°(€€€€€€ÁÉ½©•Ñ•‘}½Õ¹Ğ€ô‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ½É}ÍÑ…Ñ”¹ÁÉ½©•Ñ•‘}½Õ¹Ğ€¬a1U¹ÁÉ½©•Ñ•‘}½Õ¹Ğ°(€€€€€€™…¥±•‘}½Õ¹Ğ€ô‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ½É}ÍÑ…Ñ”¹™…¥±•‘}½Õ¹Ğ€¬a1U¹™…¥±•‘}½Õ¹Ğ°(€€€€€€±…ÍÑ}•ÉÉ½È€ôa1U¹±…ÍÑ}•ÉÉ½È°(€€€€€€ÕÁ‘…Ñ•‘}…Ğ€ô9=\ ¥€°(€€€l(€€€€€]=I-I}%°ÍÑ…ÑÕÌ°Ù…±Õ•Ì¹±…ÍÑÙ•¹ÑĞñğ¹Õ±°°(€€€€€9Õµ‰•È¡Ù…±Õ•Ì¹ÁÉ½©•Ñ•‘½Õ¹Ğ¤ñğ€À°9Õµ‰•È¡Ù…±Õ•Ì¹™…¥±•‘½Õ¹Ğ¤ñğ€À°(€€€€€±•…¹Q•áĞ¡Ù…±Õ•Ì¹±…ÍÑÉÉ½È°€ÈÀÀÀ¤ñğ¹Õ±°°(€€€t(€€¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÁÉ½•ÍÍ¥¥Ñ…±Qİ¥¹	…Ñ ¡±¥µ¥Ğ€ôU1Q}	Q!}M%i¤ì(€¥˜€¡ÁÉ½©•Ñ½ÉIÕ¹¹¥¹œ¤É•ÑÕÉ¸ìÍ­¥ÁÁ•èÑÉÕ”°ÁÉ½©•Ñ•è€À°™…¥±•è€Àôì(€ÁÉ½©•Ñ½ÉIÕ¹¹¥¹œ€ôÑÉÕ”ì(€±•ĞÁÉ½©•Ñ•€ô€Àì(€±•Ğ™…¥±•€ô€Àì(€±•Ğ±…ÍÑÙ•¹ÑĞ€ô¹Õ±°ì(€ÑÉäì(€€€…İ…¥Ğ•¹ÍÕÉ•¥¥Ñ…±Qİ¥¹M¡•µ„ ¤ì(€€€…İ…¥ĞÕÁ‘…Ñ•AÉ½©•Ñ½ÉMÑ…Ñ” ÉÕ¹¹¥¹œœ¤ì(€€€½¹ÍĞ•Ù•¹ÑÌ€ô…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€€M1P•Ù•¹Ğ¸¨(€€€€€€I=4‰¥±±¥¹}•Ù•¹ÑÌ•Ù•¹Ğ(€€€€€€1P)=%8‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ¥½¹}•Ù•¹ÑÌÁÉ½©•Ñ¥½¸(€€€€€€€€=8ÁÉ½©•Ñ¥½¸¹•Ù•¹Ñ}¥€ô•Ù•¹Ğ¹¥9ÁÉ½©•Ñ¥½¸¹±¥•¹Ñ}¥€ô•Ù•¹Ğ¹±¥•¹Ñ}¥(€€€€€€]!IÁÉ½©•Ñ¥½¸¹•Ù•¹Ñ}¥%L9U10(€€€€€€=IH	d•Ù•¹Ğ¹½ÕÉÉ•‘}…ĞM°•Ù•¹Ğ¹É•½É‘•‘}…ĞM°•Ù•¹Ğ¹¥M(€€€€€€1%5%P€Å€°(€€€€€m¹½Éµ…±¥é•‘1¥µ¥Ğ¡±¥µ¥Ğ°U1Q}	Q!}M%i°€ÔÀÀ¥t(€€€€¤ì(€€€™½È€¡½¹ÍĞ•Ù•¹Ğ½˜•Ù•¹ÑÌ¹É½İÌ¤ì(€€€€€½¹ÍĞ±¥•¹Ğ€ô…İ…¥Ğ‘ˆ¹½¹¹•Ğ ¤ì(€€€€€ÑÉäì(€€€€€€€…İ…¥Ğ±¥•¹Ğ¹ÅÕ•Éä 	%8œ¤ì(€€€€€€€…İ…¥ĞÁÉ½©•Ñ¥¥Ñ…±Qİ¥¹Ù•¹Ğ¡±¥•¹Ğ°•Ù•¹Ğ¤ì(€€€€€€€…İ…¥Ğ±¥•¹Ğ¹ÅÕ•Éä =55%Pœ¤ì(€€€€€€€ÁÉ½©•Ñ•€¬ô€Äì(€€€€€€€±…ÍÑÙ•¹ÑĞ€ô•Ù•¹Ğ¹½ÕÉÉ•‘}…Ğì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€™…¥±•€¬ô€Äì(€€€€€€€ÑÉäì…İ…¥Ğ±¥•¹Ğ¹ÅÕ•Éä I=11	,œ¤ìô…Ñ €¡|¤ì€¼¨ÑÉ…¹Í…Ñ¥½¸‘¥¹½Ğ‰•¥¸€¨¼ô(€€€€€€€½¹Í½±”¹•ÉÉ½È¡¥¥Ñ…°Ñİ¥¸ÁÉ½©•Ñ¥½¸™…¥±•™½È•Ù•¹Ğ€‘í•Ù•¹Ğ¹¥‘ôé€°•ÉÉ½È¹µ•ÍÍ…”¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€±¥•¹Ğ¹É•±•…Í” ¤ì(€€€€€ô(€€€ô(€€€…İ…¥ĞÕÁ‘…Ñ•AÉ½©•Ñ½ÉMÑ…Ñ” ¥‘±”œ°ìÁÉ½©•Ñ•‘½Õ¹ĞèÁÉ½©•Ñ•°™…¥±•‘½Õ¹Ğè™…¥±•°±…ÍÑÙ•¹ÑĞô¤ì(€€€É•ÑÕÉ¸ìÁÉ½©•Ñ•°™…¥±•°Í…¹¹•è•Ù•¹ÑÌ¹É½İÌ¹±•¹Ñ ôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€ÑÉäì…İ…¥ĞÕÁ‘…Ñ•AÉ½©•Ñ½ÉMÑ…Ñ” •ÉÉ½Èœ°ì™…¥±•‘½Õ¹Ğè€Ä°±…ÍÑÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”ô¤ìô…Ñ €¡|¤ì€¼¨½É¥¥¹…°İ¥¹Ì€¨¼ô(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô™¥¹…±±äì(€€€ÁÉ½©•Ñ½ÉIÕ¹¹¥¹œ€ô™…±Í”ì(€ô)ô()™Õ¹Ñ¥½¸ÍÑ…ÉÑ¥¥Ñ…±Qİ¥¹M¡•‘Õ±•È ¤ì(€½¹ÍĞ¥¹Ñ•ÉÙ…±5Ì€ô5…Ñ ¹µ…à ÔÀÀÀ°9Õµ‰•È¡ÁÉ½•ÍÌ¹•¹Ø¹%%Q1}Q]%9}%9QIY1}5L¤ñğ€ÄÔÀÀÀ¤ì(€½¹ÍĞ‰…Ñ¡M¥é”€ô5…Ñ ¹µ…à Ä°9Õµ‰•È¡ÁÉ½•ÍÌ¹•¹Ø¹%%Q1}Q]%9}	Q!}M%i¤ñğU1Q}	Q!}M%i¤ì(€Í•ÑQ¥µ•½ÕĞ  ¤€ôøì(€€€ÁÉ½•ÍÍ¥¥Ñ…±Qİ¥¹	…Ñ ¡‰…Ñ¡M¥é”¤¹…Ñ  ¡•ÉÉ½È¤€ôøì(€€€€€½¹Í½±”¹•ÉÉ½È ¥¥Ñ…°Ñİ¥¸ÍÑ…ÉÑÕÀÁÉ½©•Ñ¥½¸™…¥±•èœ°•ÉÉ½È¹µ•ÍÍ…”¤ì(€€€ô¤ì(€ô°€ÈÀÀÀ¤ì(€½¹ÍĞÑ¥µ•È€ôÍ•Ñ%¹Ñ•ÉÙ…°  ¤€ôøì(€€€ÁÉ½•ÍÍ¥¥Ñ…±Qİ¥¹	…Ñ ¡‰…Ñ¡M¥é”¤¹…Ñ  ¡•ÉÉ½È¤€ôøì(€€€€€½¹Í½±”¹•ÉÉ½È ¥¥Ñ…°Ñİ¥¸Á½±±¥¹œ™…¥±•èœ°•ÉÉ½È¹µ•ÍÍ…”¤ì(€€€ô¤ì(€ô°¥¹Ñ•ÉÙ…±5Ì¤ì(€Ñ¥µ•È¹Õ¹É•˜ü¸ ¤ì(€½¹Í½±”¹±½œ¡9•á„‘¥¥Ñ…°Ñİ¥¸É•…‘ä€ ‘í¥¹Ñ•ÉÙ…±5ÍõµÌ¥¹Ñ•ÉÙ…°°‰…Ñ €‘í‰…Ñ¡M¥é•ô¤¹€¤ì(€É•ÑÕÉ¸Ñ¥µ•Èì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±¥ÍÑQİ¥¹¹Ñ¥Ñ¥•Ì¡±¥•¹Ñ%°½ÁÑ¥½¹Ì€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô½ÁÑ¥½¹Ì¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•¥¥Ñ…±Qİ¥¹M¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞ•¹Ñ¥ÑåQåÁ”€ô±•…¹Q•áĞ¡½ÁÑ¥½¹Ì¹•¹Ñ¥ÑåQåÁ”°€àÀ¤¹Ñ½1½İ•É…Í” ¤ñğ¹Õ±°ì(€½¹ÍĞ½Á•É…Ñ¥½¹…±MÑ…ÑÕÌ€ô±•…¹Q•áĞ¡½ÁÑ¥½¹Ì¹½Á•É…Ñ¥½¹…±MÑ…ÑÕÌ°€ĞÀ¤¹Ñ½1½İ•É…Í” ¤ñğ¹Õ±°ì(€½¹ÍĞ¡•…±Ñ¡MÑ…ÑÕÌ€ô±•…¹Q•áĞ¡½ÁÑ¥½¹Ì¹¡•…±Ñ¡MÑ…ÑÕÌ°€ĞÀ¤¹Ñ½1½İ•É…Í” ¤ñğ¹Õ±°ì(€½¹ÍĞÅÕ•Éä€ô±•…¹Q•áĞ¡½ÁÑ¥½¹Ì¹ÅÕ•Éä°€ÈÔÔ¤ñğ¹Õ±°ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€M1P•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°‘¥ÍÁ±…å}¹…µ”°±¥™•å±•}ÍÑ…ÑÕÌ°(€€€€€€€€€€€½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÌ°¡•…±Ñ¡}ÍÑ…ÑÕÌ°ÍÑ…Ñ”°…ÑÑÉ¥‰ÕÑ•Ì°Í½ÕÉ”°(€€€€€€€€€€€Í½ÕÉ•}•Ù•¹Ñ}¥°½‰Í•ÉÙ•‘}…Ğ°™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ°(€€€€€€€€€€€€¡™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ%L9=P9U109™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ€ğ9=\ ¤¤LÍÑ…±”°(€€€€€€€€€€€½¹™¥‘•¹”°Ù•ÉÍ¥½¸°™¥ÉÍÑ}Í••¹}…Ğ°±…ÍÑ}Í••¹}…Ğ(€€€€I=4‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì(€€€€]!I±¥•¹Ñ}¥€ô€Ä(€€€€€€9€ ÈèéÑ•áĞ%L9U10=H•¹Ñ¥Ñå}ÑåÁ”€ô€È¤(€€€€€€9€ ÌèéÑ•áĞ%L9U10=H½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÌ€ô€Ì¤(€€€€€€9€ ĞèéÑ•áĞ%L9U10=H¡•…±Ñ¡}ÍÑ…ÑÕÌ€ô€Ğ¤(€€€€€€9€ ÔèéÑ•áĞ%L9U10=H‘¥ÍÁ±…å}¹…µ”%1%-€œ”œñğ€Ôñğ€œ”œ=H•¹Ñ¥Ñå}¥%1%-€œ”œñğ€Ôñğ€œ”œ¤(€€€€=IH	d±…ÍÑ}Í••¹}…ĞM(€€€€1%5%P€Ù€°(€€€m±¥•¹Ñ%°•¹Ñ¥ÑåQåÁ”°½Á•É…Ñ¥½¹…±MÑ…ÑÕÌ°¡•…±Ñ¡MÑ…ÑÕÌ°ÅÕ•Éä°¹½Éµ…±¥é•‘1¥µ¥Ğ¡½ÁÑ¥½¹Ì¹±¥µ¥Ğ¥t(€€¤ì(€É•ÑÕÉ¸É•ÍÕ±Ğ¹É½İÌì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•ÑQİ¥¹¹Ñ¥Ñä¡±¥•¹Ñ%°•¹Ñ¥ÑåQåÁ”°•¹Ñ¥Ñå%°½ÁÑ¥½¹Ì€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô½ÁÑ¥½¹Ì¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•¥¥Ñ…±Qİ¥¹M¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞÑåÁ”€ô±•…¹Q•áĞ¡•¹Ñ¥ÑåQåÁ”°€àÀ¤¹Ñ½1½İ•É…Í” ¤ì(€½¹ÍĞ¥€ô±•…¹Q•áĞ¡•¹Ñ¥Ñå%°€ÄØÀ¤ì(€½¹ÍĞ•¹Ñ¥Ñä€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€M1P•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°‘¥ÍÁ±…å}¹…µ”°±¥™•å±•}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€€½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÌ°¡•…±Ñ¡}ÍÑ…ÑÕÌ°ÍÑ…Ñ”°…ÑÑÉ¥‰ÕÑ•Ì°Í½ÕÉ”°(€€€€€€€€€€€€€Í½ÕÉ•}•Ù•¹Ñ}¥°½‰Í•ÉÙ•‘}…Ğ°™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ°(€€€€€€€€€€€€€€¡™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ%L9=P9U109™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ€ğ9=\ ¤¤LÍÑ…±”°(€€€€€€€€€€€€€½¹™¥‘•¹”°Ù•ÉÍ¥½¸°™¥ÉÍÑ}Í••¹}…Ğ°±…ÍÑ}Í••¹}…Ğ(€€€€€€I=4‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì(€€€€€]!I±¥•¹Ñ}¥€ô€Ä9•¹Ñ¥Ñå}ÑåÁ”€ô€È9•¹Ñ¥Ñå}¥€ô€Í€°(€€€€€m±¥•¹Ñ%°ÑåÁ”°¥‘t(€€€€¤ì(€½¹ÍĞ½ÕÑ½¥¹œ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€M1PÉ•±…Ñ¥½¹Í¡¥À°Ñ½}•¹Ñ¥Ñå}ÑåÁ”L•¹Ñ¥Ñå}ÑåÁ”°Ñ½}•¹Ñ¥Ñå}¥L•¹Ñ¥Ñå}¥°(€€€€€€€€€€€€€…Ñ¥Ù”°…ÑÑÉ¥‰ÕÑ•Ì°½‰Í•ÉÙ•‘}…Ğ°½¹™¥‘•¹”(€€€€€€I=4‰¥±±¥¹}Ñİ¥¹}É•±…Ñ¥½¹Í¡¥ÁÌ(€€€€€€]!I±¥•¹Ñ}¥€ô€Ä9™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô€È9™É½µ}•¹Ñ¥Ñå}¥€ô€Ì9…Ñ¥Ù”€ôQIU(€€€€€=IH	dÉ•±…Ñ¥½¹Í¡¥À°Ñ½}•¹Ñ¥Ñå}ÑåÁ”°Ñ½}•¹Ñ¥Ñå}¥‘€°(€€€€€m±¥•¹Ñ%°ÑåÁ”°¥‘t(€€€€¤ì(€½¹ÍĞ¥¹½µ¥¹œ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€M1PÉ•±…Ñ¥½¹Í¡¥À°™É½µ}•¹Ñ¥Ñå}ÑåÁ”L•¹Ñ¥Ñå}ÑåÁ”°™É½µ}•¹Ñ¥Ñå}¥L•¹Ñ¥Ñå}¥°(€€€€€€€€€€€€€…Ñ¥Ù”°…ÑÑÉ¥‰ÕÑ•Ì°½‰Í•ÉÙ•‘}…Ğ°½¹™¥‘•¹”(€€€€€€I=4‰¥±±¥¹}Ñİ¥¹}É•±…Ñ¥½¹Í¡¥ÁÌ(€€€€€€]!I±¥•¹Ñ}¥€ô€Ä9Ñ½}•¹Ñ¥Ñå}ÑåÁ”€ô€È9Ñ½}•¹Ñ¥Ñå}¥€ô€Ì9…Ñ¥Ù”€ôQIU(€€€€€=IH	dÉ•±…Ñ¥½¹Í¡¥À°™É½µ}•¹Ñ¥Ñå}ÑåÁ”°™É½µ}•¹Ñ¥Ñå}¥‘€°(€€€€€m±¥•¹Ñ%°ÑåÁ”°¥‘t(€€€€¤ì(€¥˜€ …•¹Ñ¥Ñä¹É½İÍlÁt¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸ì€¸¸¹•¹Ñ¥Ñä¹É½İÍlÁt°É•±…Ñ¥½¹Í¡¥ÁÌèì½ÕÑ½¥¹œè½ÕÑ½¥¹œ¹É½İÌ°¥¹½µ¥¹œè¥¹½µ¥¹œ¹É½İÌôôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•ÑQİ¥¹%µÁ…Ğ¡±¥•¹Ñ%°•¹Ñ¥ÑåQåÁ”°•¹Ñ¥Ñå%°½ÁÑ¥½¹Ì€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô½ÁÑ¥½¹Ì¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•¥¥Ñ…±Qİ¥¹M¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞµ…á•ÁÑ €ô5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸¡9Õµ‰•È¡½ÁÑ¥½¹Ì¹‘•ÁÑ ¤ñğ€Ğ°€à¤¤ì(€½¹ÍĞÑåÁ”€ô±•…¹Q•áĞ¡•¹Ñ¥ÑåQåÁ”°€àÀ¤¹Ñ½1½İ•É…Í” ¤ì(€½¹ÍĞ¥€ô±•…¹Q•áĞ¡•¹Ñ¥Ñå%°€ÄØÀ¤ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€]%Q IUIM%Y¥µÁ…ĞL€ (€€€€€€M1P€ÈèéÑ•áĞL•¹Ñ¥Ñå}ÑåÁ”°€ÌèéÑ•áĞL•¹Ñ¥Ñå}¥°€ÀL‘•ÁÑ °(€€€€€€€€€€€€€IIelÈèéÑ•áĞñğ€œèœñğ€ÌèéÑ•áÑtèéÑ•áÑmtLÁ…Ñ °(€€€€€€€€€€€€€9U10èéÑ•áĞLÙ¥…}É•±…Ñ¥½¹Í¡¥À(€€€€€€U9%=810(€€€€€€M1P(€€€€€€€€M]!8É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”9É•°¹™É½µ}•¹Ñ¥Ñå}¥€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}¥(€€€€€€€€€€€€€Q!8É•°¹Ñ½}•¹Ñ¥Ñå}ÑåÁ”1MÉ•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”9°(€€€€€€€€M]!8É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”9É•°¹™É½µ}•¹Ñ¥Ñå}¥€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}¥(€€€€€€€€€€€€€Q!8É•°¹Ñ½}•¹Ñ¥Ñå}¥1MÉ•°¹™É½µ}•¹Ñ¥Ñå}¥9°(€€€€€€€€¥µÁ…Ğ¹‘•ÁÑ €¬€Ä°(€€€€€€€€¥µÁ…Ğ¹Á…Ñ ñğ€ (€€€€€€€€€€M]!8É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”9É•°¹™É½µ}•¹Ñ¥Ñå}¥€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}¥(€€€€€€€€€€€€€€€Q!8É•°¹Ñ½}•¹Ñ¥Ñå}ÑåÁ”ñğ€œèœñğÉ•°¹Ñ½}•¹Ñ¥Ñå}¥(€€€€€€€€€€€€€€€1MÉ•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”ñğ€œèœñğÉ•°¹™É½µ}•¹Ñ¥Ñå}¥9(€€€€€€€€€¤°(€€€€€€€€É•°¹É•±…Ñ¥½¹Í¡¥À(€€€€€€I=4¥µÁ…Ğ(€€€€€€)=%8‰¥±±¥¹}Ñİ¥¹}É•±…Ñ¥½¹Í¡¥ÁÌÉ•°(€€€€€€€€=8É•°¹±¥•¹Ñ}¥€ô€Ä9É•°¹…Ñ¥Ù”€ôQIU9€ (€€€€€€€€€€€¡É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”9É•°¹™É½µ}•¹Ñ¥Ñå}¥€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}¥¤=H(€€€€€€€€€€€¡É•°¹Ñ½}•¹Ñ¥Ñå}ÑåÁ”€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”9É•°¹Ñ½}•¹Ñ¥Ñå}¥€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}¥¤(€€€€€€€€€¤(€€€€€€]!I¥µÁ…Ğ¹‘•ÁÑ €ğ€Ğ(€€€€€€€€99=P€ (€€€€€€€€€€M]!8É•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”9É•°¹™É½µ}•¹Ñ¥Ñå}¥€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}¥(€€€€€€€€€€€€€€€Q!8É•°¹Ñ½}•¹Ñ¥Ñå}ÑåÁ”ñğ€œèœñğÉ•°¹Ñ½}•¹Ñ¥Ñå}¥(€€€€€€€€€€€€€€€1MÉ•°¹™É½µ}•¹Ñ¥Ñå}ÑåÁ”ñğ€œèœñğÉ•°¹™É½µ}•¹Ñ¥Ñå}¥9(€€€€€€€€€€€ô9d¡¥µÁ…Ğ¹Á…Ñ ¤(€€€€€€€€€¤(€€€€€¤(€€€€M1P%MQ%9P=8€¡¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”°¥µÁ…Ğ¹•¹Ñ¥Ñå}¥¤(€€€€€€¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”°¥µÁ…Ğ¹•¹Ñ¥Ñå}¥°•¹Ñ¥Ñä¹‘¥ÍÁ±…å}¹…µ”°(€€€€€€•¹Ñ¥Ñä¹±¥™•å±•}ÍÑ…ÑÕÌ°•¹Ñ¥Ñä¹½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÌ°•¹Ñ¥Ñä¹¡•…±Ñ¡}ÍÑ…ÑÕÌ°(€€€€€€•¹Ñ¥Ñä¹½‰Í•ÉÙ•‘}…Ğ°•¹Ñ¥Ñä¹™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ°(€€€€€€€¡•¹Ñ¥Ñä¹™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ%L9=P9U109•¹Ñ¥Ñä¹™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ€ğ9=\ ¤¤LÍÑ…±”°(€€€€€€•¹Ñ¥Ñä¹½¹™¥‘•¹”°¥µÁ…Ğ¹‘•ÁÑ °¥µÁ…Ğ¹Ù¥…}É•±…Ñ¥½¹Í¡¥À(€€€€I=4¥µÁ…Ğ(€€€€1P)=%8‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì•¹Ñ¥Ñä(€€€€€€=8•¹Ñ¥Ñä¹±¥•¹Ñ}¥€ô€Ä9•¹Ñ¥Ñä¹•¹Ñ¥Ñå}ÑåÁ”€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”9•¹Ñ¥Ñä¹•¹Ñ¥Ñå}¥€ô¥µÁ…Ğ¹•¹Ñ¥Ñå}¥(€€€€=IH	d¥µÁ…Ğ¹•¹Ñ¥Ñå}ÑåÁ”°¥µÁ…Ğ¹•¹Ñ¥Ñå}¥°¥µÁ…Ğ¹‘•ÁÑ M€°(€€€m±¥•¹Ñ%°ÑåÁ”°¥°µ…á•ÁÑ¡t(€€¤ì(€½¹ÍĞ¹½‘•Ì€ôÉ•ÍÕ±Ğ¹É½İÌ¹Í½ÉĞ ¡„°ˆ¤€ôø9Õµ‰•È¡„¹‘•ÁÑ ¤€´9Õµ‰•È¡ˆ¹‘•ÁÑ ¤¤ì(€É•ÑÕÉ¸ì(€€€É½½Ğèì•¹Ñ¥Ñå}ÑåÁ”èÑåÁ”°•¹Ñ¥Ñå}¥è¥ô°(€€€‘•ÁÑ èµ…á•ÁÑ °(€€€…™™•Ñ•‘}½Õ¹Ğè5…Ñ ¹µ…à À°¹½‘•Ì¹±•¹Ñ €´€Ä¤°(€€€½Õ¹ÑÍ}‰å}ÑåÁ”è¹½‘•Ì¹™¥±Ñ•È ¡¹½‘”¤€ôø9Õµ‰•È¡¹½‘”¹‘•ÁÑ ¤€ø€À¤¹É•‘Õ” ¡½Õ¹ÑÌ°¹½‘”¤€ôøì(€€€€€½Õ¹ÑÍm¹½‘”¹•¹Ñ¥Ñå}ÑåÁ•t€ô€¡½Õ¹ÑÍm¹½‘”¹•¹Ñ¥Ñå}ÑåÁ•tñğ€À¤€¬€Äì(€€€€€É•ÑÕÉ¸½Õ¹ÑÌì(€€€ô°íô¤°(€€€¹½‘•Ì°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•ÑQİ¥¹!•…±Ñ ¡±¥•¹Ñ%°½ÁÑ¥½¹Ì€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô½ÁÑ¥½¹Ì¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•¥¥Ñ…±Qİ¥¹M¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€M1P(€€€€€€€¡M1P=U9P ¨¤èé¥¹ĞI=4‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì]!I±¥•¹Ñ}¥€ô€Ä¤L•¹Ñ¥Ñ¥•Ì°(€€€€€€€¡M1P=U9P ¨¤èé¥¹ĞI=4‰¥±±¥¹}Ñİ¥¹}É•±…Ñ¥½¹Í¡¥ÁÌ]!I±¥•¹Ñ}¥€ô€Ä9…Ñ¥Ù”€ôQIU¤LÉ•±…Ñ¥½¹Í¡¥ÁÌ°(€€€€€€€¡M1P=U9P ¨¤èé¥¹ĞI=4‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì(€€€€€€€€€]!I±¥•¹Ñ}¥€ô€Ä9™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ%L9=P9U109™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ€ğ9=\ ¤¤LÍÑ…±•}•¹Ñ¥Ñ¥•Ì°(€€€€€€€¡M1P=U9P ¨¤èé¥¹ĞI=4‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì(€€€€€€€€€]!I±¥•¹Ñ}¥€ô€Ä9¡•…±Ñ¡}ÍÑ…ÑÕÌ%8€ ‘•É…‘•œ°€É¥Ñ¥…°œ¤¤LÕ¹¡•…±Ñ¡å}•¹Ñ¥Ñ¥•Ì°(€€€€€€€¡M1P=U9P ¨¤èé¥¹ĞI=4‰¥±±¥¹}•Ù•¹ÑÌ•Ù•¹Ğ(€€€€€€€€€1P)=%8‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ¥½¹}•Ù•¹ÑÌÁÉ½©•Ñ¥½¸(€€€€€€€€€€€=8ÁÉ½©•Ñ¥½¸¹•Ù•¹Ñ}¥€ô•Ù•¹Ğ¹¥9ÁÉ½©•Ñ¥½¸¹±¥•¹Ñ}¥€ô•Ù•¹Ğ¹±¥•¹Ñ}¥(€€€€€€€€€]!I•Ù•¹Ğ¹±¥•¹Ñ}¥€ô€Ä9ÁÉ½©•Ñ¥½¸¹•Ù•¹Ñ}¥%L9U10¤LÁ•¹‘¥¹}•Ù•¹ÑÌ°(€€€€€€€¡M1P5`¡ÁÉ½©•Ñ•‘}…Ğ¤I=4‰¥±±¥¹}Ñİ¥¹}ÁÉ½©•Ñ¥½¹}•Ù•¹ÑÌ]!I±¥•¹Ñ}¥€ô€Ä¤L±…ÍÑ}ÁÉ½©•Ñ•‘}…Ñ€°(€€€m±¥•¹Ñ%‘t(€€¤ì(€É•ÑÕÉ¸É•ÍÕ±Ğ¹É½İÍlÁtì)ô()™Õ¹Ñ¥½¸ÅÕ•ÍÑ¥½¹Q½­•¹Ì¡ÅÕ•ÍÑ¥½¸¤ì(€É•ÑÕÉ¸l¸¸¹¹•ÜM•Ğ (€€€±•…¹Q•áĞ¡ÅÕ•ÍÑ¥½¸°€ÄÀÀÀ¤(€€€€€€¹Ñ½1½İ•É…Í” ¤(€€€€€€¹ÍÁ±¥Ğ ½my„µèÀ´å|¸èµt¬¼¤(€€€€€€¹™¥±Ñ•È ¡Ñ½­•¸¤€ôøÑ½­•¸¹±•¹Ñ €øô€Ì¤(€€€€€€¹Í±¥” À°€ÈÀ¤(€€€€€€¹µ…À ¡Ñ½­•¸¤€ôø€”‘íÑ½­•¹ô•€¤(€€¥tì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‰Õ¥±‘9•á…Qİ¥¹½¹Ñ•áĞ¡±¥•¹Ñ%°ÅÕ•ÍÑ¥½¸°½ÁÑ¥½¹Ì€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô½ÁÑ¥½¹Ì¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•¥¥Ñ…±Qİ¥¹M¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞÑ½­•¹Ì€ôÅÕ•ÍÑ¥½¹Q½­•¹Ì¡ÅÕ•ÍÑ¥½¸¤ì(€½¹ÍĞ±¥µ¥Ğ€ô¹½Éµ…±¥é•‘1¥µ¥Ğ¡½ÁÑ¥½¹Ì¹±¥µ¥Ğ°€ÄÈ°€ÈÔ¤ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€M1P•¹Ñ¥Ñå}ÑåÁ”°•¹Ñ¥Ñå}¥°‘¥ÍÁ±…å}¹…µ”°±¥™•å±•}ÍÑ…ÑÕÌ°(€€€€€€€€€€€½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÌ°¡•…±Ñ¡}ÍÑ…ÑÕÌ°ÍÑ…Ñ”°Í½ÕÉ”°½‰Í•ÉÙ•‘}…Ğ°(€€€€€€€€€€€™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ°(€€€€€€€€€€€€¡™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ%L9=P9U109™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ€ğ9=\ ¤¤LÍÑ…±”°(€€€€€€€€€€€½¹™¥‘•¹”(€€€€I=4‰¥±±¥¹}Ñİ¥¹}•¹Ñ¥Ñ¥•Ì(€€€€]!I±¥•¹Ñ}¥€ô€Ä9€ (€€€€€€…É‘¥¹…±¥Ñä ÈèéÑ•áÑmt¤€ô€À(€€€€€€=H•¹Ñ¥Ñå}ÑåÁ”%1%-9d ÈèéÑ•áÑmt¤(€€€€€€=H•¹Ñ¥Ñå}¥%1%-9d ÈèéÑ•áÑmt¤(€€€€€€=H=1M¡‘¥ÍÁ±…å}¹…µ”°€œœ¤%1%-9d ÈèéÑ•áÑmt¤(€€€€€€=H±¥™•å±•}ÍÑ…ÑÕÌ%1%-9d ÈèéÑ•áÑmt¤(€€€€€€=H½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÌ%1%-9d ÈèéÑ•áÑmt¤(€€€€€€=H¡•…±Ñ¡}ÍÑ…ÑÕÌ%1%-9d ÈèéÑ•áÑmt¤(€€€€€€=HÍÑ…Ñ”èéÑ•áĞ%1%-9d ÈèéÑ•áÑmt¤(€€€€€¤(€€€€=IH	d(€€€€€€M]!8¡•…±Ñ¡}ÍÑ…ÑÕÌ€ô€É¥Ñ¥…°œQ!8€À]!8¡•…±Ñ¡}ÍÑ…ÑÕÌ€ô€‘•É…‘•œQ!8€Ä1M€È9°(€€€€€€M]!8½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÌ%8€ ½™™±¥¹”œ°€‘½İ¸œ°€‘¥Í½¹¹•Ñ•œ¤Q!8€À1M€Ä9°(€€€€€€€¡™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ%L9=P9U109™É•Í¡¹•ÍÍ}•áÁ¥É•Í}…Ğ€ğ9=\ ¤¤M°(€€€€€€±…ÍÑ}Í••¹}…ĞM(€€€€1%5%P€Í€°(€€€m±¥•¹Ñ%°Ñ½­•¹Ì°±¥µ¥Ñt(€€¤ì(€¥˜€ …É•ÍÕ±Ğ¹É½İÌ¹±•¹Ñ ¤É•ÑÕÉ¸ì½¹Ñ•áĞè€œœ°Í½ÕÉ•Ìèmt°•¹Ñ¥Ñ¥•Ìèmtôì((€½¹ÍĞ…Í­Í½É%µÁ…Ğ€ô€½qˆ¡…™™•Ññ…™™•Ñ•‘ñ¥µÁ…Ññ‘•Á•¹‘ñ‘•Á•¹‘•¹åñ½ÕÑ…•ñ½™™±¥¹•ñ‘½İ¹ñ½¹¹•Ñ•¥qˆ½¤¹Ñ•ÍĞ¡ÅÕ•ÍÑ¥½¸¤ì(€±•Ğ¥µÁ…Ğ€ô¹Õ±°ì(€¥˜€¡…Í­Í½É%µÁ…Ğ¤ì(€€€½¹ÍĞÉ½½Ğ€ôÉ•ÍÕ±Ğ¹É½İÍlÁtì(€€€¥µÁ…Ğ€ô…İ…¥Ğ•ÑQİ¥¹%µÁ…Ğ¡±¥•¹Ñ%°É½½Ğ¹•¹Ñ¥Ñå}ÑåÁ”°É½½Ğ¹•¹Ñ¥Ñå}¥°ì(€€€€€ÅÕ•Éå…‰±”°(€€€€€‘•ÁÑ è5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸¡9Õµ‰•È¡½ÁÑ¥½¹Ì¹‘•ÁÑ ¤ñğ€Ì°€Ô¤¤°(€€€ô¤ì(€ô((€½¹ÍĞ±¥¹•Ì€ôÉ•ÍÕ±Ğ¹É½İÌ¹µ…À ¡•¹Ñ¥Ñä¤€ôøì(€€€½¹ÍĞÍÑ…Ñ”€ô½µÁ…Ñ=‰©•Ğ¡•¹Ñ¥Ñä¹ÍÑ…Ñ”ñğíô¤ì(€€€É•ÑÕÉ¸l(€€€€€mÑİ¥¸è‘í•¹Ñ¥Ñä¹•¹Ñ¥Ñå}ÑåÁ•ôè‘í•¹Ñ¥Ñä¹•¹Ñ¥Ñå}¥‘õu€°(€€€€€•¹Ñ¥Ñä¹‘¥ÍÁ±…å}¹…µ”ñğ•¹Ñ¥Ñä¹•¹Ñ¥Ñå}¥°(€€€€€±¥™•å±”ô‘í•¹Ñ¥Ñä¹±¥™•å±•}ÍÑ…ÑÕÍõ€°(€€€€€½Á•É…Ñ¥½¹…°ô‘í•¹Ñ¥Ñä¹½Á•É…Ñ¥½¹…±}ÍÑ…ÑÕÍõ€°(€€€€€¡•…±Ñ ô‘í•¹Ñ¥Ñä¹¡•…±Ñ¡}ÍÑ…ÑÕÍõ€°(€€€€€½‰Í•ÉÙ•ô‘í¹•Ü…Ñ”¡•¹Ñ¥Ñä¹½‰Í•ÉÙ•‘}…Ğ¤¹Ñ½%M=MÑÉ¥¹œ ¥õ€°(€€€€€ÍÑ…±”ô‘í•¹Ñ¥Ñä¹ÍÑ…±•õ€°(€€€€€½¹™¥‘•¹”ô‘í•¹Ñ¥Ñä¹½¹™¥‘•¹•õ€°(€€€€€ÍÑ…Ñ”ô‘í)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¥õ€°(€€€t¹©½¥¸ œğ€œ¤ì(€ô¤ì(€¥˜€¡¥µÁ…Ğ¤ì(€€€±¥¹•Ì¹ÁÕÍ  (€€€€€m¥µÁ…Ğè‘í¥µÁ…Ğ¹É½½Ğ¹•¹Ñ¥Ñå}ÑåÁ•ôè‘í¥µÁ…Ğ¹É½½Ğ¹•¹Ñ¥Ñå}¥‘õt…™™•Ñ•ô‘í¥µÁ…Ğ¹…™™•Ñ•‘}½Õ¹Ñõ€(€€€€€€¬€½Õ¹ÑÌô‘í)M=8¹ÍÑÉ¥¹¥™ä¡¥µÁ…Ğ¹½Õ¹ÑÍ}‰å}ÑåÁ”¥õ€(€€€€¤ì(€ô(€É•ÑÕÉ¸ì(€€€½¹Ñ•áĞè±¥¹•Ì¹©½¥¸ q¸œ¤°(€€€•¹Ñ¥Ñ¥•ÌèÉ•ÍÕ±Ğ¹É½İÌ°(€€€¥µÁ…Ğ°(€€€Í½ÕÉ•ÌèÉ•ÍÕ±Ğ¹É½İÌ¹µ…À ¡•¹Ñ¥Ñä¤€ôø€¡ì(€€€€€Í½ÕÉ•}ÑåÁ”è€‘¥¥Ñ…±}Ñİ¥¸œ°(€€€€€•¹Ñ¥Ñå}ÑåÁ”è•¹Ñ¥Ñä¹•¹Ñ¥Ñå}ÑåÁ”°(€€€€€•¹Ñ¥Ñå}¥è•¹Ñ¥Ñä¹•¹Ñ¥Ñå}¥°(€€€€€½‰Í•ÉÙ•‘}…Ğè•¹Ñ¥Ñä¹½‰Í•ÉÙ•‘}…Ğ°(€€€€€ÍÑ…±”è•¹Ñ¥Ñä¹ÍÑ…±”°(€€€€€½¹™¥‘•¹”è•¹Ñ¥Ñä¹½¹™¥‘•¹”°(€€€ô¤¤°(€ôì)ô()µ½‘Õ±”¹•áÁ½ÉÑÌ€ôì(€%%Q1}Q]%9}M!5}ME0°(€AI=)Q=I}YIM%=8°(€‰Õ¥±‘9•á…Qİ¥¹½¹Ñ•áĞ°(€‘•É¥Ù•Qİ¥¹MÑ…ÑÕÍ•Ì°(€•¹ÍÕÉ•¥¥Ñ…±Qİ¥¹M¡•µ„°(€™É•Í¡¹•ÍÍM•½¹‘Í½ÉÙ•¹Ğ°(€•ÑQİ¥¹¹Ñ¥Ñä°(€•ÑQİ¥¹!•…±Ñ °(€•ÑQİ¥¹%µÁ…Ğ°(€±¥ÍÑQİ¥¹¹Ñ¥Ñ¥•Ì°(€µ•É•‘Ù•¹ÑMÑ…Ñ”°(€½‰Í•ÉÙ•Qİ¥¹¹Ñ¥Ñä°(€½‰Í•ÉÙ•Qİ¥¹¹Ñ¥Ñ¥•Ì°(€½‰Í•ÉÙ•Qİ¥¹I•±…Ñ¥½¹Í¡¥À°(€ÁÉ½•ÍÍ¥¥Ñ…±Qİ¥¹	…Ñ °(€ÁÉ½©•Ñ¥¥Ñ…±Qİ¥¹Ù•¹Ğ°(€ÍÑ…ÉÑ¥¥Ñ…±Qİ¥¹M¡•‘Õ±•È°)ôì(