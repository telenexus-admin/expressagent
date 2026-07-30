import 'dotenv/config';
import express from 'express';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import P from 'pino';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.env.BRIDGE_PORT || 8787);
const apiKey = String(process.env.BRIDGE_API_KEY || '').trim();
const sessionRoot = String(process.env.BRIDGE_SESSION_DIR || './auth').trim();
const log = P({ level: process.env.LOG_LEVEL || 'info' });

if (!apiKey) throw new Error('BRIDGE_API_KEY is required');

const app = express();
app.use(express.json({ limit: '20mb' }));
const sessions = new Map();

function safeInstanceName(value) {
  const name = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,119}$/.test(name)) throw new Error('Invalid WhatsApp instance name');
  return name;
}

function normalizeJid(value) {
  const raw = String(value || '').trim();
  if (/^[0-9]+@(s\.whatsapp\.net|lid)$/i.test(raw)) return raw;
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function auth(req, res, next) {
  if (req.path === '/health') return next();
  if (req.get('apikey') !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function sessionSummary(session) {
  return {
    instance: { instanceName: session.name, state: session.state },
    state: session.state,
    qrcode: session.qrDataUrl,
    base64: session.qrDataUrl,
    pairingCode: session.pairingCode,
    lastError: session.lastError,
  };
}

async function deliverWebhook(session, payload) {
  if (!session.webhookUrl) return;
  try {
    const response = await fetch(session.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) log.warn({ instance: session.name, status: response.status }, 'Nexa webhook rejected message');
  } catch (error) {
    log.error({ err: error, instance: session.name }, 'Could not deliver Baileys webhook');
  }
}

function scheduleReconnect(session) {
  if (session.reconnectTimer) return;
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    startSession(session).catch((error) => log.error({ err: error, instance: session.name }, 'Baileys reconnect failed'));
  }, 3000);
}

async function startSession(session) {
  if (session.socket) return session.socket;
  await fs.mkdir(session.authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (error) {
    log.warn({ err: error, instance: session.name }, 'Could not fetch current WhatsApp Web version');
  }
  const socket = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    printQRInTerminal: false,
    browser: ['Nexa onboarding bridge', 'Chrome', '1.0.0'],
    logger: log.child({ component: 'baileys', instance: session.name }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  session.socket = socket;
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      session.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 420 });
      session.pairingCode = null;
      session.state = 'connecting';
      session.lastError = null;
      log.info({ instance: session.name }, 'Baileys QR code is ready');
    }
    if (connection) {
      session.state = connection === 'open' ? 'open' : 'close';
      if (connection === 'open') {
        session.qrDataUrl = null;
        session.pairingCode = null;
        session.lastError = null;
        log.info({ instance: session.name }, 'Baileys WhatsApp session connected');
      }
      if (connection === 'close') {
        session.socket = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        session.lastError = String(lastDisconnect?.error?.message || `connection closed (${code || 'unknown'})`);
        if (code !== DisconnectReason.loggedOut) scheduleReconnect(session);
        else log.error({ instance: session.name }, 'Baileys session logged out; new QR or pairing session is required');
      }
    }
  });
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages || []) {
      if (!message?.key || message.key.fromMe) continue;
      await deliverWebhook(session, {
        event: 'messages.upsert',
        instance: session.name,
        data: {
          key: message.key,
          pushName: message.pushName || '',
          status: 'PENDING',
          message: message.message || {},
          messageType: Object.keys(message.message || {})[0] || 'conversation',
          messageTimestamp: message.messageTimestamp,
          source: 'baileys',
        },
        destination: 'nexa-local-bridge',
        date_time: new Date().toISOString(),
        sender: 'nexa-baileys-bridge',
        server_url: `http://127.0.0.1:${port}`,
      });
    }
  });
  return socket;
}

async function getSession(instanceName) {
  const name = safeInstanceName(instanceName);
  if (!sessions.has(name)) {
    sessions.set(name, {
      name,
      authDir: path.join(sessionRoot, name),
      socket: null,
      state: 'close',
      qrDataUrl: null,
      pairingCode: null,
      webhookUrl: null,
      lastError: null,
      reconnectTimer: null,
    });
  }
  const session = sessions.get(name);
  await startSession(session);
  return session;
}

async function waitForHandshake(session, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.socket && session.state !== 'close') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('WhatsApp connection handshake did not complete');
}

function getSessionFromRequest(req) {
  return getSession(decodeURIComponent(String(req.params.instance || '')));
}

app.use(auth);
app.get('/health', (_req, res) => res.json({ status: 'ok', provider: 'baileys', sessions: [...sessions.values()].map(sessionSummary) }));

app.post('/instance/create', async (req, res) => {
  try {
    const session = await getSession(req.body?.instanceName || req.body?.instance || 'nexa-onboarding');
    res.json({ ...sessionSummary(session), status: 'created' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/instance/connect/:instance', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (req.query.number) {
      const phoneNumber = normalizePhone(req.query.number);
      if (phoneNumber.length < 8) return res.status(400).json({ error: 'A full WhatsApp number with country code is required' });
      await waitForHandshake(session);
      session.pairingCode = await session.socket.requestPairingCode(phoneNumber);
      session.qrDataUrl = null;
      log.info({ instance: session.name, phoneSuffix: phoneNumber.slice(-4) }, 'Baileys pairing code generated');
    }
    res.json(sessionSummary(session));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/instance/connectionState/:instance', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    res.json({ instance: { instanceName: session.name, state: session.state } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/webhook/set/:instance', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    const webhook = req.body?.webhook || {};
    session.webhookUrl = webhook.enabled && webhook.url ? String(webhook.url) : null;
    res.json({ status: 'success', enabled: Boolean(session.webhookUrl), url: session.webhookUrl });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function sendWithSession(req, res, builder) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session.socket || session.state !== 'open') return res.status(503).json({ error: 'WhatsApp instance is not connected' });
    const result = await builder(session, normalizeJid(req.body?.number));
    res.json({ status: 'PENDING', key: result?.key || {}, message: result?.message || {} });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}

app.post('/chat/sendPresence/:instance', (req, res) => sendWithSession(req, res, (session, jid) => session.socket.sendPresenceUpdate(req.body?.presence || 'composing', jid)));
app.post('/message/sendText/:instance', (req, res) => sendWithSession(req, res, (session, jid) => session.socket.sendMessage(jid, { text: String(req.body?.text || '') })));
app.post('/message/sendWhatsAppAudio/:instance', (req, res) => sendWithSession(req, res, (session, jid) => session.socket.sendMessage(jid, { audio: Buffer.from(String(req.body?.audio || ''), 'base64'), mimetype: req.body?.mimetype || 'audio/ogg; codecs=opus', ptt: req.body?.ptt !== false })));
app.post('/message/sendMedia/:instance', (req, res) => sendWithSession(req, res, (session, jid) => {
  const buffer = Buffer.from(String(req.body?.media || ''), 'base64');
  const mediaType = String(req.body?.mediatype || '').toLowerCase();
  const content = mediaType === 'image'
    ? { image: buffer, mimetype: req.body?.mimetype, caption: req.body?.caption || '' }
    : { document: buffer, mimetype: req.body?.mimetype, fileName: req.body?.fileName || 'attachment', caption: req.body?.caption || '' };
  return session.socket.sendMessage(jid, content);
}));

app.listen(port, '127.0.0.1', () => log.info({ port, sessionRoot }, 'Nexa per-instance Baileys bridge listening'));
