const { createRequire } = require('module');
const backendRequire = createRequire('/var/www/nexa-platform/backend/package.json');
const axios = backendRequire('axios');
const jwt = backendRequire('jsonwebtoken');
const db = require('../src/db');

function token(clientId) {
  return jwt.sign({ id: 0, role: 'admin', client_id: clientId, name: 'Incident verification' }, process.env.JWT_SECRET, { expiresIn: '2m' });
}

async function get(clientId, path, expected = 200) {
  const response = await axios.get(`http://127.0.0.1:${process.env.PORT || 3001}${path}`, {
    headers: { Authorization: `Bearer ${token(clientId)}` }, timeout: 5000, validateStatus: () => true,
  });
  if (response.status !== expected) throw new Error(`${path} returned ${response.status}, expected ${expected}`);
  return response.data;
}

async function main() {
  const activeTenant = await db.query(`SELECT client_id FROM billing_incidents
    WHERE status NOT IN ('resolved','closed') ORDER BY last_signal_at DESC LIMIT 1`);
  const tenants = await db.query(`SELECT DISTINCT client_id FROM billing_incident_event_evaluations ORDER BY client_id LIMIT 20`);
  const primaryClient = activeTenant.rows[0]?.client_id || tenants.rows[0]?.client_id || 26;
  const otherClient = tenants.rows.find((row) => row.client_id !== primaryClient)?.client_id || 2;
  const overview = await get(primaryClient, '/api/incident-commander/overview');
  const listing = await get(primaryClient, '/api/incident-commander?limit=20');
  if (overview.mode !== 'advisory' || overview.automatic_execution !== false) throw new Error('Commander safety mode is incorrect');
  let isolationStatus = 404;
  if (listing.incidents?.[0]) {
    await get(primaryClient, `/api/incident-commander/${listing.incidents[0].id}`);
    await get(otherClient, `/api/incident-commander/${listing.incidents[0].id}`, 404);
  } else {
    await get(otherClient, '/api/incident-commander/00000000-0000-4000-8000-000000000000', 404);
  }
  const evaluations = await db.query(`SELECT result, COUNT(*)::int count FROM billing_incident_event_evaluations GROUP BY result ORDER BY result`);
  const failures = Number(evaluations.rows.find((row) => row.result === 'failed')?.count || 0);
  if (failures) throw new Error(`${failures} incident event evaluations failed`);
  const incidentCounts = await db.query(`SELECT status, severity, COUNT(*)::int count
    FROM billing_incidents GROUP BY status, severity ORDER BY status, severity`);
  const activeSample = await db.query(`SELECT client_id, id, category, severity, status, title,
    evidence_count, first_detected_at, last_signal_at FROM billing_incidents
    WHERE status NOT IN ('resolved','closed') ORDER BY last_signal_at DESC LIMIT 20`);
  const activeEvidence = await db.query(`SELECT link.incident_id, event.event_type, event.source,
    event.severity, event.title, event.occurred_at
    FROM billing_incident_events link JOIN billing_events event
      ON event.id=link.event_id AND event.client_id=link.client_id
    JOIN billing_incidents incident ON incident.id=link.incident_id AND incident.client_id=link.client_id
    WHERE incident.status NOT IN ('resolved','closed') ORDER BY event.occurred_at DESC LIMIT 30`);
  console.log(JSON.stringify({ status: 'ok', primary_client: primaryClient, overview,
    visible_incidents: listing.incidents?.length || 0, evaluations: evaluations.rows,
    incident_counts: incidentCounts.rows, active_incident_sample: activeSample.rows,
    active_evidence: activeEvidence.rows,
    cross_tenant_incident_status: isolationStatus }, null, 2));
}

main().then(() => db.end()).catch(async (error) => { console.error(error.message); await db.end().catch(() => {}); process.exit(1); });
