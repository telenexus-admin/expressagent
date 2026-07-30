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
const { previewMikrotikAlert } = require('../services/mikrotikMonitor');
const { prepareSinglePaste } = require('../services/onePasteOnboarding');
const { previewProvisioning, applyProvisioning } = require('../services/mikrotikProvisioning');
const { recordRequestEvent } = require('../services/events');

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
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try {
    const single = await prepareSinglePaste(clientId, req.body || {});
    await recordRequestEvent(req, {
      eventType: 'router.onboarding_prepared',
      category: 'router',
      source: 'mikrotik_api',
      entityType: 'router_onboarding',
      entityId: single.tunnel_ip,
      title: 'Router onboarding script prepared',
      payload: {
        router_name: String(req.body?.name || '').trim(),
        tunnel_ip: single.tunnel_ip,
        expires_in_minutes: single.expires_in_minutes,
      },
      deduplicationKey: `router-onboarding:${clientId}:${single.tunnel_ip}:prepared`,
      sensitivity: 'restricted',
    });
    res.json({ tunnel_ip: single.tunnel_ip, api_host: single.tunnel_ip, api_port: 8728, api_connection_type: 'api', username: 'nexa', single_paste: true, expires_in_minutes: single.expires_in_minutes, radius_host: single.radius_host, mikrotikScript: single.script, warning: single.warning });
  } catch (err) { console.error('Prepare single-paste onboarding error:', err.message); res.status(400).json({ error: err.message || 'Could not prepare onboarding script' }); }
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

router.post('/:id/provision/preview', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try { res.json(await previewProvisioning(clientId, Number(req.params.id), req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message || 'Could not preview MikroTik provisioning' }); }
});

router.post('/:id/provision', async (req, res) => {
  const clientId = resolveTargetClient(req, res); if (!clientId) return;
  try {
    const result = await applyProvisioning(clientId, Number(req.params.id), req.body || {});
    await recordRequestEvent(req, {
      eventType: 'router.provisioned',
      category: 'router',
      source: 'mikrotik_api',
      entityType: 'router',
      entityId: req.params.id,
      title: 'Router provisioning applied',
      payload: result,
      deduplicationKey: `router:${req.params.id}:provisioned:${Date.now()}`,
      sensitivity: 'restricted',
    });
    res.json(result);
  }
  catch (err) { console.error('MikroTik provisioning error:', err.message); res.status(400).json({ error: err.message || 'MikroTik provisioning failed' }); }
});
router.post('/alerts/test', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const result = await previewMikrotikAlert({
      clientId,
      routerId: req.body.router_id || req.body.routerId,
      eventType: req.body.event_type || req.body.eventType || 'high_cpu',
      variables: req.body.variables || {},
      send: req.body.send === true,
    });
    res.json(result);
  } catch (err) {
    console.error('POST /mikrotik/alerts/test error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to test MikroTik alert' });
  }
});

router.post('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const routerConfig = await saveRouter(clientId, req.body);
    if (!routerConfig) return res.status(404).json({ error: 'MikroTik router not found' });
    await recordRequestEvent(req, {
      eventType: req.body.id ? 'router.updated' : 'router.created',
      category: 'router',
      source: 'mikrotik_api',
      entityType: 'router',
      entityId: routerConfig.id,
      title: req.body.id ? 'Router updated' : 'Router added',
      description: routerConfig.name,
      payload: {
        name: routerConfig.name,
        connection_method: routerConfig.connection_method,
        connection_type: routerConfig.connection_type,
        is_active: routerConfig.is_active,
        host: routerConfig.host,
        port: routerConfig.port,
      },
      newState: {
        name: routerConfig.name,
        is_active: routerConfig.is_active,
        connection_method: routerConfig.connection_method,
      },
      deduplicationKey: req.body.id ? `router:${routerConfig.id}:updated:${Date.now()}` : `router:${routerConfig.id}:created`,
      sensitivity: 'restricted',
    });
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
    await recordRequestEvent(req, {
      eventType: 'router.deleted',
      category: 'router',
      source: 'mikrotik_api',
      entityType: 'router',
      entityId: req.params.id,
      severity: 'warning',
      title: 'Router removed',
      deduplicationKey: `router:${req.params.id}:deleted`,
      sensitivity: 'restricted',
    });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /mikrotik/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete MikroTik router' });
  }
});

module.exports = router;
