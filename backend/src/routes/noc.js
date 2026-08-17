const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { nocAnalysis, nocHistory, nocOverview, nocRouters, nocStatus } = require('../services/noc');
const { getNetworkTopology, saveTopologyLocation } = require('../services/topology');
const {
  listFibreGis, createAsset, updateAsset, deleteAsset, createRoute,
  updateRoute, deleteRoute, syncTopologySites,
} = require('../services/fibreGis');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

router.get('/routers', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await nocRouters(clientId));
  } catch (err) {
    console.error('GET /noc/routers error:', err.message);
    res.status(500).json({ error: 'Failed to load NOC routers' });
  }
});

router.get('/topology', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try { res.json(await getNetworkTopology(clientId)); }
  catch (err) { console.error('GET /noc/topology error:', err.message); res.status(500).json({ error: err.message || 'Failed to load network topology' }); }
});

router.patch('/topology/routers/:id/location', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const saved = await saveTopologyLocation(clientId, req.params.id, req.body || {});
    if (!saved) return res.status(404).json({ error: 'Router not found' });
    res.json(saved);
  } catch (err) { console.error('PATCH /noc/topology/routers/:id/location error:', err.message); res.status(400).json({ error: err.message || 'Failed to save topology location' }); }
});

router.get('/fibre-gis', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try { res.json(await listFibreGis(clientId)); }
  catch (err) { console.error('GET /noc/fibre-gis error:', err.message); res.status(500).json({ error: err.message || 'Failed to load Fibre GIS' }); }
});

router.post('/fibre-gis/assets', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try { res.status(201).json(await createAsset(clientId, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message || 'Failed to create infrastructure' }); }
});

router.put('/fibre-gis/assets/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try { const saved = await updateAsset(clientId, req.params.id, req.body || {}); if (!saved) return res.status(404).json({ error: 'Infrastructure not found' }); res.json(saved); }
  catch (err) { res.status(400).json({ error: err.message || 'Failed to update infrastructure' }); }
});

router.delete('/fibre-gis/assets/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try { const removed = await deleteAsset(clientId, req.params.id); if (!removed) return res.status(404).json({ error: 'Infrastructure not found' }); res.json({ success: true }); }
  catch (err) { res.status(400).json({ error: err.message || 'Failed to delete infrastructure' }); }
});

router.post('/fibre-gis/routes', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try { res.status(201).json(await createRoute(clientId, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message || 'Failed to create fibre route' }); }
});

router.put('/fibre-gis/routes/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try { const saved = await updateRoute(clientId, req.params.id, req.body || {}); if (!saved) return res.status(404).json({ error: 'Fibre route not found' }); res.json(saved); }
  catch (err) { res.status(400).json({ error: err.message || 'Failed to update fibre route' }); }
});

router.delete('/fibre-gis/routes/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try { const removed = await deleteRoute(clientId, req.params.id); if (!removed) return res.status(404).json({ error: 'Fibre route not found' }); res.json({ success: true }); }
  catch (err) { res.status(400).json({ error: err.message || 'Failed to delete fibre route' }); }
});

router.post('/fibre-gis/sync-topology', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try { res.json(await syncTopologySites(clientId)); }
  catch (err) { res.status(400).json({ error: err.message || 'Failed to sync topology sites' }); }
});

router.get('/overview', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await nocOverview(clientId, req.query.router_id, req.query || {}));
  } catch (err) {
    console.error('GET /noc/overview error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to load NOC overview' });
  }
});

router.get('/traffic/history', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await nocHistory(clientId, req.query.router_id, req.query.range || '6h'));
  } catch (err) {
    console.error('GET /noc/traffic/history error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to load NOC history' });
  }
});

router.get('/status', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await nocStatus(clientId, req.query.router_id));
  } catch (err) {
    console.error('GET /noc/status error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to load NOC status' });
  }
});

router.get('/analysis', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await nocAnalysis(clientId, req.query.router_id));
  } catch (err) {
    console.error('GET /noc/analysis error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to analyze NOC events' });
  }
});

router.get('/live', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  req.on('close', () => { closed = true; });

  const send = async () => {
    if (closed) return;
    try {
      const data = await nocOverview(clientId, req.query.router_id, req.query || {});
      res.write(`event: noc_live_update\n`);
      res.write(`data: ${JSON.stringify({ type: 'noc_live_update', ...data })}\n\n`);
    } catch (err) {
      res.write(`event: noc_error\n`);
      res.write(`data: ${JSON.stringify({ error: err.message || 'NOC live update failed' })}\n\n`);
    }
  };

  await send();
  const timer = setInterval(send, 3000);
  req.on('close', () => clearInterval(timer));
});

module.exports = router;
