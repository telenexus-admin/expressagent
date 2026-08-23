import http from 'node:http';
import { config, validateConfig } from './config.js';
import { CallRegistry } from './calls.js';
import { RtpEchoBridge } from './media.js';

const registry = new CallRegistry();
const startupErrors = validateConfig();
const mediaBridge = new RtpEchoBridge({ host: '127.0.0.1', port: Number(process.env.EXTERNAL_MEDIA_PORT || 12000) });

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(payload);
}

function authorized(req) {
  if (!config.sharedSecret) return false;
  const supplied = req.headers.authorization || '';
  const expected = `Bearer ${config.sharedSecret}`;
  return supplied.length === expected.length && cryptoTimingSafeEqual(supplied, expected);
}

function cryptoTimingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && (awaitableCompare(left, right));
}

function awaitableCompare(left, right) {
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left[i] ^ right[i];
  return result === 0;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, startupErrors.length ? 503 : 200, {
      status: startupErrors.length ? 'misconfigured' : 'ok',
      service: 'nexa-voice-gateway',
      calls: registry.list().length,
      mediaBridge: mediaBridge.started ? 'listening' : 'stopped',
      errors: startupErrors,
    });
  }

  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET' && url.pathname === '/v1/calls') return json(res, 200, { calls: registry.list() });

  if (req.method === 'POST' && url.pathname === '/v1/calls') {
    const call = registry.create({ state: 'accepted', source: 'ari-pending' });
    return json(res, 202, { call });
  }

  const match = url.pathname.match(/^\/v1\/calls\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const call = registry.get(match[1]);
    return call ? json(res, 200, { call }) : json(res, 404, { error: 'Call not found' });
  }

  return json(res, 404, { error: 'Not found' });
});

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  mediaBridge.start();
  server.listen(config.port, config.host, () => {
    console.log(`nexa-voice-gateway listening on ${config.host}:${config.port}`);
    if (startupErrors.length) console.error(`configuration errors: ${startupErrors.join('; ')}`);
  });
}

export { server, registry, mediaBridge };
