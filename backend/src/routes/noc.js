const express = require('express');
const https = require('https');
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

const OPENFREEMAP_ORIGIN = 'https://tiles.openfreemap.org';
const MAP_PROXY_PREFIX = '/api/noc/fibre-gis/map';
const MAP_PROXY_MAX_BYTES = 10 * 1024 * 1024;

function safeMapProxyPath(value) {
  const path = String(value || '').replace(/^\/+/, '');
  if (!path || path.includes('..') || path.includes('\\') || path.includes('://')) return '';
  return path;
}

function mapProxyAbsoluteBase(req) {
  const candidates = [req.get('origin'), req.get('referer')];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return `${parsed.origin}${MAP_PROXY_PREFIX}`;
      }
    } catch (_) {}
  }

  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || String(req.get('host') || '').trim();
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : (req.secure ? 'https' : 'http');

  if (host && /^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    return `${protocol}://${host}${MAP_PROXY_PREFIX}`;
  }
  return MAP_PROXY_PREFIX;
}

function rewriteOpenFreeMapJson(value, req) {
  const proxyBase = mapProxyAbsoluteBase(req);
  return String(value || '')
    .replaceAll('https://tiles.openfreemap.org', proxyBase)
    .replaceAll('http://tiles.openfreemap.org', proxyBase);
}

function proxyOpenFreeMap(req, res) {
  const path = safeMapProxyPath(req.params[0]);
  if (!path) return res.status(400).json({ error: 'Invalid map resource path' });

  const target = new URL(`${OPENFREEMAP_ORIGIN}/${path}`);
  for (const [key, rawValue] of Object.entries(req.query || {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    values.forEach((value) => target.searchParams.append(key, String(value ?? '')));
  }

  const upstreamRequest = https.request({
    protocol: 'https:',
    hostname: target.hostname,
    port: 443,
    method: 'GET',
    path: `${target.pathname}${target.search}`,
    family: 4,
    headers: {
      Accept: req.get('accept') || '*/*',
      'Accept-Encoding': 'identity',
      'User-Agent': 'Polyizon-FibreGIS/1.0',
    },
  }, (upstream) => {
    const status = Number(upstream.statusCode || 502);
    const contentType = String(upstream.headers['content-type'] || 'application/octet-stream');
    const contentLength = Number(upstream.headers['content-length'] || 0);

    if (contentLength > MAP_PROXY_MAX_BYTES) {
      upstream.resume();
      return res.status(413).json({ error: 'Map resource is too large' });
    }

    res.status(status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', upstream.headers['cache-control'] || 'public, max-age=86400');
    const etag = upstream.headers.etag;
    if (etag) res.setHeader('ETag', etag);
    const lastModified = upstream.headers['last-modified'];
    if (lastModified) res.setHeader('Last-Modified', lastModified);

    const needsRewrite = contentType.includes('json') || path.startsWith('styles/');
    if (needsRewrite || status < 200 || status >= 300) {
      const chunks = [];
      let total = 0;
      upstream.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAP_PROXY_MAX_BYTES) {
          upstream.destroy(new Error('Map resource is too large'));
          return;
        }
        chunks.push(chunk);
      });
      upstream.on('end', () => {
        if (res.writableEnded) return;
        const body = Buffer.concat(chunks).toString('utf8');
        if (status < 200 || status >= 300) {
          return res.send(body || `Map provider returned ${status}`);
        }
        return res.send(rewriteOpenFreeMapJson(body, req));
      });
      upstream.on('error', (error) => {
        console.error('Fibre GIS map proxy upstream error:', error.message);
        if (!res.headersSent) res.status(502).json({ error: 'Map provider stream failed' });
        else if (!res.writableEnded) res.destroy(error);
      });
      return;
    }

    let streamed = 0;
    upstream.on('data', (chunk) => {
      streamed += chunk.length;
      if (streamed > MAP_PROXY_MAX_BYTES) upstream.destroy(new Error('Map resource is too large'));
    });
    upstream.on('error', (error) => {
      console.error('Fibre GIS map proxy stream error:', error.message);
      if (!res.headersSent) res.status(502).end();
      else if (!res.writableEnded) res.destroy(error);
    });
    upstream.pipe(res);
  });

  upstreamRequest.setTimeout(15000, () => {
    const error = new Error('Map provider timed out');
    error.code = 'MAP_TIMEOUT';
    upstreamRequest.destroy(error);
  });

  upstreamRequest.on('error', (error) => {
    console.error('Fibre GIS map proxy error:', error.message);
    if (!res.headersSent) {
      res.status(error.code === 'MAP_TIMEOUT' ? 504 : 502).json({
        error: error.code === 'MAP_TIMEOUT' ? 'Map provider timed out' : 'Map provider unavailable',
      });
    }
  });

  upstreamRequest.end();
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

router.get('/fibre-gis/map/*', proxyOpenFreeMap);

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
