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
    const impact = await calculateImpact(queryable, event.client_id,
      classification.primary_entity_type, classification.primary_entity_id);
    const inserted = await queryable.query(
      `INSERT INTO billing_incidents (
         id, client_id, incident_key, title, summary, category, severity,
         primary_entity_type, primary_entity_id, impact, first_detected_at, last_signal_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$11) RETURNING *`,
      [crypto.randomUUID(), event.client_id, classification.incident_key, classification.title,
        classification.summary, classification.category, classification.severity,
        classification.primary_entity_type, classification.primary_entity_id,
        JSON.stringify(impact), event.occurred_at]
    );
    incident = inserted.rows[0];
    opened = true;
    await addTimeline(queryable, incident, 'detected', classification.summary, {
      metadata: { event_id: event.id, rule_id: classification.rule_id },
    });
    await insertRecommendations(queryable, incident, classification.recommendations);
  } else {
    const severity = severityRank(classification.severity) > severityRank(incident.severity)
      ? classification.severity : incident.severity;
    const updated = await queryable.query(
      `UPDATE billing_incidents SET severity = $3, last_signal_at = GREATEST(last_signal_at, $4),
         updated_at = NOW() WHERE id = $1 AND client_id = $2 RETURNING *`,
      [incident.id, event.client_id, severity, event.occurred_at]
    );
    incident = updated.rows[0];
  }
  const evidence = await queryable.query(
    `INSERT INTO billing_incident_events (incident_id, event_id, client_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id`,
    [incident.id, event.id, event.client_id]
  );
  if (evidence.rowCount) {
    const updated = await queryable.query(
      `UPDATE billing_incidents SET evidence_count = evidence_count + 1, updated_at = NOW()
       WHERE id = $1 AND client_id = $2 RETURNING *`, [incident.id, event.client_id]
    );
    incident = updated.rows[0];
    if (!opened) await addTimeline(queryable, incident, 'signal', classification.summary, {
      metadata: { event_id: event.id, rule_id: classification.rule_id },
    });
  }
  return { incident, opened };
}

async function resolveFromEvent(queryable, event, classification) {
  const result = await queryable.query(
    `UPDATE billing_incidents SET status = 'resolved', resolved_at = $3,
       last_signal_at = GREATEST(last_signal_at, $3), updated_at = NOW()
     WHERE id = (
       SELECT id FROM billing_incidents WHERE client_id = $1 AND incident_key = $2
         AND status NOT IN ('resolved','closed') ORDER BY created_at DESC LIMIT 1 FOR UPDATE
     ) RETURNING *`,
    [event.client_id, classification.incident_key, event.occurred_at]
  );
  const incident = result.rows[0] || null;
  if (incident) {
    await queryable.query(
      `INSERT INTO billing_incident_events (incident_id, event_id, client_id, relationship)
       VALUES ($1,$2,$3,'recovery') ON CONFLICT DO NOTHING`,
      [incident.id, event.id, event.client_id]
    );
    await addTimeline(queryable, incident, 'resolved', classification.summary, {
      metadata: { event_id: event.id, rule_id: classification.rule_id },
    });
  }
  return incident;
}

async function evaluateEvent(queryable, event) {
  const classification = classifyIncidentEvent(event);
  try {
    let incident = null;
    let opened = false;
    if (classification.result === 'correlated') {
      ({ incident, opened } = await correlateEvent(queryable, event, classification));
    } else if (classification.result === 'resolved') {
      incident = await resolveFromEvent(queryable, event, classification);
    }
    await queryable.query(
      `INSERT INTO billing_incident_event_evaluations
         (event_id, client_id, result, incident_id, rule_id)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id, client_id) DO NOTHING`,
      [event.id, event.client_id, incident ? classification.result : 'ignored', incident?.id || null,
        classification.rule_id || null]
    );
    return { classification, incident, opened };
  } catch (error) {
    await queryable.query(
      `INSERT INTO billing_incident_event_evaluations
         (event_id, client_id, result, rule_id, error)
       VALUES ($1,$2,'failed',$3,$4)
       ON CONFLICT (event_id, client_id) DO UPDATE SET result='failed',
         attempts=billing_incident_event_evaluations.attempts+1,
         next_retry_at=NOW()+INTERVAL '1 minute', error=EXCLUDED.error, evaluated_at=NOW()`,
      [event.id, event.client_id, classification.rule_id || null, text(error.message, 2000)]
    );
    throw error;
  }
}

