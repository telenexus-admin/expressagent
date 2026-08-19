import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');

const host = process.env.PANEL_BIND_HOST || '127.0.0.1';
const port = Number(process.env.PANEL_PORT || 3015);
const domain = process.env.PANEL_DOMAIN || 'phone.polyizon.tech';
const extension = process.env.PANEL_EXTENSION || '7001';
const username = process.env.PANEL_SIP_USERNAME || extension;
const password = process.env.PANEL_SIP_PASSWORD || '';
const displayName = process.env.PANEL_DISPLAY_NAME || 'Nexa Phone';
const cdrPath = process.env.ASTERISK_CDR_CSV || '/var/log/asterisk/cdr-csv/Master.csv';

const dids = [
  { did: '254207913951', label: '020 7913951', dialPrefix: '951' },
  { did: '254207913952', label: '020 7913952', dialPrefix: '952' },
  { did: '254207913953', label: '020 7913953', dialPrefix: '953' },
];

if (!password) {
  console.error('PANEL_SIP_PASSWORD is required');
  process.exit(1);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
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

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function statusFor(disposition, direction) {
  const upper = String(disposition || '').toUpperCase();
  if (upper === 'ANSWERED') return { status: 'Answered', statusClass: 'answered' };
  if (upper === 'NO ANSWER') {
    return direction === 'incoming'
      ? { status: 'Missed', statusClass: 'missed' }
      : { status: 'No answer', statusClass: 'failed' };
  }
  if (['BUSY', 'FAILED', 'CONGESTION'].includes(upper)) return { status: upper === 'BUSY' ? 'Busy' : 'Failed', statusClass: 'failed' };
  return { status: upper || 'Ended', statusClass: 'other' };
}

function formatStart(value) {
  if (!value) return 'Unknown time';
  const parsed = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function normalizeOutgoingDestination(dst) {
  const value = String(dst || '').replace(/\D/g, '');
  for (const item of dids) {
    if (value.startsWith(item.dialPrefix) && value.slice(item.dialPrefix.length).startsWith('254')) {
      return value.slice(item.dialPrefix.length);
    }
  }
  return value;
}

function readCalls(limit) {
  if (!fs.existsSync(cdrPath)) return [];
  const data = fs.readFileSync(cdrPath, 'utf8');
  const lines = data.split(/\r?\n/).filter(Boolean);
  const allowedDids = new Set(dids.map((item) => item.did));
  const calls = [];

  for (let i = lines.length - 1; i >= 0 && calls.length < limit; i -= 1) {
    const f = parseCsvLine(lines[i]);
    if (f.length < 15) continue;

    const [
      accountcode,
      src,
      dst,
      dcontext,
      clid,
      channel,
      dstchannel,
      lastapp,
      lastdata,
      start,
      answer,
      end,
      duration,
      billsec,
      disposition,
      amaflags,
      uniqueid,
      userfield,
    ] = f;

    let direction = null;
    let number = '';
    let did = '';

    if (allowedDids.has(dst) && ['from-cloudone', 'nexa-phone-inbound'].includes(dcontext)) {
      direction = 'incoming';
      number = String(src || '').replace(/^\+/, '');
      did = dst;
    } else if (dcontext === 'from-nexa-phone' || String(userfield || '').startsWith('OUTDID:')) {
      direction = 'outgoing';
      number = normalizeOutgoingDestination(dst);
      did = String(userfield || '').startsWith('OUTDID:')
        ? String(userfield).slice('OUTDID:'.length)
        : '';
    }

    if (!direction) continue;

    const mapped = statusFor(disposition, direction);
    calls.push({
      id: uniqueid || `${start}-${i}`,
      direction,
      directionLabel: direction === 'incoming' ? 'Incoming' : 'Outgoing',
      number,
      did,
      start,
      timeLabel: formatStart(start),
      duration: Number(duration || 0),
      billsec: Number(billsec || 0),
      disposition,
      ...mapped,
    });
  }

  return calls;
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.resolve(distDir, `.${requested}`);
  if (!filePath.startsWith(`${distDir}${path.sep}`) && filePath !== path.join(distDir, 'index.html')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Phone panel build is missing.');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'microphone=(self)',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' wss:; media-src 'self' blob:; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || domain}`);

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { status: 'ok', service: 'nexa-phone-panel' });
    }

    if (url.pathname === '/api/config') {
      return sendJson(res, 200, {
        extension,
        username,
        password,
        displayName,
        sipDomain: domain,
        websocket: `wss://${domain}/ws`,
        outboundDids: dids,
      });
    }

    if (url.pathname === '/api/calls') {
      const requested = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 40)));
      return sendJson(res, 200, { calls: readCalls(requested) });
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error('phone-panel request error:', error.message);
    return sendJson(res, 500, { error: 'Phone panel request failed' });
  }
});

server.listen(port, host, () => {
  console.log(`Nexa phone panel listening on http://${host}:${port}`);
});
