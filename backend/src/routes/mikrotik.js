const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  activateWireguardPeer,
  deleteRouter,
  getRouter,
  listMikrotikClients,
  listRouters,
  prepareWireguardOnboarding,
  saveRouter,
  syncMikrotikClients,
  testRouterConfig,
  updateRouterStatus,
} = require('../services/mikrotik');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

function connectionSummary(probe) {
  return {
    ok: true,
    identity: probe.identity || '',
    version: probe.version || '',
    uptime: probe.uptime || '',
    cpu_load: probe.cpu_load || '',
    free_memory: probe.free_memory || '',
    ppp_active_count: probe.ppp_active_count || 0,
    hotspot_active_count: probe.hotspot_active_count || 0,
    interface_count: probe.interface_count || 0,
  };
}

router.get('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await listRouters(clientId));
  } catch (err) {
    console.error('GET /mikrotik error:', err.message);
    res.status(500).json({ error: 'Failed to load MikroTik routers' });
  }
});

router.get('/clients', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await listMikrotikClients(clientId, req.query || {}));
  } catch (err) {
    console.error('GET /mikrotik/clients error:', err.message);
    res.status(500).json({ error: 'Failed to load MikroTik clients' });
  }
});

router.post('/clients/sync', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await syncMikrotikClients(clientId));
  } catch (err) {
    console.error('POST /mikrotik/clients/sync error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to sync MikroTik clients' });
  }
});

router.post('/wireguard/prepare', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const plan = await prepareWireguardOnboarding(clientId, req.body || {});
    res.json(plan);
  } catch (err) {
    console.error('POST /mikrotik/wireguard/prepare error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to prepare WireGuard onboarding' });
  }
});

router.post('/wireguard/activate', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const result = await activateWireguardPeer(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('POST /mikrotik/wireguard/activate error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to activate WireGuard peer' });
  }
});

router.post('/test', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    let config = req.body || {};
    if (req.body.id && !req.body.password) {
      const saved = await getRouter(clientId, req.body.id, { includePassword: true });
      if (!saved) return res.status(404).json({ error: 'MikroTik router not found' });
      config = { ...saved, ...req.body, password: saved.password };
    }
    const probe = await testRouterConfig(config);
    if (req.body.id) await updateRouterStatus(clientId, req.body.id, { ok: true, ...probe });
    res.json(connectionSummary(probe));
  } catch (err) {
    const message = err.message || 'MikroTik connection failed';
    if (req.body?.id) await updateRouterStatus(clientId, req.body.id, { ok: false, error: message }).catch(() => {});
    console.error('POST /mikrotik/test error:', message);
    res.status(400).json({ error: message });
  }
});

router.post('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const routerConfig = await saveRouter(clientId, req.body);
    if (!routerConfig) return res.status(404).json({ error: 'MikroTik router not found' });
    res.status(req.body.id ? 200 : 201).json(routerConfig);
  } catch (err) {
    console.error('POST /mikrotik error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to save MikroTik router' });
  }
});

router.delete('/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const deleted = await deleteRouter(clientId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'MikroTik router not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /mikrotik/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete MikroTik router' });
  }
});

module.exports = router;