async function emitIncidentEvent(result, sourceEvent) {
  if (!result.incident) return;
  const eventType = result.classification.result === 'resolved'
    ? 'incident.resolved' : (result.opened ? 'incident.opened' : 'incident.signal_correlated');
  await recordBillingEvent({
    clientId: sourceEvent.client_id,
    eventType,
    category: 'incident',
    source: 'incident_commander',
    entityType: 'incident',
    entityId: result.incident.id,
    actorType: 'system',
    severity: eventType === 'incident.resolved' ? 'info' : sourceEvent.severity,
    title: result.incident.title,
    description: result.incident.summary,
    payload: { status: result.incident.status, category: result.incident.category,
      severity: result.incident.severity, evidence_count: result.incident.evidence_count },
    relatedEntities: sourceEvent.entity_type ? [{ entityType: sourceEvent.entity_type,
      entityId: sourceEvent.entity_id, relationship: 'triggered_by' }] : [],
    correlationId: result.incident.id,
    causationId: sourceEvent.id,
    deduplicationKey: `incident:${result.incident.id}:${sourceEvent.id}:${eventType}`,
    sensitivity: 'internal',
  });
}

async function processIncidentBatch(limit = 100) {
  await ensureIncidentSchema();
  const lockClient = await db.connect();
  try {
    const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext('nexa:incident-commander')) AS acquired");
    if (!lock.rows[0]?.acquired) return { skipped: true, processed: 0 };
    try {
      const events = await db.query(
        `SELECT event.* FROM billing_events event
         LEFT JOIN billing_incident_event_evaluations evaluation
           ON evaluation.event_id = event.id AND evaluation.client_id = event.client_id
         WHERE evaluation.event_id IS NULL
            OR (evaluation.result='failed' AND evaluation.attempts < 5
              AND COALESCE(evaluation.next_retry_at, NOW()) <= NOW())
         ORDER BY event.recorded_at ASC, event.id ASC LIMIT $1`,
        [Math.max(1, Math.min(Number(limit) || 100, 500))]
      );
      const counts = { processed: 0, opened: 0, correlated: 0, resolved: 0, ignored: 0, failed: 0 };
      for (const event of events.rows) {
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          const result = await evaluateEvent(client, event);
          await client.query('COMMIT');
          counts.processed += 1;
          if (!result.incident) counts.ignored += 1;
          else if (result.classification.result === 'resolved') counts.resolved += 1;
          else if (result.opened) counts.opened += 1;
          else counts.correlated += 1;
          await emitIncidentEvent(result, event).catch((error) =>
            console.error('Could not emit incident event:', error.message));
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch (_) { /* no transaction */ }
          counts.failed += 1;
        } finally {
          client.release();
        }
      }
      return counts;
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext('nexa:incident-commander'))");
    }
  } finally {
    lockClient.release();
  }
}

function buildCommandBrief(incident) {
  const impacted = Number(incident.impact?.affected_entities || 0);
  const scope = impacted ? `${impacted} directly connected ${impacted === 1 ? 'entity' : 'entities'} may be affected` : 'No downstream impact is confirmed yet';
  const state = incident.status === 'resolved'
    ? 'The recovery signal has been recorded and the incident is resolved.'
    : `The incident is ${incident.status}; Nexa remains in advisory mode.`;
  return `${incident.title}. ${incident.summary} ${scope}. ${state}`;
}

async function listIncidents(clientId, options = {}, queryable = db) {
  await ensureIncidentSchema(queryable);
  const statuses = text(options.status, 120).split(',').filter((value) => ACTIVE_STATUSES.has(value) || ['resolved','closed'].includes(value));
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
  const result = await queryable.query(
    `SELECT incident.*,
       (SELECT COUNT(*)::int FROM billing_incident_recommendations recommendation
        WHERE recommendation.incident_id = incident.id AND recommendation.status = 'proposed') AS proposed_actions
     FROM billing_incidents incident WHERE incident.client_id = $1
       AND (cardinality($2::text[]) = 0 OR incident.status = ANY($2::text[]))
       AND ($3::text IS NULL OR incident.severity = $3)
     ORDER BY CASE incident.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
       incident.last_signal_at DESC LIMIT $4`,
    [clientId, statuses, text(options.severity, 20) || null, limit]
  );
  return result.rows.map((incident) => ({ ...incident, brief: buildCommandBrief(incident) }));
}

