import http from 'node:http';
import { config, validateConfig } from './config.js';
import { CallRegistry } from './calls.js';
import { AriClient } from './ari.js';
import { RtpMediaSession } from './media.js';
import { OpenAIRealtimeSession } from './openai.js';

const registry = new CallRegistry();
const startupErrors = validateConfig();
const activeCalls = new Map();

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
  const supplied = req.headers.authorization || '';
  const expected = `Bearer ${config.sharedSecret}`;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a[i] ^ b[i];
  return result === 0;
}

function nextMediaPort() {
  for (let port = config.externalMediaPortStart; port <= config.externalMediaPortMax; port += 1) {
    const used = [...activeCalls.values()].some((call) => call.media?.port === port);
    if (!used) return port;
  }
  throw new Error('No external media ports available');
}

async function cleanupCall(channelId, reason = 'ended') {
  const active = activeCalls.get(channelId);
  if (!active) return;
  activeCalls.delete(channelId);
  if (active.timer) clearTimeout(active.timer);
  active.openai.stop();
  active.media.stop();
  if (active.bridgeId) {
    try { await active.ari.deleteBridge(active.bridgeId); } catch (error) { console.warn(`Bridge cleanup failed: ${error.message}`); }
  }
  registry.update(active.callId, { state: 'ended', endReason: reason });
}

async function handleAri(event, ari) {
  if (event.channel?.name?.startsWith('UnicastRTP/')) return;

  if (event.type === 'StasisStart' && event.channel?.id) {
    if (activeCalls.has(event.channel.id)) return;
    const call = registry.create({
      channelId: event.channel.id,
      caller: event.channel.caller?.number || event.channel.caller?.name || null,
      state: 'starting',
    });

    let media;
    let openai;
    try {
      media = new RtpMediaSession({
        host: config.externalMediaHost,
        port: nextMediaPort(),
        onAudio: (payload) => openai?.sendAudio(payload),
        onError: (error) => console.error(`RTP error for ${call.id}: ${error.message}`),
      });
      await media.start();

      openai = new OpenAIRealtimeSession({
        callId: call.id,
        onAudio: (payload) => media.sendAudio(payload),
        onTranscript: (entry) => {
          if (entry.text) console.log(`[${call.id}] caller: ${entry.text}`);
          if (entry.delta) process.stdout.write(`[${call.id}] Nexa: ${entry.delta}`);
        },
        onError: (error) => {
          console.error(`OpenAI realtime error for ${call.id}: ${error.message}`);
          registry.update(call.id, { state: 'ai-error', error: error.message });
        },
        onClose: () => registry.update(call.id, { aiConnection: 'closed' }),
      }).start();

      const bridge = await ari.createBridge();
      const externalHost = `${config.externalMediaHost}:${media.port}`;
      const externalMedia = await ari.createExternalMedia(externalHost);
      await ari.addToBridge(bridge.id, [event.channel.id, externalMedia.id]);

      activeCalls.set(event.channel.id, {
        callId: call.id,
        bridgeId: bridge.id,
        mediaChannelId: externalMedia.id,
        media,
        openai,
        ari,
        timer: setTimeout(() => {
          ari.hangupChannel(event.channel.id).catch(() => {});
        }, config.maxCallSeconds * 1000),
      });

      registry.update(call.id, {
        state: 'connected',
        bridgeId: bridge.id,
        mediaChannelId: externalMedia.id,
        mediaPort: media.port,
        aiConnection: 'connecting',
      });
    } catch (error) {
      if (openai) openai.stop();
      if (media) media.stop();
      registry.update(call.id, { state: 'failed', error: error.message });
      try { await ari.hangupChannel(event.channel.id); } catch {}
    }
    return;
  }

  if (event.type === 'StasisEnd' && event.channel?.id) {
    await cleanupCall(event.channel.id, 'stasis-ended');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, startupErrors.length ? 503 : 200, {
      status: startupErrors.length ? 'misconfigured' : 'ok',
      service: 'nexa-voice-gateway',
      calls: registry.list().length,
      activeCalls: activeCalls.size,
      errors: startupErrors,
      openai: config.openaiModel,
    });
  }
  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });
  if (req.method === 'GET' && url.pathname === '/v1/calls') return json(res, 200, { calls: registry.list() });
  return json(res, 404, { error: 'Not found' });
});

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const ari = new AriClient();
  if (startupErrors.length) {
    console.error(`Nexa Voice Gateway configuration errors: ${startupErrors.join('; ')}`);
  }
  ari.connect((event) => handleAri(event, ari).catch((error) => console.error(`ARI event error: ${error.message}`)))
    .on('error', (error) => console.error(`ARI connection error: ${error.message}`));
  server.listen(config.port, config.host, () => console.log(`nexa-voice-gateway listening on ${config.host}:${config.port}`));
}

export { server, registry, activeCalls, handleAri, nextMediaPort };
