from pathlib import Path

noc = Path('backend/src/routes/noc.js')
text = noc.read_text()
text = text.replace("const { Readable } = require('stream');\n", "const https = require('https');\n")
start = text.index('async function proxyOpenFreeMap(req, res) {')
end = text.index("\n\nrouter.get('/routers'", start)
replacement = r'''function proxyOpenFreeMap(req, res) {
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
        return res.send(rewriteOpenFreeMapJson(body));
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
}'''
text = text[:start] + replacement + text[end:]
noc.write_text(text)

frontend = Path('frontend/src/pages/BillingFibreGis.jsx')
text = frontend.read_text()
old = "const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';\n"
new = """const MAP_STYLE = '/api/noc/fibre-gis/map/styles/liberty';
const MAP_PROXY_PATH = '/api/noc/fibre-gis/map/';

function transformMapRequest(url) {
  if (!String(url || '').includes(MAP_PROXY_PATH)) return { url };
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url };
}
"""
if old not in text:
    raise SystemExit('MAP_STYLE anchor missing')
text = text.replace(old, new, 1)
anchor = "        attributionControl: true,\n"
if anchor not in text:
    raise SystemExit('map options anchor missing')
text = text.replace(anchor, anchor + "        transformRequest: transformMapRequest,\n", 1)
frontend.write_text(text)