async function getIncident(clientId, incidentId, queryable = db) {
  await ensureIncidentSchema(queryable);
  const incident = await queryable.query('SELECT * FROM billing_incidents WHERE client_id=$1 AND id=$2 LIMIT 1', [clientId, incidentId]);
  if (!incident.rows[0]) return null;
  const timeline = await queryable.query('SELECT * FROM billing_incident_timeline WHERE client_id=$1 AND incident_id=$2 ORDER BY created_at ASC', [clientId, incidentId]);
  const evidence = await queryable.query(`SELECT event.id, event.event_type, event.event_category, event.source, event.severity,
      event.title, event.description, event.entity_type, event.entity_id, event.occurred_at, link.relationship
      FROM billing_incident_events link JOIN billing_events event
        ON event.id=link.event_id AND event.client_id=link.client_id
      WHERE link.client_id=$1 AND link.incident_id=$2 ORDER BY event.occurred_at ASC`, [clientId, incidentId]);
  const recommendations = await queryable.query('SELECT * FROM billing_incident_recommendations WHERE client_id=$1 AND incident_id=$2 ORDER BY created_at ASC', [clientId, incidentId]);
  const approvals = await queryable.query('SELECT * FROM billing_incident_approvals WHERE client_id=$1 AND incident_id=$2 ORDER BY created_at DESC', [clientId, incidentId]);
  return { ...incident.rows[0], brief: buildCommandBrief(incident.rows[0]), timeline: timeline.rows,
    evidence: evidence.rows, recommendations: recommendations.rows, approvals: approvals.rows };
}

async function getIncidentOverview(clientId, queryable = db) {
  await ensureIncidentSchema(queryable);
  const result = await queryable.query(
    `SELECT COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS active,
       COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed') AND severity='critical')::int AS critical,
       COUNT(*) FILTER (WHERE status='resolved' AND resolved_at >= NOW()-INTERVAL '24 hours')::int AS resolved_24h,
       COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at-first_detected_at))/60)
         FILTER (WHERE resolved_at IS NOT NULL AND resolved_at >= NOW()-INTERVAL '30 days'),0)::numeric(12,2) AS mttr_minutes
     FROM billing_incidents WHERE client_id=$1`, [clientId]
  );
  return { ...result.rows[0], mode: 'advisory', automatic_execution: false };
}

async function buildIncidentContext(clientId, question = '', options = {}) {
  await ensureIncidentSchema();
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 25));
  const terms = text(question, 500).toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2).slice(0, 8);
  const result = await db.query(
    `SELECT id, title, summary, category, severity, status, confidence, impact,
            primary_entity_type, primary_entity_id, evidence_count,
            first_detected_at, last_signal_at, resolved_at
     FROM billing_incidents WHERE client_id=$1
       AND (status NOT IN ('resolved','closed') OR last_signal_at >= NOW()-INTERVAL '7 days')
       AND (cardinality($2::text[]) = 0 OR EXISTS (
         SELECT 1 FROM unnest($2::text[]) term
         WHERE lower(title || ' ' || summary || ' ' || category || ' ' || COALESCE(primary_entity_type,'') || ' ' || COALESCE(primary_entity_id,'')) LIKE '%' || term || '%'
       ))
     ORDER BY (status NOT IN ('resolved','closed')) DESC,
       CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
       last_signal_at DESC LIMIT $3`,
    [clientId, terms, limit]
  );
  return {
    context: result.rows.map((incident) => [
      `Incident ${incident.id}: ${incident.title}`,
      `Status ${incident.status}; severity ${incident.severity}; category ${incident.category}; confidence ${incident.confidence}%.`,
      `Summary: ${incident.summary}`,
      `Impact: ${JSON.stringify(incident.impact || {})}; evidence signals: ${incident.evidence_count}; last signal: ${incident.last_signal_at}.`,
    ].join('\n')).join('\n\n'),
    sources: result.rows.map((incident) => ({ type: 'incident', id: incident.id,
      status: incident.status, last_signal_at: incident.last_signal_at })),
  };
}

