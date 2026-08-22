'use strict';
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const SOCKET_PATH = process.env.NEXA_NETWORK_EXECUTOR_SOCKET || '/run/nexa-network-executor/control.sock';
const WG_INTERFACE = process.env.NEXA_WG_INTERFACE || 'wg0';
const WG_SUBNET_PREFIX = process.env.NEXA_WG_SUBNET_PREFIX || '10.77.0.';
const WG_CONFIG = `/etc/wireguard/${WG_INTERFACE}.conf`;
const MAX_REQUEST = 4096;

if (!/^[A-Za-z0-9_.=-]{1,15}$/.test(WG_INTERFACE)) throw new Error('Invalid configured WireGuard interface');
if (!/^10\.77\.0\.$/.test(WG_SUBNET_PREFIX)) throw new Error('WireGuard subnet prefix is not approved');

function validatePublicKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error('Invalid WireGuard public key');
  return key;
}

function validateTunnelIp(value) {
  const ip = String(value || '').trim();
  const match = ip.match(/^10\.77\.0\.(\d{1,3})$/);
  const host = Number(match?.[1]);
  if (!match || !Number.isInteger(host) || host < 2 || host > 254) throw new Error('Tunnel IP is outside the managed subnet');
  return ip;
}

async function persist() {
  const result = await execFileAsync('/usr/bin/wg', ['showconf', WG_INTERFACE], { timeout: 10000, maxBuffer: 1024 * 1024 });
  const temporary = `${WG_CONFIG}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, result.stdout, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, WG_CONFIG);
  fs.chmodSync(WG_CONFIG, 0o600);
}

async function execute(payload) {
  const operation = String(payload?.operation || '');
  const publicKey = validatePublicKey(payload?.public_key);
  const keyFingerprint = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  if (operation === 'activate-peer') {
    const tunnelIp = validateTunnelIp(payload?.tunnel_ip);
    await execFileAsync('/usr/bin/wg', ['set', WG_INTERFACE, 'peer', publicKey, 'allowed-ips', `${tunnelIp}/32`], { timeout: 10000 });
    try { await persist(); } catch (error) {
      await execFileAsync('/usr/bin/wg', ['set', WG_INTERFACE, 'peer', publicKey, 'remove'], { timeout: 10000 }).catch(() => {});
      throw error;
    }
    console.log(JSON.stringify({ event: 'wireguard_peer_activated', key_fingerprint: keyFingerprint, tunnel_ip: tunnelIp }));
    return { ok: true, interface: WG_INTERFACE, tunnel_ip: tunnelIp };
  }
  if (operation === 'remove-peer') {
    await execFileAsync('/usr/bin/wg', ['set', WG_INTERFACE, 'peer', publicKey, 'remove'], { timeout: 10000 });
    await persist();
    console.log(JSON.stringify({ event: 'wireguard_peer_removed', key_fingerprint: keyFingerprint }));
    return { ok: true, interface: WG_INTERFACE };
  }
  throw new Error('Operation is not permitted');
}

fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true, mode: 0o750 });
try { fs.unlinkSync(SOCKET_PATH); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const server = net.createServer((socket) => {
  let buffer = '';
  socket.setTimeout(5000, () => socket.destroy());
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    if (Buffer.byteLength(buffer) > MAX_REQUEST) return socket.destroy();
    const newline = buffer.indexOf('\n');
    if (newline < 0) return;
    const line = buffer.slice(0, newline);
    buffer = '';
    Promise.resolve().then(() => JSON.parse(line)).then(execute)
      .then((result) => socket.end(`${JSON.stringify(result)}\n`))
      .catch((error) => socket.end(`${JSON.stringify({ ok: false, error: error.message || 'Executor rejected request' })}\n`));
  });
  socket.on('error', () => {});
});

server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o660);
  console.log(`Nexa network executor listening on ${SOCKET_PATH}`);
});

function stop(signal) {
  console.log(`Stopping network executor after ${signal}`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
