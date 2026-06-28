const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const db = require('../db');

const DEFAULT_FEATURES = {
  ppp_active: true,
  ppp_secrets: true,
  hotspot_active: true,
  dhcp_leases: true,
  interfaces: true,
  logs: true,
  ping: true,
};

function encryptionKey() {
  return crypto
    .createHash('sha256')
    .update(process.env.MIKROTIK_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET || 'nexa-mikrotik-secret')
    .digest();
}

function encryptSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `gcm:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (!text.startsWith('gcm:')) return text;
  const [, iv64, tag64, data64] = text.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv64, 'base64'));
  decipher.setAuthTag(Buffer.from(tag64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data64, 'base64')), decipher.final()]).toString('utf8');
}

async function ensureMikrotikTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mikrotik_routers (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name VARCHAR(160) NOT NULL,
      host VARCHAR(255) NOT NULL,
      port INTEGER NOT NULL DEFAULT 8728,
      connection_type VARCHAR(20) NOT NULL DEFAULT 'api',
      username VARCHAR(120) NOT NULL,
      password_encrypted TEXT NOT NULL,
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_status VARCHAR(40),
      last_error TEXT,
      last_identity VARCHAR(180),
      last_version VARCHAR(120),
      last_uptime VARCHAR(120),
      last_seen_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_client ON mikrotik_routers(client_id, is_active)`);
}

function cleanFeatures(features) {
  const incoming = typeof features === 'object' && features ? features : {};
  return Object.fromEntries(Object.keys(DEFAULT_FEATURES).map((key) => [key, incoming[key] !== false]));
}

