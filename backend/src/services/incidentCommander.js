const crypto = require('crypto');
const os = require('os');
const db = require('../db');
const { ensureEventSchema, recordBillingEvent } = require('./events');

const INCIDENT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS billing_incidents (
    id UUID PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    incident_key VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    category VARCHAR(60) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    status VARCHAR(24) NOT NULL DEFAULT 'detected'
      CHECK (status IN ('detected','investigating','mitigating','monitoring','resolved','closed')),
    commander_mode VARCHAR(24) NOT NULL DEFAULT 'advisory'
      CHECK (commander_mode IN ('advisory','approval_required')),
    confidence NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),
    primary_entity_type VARCHAR(80),
    primary_entity_id VARCHAR(160),
    impact JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
    first_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_signal_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_incidents_active_key
    ON billing_incidents(client_id, incident_key)
    WHERE status NOT IN ('resolved','closed');
  CREATE INDEX IF NOT EXISTS idx_billing_incidents_tenant_status
    ON billing_incidents(client_id, status, severity, last_signal_at DESC);

  CREATE TABLE IF NOT EXISTS billing_incident_events (
    incident_id UUID NOT NULL REFERENCES billing_incidents(id) ON DELETE CASCADE,
    event_id UUID NOT NULL,
    client_id INTEGER NOT NULL,
    relationship VARCHAR(40) NOT NULL DEFAULT 'evidence',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (incident_id, event_id),
    FOREIGN KEY (event_id, client_id) REFERENCES billing_events(id, client_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_billing_incident_events_tenant
    ON billing_incident_events(client_id, incident_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS billing_incident_timeline (
    id BIGSERIAL PRIMARY KEY,
    incident_id UUID NOT NULL REFERENCES billing_incidents(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    entry_type VARCHAR(40) NOT NULL,
    message TEXT NOT NULL,
    actor_type VARCHAR(40) NOT NULL DEFAULT 'system',
    actor_id VARCHAR(160),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_billing_incident_timeline
    ON billing_incident_timeline(client_id, incident_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS billing_incident_recommendations (
    id UUID PRIMARY KEY,
    incident_id UUID NOT NULL REFERENCES billing_incidents(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    action_type VARCHAR(80) NOT NULL,
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
    title VARCHAR(255) NOT NULL,
    rationale TEXT NOT NULL,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    approval_required BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(24) NOT NULL DEFAULT 'proposed'
      CHECK (status IN ('proposed','approved','rejected','superseded','executed')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (incident_id, action_type)
  );

  CREATE TABLE IF NOT EXISTS billing_incident_approvals (
    id UUID PRIMARY KEY,
    incident_id UUID NOT NULL REFERENCES billing_incidents(id) ON DELETE CASCADE,
    recommendation_id UUID NOT NULL REFERENCES billing_incident_recommendations(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved','rejected')),
    decided_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_billing_incident_approvals_tenant
    ON billing_incident_approvals(client_id, incident_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS billing_incident_event_evaluations (
    event_id UUID NOT NULL,
    client_id INTEGER NOT NULL,
    result VARCHAR(20) NOT NULL CHECK (result IN ('ignored','correlated','resolved','failed')),
    incident_id UUID REFERENCES billing_incidents(id) ON DELETE SET NULL,
    rule_id VARCHAR(100),
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
    next_retry_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, client_id),
    FOREIGN KEY (event_id, client_id) REFERENCES billing_events(id, client_id) ON DELETE CASCADE
  );
`;

const ACTIVE_STATUSES = new Set(['detected', 'investigating', 'mitigating', 'monitoring']);
const STATUS_TRANSITIONS = {
  detected: new Set(['investigating', 'resolved', 'closed']),
  investigating: new Set(['mitigating', 'monitoring', 'resolved', 'closed']),
  mitigating: new Set(['monitoring', 'resolved', 'closed']),
  monitoring: new Set(['investigating', 'mitigating', 'resolved', 'closed']),
  resolved: new Set(['closed', 'investigating']),
  closed: new Set([]),
};
const WORKER_ID = `${os.hostname()}:${process.pid}:incident-commander`;
const POLL_MS = Math.max(5000, Number(process.env.INCIDENT_COMMANDER_INTERVAL_MS) || 15000);
let schemaReady = false;
let schemaPromise;
let schedulerStarted = false;

function text(value, max = 255) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function severityRank(value) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[value] || 1;
}

function incidentSeverity(event) {
  if (event.severity === 'critical') return 'critical';
  if (event.severity === 'warning') return 'high';
  return 'medium';
}

function eventDomain(event) {
  const haystack = `${event.event_type} ${event.event_category} ${event.source} ${event.entity_type || ''}`.toLowerCase();
  if (/mikrotik|router|network|noc|link|wan/.test(haystack)) return 'network';
  if (/radius|pppoe|hotspot|session|authentication/.test(haystack)) return 'access';
  if (/tr069|ont|olt|acs|fiber|optical/.test(haystack)) return 'fiber';
  if (/payment|invoice|billing|collection/.test(haystack)) return 'billing';
  if (/whatsapp|sms|communication|message/.test(haystack)) return 'communication';
  if (/employee|task|ticket|technician/.test(haystack)) return 'workforce';
  return 'platform';
}

function recommendationTemplates(domain) {
  const common = [{
    action_type: 'verify_signal', risk_level: 'low', title: 'Verify the live signal',
    rationale: 'Confirm the condition from a second source before making a customer-impacting change.',
    steps: ['Check the latest telemetry timestamp', 'Compare the event with the digital twin', 'Record the verification in the incident timeline'],
  }];
  const byDomain = {
    network: [{
      action_type: 'inspect_router_path', risk_level: 'medium', title: 'Inspect the affected router path',
      rationale: 'Router and upstream health should be checked before restarting services or changing configuration.',
      steps: ['Check router reachability and interface errors', 'Review affected subscribers', 'Prepare a reversible remediation plan'],
    }],
    access: [{
      action_type: 'inspect_radius_access', risk_level: 'medium', title: 'Inspect RADIUS access flow',
      rationale: 'Authentication and accounting evidence can distinguish credential, NAS, and session failures.',
      steps: ['Check recent authentication results', 'Compare accounting sessions', 'Confirm package and expiry state'],
    }],
    fiber: [{
      action_type: 'inspect_optical_path', risk_level: 'medium', title: 'Inspect the optical path',
      rationale: 'ONT and ACS observations should be compared before initiating remote remediation.',
      steps: ['Check last inform time', 'Review optical signal and OLT state', 'Identify subscribers on the affected branch'],
    }],
    billing: [{
      action_type: 'review_billing_evidence', risk_level: 'high', title: 'Review billing evidence',
      rationale: 'Financial changes require confirmation of invoices, payments, and account state.',
      steps: ['Reconcile payment references', 'Check invoice and subscriber state', 'Request approval before financial correction'],
    }],
    communication: [{
      action_type: 'inspect_delivery_channel', risk_level: 'medium', title: 'Inspect message delivery',
      rationale: 'Provider session and delivery acknowledgements should be verified before retrying messages.',
      steps: ['Check provider connection', 'Review the latest delivery acknowledgement', 'Avoid bulk retries until the channel is healthy'],
    }],
    workforce: [{
      action_type: 'review_task_ownership', risk_level: 'low', title: 'Review task ownership and SLA',
      rationale: 'Clear assignment and escalation prevent duplicate or missed field work.',
      steps: ['Confirm assignee', 'Review SLA and dependencies', 'Escalate with the evidence attached if overdue'],
    }],
    platform: [{
      action_type: 'inspect_platform_health', risk_level: 'medium', title: 'Inspect platform health',
      rationale: 'Processor, queue, and dependency health should be verified before intervention.',
      steps: ['Check processor backlog and alerts', 'Review dependency freshness', 'Prepare a rollback-safe mitigation'],
    }],
  };
  return [...common, ...(byDomain[domain] || byDomain.platform)];
}

function classifyIncidentEvent(event) {
  const eventType = String(event.event_type || '').toLowerCase();
  const category = String(event.event_category || '').toLowerCase();
  const source = String(event.source || '').toLowerCase();
  if (source === 'incident_commander' || category === 'incident' || eventType.startsWith('incident.')) {
    return { result: 'ignored', reason: 'commander_event' };
  }
  const occurredAt = event.occurred_at ? new Date(event.occurred_at) : null;
  const maxAgeHours = Math.max(1, Number(process.env.INCIDENT_COMMANDER_MAX_EVENT_AGE_HOURS) || 24);
  if (occurredAt && !Number.isNaN(occurredAt.getTime())
    && Date.now() - occurredAt.getTime() > maxAgeHours * 3600000) {
    return { result: 'ignored', reason: 'historical_signal' };
  }
  const resolved = /(resolved|recovered|restored|online)$/.test(eventType)
    || eventType === 'digital_twin.alert_resolved';
  const actionable = event.severity === 'warning'
    || event.severity === 'critical'
    || /(offline|failed|failure|outage|degraded|timeout|unreachable|alert_opened|overdue)/.test(eventType);
  if (!actionable && !resolved) return { result: 'ignored', reason: 'non_actionable' };

  const domain = eventDomain(event);
  const entityType = text(event.entity_type || domain, 80).toLowerCase();
  const entityId = text(event.entity_id || event.correlation_id || event.event_type, 160);
  const ruleId = `${domain}.${resolved ? 'recovery' : 'degradation'}`;
  const correlation = text(event.correlation_id || `${entityType}:${entityId}`, 180).toLowerCase();
  return {
    result: resolved ? 'resolved' : 'correlated',
    rule_id: ruleId,
    incident_key: `${domain}:${correlation}`.slice(0, 255),
    category: domain,
    severity: incidentSeverity(event),
    title: text(event.title || `${domain[0].toUpperCase()}${domain.slice(1)} incident detected`),
    summary: text(event.description || `Nexa detected ${event.event_type} from ${event.source}.`, 2000),
    primary_entity_type: event.entity_type || null,
    primary_entity_id: event.entity_id || null,
    recommendations: recommendationTemplates(domain),
  };
}

async function ensureIncidentSchema(queryable = db) {
  await ensureEventSchema(queryable);
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = queryable.query(INCIDENT_SCHEMA_SQL)
      .then(() => { schemaReady = true; })
      .catch((error) => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
}

async function calculateImpact(queryable, clientId, entityType, entityId) {
  if (!entityType || !entityId) return { affected_entities: 0, by_type: {} };
  const result = await queryable.query(
    `SELECT entity_type, COUNT(*)::int AS count FROM (
       SELECT to_entity_type AS entity_type FROM billing_twin_relationships
        WHERE client_id = $1 AND active = TRUE
          AND from_entity_type = $2 AND from_entity_id = $3
       UNION ALL
       SELECT from_entity_type AS entity_type FROM billing_twin_relationships
        WHERE client_id = $1 AND active = TRUE
          AND to_entity_type = $2 AND to_entity_id = $3
     ) impacted GROUP BY entity_type`,
    [clientId, entityType, String(entityId)]
  );
  const byType = Object.fromEntries(result.rows.map((row) => [row.entity_type, Number(row.count)]));
  return { affected_entities: Object.values(byType).reduce((sum, count) => sum + count, 0), by_type: byType };
}

async function addTimeline(queryable, incident, entryType, message, actor = {}) {
  await queryable.query(
    `INSERT INTO billing_incident_timeline
       (incident_id, client_id, entry_type, message, actor_type, actor_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [incident.id, incident.client_id, entryType, text(message, 4000), actor.type || 'system', actor.id || null,
      JSON.stringify(actor.metadata || {})]
  );
}

async function insertRecommendations(queryable, incident, recommendations) {
  for (const item of recommendations) {
    await queryable.query(
      `INSERT INTO billing_incident_recommendations
         (id, incident_id, client_id, action_type, risk_level, title, rationale, steps, approval_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,TRUE)
       ON CONFLICT (incident_id, action_type) DO NOTHING`,
      [crypto.randomUUID(), incident.id, incident.client_id, item.action_type, item.risk_level,
        item.title, item.rationale, JSON.stringify(item.steps)]
    );
  }
}

async function correlateEvent(queryable, event, classification) {
  const existing = await queryable.query(
    `SELECT * FROM billing_incidents
     WHERE client_id = $1 AND incident_key = $2 AND status NOT IN ('resolved','closed')
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [event.client_id, classification.incident_key]
  );
  let incident = existing.rows[0];
  let opened = false;
  if (!incident) {
    const impact = await cal×Nw¶‰ËkºwµçM½±Ù•œ°±…ÍÍ¥™¥…Ñ¥½¸¹ÍÕµµ…Éä°ì(€€€€€µ•Ñ…‘…Ñ„èì•Ù•¹Ñ}¥è•Ù•¹Ğ¹¥°ÉÕ±•}¥è±…ÍÍ¥™¥…Ñ¥½¸¹ÉÕ±•}¥ô°(€€€ô¤ì(€ô(€É•ÑÕÉ¸¥¹¥‘•¹Ğì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•Ù…±Õ…Ñ•Ù•¹Ğ¡ÅÕ•Éå…‰±”°•Ù•¹Ğ¤ì(€½¹ÍĞ±…ÍÍ¥™¥…Ñ¥½¸€ô±…ÍÍ¥™å%¹¥‘•¹ÑÙ•¹Ğ¡•Ù•¹Ğ¤ì(€ÑÉäì(€€€±•Ğ¥¹¥‘•¹Ğ€ô¹Õ±°ì(€€€±•Ğ½Á•¹•€ô™…±Í”ì(€€€¥˜€¡±…ÍÍ¥™¥…Ñ¥½¸¹É•ÍÕ±Ğ€ôôô€½ÉÉ•±…Ñ•œ¤ì(€€€€€€¡ì¥¹¥‘•¹Ğ°½Á•¹•ô€ô…İ…¥Ğ½ÉÉ•±…Ñ•Ù•¹Ğ¡ÅÕ•Éå…‰±”°•Ù•¹Ğ°±…ÍÍ¥™¥…Ñ¥½¸¤¤ì(€€€ô•±Í”¥˜€¡±…ÍÍ¥™¥…Ñ¥½¸¹É•ÍÕ±Ğ€ôôô€É•Í½±Ù•œ¤ì(€€€€€¥¹¥‘•¹Ğ€ô…İ…¥ĞÉ•Í½±Ù•É½µÙ•¹Ğ¡ÅÕ•Éå…‰±”°•Ù•¹Ğ°±…ÍÍ¥™¥…Ñ¥½¸¤ì(€€€ô(€€€…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€%9MIP%9Q<‰¥±±¥¹}¥¹¥‘•¹Ñ}•Ù•¹Ñ}•Ù…±Õ…Ñ¥½¹Ì(€€€€€€€€€¡•Ù•¹Ñ}¥°±¥•¹Ñ}¥°É•ÍÕ±Ğ°¥¹¥‘•¹Ñ}¥°ÉÕ±•}¥¤(€€€€€€Y1UL€ Ä°È°Ì°Ğ°Ô¤=8=91%P€¡•Ù•¹Ñ}¥°±¥•¹Ñ}¥¤<9=Q!%9€°(€€€€€m•Ù•¹Ğ¹¥°•Ù•¹Ğ¹±¥•¹Ñ}¥°¥¹¥‘•¹Ğ€ü±…ÍÍ¥™¥…Ñ¥½¸¹É•ÍÕ±Ğ€è€¥¹½É•œ°¥¹¥‘•¹Ğü¹¥ñğ¹Õ±°°(€€€€€€€±…ÍÍ¥™¥…Ñ¥½¸¹ÉÕ±•}¥ñğ¹Õ±±t(€€€€¤ì(€€€É•ÑÕÉ¸ì±…ÍÍ¥™¥…Ñ¥½¸°¥¹¥‘•¹Ğ°½Á•¹•ôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€%9MIP%9Q<‰¥±±¥¹}¥¹¥‘•¹Ñ}•Ù•¹Ñ}•Ù…±Õ…Ñ¥½¹Ì(€€€€€€€€€¡•Ù•¹Ñ}¥°±¥•¹Ñ}¥°É•ÍÕ±Ğ°ÉÕ±•}¥°•ÉÉ½È¤(€€€€€€Y1UL€ Ä°È°™…¥±•œ°Ì°Ğ¤(€€€€€€=8=91%P€¡•Ù•¹Ñ}¥°±¥•¹Ñ}¥¤<UAQMPÉ•ÍÕ±Ğô™…¥±•œ°(€€€€€€€€…ÑÑ•µÁÑÌõ‰¥±±¥¹}¥¹¥‘•¹Ñ}•Ù•¹Ñ}•Ù…±Õ…Ñ¥½¹Ì¹…ÑÑ•µÁÑÌ¬Ä°(€€€€€€€€¹•áÑ}É•ÑÉå}…Ğõ9=\ ¤­%9QIY0€œÄµ¥¹ÕÑ”œ°•ÉÉ½Èõa1U¹•ÉÉ½È°•Ù…±Õ…Ñ•‘}…Ğõ9=\ ¥€°(€€€€€m•Ù•¹Ğ¹¥°•Ù•¹Ğ¹±¥•¹Ñ}¥°±…ÍÍ¥™¥…Ñ¥½¸¹ÉÕ±•}¥ñğ¹Õ±°°Ñ•áĞ¡•ÉÉ½È¹µ•ÍÍ…”°€ÈÀÀÀ¥t(€€€€¤ì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸•µ¥Ñ%¹¥‘•¹ÑÙ•¹Ğ¡É•ÍÕ±Ğ°Í½ÕÉ•Ù•¹Ğ¤ì(€¥˜€ …É•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¤É•ÑÕÉ¸ì(€½¹ÍĞ•Ù•¹ÑQåÁ”€ôÉ•ÍÕ±Ğ¹±…ÍÍ¥™¥…Ñ¥½¸¹É•ÍÕ±Ğ€ôôô€É•Í½±Ù•œ(€€€€ü€¥¹¥‘•¹Ğ¹É•Í½±Ù•œ€è€¡É•ÍÕ±Ğ¹½Á•¹•€ü€¥¹¥‘•¹Ğ¹½Á•¹•œ€è€¥¹¥‘•¹Ğ¹Í¥¹…±}½ÉÉ•±…Ñ•œ¤ì(€…İ…¥ĞÉ•½É‘	¥±±¥¹Ù•¹Ğ¡ì(€€€±¥•¹Ñ%èÍ½ÕÉ•Ù•¹Ğ¹±¥•¹Ñ}¥°(€€€•Ù•¹ÑQåÁ”°(€€€…Ñ•½Éäè€¥¹¥‘•¹Ğœ°(€€€Í½ÕÉ”è€¥¹¥‘•¹Ñ}½µµ…¹‘•Èœ°(€€€•¹Ñ¥ÑåQåÁ”è€¥¹¥‘•¹Ğœ°(€€€•¹Ñ¥Ñå%èÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹¥°(€€€…Ñ½ÉQåÁ”è€ÍåÍÑ•´œ°(€€€Í•Ù•É¥Ñäè•Ù•¹ÑQåÁ”€ôôô€¥¹¥‘•¹Ğ¹É•Í½±Ù•œ€ü€¥¹™¼œ€èÍ½ÕÉ•Ù•¹Ğ¹Í•Ù•É¥Ñä°(€€€Ñ¥Ñ±”èÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹Ñ¥Ñ±”°(€€€‘•ÍÉ¥ÁÑ¥½¸èÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹ÍÕµµ…Éä°(€€€Á…å±½…èìÍÑ…ÑÕÌèÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹ÍÑ…ÑÕÌ°…Ñ•½ÉäèÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹…Ñ•½Éä°(€€€€€Í•Ù•É¥ÑäèÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹Í•Ù•É¥Ñä°•Ù¥‘•¹•}½Õ¹ĞèÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹•Ù¥‘•¹•}½Õ¹Ğô°(€€€É•±…Ñ•‘¹Ñ¥Ñ¥•ÌèÍ½ÕÉ•Ù•¹Ğ¹•¹Ñ¥Ñå}ÑåÁ”€ümì•¹Ñ¥ÑåQåÁ”èÍ½ÕÉ•Ù•¹Ğ¹•¹Ñ¥Ñå}ÑåÁ”°(€€€€€•¹Ñ¥Ñå%èÍ½ÕÉ•Ù•¹Ğ¹•¹Ñ¥Ñå}¥°É•±…Ñ¥½¹Í¡¥Àè€ÑÉ¥•É•‘}‰äœõt€èmt°(€€€½ÉÉ•±…Ñ¥½¹%èÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹¥°(€€€…ÕÍ…Ñ¥½¹%èÍ½ÕÉ•Ù•¹Ğ¹¥°(€€€‘•‘ÕÁ±¥…Ñ¥½¹-•äè¥¹¥‘•¹Ğè‘íÉ•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¹¥‘ôè‘íÍ½ÕÉ•Ù•¹Ğ¹¥‘ôè‘í•Ù•¹ÑQåÁ•õ€°(€€€Í•¹Í¥Ñ¥Ù¥Ñäè€¥¹Ñ•É¹…°œ°(€ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÁÉ½•ÍÍ%¹¥‘•¹Ñ	…Ñ ¡±¥µ¥Ğ€ô€ÄÀÀ¤ì(€…İ…¥Ğ•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„ ¤ì(€½¹ÍĞ±½­±¥•¹Ğ€ô…İ…¥Ğ‘ˆ¹½¹¹•Ğ ¤ì(€ÑÉäì(€€€½¹ÍĞ±½¬€ô…İ…¥Ğ±½­±¥•¹Ğ¹ÅÕ•Éä ‰M1PÁ}ÑÉå}…‘Ù¥Í½Éå}±½¬¡¡…Í¡Ñ•áĞ ¹•á„é¥¹¥‘•¹Ğµ½µµ…¹‘•Èœ¤¤L…ÅÕ¥É•ˆ¤ì(€€€¥˜€ …±½¬¹É½İÍlÁtü¹…ÅÕ¥É•¤É•ÑÕÉ¸ìÍ­¥ÁÁ•èÑÉÕ”°ÁÉ½•ÍÍ•è€Àôì(€€€ÑÉäì(€€€€€½¹ÍĞ•Ù•¹ÑÌ€ô…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€€€€€M1P•Ù•¹Ğ¸¨I=4‰¥±±¥¹}•Ù•¹ÑÌ•Ù•¹Ğ(€€€€€€€€1P)=%8‰¥±±¥¹}¥¹¥‘•¹Ñ}•Ù•¹Ñ}•Ù…±Õ…Ñ¥½¹Ì•Ù…±Õ…Ñ¥½¸(€€€€€€€€€€=8•Ù…±Õ…Ñ¥½¸¹•Ù•¹Ñ}¥€ô•Ù•¹Ğ¹¥9•Ù…±Õ…Ñ¥½¸¹±¥•¹Ñ}¥€ô•Ù•¹Ğ¹±¥•¹Ñ}¥(€€€€€€€€]!I•Ù…±Õ…Ñ¥½¸¹•Ù•¹Ñ}¥%L9U10(€€€€€€€€€€€=H€¡•Ù…±Õ…Ñ¥½¸¹É•ÍÕ±Ğô™…¥±•œ9•Ù…±Õ…Ñ¥½¸¹…ÑÑ•µÁÑÌ€ğ€Ô(€€€€€€€€€€€€€9=1M¡•Ù…±Õ…Ñ¥½¸¹¹•áÑ}É•ÑÉå}…Ğ°9=\ ¤¤€ğô9=\ ¤¤(€€€€€€€€=IH	d•Ù•¹Ğ¹É•½É‘•‘}…ĞM°•Ù•¹Ğ¹¥M1%5%P€Å€°(€€€€€€€m5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸¡9Õµ‰•È¡±¥µ¥Ğ¤ñğ€ÄÀÀ°€ÔÀÀ¤¥t(€€€€€€¤ì(€€€€€½¹ÍĞ½Õ¹ÑÌ€ôìÁÉ½•ÍÍ•è€À°½Á•¹•è€À°½ÉÉ•±…Ñ•è€À°É•Í½±Ù•è€À°¥¹½É•è€À°™…¥±•è€Àôì(€€€€€™½È€¡½¹ÍĞ•Ù•¹Ğ½˜•Ù•¹ÑÌ¹É½İÌ¤ì(€€€€€€€½¹ÍĞ±¥•¹Ğ€ô…İ…¥Ğ‘ˆ¹½¹¹•Ğ ¤ì(€€€€€€€ÑÉäì(€€€€€€€€€…İ…¥Ğ±¥•¹Ğ¹ÅÕ•Éä 	%8œ¤ì(€€€€€€€€€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥Ğ•Ù…±Õ…Ñ•Ù•¹Ğ¡±¥•¹Ğ°•Ù•¹Ğ¤ì(€€€€€€€€€…İ…¥Ğ±¥•¹Ğ¹ÅÕ•Éä =55%Pœ¤ì(€€€€€€€€€½Õ¹ÑÌ¹ÁÉ½•ÍÍ•€¬ô€Äì(€€€€€€€€€¥˜€ …É•ÍÕ±Ğ¹¥¹¥‘•¹Ğ¤½Õ¹ÑÌ¹¥¹½É•€¬ô€Äì(€€€€€€€€€•±Í”¥˜€¡É•ÍÕ±Ğ¹±…ÍÍ¥™¥…Ñ¥½¸¹É•ÍÕ±Ğ€ôôô€É•Í½±Ù•œ¤½Õ¹ÑÌ¹É•Í½±Ù•€¬ô€Äì(€€€€€€€€€•±Í”¥˜€¡É•ÍÕ±Ğ¹½Á•¹•¤½Õ¹ÑÌ¹½Á•¹•€¬ô€Äì(€€€€€€€€€•±Í”½Õ¹ÑÌ¹½ÉÉ•±…Ñ•€¬ô€Äì(€€€€€€€€€…İ…¥Ğ•µ¥Ñ%¹¥‘•¹ÑÙ•¹Ğ¡É•ÍÕ±Ğ°•Ù•¹Ğ¤¹…Ñ  ¡•ÉÉ½È¤€ôø(€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ½Õ±¹½Ğ•µ¥Ğ¥¹¥‘•¹Ğ•Ù•¹Ğèœ°•ÉÉ½È¹µ•ÍÍ…”¤¤ì(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€ÑÉäì…İ…¥Ğ±¥•¹Ğ¹ÅÕ•Éä I=11	,œ¤ìô…Ñ €¡|¤ì€¼¨¹¼ÑÉ…¹Í…Ñ¥½¸€¨¼ô(€€€€€€€€€½Õ¹ÑÌ¹™…¥±•€¬ô€Äì(€€€€€€€ô™¥¹…±±äì(€€€€€€€€€±¥•¹Ğ¹É•±•…Í” ¤ì(€€€€€€€ô(€€€€€ô(€€€€€É•ÑÕÉ¸½Õ¹ÑÌì(€€€ô™¥¹…±±äì(€€€€€…İ…¥Ğ±½­±¥•¹Ğ¹ÅÕ•Éä ‰M1PÁ}…‘Ù¥Í½Éå}Õ¹±½¬¡¡…Í¡Ñ•áĞ ¹•á„é¥¹¥‘•¹Ğµ½µµ…¹‘•Èœ¤¤ˆ¤ì(€€€ô(€ô™¥¹…±±äì(€€€±½­±¥•¹Ğ¹É•±•…Í” ¤ì(€ô)ô()™Õ¹Ñ¥½¸‰Õ¥±‘½µµ…¹‘	É¥•˜¡¥¹¥‘•¹Ğ¤ì(€½¹ÍĞ¥µÁ…Ñ•€ô9Õµ‰•È¡¥¹¥‘•¹Ğ¹¥µÁ…Ğü¹…™™•Ñ•‘}•¹Ñ¥Ñ¥•Ìñğ€À¤ì(€½¹ÍĞÍ½Á”€ô¥µÁ…Ñ•€ü€‘í¥µÁ…Ñ•‘ô‘¥É•Ñ±ä½¹¹•Ñ•€‘í¥µÁ…Ñ•€ôôô€Ä€ü€•¹Ñ¥Ñäœ€è€•¹Ñ¥Ñ¥•Ìôµ…ä‰”…™™•Ñ•‘€€è€9¼‘½İ¹ÍÑÉ•…´¥µÁ…Ğ¥Ì½¹™¥Éµ•å•Ğœì(€½¹ÍĞÍÑ…Ñ”€ô¥¹¥‘•¹Ğ¹ÍÑ…ÑÕÌ€ôôô€É•Í½±Ù•œ(€€€€ü€Q¡”É•½Ù•ÉäÍ¥¹…°¡…Ì‰••¸É•½É‘•…¹Ñ¡”¥¹¥‘•¹Ğ¥ÌÉ•Í½±Ù•¸œ(€€€€èQ¡”¥¹¥‘•¹Ğ¥Ì€‘í¥¹¥‘•¹Ğ¹ÍÑ…ÑÕÍôì9•á„É•µ…¥¹Ì¥¸…‘Ù¥Í½Éäµ½‘”¹€ì(€É•ÑÕÉ¸€‘í¥¹¥‘•¹Ğ¹Ñ¥Ñ±•ô¸€‘í¥¹¥‘•¹Ğ¹ÍÕµµ…Éåô€‘íÍ½Á•ô¸€‘íÍÑ…Ñ•õ€ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±¥ÍÑ%¹¥‘•¹ÑÌ¡±¥•¹Ñ%°½ÁÑ¥½¹Ì€ôíô°ÅÕ•Éå…‰±”€ô‘ˆ¤ì(€…İ…¥Ğ•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞÍÑ…ÑÕÍ•Ì€ôÑ•áĞ¡½ÁÑ¥½¹Ì¹ÍÑ…ÑÕÌ°€ÄÈÀ¤¹ÍÁ±¥Ğ œ°œ¤¹™¥±Ñ•È ¡Ù…±Õ”¤€ôøQ%Y}MQQUML¹¡…Ì¡Ù…±Õ”¤ñğlÉ•Í½±Ù•œ°±½Í•t¹¥¹±Õ‘•Ì¡Ù…±Õ”¤¤ì(€½¹ÍĞ±¥µ¥Ğ€ô5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸¡9Õµ‰•È¡½ÁÑ¥½¹Ì¹±¥µ¥Ğ¤ñğ€ÄÀÀ°€ÔÀÀ¤¤ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€M1P¥¹¥‘•¹Ğ¸¨°(€€€€€€€¡M1P=U9P ¨¤èé¥¹ĞI=4‰¥±±¥¹}¥¹¥‘•¹Ñ}É•½µµ•¹‘…Ñ¥½¹ÌÉ•½µµ•¹‘…Ñ¥½¸(€€€€€€€]!IÉ•½µµ•¹‘…Ñ¥½¸¹¥¹¥‘•¹Ñ}¥€ô¥¹¥‘•¹Ğ¹¥9É•½µµ•¹‘…Ñ¥½¸¹ÍÑ…ÑÕÌ€ô€ÁÉ½Á½Í•œ¤LÁÉ½Á½Í•‘}…Ñ¥½¹Ì(€€€€I=4‰¥±±¥¹}¥¹¥‘•¹ÑÌ¥¹¥‘•¹Ğ]!I¥¹¥‘•¹Ğ¹±¥•¹Ñ}¥€ô€Ä(€€€€€€9€¡…É‘¥¹…±¥Ñä ÈèéÑ•áÑmt¤€ô€À=H¥¹¥‘•¹Ğ¹ÍÑ…ÑÕÌ€ô9d ÈèéÑ•áÑmt¤¤(€€€€€€9€ ÌèéÑ•áĞ%L9U10=H¥¹¥‘•¹Ğ¹Í•Ù•É¥Ñä€ô€Ì¤(€€€€=IH	dM¥¹¥‘•¹Ğ¹Í•Ù•É¥Ñä]!8€É¥Ñ¥…°œQ!8€Ğ]!8€¡¥ œQ!8€Ì]!8€µ•‘¥Õ´œQ!8€È1M€Ä9M°(€€€€€€¥¹¥‘•¹Ğ¹±…ÍÑ}Í¥¹…±}…ĞM1%5%P€Ñ€°(€€€m±¥•¹Ñ%°ÍÑ…ÑÕÍ•Ì°Ñ•áĞ¡½ÁÑ¥½¹Ì¹Í•Ù•É¥Ñä°€ÈÀ¤ñğ¹Õ±°°±¥µ¥Ñt(€€¤ì(€É•ÑÕÉ¸É•ÍÕ±Ğ¹É½İÌ¹µ…À ¡¥¹¥‘•¹Ğ¤€ôø€¡ì€¸¸¹¥¹¥‘•¹Ğ°‰É¥•˜è‰Õ¥±‘½µµ…¹‘	É¥•˜¡¥¹¥‘•¹Ğ¤ô¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•Ñ%¹¥‘•¹Ğ¡±¥•¹Ñ%°¥¹¥‘•¹Ñ%°ÅÕ•Éå…‰±”€ô‘ˆ¤ì(€…İ…¥Ğ•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞ¥¹¥‘•¹Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä M1P€¨I=4‰¥±±¥¹}¥¹¥‘•¹ÑÌ]!I±¥•¹Ñ}¥ôÄ9¥ôÈ1%5%P€Äœ°m±¥•¹Ñ%°¥¹¥‘•¹Ñ%‘t¤ì(€¥˜€ …¥¹¥‘•¹Ğ¹É½İÍlÁt¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍĞÑ¥µ•±¥¹”€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä M1P€¨I=4‰¥±±¥¹}¥¹¥‘•¹Ñ}Ñ¥µ•±¥¹”]!I±¥•¹Ñ}¥ôÄ9¥¹¥‘•¹Ñ}¥ôÈ=IH	dÉ•…Ñ•‘}…ĞMœ°m±¥•¹Ñ%°¥¹¥‘•¹Ñ%‘t¤ì(€½¹ÍĞ•Ù¥‘•¹”€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä¡M1P•Ù•¹Ğ¹¥°•Ù•¹Ğ¹•Ù•¹Ñ}ÑåÁ”°•Ù•¹Ğ¹•Ù•¹Ñ}…Ñ•½Éä°•Ù•¹Ğ¹Í½ÕÉ”°•Ù•¹Ğ¹Í•Ù•É¥Ñä°(€€€€€•Ù•¹Ğ¹Ñ¥Ñ±”°•Ù•¹Ğ¹‘•ÍÉ¥ÁÑ¥½¸°•Ù•¹Ğ¹•¹Ñ¥Ñå}ÑåÁ”°•Ù•¹Ğ¹•¹Ñ¥Ñå}¥°•Ù•¹Ğ¹½ÕÉÉ•‘}…Ğ°±¥¹¬¹É•±…Ñ¥½¹Í¡¥À(€€€€€I=4‰¥±±¥¹}¥¹¥‘•¹Ñ}•Ù•¹ÑÌ±¥¹¬)=%8‰¥±±¥¹}•Ù•¹ÑÌ•Ù•¹Ğ(€€€€€€€=8•Ù•¹Ğ¹¥õ±¥¹¬¹•Ù•¹Ñ}¥9•Ù•¹Ğ¹±¥•¹Ñ}¥õ±¥¹¬¹±¥•¹Ñ}¥(€€€€€]!I±¥¹¬¹±¥•¹Ñ}¥ôÄ9±¥¹¬¹¥¹¥‘•¹Ñ}¥ôÈ=IH	d•Ù•¹Ğ¹½ÕÉÉ•‘}…ĞM€°m±¥•¹Ñ%°¥¹¥‘•¹Ñ%‘t¤ì(€½¹ÍĞÉ•½µµ•¹‘…Ñ¥½¹Ì€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä M1P€¨I=4‰¥±±¥¹}¥¹¥‘•¹Ñ}É•½µµ•¹‘…Ñ¥½¹Ì]!I±¥•¹Ñ}¥ôÄ9¥¹¥‘•¹Ñ}¥ôÈ=IH	dÉ•…Ñ•‘}…ĞMœ°m±¥•¹Ñ%°¥¹¥‘•¹Ñ%‘t¤ì(€½¹ÍĞ…ÁÁÉ½Ù…±Ì€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä M1P€¨I=4‰¥±±¥¹}¥¹¥‘•¹Ñ}…ÁÁÉ½Ù…±Ì]!I±¥•¹Ñ}¥ôÄ9¥¹¥‘•¹Ñ}¥ôÈ=IH	dÉ•…Ñ•‘}…ĞMœ°m±¥•¹Ñ%°¥¹¥‘•¹Ñ%‘t¤ì(€É•ÑÕÉ¸ì€¸¸¹¥¹¥‘•¹Ğ¹É½İÍlÁt°‰É¥•˜è‰Õ¥±‘½µµ…¹‘	É¥•˜¡¥¹¥‘•¹Ğ¹É½İÍlÁt¤°Ñ¥µ•±¥¹”èÑ¥µ•±¥¹”¹É½İÌ°(€€€•Ù¥‘•¹”è•Ù¥‘•¹”¹É½İÌ°É•½µµ•¹‘…Ñ¥½¹ÌèÉ•½µµ•¹‘…Ñ¥½¹Ì¹É½İÌ°…ÁÁÉ½Ù…±Ìè…ÁÁÉ½Ù…±Ì¹É½İÌôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•Ñ%¹¥‘•¹Ñ=Ù•ÉÙ¥•Ü¡±¥•¹Ñ%°ÅÕ•Éå…‰±”€ô‘ˆ¤ì(€…İ…¥Ğ•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€M1P=U9P ¨¤%1QH€¡]!IÍÑ…ÑÕÌ9=P%8€ É•Í½±Ù•œ°±½Í•œ¤¤èé¥¹ĞL…Ñ¥Ù”°(€€€€€€=U9P ¨¤%1QH€¡]!IÍÑ…ÑÕÌ9=P%8€ É•Í½±Ù•œ°±½Í•œ¤9Í•Ù•É¥ÑäôÉ¥Ñ¥…°œ¤èé¥¹ĞLÉ¥Ñ¥…°°(€€€€€€=U9P ¨¤%1QH€¡]!IÍÑ…ÑÕÌôÉ•Í½±Ù•œ9É•Í½±Ù•‘}…Ğ€øô9=\ ¤µ%9QIY0€œÈĞ¡½ÕÉÌœ¤èé¥¹ĞLÉ•Í½±Ù•‘|ÈÑ °(€€€€€€=1M¡Y¡aQIP¡A= I=4€¡É•Í½±Ù•‘}…Ğµ™¥ÉÍÑ}‘•Ñ•Ñ•‘}…Ğ¤¤¼ØÀ¤(€€€€€€€€%1QH€¡]!IÉ•Í½±Ù•‘}…Ğ%L9=P9U109É•Í½±Ù•‘}…Ğ€øô9=\ ¤µ%9QIY0€œÌÀ‘…åÌœ¤°À¤èé¹Õµ•É¥Œ ÄÈ°È¤LµÑÑÉ}µ¥¹ÕÑ•Ì(€€€€I=4‰¥±±¥¹}¥¹¥‘•¹ÑÌ]!I±¥•¹Ñ}¥ôÅ€°m±¥•¹Ñ%‘t(€€¤ì(€É•ÑÕÉ¸ì€¸¸¹É•ÍÕ±Ğ¹É½İÍlÁt°µ½‘”è€…‘Ù¥Í½Éäœ°…ÕÑ½µ…Ñ¥}•á•ÕÑ¥½¸è™…±Í”ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‰Õ¥±‘%¹¥‘•¹Ñ½¹Ñ•áĞ¡±¥•¹Ñ%°ÅÕ•ÍÑ¥½¸€ô€œœ°½ÁÑ¥½¹Ì€ôíô¤ì(€…İ…¥Ğ•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„ ¤ì(€½¹ÍĞ±¥µ¥Ğ€ô5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸¡9Õµ‰•È¡½ÁÑ¥½¹Ì¹±¥µ¥Ğ¤ñğ€ÄÀ°€ÈÔ¤¤ì(€½¹ÍĞÑ•ÉµÌ€ôÑ•áĞ¡ÅÕ•ÍÑ¥½¸°€ÔÀÀ¤¹Ñ½1½İ•É…Í” ¤¹ÍÁ±¥Ğ ½my„µèÀ´åt¬¼¤¹™¥±Ñ•È ¡Ñ•É´¤€ôøÑ•É´¹±•¹Ñ €ø€È¤¹Í±¥” À°€à¤ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥Ğ‘ˆ¹ÅÕ•Éä (€€€M1P¥°Ñ¥Ñ±”°ÍÕµµ…Éä°…Ñ•½Éä°Í•Ù•É¥Ñä°ÍÑ…ÑÕÌ°½¹™¥‘•¹”°¥µÁ…Ğ°(€€€€€€€€€€€ÁÉ¥µ…Éå}•¹Ñ¥Ñå}ÑåÁ”°ÁÉ¥µ…Éå}•¹Ñ¥Ñå}¥°•Ù¥‘•¹•}½Õ¹Ğ°(€€€€€€€€€€€™¥ÉÍÑ}‘•Ñ•Ñ•‘}…Ğ°±…ÍÑ}Í¥¹…±}…Ğ°É•Í½±Ù•‘}…Ğ(€€€€I=4‰¥±±¥¹}¥¹¥‘•¹ÑÌ]!I±¥•¹Ñ}¥ôÄ(€€€€€€9€¡ÍÑ…ÑÕÌ9=P%8€ É•Í½±Ù•œ°±½Í•œ¤=H±…ÍÑ}Í¥¹…±}…Ğ€øô9=\ ¤µ%9QIY0€œÜ‘…åÌœ¤(€€€€€€9€¡…É‘¥¹…±¥Ñä ÈèéÑ•áÑmt¤€ô€À=Ha%MQL€ (€€€€€€€€M1P€ÄI=4Õ¹¹•ÍĞ ÈèéÑ•áÑmt¤Ñ•É´(€€€€€€€€]!I±½İ•È¡Ñ¥Ñ±”ñğ€œ€œñğÍÕµµ…Éäñğ€œ€œñğ…Ñ•½Éäñğ€œ€œñğ=1M¡ÁÉ¥µ…Éå}•¹Ñ¥Ñå}ÑåÁ”°œœ¤ñğ€œ€œñğ=1M¡ÁÉ¥µ…Éå}•¹Ñ¥Ñå}¥°œœ¤¤1%-€œ”œñğÑ•É´ñğ€œ”œ(€€€€€€€¤¤(€€€€=IH	d€¡ÍÑ…ÑÕÌ9=P%8€ É•Í½±Ù•œ°±½Í•œ¤¤M°(€€€€€€MÍ•Ù•É¥Ñä]!8€É¥Ñ¥…°œQ!8€Ğ]!8€¡¥ œQ!8€Ì]!8€µ•‘¥Õ´œQ!8€È1M€Ä9M°(€€€€€€±…ÍÑ}Í¥¹…±}…ĞM1%5%P€Í€°(€€€m±¥•¹Ñ%°Ñ•ÉµÌ°±¥µ¥Ñt(€€¤ì(€É•ÑÕÉ¸ì(€€€½¹Ñ•áĞèÉ•ÍÕ±Ğ¹É½İÌ¹µ…À ¡¥¹¥‘•¹Ğ¤€ôøl(€€€€€%¹¥‘•¹Ğ€‘í¥¹¥‘•¹Ğ¹¥‘ôè€‘í¥¹¥‘•¹Ğ¹Ñ¥Ñ±•õ€°(€€€€€MÑ…ÑÕÌ€‘í¥¹¥‘•¹Ğ¹ÍÑ…ÑÕÍôìÍ•Ù•É¥Ñä€‘í¥¹¥‘•¹Ğ¹Í•Ù•É¥Ñåôì…Ñ•½Éä€‘í¥¹¥‘•¹Ğ¹…Ñ•½Éåôì½¹™¥‘•¹”€‘í¥¹¥‘•¹Ğ¹½¹™¥‘•¹•ô”¹€°(€€€€€MÕµµ…Éäè€‘í¥¹¥‘•¹Ğ¹ÍÕµµ…Éåõ€°(€€€€€%µÁ…Ğè€‘í)M=8¹ÍÑÉ¥¹¥™ä¡¥¹¥‘•¹Ğ¹¥µÁ…Ğñğíô¥ôì•Ù¥‘•¹”Í¥¹…±Ìè€‘í¥¹¥‘•¹Ğ¹•Ù¥‘•¹•}½Õ¹Ñôì±…ÍĞÍ¥¹…°è€‘í¥¹¥‘•¹Ğ¹±…ÍÑ}Í¥¹…±}…Ñô¹€°(€€€t¹©½¥¸ q¸œ¤¤¹©½¥¸ q¹q¸œ¤°(€€€Í½ÕÉ•ÌèÉ•ÍÕ±Ğ¹É½İÌ¹µ…À ¡¥¹¥‘•¹Ğ¤€ôø€¡ìÑåÁ”è€¥¹¥‘•¹Ğœ°¥è¥¹¥‘•¹Ğ¹¥°(€€€€€ÍÑ…ÑÕÌè¥¹¥‘•¹Ğ¹ÍÑ…ÑÕÌ°±…ÍÑ}Í¥¹…±}…Ğè¥¹¥‘•¹Ğ¹±…ÍÑ}Í¥¹…±}…Ğô¤¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÑÉ…¹Í¥Ñ¥½¹%¹¥‘•¹Ğ¡±¥•¹Ñ%°¥¹¥‘•¹Ñ%°ÍÑ…ÑÕÌ°…Ñ½È€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô…Ñ½È¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞÕÉÉ•¹Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä M1P€¨I=4‰¥±±¥¹}¥¹¥‘•¹ÑÌ]!I±¥•¹Ñ}¥ôÄ9¥ôÈ1%5%P€Äœ°m±¥•¹Ñ%°¥¹¥‘•¹Ñ%‘t¤ì(€¥˜€ …ÕÉÉ•¹Ğ¹É½İÍlÁt¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍĞ¹•áĞ€ôÑ•áĞ¡ÍÑ…ÑÕÌ°€ÈĞ¤¹Ñ½1½İ•É…Í” ¤ì(€¥˜€ …MQQUM}QI9M%Q%=9MmÕÉÉ•¹Ğ¹É½İÍlÁt¹ÍÑ…ÑÕÍtü¹¡…Ì¡¹•áĞ¤¤Ñ¡É½Ü¹•ÜÉÉ½È¡…¹¹½Ğµ½Ù”¥¹¥‘•¹Ğ™É½´€‘íÕÉÉ•¹Ğ¹É½İÍlÁt¹ÍÑ…ÑÕÍôÑ¼€‘í¹•áÑõ€¤ì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€UAQ‰¥±±¥¹}¥¹¥‘•¹ÑÌMPÍÑ…ÑÕÌôÌèéÙ…É¡…È°(€€€€€€…­¹½İ±•‘•‘}…ĞõM]!8€ÌèéÑ•áĞô¥¹Ù•ÍÑ¥…Ñ¥¹œœ9…­¹½İ±•‘•‘}…Ğ%L9U10Q!89=\ ¤1M…­¹½İ±•‘•‘}…Ğ9°(€€€€€€…­¹½İ±•‘•‘}‰äõM]!8€ÌèéÑ•áĞô¥¹Ù•ÍÑ¥…Ñ¥¹œœ9…­¹½İ±•‘•‘}‰ä%L9U10Q!8€Ğ1M…­¹½İ±•‘•‘}‰ä9°(€€€€€€É•Í½±Ù•‘}…ĞõM]!8€ÌèéÑ•áĞôÉ•Í½±Ù•œQ!89=\ ¤]!8€ÌèéÑ•áĞô¥¹Ù•ÍÑ¥…Ñ¥¹œœQ!89U101MÉ•Í½±Ù•‘}…Ğ9°(€€€€€€±½Í•‘}…ĞõM]!8€ÌèéÑ•áĞô±½Í•œQ!89=\ ¤1M±½Í•‘}…Ğ9°ÕÁ‘…Ñ•‘}…Ğõ9=\ ¤(€€€€]!I±¥•¹Ñ}¥ôÄ9¥ôÈIQUI9%9€©€°m±¥•¹Ñ%°¥¹¥‘•¹Ñ%°¹•áĞ°…Ñ½È¹…‘µ¥¹%ñğ¹Õ±±t(€€¤ì(€…İ…¥Ğ…‘‘Q¥µ•±¥¹”¡ÅÕ•Éå…‰±”°É•ÍÕ±Ğ¹É½İÍlÁt°€ÍÑ…ÑÕÍ}¡…¹•œ°%¹¥‘•¹Ğµ½Ù•Ñ¼€‘í¹•áÑô¹€°ìÑåÁ”è€…‘µ¥¸œ°¥è…Ñ½È¹…‘µ¥¹%ô¤ì(€É•ÑÕÉ¸É•ÍÕ±Ğ¹É½İÍlÁtì)ô()…Íå¹Œ™Õ¹Ñ¥½¸…‘‘%¹¥‘•¹Ñ9½Ñ”¡±¥•¹Ñ%°¥¹¥‘•¹Ñ%°µ•ÍÍ…”°…Ñ½È€ôíô¤ì(€½¹ÍĞÅÕ•Éå…‰±”€ô…Ñ½È¹ÅÕ•Éå…‰±”ñğ‘ˆì(€…İ…¥Ğ•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞ¥¹¥‘•¹Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä M1P€¨I=4‰¥±±¥¹}¥¹¥‘•¹ÑÌ]!I±¥•¹Ñ}¥ôÄ9¥ôÈ1%5%P€Äœ°m±¥•¹Ñ%°¥¹¥‘•¹Ñ%‘t¤ì(€¥˜€ …¥¹¥‘•¹Ğ¹É½İÍlÁt¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍĞ¹½Ñ”€ôÑ•áĞ¡µ•ÍÍ…”°€ĞÀÀÀ¤ì(€¥˜€ …¹½Ñ”¤Ñ¡É½Ü¹•ÜÉÉ½È 9½Ñ”¥ÌÉ•ÅÕ¥É•œ¤ì(€…İ…¥Ğ…‘‘Q¥µ•±¥¹”¡ÅÕ•Éå…‰±”°¥¹¥‘•¹Ğ¹É½İÍlÁt°€¹½Ñ”œ°¹½Ñ”°ìÑåÁ”è€…‘µ¥¸œ°¥è…Ñ½È¹…‘µ¥¹%ô¤ì(€É•ÑÕÉ¸•Ñ%¹¥‘•¹Ğ¡±¥•¹Ñ%°¥¹¥‘•¹Ñ%°ÅÕ•Éå…‰±”¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘•¥‘•I•½µµ•¹‘…Ñ¥½¸¡±¥•¹Ñ%°É•½µµ•¹‘…Ñ¥½¹%°‘•¥Í¥½¸°…Ñ½È€ôíô¤ì(€½¹ÍĞ•áÑ•É¹…°€ô…Ñ½È¹ÅÕ•Éå…‰±”ñğ¹Õ±°ì(€½¹ÍĞÅÕ•Éå…‰±”€ô•áÑ•É¹…°ñğ…İ…¥Ğ‘ˆ¹½¹¹•Ğ ¤ì(€…İ…¥Ğ•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„¡ÅÕ•Éå…‰±”¤ì(€½¹ÍĞ¹½Éµ…±¥é•€ôÑ•áĞ¡‘•¥Í¥½¸°€ÈÀ¤¹Ñ½1½İ•É…Í” ¤ì(€¥˜€ …l…ÁÁÉ½Ù•œ°É•©•Ñ•t¹¥¹±Õ‘•Ì¡¹½Éµ…±¥é•¤¤Ñ¡É½Ü¹•ÜÉÉ½È •¥Í¥½¸µÕÍĞ‰”…ÁÁÉ½Ù•½ÈÉ•©•Ñ•œ¤ì(€ÑÉäì(€€€¥˜€ …•áÑ•É¹…°¤…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä 	%8œ¤ì(€€€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€UAQ‰¥±±¥¹}¥¹¥‘•¹Ñ}É•½µµ•¹‘…Ñ¥½¹ÌMPÍÑ…ÑÕÌôÌ°ÕÁ‘…Ñ•‘}…Ğõ9=\ ¤(€€€€€€]!I±¥•¹Ñ}¥ôÄ9¥ôÈ9ÍÑ…ÑÕÌôÁÉ½Á½Í•œIQUI9%9€©€°(€€€€€m±¥•¹Ñ%°É•½µµ•¹‘…Ñ¥½¹%°¹½Éµ…±¥é•‘t(€€€€¤ì(€€€¥˜€ …É•ÍÕ±Ğ¹É½İÍlÁt¤ì¥˜€ …•áÑ•É¹…°¤…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä I=11	,œ¤ìÉ•ÑÕÉ¸¹Õ±°ìô(€€€…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä (€€€€€%9MIP%9Q<‰¥±±¥¹}¥¹¥‘•¹Ñ}…ÁÁÉ½Ù…±Ì(€€€€€€€¡¥°¥¹¥‘•¹Ñ}¥°É•½µµ•¹‘…Ñ¥½¹}¥°±¥•¹Ñ}¥°‘•¥Í¥½¸°‘•¥‘•‘}‰ä°É•…Í½¸¤(€€€€€€Y1UL€ Ä°È°Ì°Ğ°Ô°Ø°Ü¥€°(€€€€€mÉåÁÑ¼¹É…¹‘½µUU% ¤°É•ÍÕ±Ğ¹É½İÍlÁt¹¥¹¥‘•¹Ñ}¥°É•½µµ•¹‘…Ñ¥½¹%°±¥•¹Ñ%°(€€€€€€€¹½Éµ…±¥é•°…Ñ½È¹…‘µ¥¹%ñğ¹Õ±°°Ñ•áĞ¡…Ñ½È¹É•…Í½¸°€ÈÀÀÀ¤ñğ¹Õ±±t(€€€€¤ì(€€€…İ…¥Ğ…‘‘Q¥µ•±¥¹”¡ÅÕ•Éå…‰±”°ì¥èÉ•ÍÕ±Ğ¹É½İÍlÁt¹¥¹¥‘•¹Ñ}¥°±¥•¹Ñ}¥è±¥•¹Ñ%ô°€É•½µµ•¹‘…Ñ¥½¹}‘•¥‘•œ°(€€€€€€‘íÉ•ÍÕ±Ğ¹É½İÍlÁt¹Ñ¥Ñ±•ôİ…Ì€‘í¹½Éµ…±¥é•‘ô¸9¼…Ñ¥½¸İ…Ì•á•ÕÑ•¹€°ìÑåÁ”è€…‘µ¥¸œ°¥è…Ñ½È¹…‘µ¥¹%ô¤ì(€€€¥˜€ …•áÑ•É¹…°¤…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä =55%Pœ¤ì(€€€É•ÑÕÉ¸É•ÍÕ±Ğ¹É½İÍlÁtì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€ …•áÑ•É¹…°¤ÑÉäì…İ…¥ĞÅÕ•Éå…‰±”¹ÅÕ•Éä I=11	,œ¤ìô…Ñ €¡|¤ì€¼¨¹¼ÑÉ…¹Í…Ñ¥½¸€¨¼ô(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô™¥¹…±±äì¥˜€ …•áÑ•É¹…°¤ÅÕ•Éå…‰±”¹É•±•…Í” ¤ìô)ô()™Õ¹Ñ¥½¸ÍÑ…ÉÑ%¹¥‘•¹Ñ½µµ…¹‘•ÉM¡•‘Õ±•È ¤ì(€¥˜€¡Í¡•‘Õ±•ÉMÑ…ÉÑ•¤É•ÑÕÉ¸ì(€Í¡•‘Õ±•ÉMÑ…ÉÑ•€ôÑÉÕ”ì(€Í•ÑQ¥µ•½ÕĞ  ¤€ôøÁÉ½•ÍÍ%¹¥‘•¹Ñ	…Ñ  ÈÔÀ¤¹…Ñ  ¡•ÉÉ½È¤€ôø(€€€½¹Í½±”¹•ÉÉ½È %¹¥‘•¹Ğ½µµ…¹‘•ÈÍÑ…ÉÑÕÀ™…¥±•èœ°•ÉÉ½È¹µ•ÍÍ…”¤¤°€ØÀÀÀÀ¤ì(€½¹ÍĞÑ¥µ•È€ôÍ•Ñ%¹Ñ•ÉÙ…°  ¤€ôøÁÉ½•ÍÍ%¹¥‘•¹Ñ	…Ñ  ÄÀÀ¤¹…Ñ  ¡•ÉÉ½È¤€ôø(€€€½¹Í½±”¹•ÉÉ½È %¹¥‘•¹Ğ½µµ…¹‘•ÈÁ½±±¥¹œ™…¥±•èœ°•ÉÉ½È¹µ•ÍÍ…”¤¤°A=11}5L¤ì(€Ñ¥µ•È¹Õ¹É•˜ü¸ ¤ì(€½¹Í½±”¹±½œ¡9•á„%¹¥‘•¹Ğ½µµ…¹‘•ÈÉ•…‘ä€ ‘íA=11}5MõµÌ°…‘Ù¥Í½Éäµ½¹±ä°€‘í]=I-I}%ô¤¹€¤ì)ô()µ½‘Õ±”¹•áÁ½ÉÑÌ€ôì(€%9%9Q}M!5}ME0°(€…‘‘%¹¥‘•¹Ñ9½Ñ”°(€‰Õ¥±‘%¹¥‘•¹Ñ½¹Ñ•áĞ°(€‰Õ¥±‘½µµ…¹‘	É¥•˜°(€±…ÍÍ¥™å%¹¥‘•¹ÑÙ•¹Ğ°(€‘•¥‘•I•½µµ•¹‘…Ñ¥½¸°(€•¹ÍÕÉ•%¹¥‘•¹ÑM¡•µ„°(€•Ù…±Õ…Ñ•Ù•¹Ğ°(€•Ñ%¹¥‘•¹Ğ°(€•Ñ%¹¥‘•¹Ñ=Ù•ÉÙ¥•Ü°(€±¥ÍÑ%¹¥‘•¹ÑÌ°(€ÁÉ½•ÍÍ%¹¥‘•¹Ñ	…Ñ °(€É•½µµ•¹‘…Ñ¥½¹Q•µÁ±…Ñ•Ì°(€ÍÑ…ÉÑ%¹¥‘•¹Ñ½µµ…¹‘•ÉM¡•‘Õ±•È°(€ÑÉ…¹Í¥Ñ¥½¹%¹¥‘•¹Ğ°)ôì(