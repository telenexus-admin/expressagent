const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  cancelExecutionRequest,
  createExecutionRequest,
  decideExecutionRequest,
  executeApprovedRequest,
  executionFeatureState,
  getExecutionOverview,
  getExecutionRequest,
  getExecutorCredentialStatus,
  listExecutionRequests,
  setRouterExecutorCredential,
  testRouterExecutorCredential,
} = require('../services/networkExecutor');

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

router.get('/execution/overview', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try { res.json(await getExecutionOverview(clientId)); }
  catch (error) { res.status(500).json({ error: 'Failed to load execution overview' }); }
});

router.get('/execution/state', (req, res) => {
  if (!tenant(req, res)) return;
  res.json(executionFeatureState());
});

router.get('/execution-requests', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    res.json({ requests: await listExecutionRequests(clientId, {
      status: req.query.status, routerId: req.query.routerId || req.query.router_id, limit: req.query.limit,
    }), ...executionFeatureState() });
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to load execution requests' }); }
});

router.get('/execution-requests/:requestId', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    const request = await getExecutionRequest(clientId, req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Execution request not found' });
    res.json(request);
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to load execution request' }); }
});

router.post('/plans/:planId/execution-requests', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    const request = await createExecutionRequest(clientId, req.params.planId, req.body || {}, {
      adminId: req.user?.id, idempotencyKey: req.get('Idempotency-Key'),
    });
    res.status(201).json(request);
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to request execution' }); }
});

router.post('/execution-requests/:requestId/decision', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    const request = await decideExecutionRequest(clientId, req.params.requestId, req.body?.decision, {
      adminId: req.user?.id, reason: req.body?.reason,
    });
    if (!request) return res.status(404).json({ error: 'Execution request not found' });
    res.json(request);
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to decide execution request' }); }
});

router.post('/execution-requests/:requestId/execute', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    res.json(await executeApprovedRequest(clientId, req.params.requestId));
  } catch (error) {
    const disabled = /disabled by deployment policy/i.test(error.message);
    res.status(disabled ? 423 : 400).json({ error: error.message || 'Execution failed' });
  }
});

router.post('/execution-requests/:requestId/cancel', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    const request = await cancelExecutionRequest(clientId, req.params.requestId, { adminId: req.user?.id });
    if (!request) return res.status(404).json({ error: 'Cancellable execution request not found' });
    res.json(request);
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to cancel execution request' }); }
});

router.get('/routers/:routerId/executor-credential', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId) return;
  try {
    const credential = await getExecutorCredentialStatus(clientId, Number(req.params.routerId));
    if (!credential) return res.status(404).json({ error: 'Executor credential not configured' });
    res.json(credential);
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to load executor credential' }); }
});

router.put('/routers/:routerId/executor-credential', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try {
    res.json(await setRouterExecutorCredential(clientId, Number(req.params.routerId), req.body || {}, { adminId: req.user?.id }));
  } catch (error) { res.status(400).json({ error: error.message || 'Failed to configure executor credential' }); }
});

router.post('/routers/:routerId/executor-credential/test', async (req, res) => {
  const clientId = tenant(req, res); if (!clientId || !requireAdmin(req, res)) return;
  try { res.json(await testRouterExecutorCredential(clientId, Number(req.params.routerId))); }
  catch (error) { res.status(400).json({ error: error.message || 'Executor credential test failed' }); }
});

module.exports = router;