function safeRouter(row) {
  const features = cleanFeatures(row.features);
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    connection_type: row.connection_type || 'api',
    username: row.username,
    password_configured: Boolean(row.password_encrypted),
    features,
    is_active: row.is_active !== false,
    last_status: row.last_status || '',
    last_error: row.last_error || '',
    last_identity: row.last_identity || '',
    last_version: row.last_version || '',
    last_uptime: row.last_uptime || '',
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  if (length < 0x200000) return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  if (length < 0x10000000) return Buffer.from([(length >> 24) | 0xe0, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
  return Buffer.from([0xf0, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

function encodeWord(word) {
  const data = Buffer.from(String(word), 'utf8');
  return Buffer.concat([encodeLength(data.length), data]);
}

class RouterOsApi {
  constructor({ host, port, secure }) {
    this.host = host;
    this.port = Number(port || (secure ? 8729 : 8728));
    this.secure = secure;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const options = { host: this.host, port: this.port, rejectUnauthorized: false };
      const socket = this.secure ? tls.connect(options) : net.connect(options);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('MikroTik connection timed out'));
      }, 15000);
      socket.once(this.secure ? 'secureConnect' : 'connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on('data', (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); });
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  close() {
    if (this.socket) this.socket.end();
  }

  writeSentence(words) {
    const payload = Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
    this.socket.write(payload);
  }

  async waitForBuffer(count, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (this.buffer.length < count) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('MikroTik API response timed out');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async readByte() {
    await this.waitForBuffer(1);
    const byte = this.buffer[0];
    this.buffer = this.buffer.slice(1);
    return byte;
  }

  async readBytes(count) {
    await this.waitForBuffer(count);
    const chunk = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return chunk;
  }

  async readLength() {
    const first = await this.readByte();
    if ((first & 0x80) === 0x00) return first;
    if ((first & 0xc0) === 0x80) return ((first & ~0xc0) << 8) + await this.readByte();
    if ((first & 0xe0) === 0xc0) return ((first & ~0xe0) << 16) + ((await this.readByte()) << 8) + await this.readByte();
    if ((first & 0xf0) === 0xe0) return ((first & ~0xf0) << 24) + ((await this.readByte()) << 16) + ((await this.readByte()) << 8) + await this.readByte();
    return ((await this.readByte()) << 24) + ((await this.readByte()) << 16) + ((await this.readByte()) << 8) + await this.readByte();
  }

  async readWord() {
    const length = await this.readLength();
    if (length === 0) return '';
    return (await this.readBytes(length)).toString('utf8');
  }

  async readSentence() {
    const words = [];
    while (true) {
      const word = await this.readWord();
      if (!word) return words;
      words.push(word);
    }
  }

  async command(command, attrs = {}) {
    const words = [command, ...Object.entries(attrs).map(([key, value]) => `=${key}=${value}`)];
    this.writeSentence(words);
    const rows = [];
    while (true) {
      const sentence = await this.readSentence();
      const marker = sentence[0];
      const data = {};
      for (const word of sentence.slice(1)) {
        const match = word.match(/^=([^=]+)=(.*)$/);
        if (match) data[match[1]] = match[2];
      }
      if (marker === '!re') rows.push(data);
      if (marker === '!trap' || marker === '!fatal') throw new Error(data.message || 'RouterOS command failed');
      if (marker === '!done') return rows;
    }
  }

  async login(username, password) {
    await this.command('/login', { name: username, password });
  }
}

async function connectRouter(config) {
  const client = new RouterOsApi({
    host: config.host,
    port: config.port,
    secure: config.connection_type === 'api-ssl',
  });
  await client.connect();
  await client.login(config.username, config.password);
  return client;
}

async function probeRouter(config) {
  const client = await connectRouter(config);
  try {
    const identityRows = await client.command('/system/identity/print');
    const resourceRows = await client.command('/system/resource/print');
    const pppRows = await client.command('/ppp/active/print').catch(() => []);
    const hotspotRows = await client.command('/ip/hotspot/active/print').catch(() => []);
    const interfaceRows = await client.command('/interface/print').catch(() => []);
    const identity = identityRows[0] || {};
    const resource = resourceRows[0] || {};
    return {
      identity: identity.name || '',
      version: resource.version || '',
      uptime: resource.uptime || '',
      cpu_load: resource['cpu-load'] || '',
      free_memory: resource['free-memory'] || '',
      ppp_active_count: pppRows.length,
      hotspot_active_count: hotspotRows.length,
      interface_count: interfaceRows.length,
    };
  } finally {
    client.close();
  }
}

async function listRouters(clientId) {
  await ensureMikrotikTables();
  const result = await db.query(`SELECT * FROM mikrotik_routers WHERE client_id = $1 ORDER BY created_at DESC`, [clientId]);
  return result.rows.map(safeRouter);
}

async function getRouter(clientId, id, { includePassword = false } = {}) {
  await ensureMikrotikTables();
  const result = await db.query(`SELECT * FROM mikrotik_routers WHERE client_id = $1 AND id = $2 LIMIT 1`, [clientId, id]);
  const row = result.rows[0];
  if (!row) return null;
  return includePassword ? { ...row, password: decryptSecret(row.password_encrypted) } : safeRouter(row);
}

async function saveRouter(clientId, payload = {}) {
  await ensureMikrotikTables();
  const id = payload.id ? Number(payload.id) : null;
  const name = String(payload.name || '').trim().slice(0, 160);
  const host = String(payload.host || '').trim();
  const port = Number(payload.port || (payload.connection_type === 'api-ssl' ? 8729 : 8728));
  const connectionType = payload.connection_type === 'api-ssl' ? 'api-ssl' : 'api';
  const username = String(payload.username || '').trim().slice(0, 120);
  const features = cleanFeatures(payload.features);
  if (!name) throw new Error('Router name is required');
  if (!host) throw new Error('Router host/IP is required');
  if (!username) throw new Error('MikroTik username is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid MikroTik API port');

  if (id) {
    const current = await getRouter(clientId, id, { includePassword: false });
    if (!current) return null;
    const passwordSql = payload.password ? ', password_encrypted = $8' : '';
    const params = [name, host, port, connectionType, username, JSON.stringify(features), payload.is_active !== false, clientId, id];
    if (payload.password) params.splice(7, 0, encryptSecret(payload.password));
    const result = await db.query(
      `UPDATE mikrotik_routers
       SET name = $1, host = $2, port = $3, connection_type = $4, username = $5,
           features = $6::jsonb, is_active = $7, updated_at = NOW()${passwordSql}
       WHERE client_id = $${params.length - 1} AND id = $${params.length}
       RETURNING *`,
      params
    );
    return safeRouter(result.rows[0]);
  }

  if (!payload.password) throw new Error('MikroTik password is required');
  const result = await db.query(
    `INSERT INTO mikrotik_routers
       (client_id, name, host, port, connection_type, username, password_encrypted, features, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     RETURNING *`,
    [clientId, name, host, port, connectionType, username, encryptSecret(payload.password), JSON.stringify(features), payload.is_active !== false]
  );
  return safeRouter(result.rows[0]);
}

async function testRouterConfig(config) {
  const password = config.password || (config.password_encrypted ? decryptSecret(config.password_encrypted) : '');
  return probeRouter({ ...config, password });
}

async function updateRouterStatus(clientId, id, status) {
  const result = await db.query(
    `UPDATE mikrotik_routers
     SET last_status = $1, last_error = $2, last_identity = $3, last_version = $4,
         last_uptime = $5, last_seen_at = CASE WHEN $1 = 'online' THEN NOW() ELSE last_seen_at END,
         updated_at = NOW()
     WHERE client_id = $6 AND id = $7
     RETURNING *`,
    [
      status.ok ? 'online' : 'error',
      status.error || null,
      status.identity || null,
      status.version || null,
      status.uptime || null,
      clientId,
      id,
    ]
  );
  return result.rows[0] ? safeRouter(result.rows[0]) : null;
}

async function deleteRouter(clientId, id) {
  await ensureMikrotikTables();
  const result = await db.query(`DELETE FROM mikrotik_routers WHERE client_id = $1 AND id = $2 RETURNING id`, [clientId, id]);
  return Boolean(result.rows[0]);
}

module.exports = {
  DEFAULT_FEATURES,
  deleteRouter,
  ensureMikrotikTables,
  getRouter,
  listRouters,
  saveRouter,
  testRouterConfig,
  updateRouterStatus,
};
