const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { nocHistory, nocOverview, nocRouters, nocStatus } = require('../services/noc');

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
