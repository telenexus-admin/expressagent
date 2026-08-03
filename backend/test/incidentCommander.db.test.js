const crypto = require('crypto');
const db = require('../src/db');
const { appendBillingEvent, ensureEventSchema } = require('../src/services/events');
const {
  decideRecommendation,
  ensureIncidentSchema,
  evaluateEvent,
  getIncident,
  getIncidentOverview,
  listIncidents,
  transitionIncident,
} = require('../src/services/incidentCommander');

async function run() {
  await ensureEventSchema(db);
  await ensureIncidentSchema(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const first = await client.query(`INSERT INTO clients (name, account_type) VALUES ($1,'billing') RETURNING id`, [`Incident Test ${crypto.randomUUID()}`]);
    const second = await client.query(`INSERT INTO clients (name, account_type) VALUES ($1,'billing') RETURNING id`, [`Incident Other ${crypto.randomUUID()}`]);
    const clientId = first.rows[0].id;
    const otherClientId = second.rows[0].id;
    const router = await client.query(
      `INSERT INTO mikrotik_routers
       (client_id, name, host, username, password_encrypted, is_active)
       VALUES ($1,$2,'192.0.2.10','synthetic','synthetic-test-only',TRUE) RETURNING id`,
      [clientId, `Synthetic Router ${crypto.randomUUID()}`]
    );
    await client.query(
      `INSERT INTO billing_twin_entities
       (client_id, entity_type, entity_id, display_name, source, observed_at, first_seen_at, last_seen_at)
       VALUES ($1,'router',$2,'Synthetic Router','incident_test',NOW(),NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [clientId, String(router.rows[0].id)]
    );
    const subscriberEntityId = `subscriber-${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO billing_twin_entities
       (client_id, entity_type, entity_id, display_name, source, observed_at, first_seen_at, last_seen_at)
       VALUES ($1,'subscriber',$2,'Affected Subscriber','incident_test',NOW(),NOW(),NOW())`, [clientId, subscriberEntityId]
    );
    await client.query(
      `INSERT INTO billing_twin_relationships
       (client_id, from_entity_type, from_entity_id, relationship, to_entity_type, to_entity_id, observed_at, valid_from)
       VALUES ($1,'subscriber',$2,'connected_through','router',$3,NOW(),NOW())`,
      [clientId, subscriberEntityId, String(router.rows[0].id)]
    );

    const firstEvent = await appendBillingEvent(client, {
      clientId, eventType: 'router.offline', category: 'network', source: 'incident_test',
      entityType: 'router', entityId: router.rows[0].id, severity: 'critical',
      title: 'Synthetic router offline', description: 'The test router stopped responding.',
      deduplicationKey: `incident-test:${crypto.randomUUID()}`,
    });
    const opened = await evaluateEvent(client, firstEvent.event);
    if (!opened.opened || opened.incident.status !== 'detected') throw new Error('Critical signal did not open an incident');
    if (Number(opened.incident.impact?.affected_entities) !== 1) throw new Error('Digital twin impact was not attached');

    const repeatedEvent = await appendBillingEvent(client, {
      clientId, eventType: 'router.timeout', category: 'network', source: 'incident_test',
      entityType: 'router', entityId: router.rows[0].id, severity: 'warning',
      title: 'Synthetic router timeout', deduplicationKey: `incident-test:${crypto.randomUUID()}`,
    });
    const correlated = await evaluateEvent(client, repeatedEvent.event);
    if (correlated.opened || correlated.incident.id !== opened.incident.id || Number(correlated.incident.evidence_count) !== 2) {
      throw new Error('Repeated signal did not correlate into the active incident');
    }

    const listed = await listIncidents(clientId, { status: 'detected' }, client);
    if (listed.length !== 1) throw new Error('Tenant incident listing failed');
    if ((await listIncidents(otherClientId, {}, client)).length !== 0) throw new Error('Cross-tenant incident leaked');
    const detail = await getIncident(clientId, opened.incident.id, client);
    if (!detail || detail.evidence.length !== 2 || detail.recommendations.length < 2) throw new Error('Incident command detail is incomplete');
    if (await getIncident(otherClientId, opened.incident.id, client)) throw new Error('Cross-tenant incident detail leaked');

    const investigating = await transitionIncident(clientId, opened.incident.id, 'investigating', { queryable: client });
    if (investigating.status !== 'investigating') throw new Error('Incident transition failed');
    const recommendation = detail.recommendations[0];
    const approved = await decideRecommendation(clientId, recommendation.id, 'approved', { reason: 'Synthetic approval', queryable: client });
    if (approved.status !== 'approved') throw new Error('Recommendation approval was not recorded');
    const approval = await client.query('SELECT COUNT(*)::int count FROM billing_incident_approvals WHERE client_id=$1 AND recommendation_id=$2', [clientId, recommendation.id]);
    if (Number(approval.rows[0].count) !== 1) throw new Error('Approval audit row missing');

    const recoveryEvent = await appendBillingEvent(client, {
      clientId, eventType: 'router.online', category: 'network', source: 'incident_test',
      entityType: 'router', entityId: router.rows[0].id, severity: 'info',
      title: 'Synthetic router recovered', deduplicationKey: `incident-test:${crypto.randomUUID()}`,
    });
    const resolved = await evaluateEvent(client, recoveryEvent.event);
    if (resolved.incident?.status !== 'resolved') throw new Error('Recovery signal did not resolve the incident');
    const overview = await getIncidentOverview(clientId, client);
    if (Number(overview.active) !== 0 || overview.automatic_execution !== false) throw new Error('Incident overview or safety mode is incorrect');

    await client.query('ROLLBACK');
    console.log('Incident Commander correlation, impact, isolation, approval audit, and recovery tests passed and rolled back.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no transaction */ }
    throw error;
  } finally { client.release(); await db.end(); }
}

run().catch((error) => { console.error(error); process.exit(1); });
