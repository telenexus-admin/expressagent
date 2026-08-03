const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { recordRequestEvent } = require('../services/events');
const {
  collectRouterObservability,
  getNetworkOverview,
  getRouterTopology,
  listAnomalies,
  listBaselines,
  listMetricSamples,
} = require('../services/networkObservability');

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

router.get('/overview', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try { res.json(await getNetworkOverview(clientId)); }
  catch (error) {
    console.error('GET /network-agent/overview error:', error.message);
    res.status(500).json({ error: 'Failed to load network overview' });
  }
});

router.get('/anomalies', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    res.json({ anomalies: await listAnomalies(clientId, {
      routerId: req.query.routerId || req.query.router_id,
      status: req.query.status || 'open',
    }) });
  } catch (error) {
    console.error('GET /network-agent/anomalies error:', error.message);
    res.status(500).json({ error: 'Failed to load network anomalies' });
  }
});

router.get('/routers/:routerId/topology', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    const topology = await getRouterTopology(clientId, Number(req.params.routerId));
    if (!topology) return res.status(404).json({ error: 'Router not found' });
    res.json(topology);
  } catch (error) {
    console.error('GET /network-agent/routers/:routerId/topology error:', error.message);
    res.status(500).json({ error: 'Failed to load router topology' });
  }
});

router.get('/routers/:routerId/metrics', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    res.json({ samples: await listMetricSamples(clientId, Number(req.params.routerId), {
      metric: req.query.metric,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    }) });
  } catch (error) {
    console.error('GET /network-agent/routers/:routerId/metrics error:', error.message);
    res.status(400).json({ error: error.message || 'Failed to load router metrics' });
  }
});

router.get('/routers/:routerId/baselines', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try { res.json({ baselines: await listBaselines(clientId, Number(req.params.routerId)) }); }
  catch (error) {
    console.error('GET /network-agent/routers/:routerId/baselines error:', error.message);
    res.status(500).json({ error: 'Failed to load router baselines' });
  }
});

router.post('/routers/:routerId/collect', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    const result = await collectRouterObservability(clientId, Number(req.params.routerId));
    await recordRequestEvent(req, {
      eventType: 'router.observability_collected', category: 'network', source: 'network_agent_api',
      entityType: 'router', entityId: req.params.routerId, title: 'Read-only router observability collected',
      payload: result, deduplicationKey: `network-collection:${result.run_id}`, sensitivity: 'restricted',
    });
    res.json({ ...result, read_only: true, commands_executed: false });
  } catch (error) {
    console.error('POST /network-agent/routers/:routerId/collect error:', error.message);
    res.status(400).json({ error: error.message || 'Router observability collection failed' });
  }
});

module.exports = router;
