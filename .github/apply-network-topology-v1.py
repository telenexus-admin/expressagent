from pathlib import Path


def ensure_replace(path, old, new, already, label):
    text = path.read_text()
    if already in text:
        return
    if old not in text:
        raise SystemExit(f'{label} marker not found in {path}')
    path.write_text(text.replace(old, new, 1))


workspace = Path('frontend/src/pages/BillingWorkspace.jsx')
ensure_replace(workspace, "const BillingNoc = lazy(() => import('./BillingNoc'));\n", "const BillingNoc = lazy(() => import('./BillingNoc'));\nconst BillingTopology = lazy(() => import('./BillingTopology'));\n", "const BillingTopology = lazy(() => import('./BillingTopology'));", 'topology lazy import')
ensure_replace(workspace, "  ['noc', 'NOC', 'pulse'],\n  ['routers', 'Routers', 'router'],\n", "  ['noc', 'NOC', 'pulse'],\n  ['topology', 'Topology', 'topology'],\n  ['routers', 'Routers', 'router'],\n", "['topology', 'Topology', 'topology']", 'topology nav item')
ensure_replace(workspace, "    keys: [\n      'noc',\n      'routers',\n      'radius',\n      'tr069',\n    ],\n", "    keys: [\n      'noc',\n      'topology',\n      'routers',\n      'radius',\n      'tr069',\n    ],\n", "      'topology',\n      'routers',", 'network group topology item')
ensure_replace(workspace, "!['subscribers', 'routers', 'hotspot', 'noc'].includes(tab)", "!['subscribers', 'routers', 'hotspot', 'noc', 'topology'].includes(tab)", "!['subscribers', 'routers', 'hotspot', 'noc', 'topology'].includes(tab)", 'topology workspace header suppression')
ensure_replace(workspace, "        {tab === 'noc' && <Suspense fallback={<BillingWorkspaceSkeleton />}><BillingNoc onOpenRouters={() => go('routers')} /></Suspense>}\n        {tab === 'routers'", "        {tab === 'noc' && <Suspense fallback={<BillingWorkspaceSkeleton />}><BillingNoc onOpenRouters={() => go('routers')} /></Suspense>}\n        {tab === 'topology' && <Suspense fallback={<BillingWorkspaceSkeleton />}><BillingTopology /></Suspense>}\n        {tab === 'routers'", "tab === 'topology'", 'topology render block')
ensure_replace(workspace, "    pulse: <><path d=\"M3 12h4l2.2-5 4.1 10 2.3-5H21\" /><circle cx=\"7\" cy=\"12\" r=\"1\" /><circle cx=\"17\" cy=\"12\" r=\"1\" /></>,\n    clients:", "    pulse: <><path d=\"M3 12h4l2.2-5 4.1 10 2.3-5H21\" /><circle cx=\"7\" cy=\"12\" r=\"1\" /><circle cx=\"17\" cy=\"12\" r=\"1\" /></>,\n    topology: <><circle cx=\"5\" cy=\"6\" r=\"2.2\" /><circle cx=\"19\" cy=\"6\" r=\"2.2\" /><circle cx=\"12\" cy=\"18\" r=\"2.2\" /><path d=\"M7 7.2 10.5 16M17 7.2 13.5 16M7.2 6h9.6\" /></>,\n    clients:", "    topology: <><circle", 'topology navigation icon')

route = Path('backend/src/routes/noc.js')
ensure_replace(route, "const { nocAnalysis, nocHistory, nocOverview, nocRouters, nocStatus } = require('../services/noc');\n", "const { nocAnalysis, nocHistory, nocOverview, nocRouters, nocStatus } = require('../services/noc');\nconst { getNetworkTopology, saveTopologyLocation } = require('../services/topology');\n", "const { getNetworkTopology, saveTopologyLocation } = require('../services/topology');", 'topology service import')
ensure_replace(route, "router.get('/overview', async (req, res) => {\n", "router.get('/topology', async (req, res) => {\n  const clientId = resolveTargetClient(req, res);\n  if (!clientId) return;\n  try { res.json(await getNetworkTopology(clientId)); }\n  catch (err) { console.error('GET /noc/topology error:', err.message); res.status(500).json({ error: err.message || 'Failed to load network topology' }); }\n});\n\nrouter.patch('/topology/routers/:id/location', async (req, res) => {\n  const clientId = resolveTargetClient(req, res);\n  if (!clientId) return;\n  try {\n    const saved = await saveTopologyLocation(clientId, req.params.id, req.body || {});\n    if (!saved) return res.status(404).json({ error: 'Router not found' });\n    res.json(saved);\n  } catch (err) { console.error('PATCH /noc/topology/routers/:id/location error:', err.message); res.status(400).json({ error: err.message || 'Failed to save topology location' }); }\n});\n\nrouter.get('/overview', async (req, res) => {\n", "router.get('/topology'", 'topology routes')

topology = Path('backend/src/services/topology.js')
text = topology.read_text()
needle = "      const link = linkState(snapshot, neighbor.local_interface);\n"
first = text.find(needle)
second = text.find(needle, first + len(needle)) if first >= 0 else -1
if second >= 0:
    text = text[:second] + text[second + len(needle):]
topology.write_text(text)
