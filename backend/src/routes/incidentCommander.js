const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { recordRequestEvent } = require('../services/events');
const {
  addIncidentNote,
  decideRecommendation,
  getIncident,
  getIncidentOverview,
  listIncidents,
  transitionIncident,
} = require('../services/incidentCommander');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function tenant(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

function requireDecisionAuthority(req, res) {
  if (!['admin', 'superadmin'].includes(req.user?.role)) {
    res.status(403).json({ error: 'Administrator approval is required' });
    return false;
  }
  return true;
}

router.get('/overview', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try { res.json(await getIncidentOverview(clientId)); }
  catch (error) { console.error('GET /incident-commander/overview error:', error.message); res.status(500).json({ error: 'Failed to load incident overview' }); }
});

router.get('/', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try { res.json({ incidents: await listIncidents(clientId, req.query) }); }
  catch (error) { console.error('GET /incident-commander error:', error.message); res.status(500).json({ error: 'Failed to load incidents' }); }
});

router.get('/:id', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    const incident = await getIncident(clientId, req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    res.json(incident);
  } catch (error) { console.error('GET /incident-commander/:id error:', error.message); res.status(500).json({ error: 'Failed to load incident' }); }
});

router.patch('/:id/status', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireDecisionAuthority(req, res)) return;
  try {
    const incident = await transitionIncident(clientId, req.params.id, req.body?.status, { adminId: req.user?.id });
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    await recordRequestEvent(req, {
      eventType: 'incident.status_changed', category: 'incident', source: 'incident_commander_api',
      entityType: 'incident', entityId: incident.id, title: 'Incident status changed',
      payload: { status: incident.status }, newState: { status: incident.status },
      deduplicationKey: `incident:${incident.id}:status:${incident.status}:${Date.now()}`,
    });
    res.json(incident);
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to change incident status' }); }
});

router.post('/:id/notes', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireDecisionAuthority(req, res)) return;
  try {
    const incident = await addIncidentNote(clientId, req.params.id, req.body?.message, { adminId: req.user?.id });
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    await recordRequestEvent(req, {
      eventType: 'incident.note_added', category: 'incident', source: 'incident_commander_api',
      entityType: 'incident', entityId: req.params.id, title: 'Incident note added',
      payload: { message: String(req.body?.message || '').slice(0, 4000) },
      deduplicationKey: `incident:${req.params.id}:note:${Date.now()}`,
      sensitivity: 'confidential',
    });
    res.json(incident);
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to add incident note' }); }
});

router.post('/recommendations/:id/decision', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireDecisionAuthority(req, res)) return;
  try {
    const recommendation = await decideRecommendation(clientId, req.params.id, req.body?.decision, {
      adminId: req.user?.id, reason: req.body?.reason,
    });
    if (!recommendation) return res.status(404).json({ error: 'Proposed recommendation not found' });
    await recordRequestEvent(req, {
      eventType: `incident.recommendation_${recommendation.status}`,
      category: 'incident', source: 'incident_commander_api', entityType: 'incident',
      entityId: recommendation.incident_id, title: `Incident recommendation ${recommendation.status}`,
      payload: { recommendation_id: recommendation.id, action_type: recommendation.action_type,
        decision: recommendation.status, executed: false },
      relatedEntities: [{ entityType: 'incident_recommendation', entityId: recommendation.id, relationship: 'decision' }],
      deduplicationKey: `incident-recommendation:${recommendation.id}:${recommendation.status}`,
      sensitivity: 'confidential',
    });
    res.json({ recommendation, executed: false, message: 'Decision recorded. No operational action was executed.' });
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to decide recommendation' }); }
});

module.exports = router;
