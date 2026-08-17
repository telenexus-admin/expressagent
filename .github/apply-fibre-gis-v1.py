from pathlib import Path


def replace_once(path, old, new, label):
    text = path.read_text()
    if old not in text:
        if new in text:
            return
        raise SystemExit(f'{label} marker not found in {path}')
    path.write_text(text.replace(old, new, 1))


route = Path('backend/src/routes/noc.js')
replace_once(
    route,
    "const { getNetworkTopology, saveTopologyLocation } = require('../services/topology');\n",
    "const { getNetworkTopology, saveTopologyLocation } = require('../services/topology');\nconst {\n  listFibreGis, createAsset, updateAsset, deleteAsset, createRoute,\n  updateRoute, deleteRoute, syncTopologySites,\n} = require('../services/fibreGis');\n",
    'fibre GIS service import',
)

marker = "router.get('/overview', async (req, res) => {\n"
block = """router.get('/fibre-gis', async (req, res) => {
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

"""
replace_once(route, marker, block + marker, 'fibre GIS routes')

workspace = Path('frontend/src/pages/BillingWorkspace.jsx')
replace_once(
    workspace,
    "const BillingTopology = lazy(() => import('./BillingTopology'));\n",
    "const BillingTopology = lazy(() => import('./BillingTopology'));\nconst BillingFibreGis = lazy(() => import('./BillingFibreGis'));\n",
    'Fibre GIS lazy import',
)
replace_once(
    workspace,
    "  ['topology', 'Topology', 'topology'],\n  ['routers', 'Routers', 'router'],\n",
    "  ['topology', 'Topology', 'topology'],\n  ['fibre-gis', 'Fibre GIS', 'map'],\n  ['routers', 'Routers', 'router'],\n",
    'Fibre GIS nav item',
)
replace_once(
    workspace,
    "      'topology',\n      'routers',\n",
    "      'topology',\n      'fibre-gis',\n      'routers',\n",
    'Fibre GIS network group',
)
replace_once(
    workspace,
    "!['subscribers', 'routers', 'hotspot', 'noc', 'topology'].includes(tab)",
    "!['subscribers', 'routers', 'hotspot', 'noc', 'topology', 'fibre-gis'].includes(tab)",
    'Fibre GIS header suppression',
)
replace_once(
    workspace,
    "        {tab === 'topology' && <Suspense fallback={<BillingWorkspaceSkeleton />}><BillingTopology /></Suspense>}\n        {tab === 'routers'",
    "        {tab === 'topology' && <Suspense fallback={<BillingWorkspaceSkeleton />}><BillingTopology /></Suspense>}\n        {tab === 'fibre-gis' && <Suspense fallback={<BillingWorkspaceSkeleton />}><BillingFibreGis /></Suspense>}\n        {tab === 'routers'",
    'Fibre GIS render',
)
replace_once(
    workspace,
    "    topology: <><circle cx=\"5\" cy=\"6\" r=\"2.2\" /><circle cx=\"19\" cy=\"6\" r=\"2.2\" /><circle cx=\"12\" cy=\"18\" r=\"2.2\" /><path d=\"M7 7.2 10.5 16M17 7.2 13.5 16M7.2 6h9.6\" /></>,\n    clients:",
    "    topology: <><circle cx=\"5\" cy=\"6\" r=\"2.2\" /><circle cx=\"19\" cy=\"6\" r=\"2.2\" /><circle cx=\"12\" cy=\"18\" r=\"2.2\" /><path d=\"M7 7.2 10.5 16M17 7.2 13.5 16M7.2 6h9.6\" /></>,\n    map: <><path d=\"m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z\" /><path d=\"M9 3v15M15 6v15\" /></>,\n    clients:",
    'Fibre GIS icon',
)