async function transitionIncident(clientId, incidentId, status, actor = {}) {
  const queryable = actor.queryable || db;
  await ensureIncidentSchema(queryable);
  const current = await queryable.query('SELECT * FROM billing_incidents WHERE client_id=$1 AND id=$2 LIMIT 1', [clientId, incidentId]);
  if (!current.rows[0]) return null;
  const next = text(status, 24).toLowerCase();
  if (!STATUS_TRANSITIONS[current.rows[0].status]?.has(next)) throw new Error(`Cannot move incident from ${current.rows[0].status} to ${next}`);
  const result = await queryable.query(
    `UPDATE billing_incidents SET status=$3::varchar,
       acknowledged_at=CASE WHEN $3::text='investigating' AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
       acknowledged_by=CASE WHEN $3::text='investigating' AND acknowledged_by IS NULL THEN $4 ELSE acknowledged_by END,
       resolved_at=CASE WHEN $3::text='resolved' THEN NOW() WHEN $3::text='investigating' THEN NULL ELSE resolved_at END,
       closed_at=CASE WHEN $3::text='closed' THEN NOW() ELSE closed_at END, updated_at=NOW()
     WHERE client_id=$1 AND id=$2 RETURNING *`, [clientId, incidentId, next, actor.adminId || null]
  );
  await addTimeline(queryable, result.rows[0], 'status_changed', `Incident moved to ${next}.`, { type: 'admin', id: actor.adminId });
  return result.rows[0];
}

async function addIncidentNote(clientId, incidentId, message, actor = {}) {
  const queryable = actor.queryable || db;
  await ensureIncidentSchema(queryable);
  const incident = await queryable.query('SELECT * FROM billing_incidents WHERE client_id=$1 AND id=$2 LIMIT 1', [clientId, incidentId]);
  if (!incident.rows[0]) return null;
  const note = text(message, 4000);
  if (!note) throw new Error('Note is required');
  await addTimeline(queryable, incident.rows[0], 'note', note, { type: 'admin', id: actor.adminId });
  return getIncident(clientId, incidentId, queryable);
}

async function decideRecommendation(clientId, recommendationId, decision, actor = {}) {
  const external = actor.queryable || null;
  const queryable = external || await db.connect();
  await ensureIncidentSchema(queryable);
  const normalized = text(decision, 20).toLowerCase();
  if (!['approved','rejected'].includes(normalized)) throw new Error('Decision must be approved or rejected');
  try {
    if (!external) await queryable.query('BEGIN');
    const result = await queryable.query(
      `UPDATE billing_incident_recommendations SET status=$3, updated_at=NOW()
       WHERE client_id=$1 AND id=$2 AND status='proposed' RETURNING *`,
      [clientId, recommendationId, normalized]
    );
    if (!result.rows[0]) { if (!external) await queryable.query('ROLLBACK'); return null; }
    await queryable.query(
      `INSERT INTO billing_incident_approvals
       (id, incident_id, recommendation_id, client_id, decision, decided_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [crypto.randomUUID(), result.rows[0].incident_id, recommendationId, clientId,
        normalized, actor.adminId || null, text(actor.reason, 2000) || null]
    );
    await addTimeline(queryable, { id: result.rows[0].incident_id, client_id: clientId }, 'recommendation_decided',
      `${result.rows[0].title} was ${normalized}. No action was executed.`, { type: 'admin', id: actor.adminId });
    if (!external) await queryable.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    if (!external) try { await queryable.query('ROLLBACK'); } catch (_) { /* no transaction */ }
    throw error;
  } finally { if (!external) queryable.release(); }
}

function startIncidentCommanderScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setTimeout(() => processIncidentBatch(250).catch((error) =>
    console.error('Incident Commander startup failed:', error.message)), 60000);
  const timer = setInterval(() => processIncidentBatch(100).catch((error) =>
    console.error('Incident Commander polling failed:', error.message)), POLL_MS);
  timer.unref?.();
  console.log(`Nexa Incident Commander ready (${POLL_MS}ms, advisory-only, ${WORKER_ID}).`);
}

module.exports = {
  INCIDENT_SCHEMA_SQL,
  addIncidentNote,
  buildIncidentContext,
  buildCommandBrief,
  classifyIncidentEvent,
  decideRecommendation,
  ensureIncidentSchema,
  evaluateEvent,
  getIncident,
  getIncidentOverview,
  listIncidents,
  processIncidentBatch,
  recommendationTemplates,
  startIncidentCommanderScheduler,
  transitionIncident,
};
