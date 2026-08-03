const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  createShadowPlan, getActionCatalog, getAutomationOverview, getShadowPlan,
  listShadowPlans, planTenantSignals, reviewShadowPlan,
} = require('../services/networkAutomation');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function tenant(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

function requireAdmin(req, res) {
  if (!['admin', 'superadmin'].includes(req.user?.role)) {
    res.status(403).json({ error: 'Administrator permission is required' });
    return false;
  }
  return true;
}

router.get('/automation/overview', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try { res.json(await getAutomationOverview(clientId)); }
  catch (error) {
    console.error('GET /network-agent/automation/overview error:', error.message);
    res.status(500).json({ error: 'Failed to load network automation overview' });
  }
});

router.get('/actions', (req, res) => {
  if (!tenant(req, res)) return;
  res.json({ actions: getActionCatalog(), mode: 'shadow', execution_allowed: false });
});

router.get('/plans', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    res.json({ plans: await listShadowPlans(clientId, {
      routerId: req.query.routerId || req.query.router_id,
      incidentId: req.query.incidentId || req.query.incident_id,
      reviewStatus: req.query.reviewStatus || req.query.review_status,
      actionType: req.query.actionType || req.query.action_type,
      limit: req.query.limit,
    }), mode: 'shadow', execution_allowed: false });
  } catch (error) {
    console.error('GET /network-agent/plans error:', error.message);
    res.status(400).json({ error: error.message || 'Failed to load shadow plans' });
  }
});

router.get('/plans/:planId', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    const plan = await getShadowPlan(clientId, req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Shadow plan not found' });
    res.json(plan);
  } catch (error) {
    console.error('GET /network-agent/plans/:planId error:', error.message);
    res.status(400).json({ error: error.message || 'Failed to load shadow plan' });
  }
});

router.post('/plans/preview', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    const plan = await createShadowPlan(clientId, Number(req.body?.router_id || req.body?.routerId),
      req.body?.action_type || req.body?.actionType, req.body?.parameters || {}, {
        incidentId: req.body?.incident_id || req.body?.incidentId,
        anomalyId: req.body?.anomaly_id || req.body?.anomalyId,
        reason: req.body?.reason, source: 'network_agent_api', createdBy: req.user?.id || null,
      });
    res.status(201).json({ ...plan, mode: 'shadow', execution_allowed: false, commands_executed: false });
  } catch (error) {
    console.error('POST /network-agent/plans/preview error:', error.message);
    res.status(400).json({ error: error.message || 'Failed to create shadow plan' });
  }
});

router.post('/plans/:planId/review', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    const plan = await reviewShadowPlan(clientId, req.params.planId, req.body?.decision, {
      note: req.body?.note, adminId: req.user?.id || null,
    });
    if (!plan) return res.status(404).json({ error: 'Shadow plan not found' });
    res.json({ ...plan, mode: 'shadow', execution_allowed: false, commands_executed: false });
  } catch (error) {
    console.error('POST /network-agent/plans/:planId/review error:', error.message);
    res.status(400).json({ error: error.message || 'Failed to review shadow plan' });
  }
});

router.post('/shadow/run', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    const result = await planTenantSignals(clientId);
    res.json({ ...result, mode: 'shadow', automatic_execution: false, commands_executed: 0 });
  } catch (error) {
    console.error('POST /network-agent/shadow/run error:', error.message);
    res.status(400).json({ error: error.message || 'Shadow planning failed' });
  }
});

module.exports = router;
