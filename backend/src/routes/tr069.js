const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { recordBillingEvent, recordRequestEvent } = require('../services/events');
const { observeTwinEntity, observeTwinRelationship } = require('../services/digitalTwin');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);
let telemetrySchedulerStarted = false;
let telemetrySchedulerBusy = false;

function clientId(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

function key() {
  const secret = process.env.RADIUS_CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('Credential encryption key is not configured');
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(value) {
  if (!value) return '';
  const [version, ivHex, tagHex, payloadHex] = String(value).split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !payloadHex) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(payloadHex, 'hex')), decipher.final()]).toString('utf8');
}

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tr069_configs (
      client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      nbi_url TEXT NOT NULL,
      cwmp_url TEXT,
      api_token_encrypted TEXT,
      cpe_username TEXT,
      cpe_password_encrypted TEXT,
      inform_interval INTEGER NOT NULL DEFAULT 300,
      tenant_tag TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_tested_at TIMESTAMPTZ,
      last_test_status TEXT,
      last_test_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tr069_device_cache (
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      serial_number TEXT,
      manufacturer TEXT,
      model_name TEXT,
      software_version TEXT,
      ip_address TEXT,
      mac_address TEXT,
      ssid TEXT,
      rx_power_dbm NUMERIC,
      tx_power_dbm NUMERIC,
      uptime_seconds BIGINT,
      last_inform TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'offline',
      raw_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS tr069_device_locations (
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      subscriber_id INTEGER REFERENCES billing_subscribers(id) ON DELETE SET NULL,
      latitude NUMERIC(10,7),
      longitude NUMERIC(10,7),
      address TEXT,
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, device_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tr069_cache_client_status ON tr069_device_cache(client_id, status);
  `);
}

function tenantTag(id) {
  return `nexa-client-${id}`;
}

function valueAt(device, paths) {
  for (const path of paths) {
    let current = device;
    for (const part of path.split('.')) current = current && current[part];
    if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, '_value')) current = current._value;
    if (Array.isArray(current)) current = current.length > 1 && typeof current[0] === 'string' && current[0].includes('T') ? current[1] : current[0];
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return null;
}

function normalizeDevice(device) {
  const lastInform = device._lastInform || valueAt(device, ['Events.Inform']);
  const ageMs = lastInform ? Date.now() - new Date(lastInform).getTime() : Number.POSITIVE_INFINITY;
  const rx = Number(valueAt(device, [
    'VirtualParameters.RXPower',
    'Device.Optical.Interface.1.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower',
  ]));
  const status = ageMs <= 15 * 60 * 1000 ? (Number.isFinite(rx) && rx < -27 ? 'warning' : 'online') : 'offline';
  return {
    device_id: String(device._id || ''),
    serial_number: valueAt(device, ['DeviceID.SerialNumber', '_deviceId._SerialNumber', 'Device.DeviceInfo.SerialNumber', 'InternetGatewayDevice.DeviceInfo.SerialNumber']),
    manufacturer: valueAt(device, ['DeviceID.Manufacturer', '_deviceId._Manufacturer', 'Device.DeviceInfo.Manufacturer', 'InternetGatewayDevice.DeviceInfo.Manufacturer']),
    model_name: valueAt(device, ['DeviceID.ProductClass', '_deviceId._ProductClass', 'Device.DeviceInfo.ModelName', 'InternetGatewayDevice.DeviceInfo.ModelName']),
    software_version: valueAt(device, ['Device.DeviceInfo.SoftwareVersion', 'InternetGatewayDevice.DeviceInfo.SoftwareVersion']),
    ip_address: valueAt(device, ['VirtualParameters.IP', 'Device.IP.Interface.1.IPv4Address.1.IPAddress', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress']),
    mac_address: valueAt(device, ['VirtualParameters.MAC', 'Device.Ethernet.Interface.1.MACAddress', 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress']),
    ssid: valueAt(device, ['Device.WiFi.SSID.1.SSID', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID']),
    rx_power_dbm: Number.isFinite(rx) ? rx : null,
    tx_power_dbm: Number(valueAt(device, ['VirtualParameters.TXPower', 'Device.Optical.Interface.1.TXPower'])) || null,
    uptime_seconds: Number(valueAt(device, ['Device.DeviceInfo.UpTime', 'InternetGatewayDevice.DeviceInfo.UpTime'])) || 0,
    last_inform: lastInform || null,
    status,
  };
}

async function configFor(id) {
  await ensureSchema();
  const result = await db.query('SELECT * FROM tr069_configs WHERE client_id = $1 LIMIT 1', [id]);
  return result.rows[0] || null;
}

function acsClient(config) {
  if (!config?.nbi_url) throw new Error('Configure the ACS NBI URL first');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const token = decrypt(config.api_token_encrypted);
  if (token) headers.Authorization = `Bearer ${token}`;
  return axios.create({ baseURL: String(config.nbi_url).replace(/\/$/, ''), headers, timeout: 20000 });
}

async function syncDevices(id) {
  const config = await configFor(id);
  if (!config?.enabled) throw new Error('TR-069 is not configured for this billing account');
  const api = acsClient(config);
  const query = JSON.stringify({ _tags: config.tenant_tag });
  const response = await api.get('/devices/', { params: { query } });
  const devices = Array.isArray(response.data) ? response.data.map(normalizeDevice).filter((item) => item.device_id) : [];
  const previousResult = await db.query(
    `SELECT device_id, status, last_inform, rx_power_dbm, software_version
     FROM tr069_device_cache WHERE client_id = $1`,
    [id]
  );
  const previousById = new Map(previousResult.rows.map((item) => [String(item.device_id), item]));
  const locationResult = await db.query(
    `SELECT device_id, subscriber_id FROM tr069_device_locations WHERE client_id = $1`,
    [id]
  );
  const subscriberByDevice = new Map(
    locationResult.rows.filter((row) => row.subscriber_id).map((row) => [String(row.device_id), row.subscriber_id])
  );
  for (const item of devices) {
    await db.query(
      `INSERT INTO tr069_device_cache
       (client_id, device_id, serial_number, manufacturer, model_name, software_version, ip_address, mac_address, ssid,
        rx_power_dbm, tx_power_dbm, uptime_seconds, last_inform, status, raw_summary, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())
       ON CONFLICT (client_id, device_id) DO UPDATE SET
        serial_number=EXCLUDED.serial_number, manufacturer=EXCLUDED.manufacturer, model_name=EXCLUDED.model_name,
        software_version=EXCLUDED.software_version, ip_address=EXCLUDED.ip_address, mac_address=EXCLUDED.mac_address,
        ssid=EXCLUDED.ssid, rx_power_dbm=EXCLUDED.rx_power_dbm, tx_power_dbm=EXCLUDED.tx_power_dbm,
        uptime_seconds=EXCLUDED.uptime_seconds, last_inform=EXCLUDED.last_inform, status=EXCLUDED.status,
        raw_summary=EXCLUDED.raw_summary, synced_at=NOW()`,
      [id, item.device_id, item.serial_number, item.manufacturer, item.model_name, item.software_version, item.ip_address,
        item.mac_address, item.ssid, item.rx_power_dbm, item.tx_power_dbm, item.uptime_seconds, item.last_inform,
        item.status, JSON.stringify(item)]
    );
    const previous = previousById.get(String(item.device_id));
    if (!previous || previous.status !== item.status) {
      await recordBillingEvent({
        clientId: id,
        eventType: previous ? 'ont.status_changed' : 'ont.discovered',
        category: 'ont',
        source: 'tr069_sync',
        entityType: 'ont',
        entityId: String(item.device_id).slice(0, 160),
        actorType: 'system',
        severity: item.status === 'offline' ? 'warning' : item.status === 'warning' ? 'warning' : 'info',
        title: previous ? 'ONT status changed' : 'ONT discovered',
        description: `${item.manufacturer || ''} ${item.model_name || ''}`.trim() || item.device_id,
        payload: item,
        previousState: previous || {},
        newState: {
          status: item.status,
          last_inform: item.last_inform,
          rx_power_dbm: item.rx_power_dbm,
          software_version: item.software_version,
        },
        deduplicationKey: previous
          ? `ont:${id}:${item.device_id}:status:${item.status}:${item.last_inform || 'unknown'}`
          : `ont:${id}:${item.device_id}:discovered`,
        sensitivity: 'restricted',
      });
    }
    await observeTwinEntity({
      clientId: id,
      eventType: 'ont.observed',
      category: 'ont',
      source: 'tr069_live',
      entityType: 'ont',
      entityId: String(item.device_id).slice(0, 160),
      displayName: [item.manufacturer, item.model_name, item.serial_number].filter(Boolean).join(' ') || item.device_id,
      state: {
        status: item.status,
        operational_status: item.status === 'online' || item.status === 'warning' ? 'online' : 'offline',
        health_status: item.status === 'warning' ? 'degraded' : item.status === 'offline' ? 'critical' : 'healthy',
        serial_number: item.serial_number,
        manufacturer: item.manufacturer,
        model_name: item.model_name,
        software_version: item.software_version,
        ip_address: item.ip_address,
        mac_address: item.mac_address,
        ssid: item.ssid,
        rx_power_dbm: item.rx_power_dbm,
        tx_power_dbm: item.tx_power_dbm,
        uptime_seconds: item.uptime_seconds,
        last_inform: item.last_inform,
      },
      observedAt: item.last_inform || new Date(),
      severity: item.status === 'offline' ? 'critical' : item.status === 'warning' ? 'warning' : 'info',
      sensitivity: 'restricted',
    });
    const subscriberId = subscriberByDevice.get(String(item.device_id));
    if (subscriberId) await observeTwinRelationship({
      clientId: id,
      fromEntityType: 'ont',
      fromEntityId: String(item.device_id).slice(0, 160),
      relationship: 'assigned_subscriber',
      toEntityType: 'subscriber',
      toEntityId: subscriberId,
      active: true,
      observedAt: item.last_inform || new Date(),
    });
  }
  return devices;
}

async function runTr069TelemetryOnce() {
  if (telemetrySchedulerBusy) return { skipped: true, accounts: 0, devices: 0 };
  telemetrySchedulerBusy = true;
  let devices = 0;
  let failed = 0;
  try {
    await ensureSchema();
    const configs = await db.query(
      `SELECT client_id, last_test_status FROM tr069_configs WHERE enabled = TRUE ORDER BY client_id`
    );
    for (const config of configs.rows) {
      try {
        const synced = await syncDevices(config.client_id);
        devices += synced.length;
        await db.query(
          `UPDATE tr069_configs
           SET last_tested_at = NOW(), last_test_status = 'online', last_test_error = NULL, updated_at = NOW()
           WHERE client_id = $1`,
          [config.client_id]
        );
        await observeTwinEntity({
          clientId: config.client_id,
          eventType: 'tr069.connection_observed',
          category: 'tr069',
          source: 'tr069_monitor_live',
          entityType: 'tr069_configuration',
          entityId: config.client_id,
          displayName: 'TR-069 ACS connection',
          state: {
            online: true,
            operational_status: 'online',
            health_status: 'healthy',
            device_count: synced.length,
          },
          observedAt: new Date(),
          sensitivity: 'restricted',
        });
        if (config.last_test_status && config.last_test_status !== 'online') await recordBillingEvent({
          clientId: config.client_id,
          eventType: 'tr069.connection_recovered',
          category: 'tr069',
          source: 'tr069_monitor',
          entityType: 'tr069_configuration',
          entityId: config.client_id,
          actorType: 'system',
          severity: 'info',
          title: 'TR-069 connection recovered',
          newState: { status: 'online', device_count: synced.length },
          deduplicationKey: `tr069-monitor:${config.client_id}:recovered:${Date.now()}`,
          sensitivity: 'restricted',
        });
      } catch (error) {
        failed += 1;
        await db.query(
          `UPDATE tr069_configs
           SET last_tested_at = NOW(), last_test_status = 'offline', last_test_error = $2, updated_at = NOW()
           WHERE client_id = $1`,
          [config.client_id, String(error.message || 'TR-069 synchronization failed').slice(0, 500)]
        );
        await observeTwinEntity({
          clientId: config.client_id,
          eventType: 'tr069.connection_failed',
          category: 'tr069',
          source: 'tr069_monitor_live',
          entityType: 'tr069_configuration',
          entityId: config.client_id,
          displayName: 'TR-069 ACS connection',
          state: {
            online: false,
            operational_status: 'offline',
            health_status: 'critical',
            last_error: String(error.message || 'TR-069 synchronization failed').slice(0, 500),
          },
          severity: 'critical',
          observedAt: new Date(),
          sensitivity: 'restricted',
        }).catch(() => {});
        if (config.last_test_status !== 'offline') await recordBillingEvent({
          clientId: config.client_id,
          eventType: 'tr069.connection_failed',
          category: 'tr069',
          source: 'tr069_monitor',
          entityType: 'tr069_configuration',
          entityId: config.client_id,
          actorType: 'system',
          severity: 'warning',
          title: 'TR-069 connection failed',
          description: String(error.message || 'TR-069 synchronization failed').slice(0, 500),
          newState: { status: 'offline' },
          deduplicationKey: `tr069-monitor:${config.client_id}:offline:${Date.now()}`,
          sensitivity: 'restricted',
        }).catch(() => {});
      }
    }
    return { accounts: configs.rows.length, devices, failed };
  } finally {
    telemetrySchedulerBusy = false;
  }
}

function startTr069TelemetryScheduler() {
  if (telemetrySchedulerStarted) return;
  telemetrySchedulerStarted = true;
  const intervalMs = Math.max(60000, Number(process.env.TR069_MONITOR_INTERVAL_MS) || 300000);
  setTimeout(() => {
    runTr069TelemetryOnce().catch((error) => console.error('TR-069 telemetry startup failed:', error.message));
  }, 15000);
  const timer = setInterval(() => {
    runTr069TelemetryOnce().catch((error) => console.error('TR-069 telemetry poll failed:', error.message));
  }, intervalMs);
  timer.unref?.();
  console.log(`TR-069 telemetry scheduler ready (${intervalMs}ms interval).`);
}

router.get('/config', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  try {
    const config = await configFor(id);
    res.json(config ? {
      configured: true, nbi_url: config.nbi_url, cwmp_url: config.cwmp_url || '', cpe_username: config.cpe_username || '',
      inform_interval: config.inform_interval, tenant_tag: config.tenant_tag, enabled: config.enabled,
      has_api_token: Boolean(config.api_token_encrypted), has_cpe_password: Boolean(config.cpe_password_encrypted),
      last_tested_at: config.last_tested_at, last_test_status: config.last_test_status, last_test_error: config.last_test_error,
    } : { configured: false, tenant_tag: tenantTag(id), inform_interval: 300 });
  } catch (error) { res.status(500).json({ error: 'Could not load TR-069 configuration' }); }
});

router.put('/config', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  const nbiUrl = String(req.body.nbi_url || '').trim();
  const cwmpUrl = String(req.body.cwmp_url || '').trim();
  if (!/^https?:\/\//i.test(nbiUrl)) return res.status(400).json({ error: 'Enter a valid ACS NBI URL' });
  if (cwmpUrl && !/^https?:\/\//i.test(cwmpUrl)) return res.status(400).json({ error: 'Enter a valid CWMP URL' });
  try {
    await ensureSchema();
    const current = await configFor(id);
    const apiToken = String(req.body.api_token || '').trim();
    const cpePassword = String(req.body.cpe_password || '').trim();
    await db.query(
      `INSERT INTO tr069_configs
       (client_id,nbi_url,cwmp_url,api_token_encrypted,cpe_username,cpe_password_encrypted,inform_interval,tenant_tag,enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (client_id) DO UPDATE SET nbi_url=EXCLUDED.nbi_url,cwmp_url=EXCLUDED.cwmp_url,
        api_token_encrypted=EXCLUDED.api_token_encrypted,cpe_username=EXCLUDED.cpe_username,
        cpe_password_encrypted=EXCLUDED.cpe_password_encrypted,inform_interval=EXCLUDED.inform_interval,
        enabled=EXCLUDED.enabled,updated_at=NOW()`,
      [id, nbiUrl.replace(/\/$/, ''), cwmpUrl.replace(/\/$/, ''), apiToken ? encrypt(apiToken) : current?.api_token_encrypted || null,
        String(req.body.cpe_username || '').trim(), cpePassword ? encrypt(cpePassword) : current?.cpe_password_encrypted || null,
        Math.max(60, Math.min(86400, Number(req.body.inform_interval || 300))), tenantTag(id), req.body.enabled !== false]
    );
    await recordRequestEvent(req, {
      clientId: id,
      eventType: current ? 'tr069.configuration_updated' : 'tr069.configuration_created',
      category: 'tr069',
      source: 'tr069_api',
      entityType: 'tr069_configuration',
      entityId: id,
      title: current ? 'TR-069 configuration updated' : 'TR-069 configuration created',
      payload: {
        nbi_url: nbiUrl.replace(/\/$/, ''),
        cwmp_url: cwmpUrl.replace(/\/$/, ''),
        inform_interval: Math.max(60, Math.min(86400, Number(req.body.inform_interval || 300))),
        tenant_tag: tenantTag(id),
        enabled: req.body.enabled !== false,
      },
      deduplicationKey: `tr069-config:${id}:${Date.now()}`,
      sensitivity: 'restricted',
    });
    res.json({ success: true, tenant_tag: tenantTag(id) });
  } catch (error) { console.error('TR-069 config save error:', error.message); res.status(500).json({ error: 'Could not save TR-069 configuration' }); }
});

router.post('/test', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  try {
    const config = await configFor(id);
    const response = await acsClient(config).get('/devices/', { params: { query: JSON.stringify({ _tags: config.tenant_tag }), projection: '_id', limit: 1 } });
    await db.query(`UPDATE tr069_configs SET last_tested_at=NOW(),last_test_status='online',last_test_error=NULL WHERE client_id=$1`, [id]);
    await recordRequestEvent(req, {
      clientId: id,
      eventType: 'tr069.connection_tested',
      category: 'tr069',
      source: 'tr069_api',
      entityType: 'tr069_configuration',
      entityId: id,
      title: 'TR-069 connection test succeeded',
      payload: { reachable: true, devices_visible: Array.isArray(response.data) ? response.data.length : 0 },
      deduplicationKey: `tr069-test:${id}:${Date.now()}`,
      sensitivity: 'restricted',
    });
    res.json({ success: true, reachable: true, devices_visible: Array.isArray(response.data) ? response.data.length : 0 });
  } catch (error) {
    await db.query(`UPDATE tr069_configs SET last_tested_at=NOW(),last_test_status='offline',last_test_error=$2 WHERE client_id=$1`, [id, String(error.message).slice(0, 500)]).catch(() => {});
    await recordRequestEvent(req, {
      clientId: id,
      eventType: 'tr069.connection_failed',
      category: 'tr069',
      source: 'tr069_api',
      entityType: 'tr069_configuration',
      entityId: id,
      actorType: 'system',
      severity: 'warning',
      title: 'TR-069 connection test failed',
      payload: { reachable: false, error: error.message },
      deduplicationKey: `tr069-test-failed:${id}:${Date.now()}`,
      sensitivity: 'restricted',
    }).catch(() => {});
    res.status(400).json({ error: `ACS connection failed: ${error.message}` });
  }
});

router.post('/sync', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  try {
    const devices = await syncDevices(id);
    await recordRequestEvent(req, {
      clientId: id,
      eventType: 'tr069.devices_synced',
      category: 'tr069',
      source: 'tr069_api',
      entityType: 'tr069_configuration',
      entityId: id,
      title: 'TR-069 devices synchronized',
      payload: { device_count: devices.length },
      deduplicationKey: `tr069-sync:${id}:${Date.now()}`,
      sensitivity: 'restricted',
    });
    res.json({ success: true, synced: devices.length });
  }
  catch (error) { res.status(400).json({ error: error.message || 'Could not synchronize TR-069 devices' }); }
});

router.get('/devices', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  try {
    await ensureSchema();
    if (req.query.refresh === '1') await syncDevices(id).catch(() => {});
    const result = await db.query(
      `SELECT c.*,l.latitude,l.longitude,l.address,l.notes,l.subscriber_id,s.full_name AS subscriber_name,
              s.account_number,r.name AS router_name
       FROM tr069_device_cache c
       LEFT JOIN tr069_device_locations l ON l.client_id=c.client_id AND l.device_id=c.device_id
       LEFT JOIN billing_subscribers s ON s.id=l.subscriber_id AND s.client_id=c.client_id
       LEFT JOIN mikrotik_routers r ON r.id=s.router_id AND r.client_id=s.client_id
       WHERE c.client_id=$1 ORDER BY c.status='online' DESC,c.last_inform DESC NULLS LAST`,
      [id]
    );
    res.json(result.rows);
  } catch (error) { console.error('TR-069 device list error:', error.message); res.status(500).json({ error: 'Could not load ONTs' }); }
});

router.get('/summary', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  try {
    await ensureSchema();
    const [config, stats] = await Promise.all([
      configFor(id),
      db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='online')::int online,
        COUNT(*) FILTER(WHERE status='offline')::int offline,COUNT(*) FILTER(WHERE status='warning')::int warning,
        COUNT(*) FILTER(WHERE l.latitude IS NULL OR l.longitude IS NULL)::int unmapped
        FROM tr069_device_cache c LEFT JOIN tr069_device_locations l ON l.client_id=c.client_id AND l.device_id=c.device_id
        WHERE c.client_id=$1`, [id]),
    ]);
    res.json({ configured: Boolean(config), acs_status: config?.last_test_status || 'not_configured', tenant_tag: config?.tenant_tag || tenantTag(id), ...stats.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Could not load TR-069 summary' }); }
});

router.post('/claim', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  const deviceId = String(req.body.device_id || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'Enter the GenieACS device ID' });
  try {
    const config = await configFor(id);
    const api = acsClient(config);
    const found = await api.get('/devices/', { params: { query: JSON.stringify({ _id: deviceId }), projection: '_id' } });
    if (!Array.isArray(found.data) || !found.data.length) return res.status(404).json({ error: 'Device was not found in this ACS' });
    await api.post(`/devices/${encodeURIComponent(deviceId)}/tags/${encodeURIComponent(config.tenant_tag)}`);
    await syncDevices(id);
    await recordRequestEvent(req, {
      clientId: id,
      eventType: 'ont.claimed',
      category: 'ont',
      source: 'tr069_api',
      entityType: 'ont',
      entityId: deviceId.slice(0, 160),
      title: 'ONT claimed',
      payload: { device_id: deviceId, tenant_tag: config.tenant_tag },
      deduplicationKey: `ont:${id}:${deviceId}:claimed`,
      sensitivity: 'restricted',
    });
    res.json({ success: true, device_id: deviceId });
  } catch (error) { res.status(400).json({ error: error.message || 'Could not claim ONT' }); }
});

router.put('/devices/:deviceId/location', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  const latitude = Number(req.body.latitude); const longitude = Number(req.body.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Enter valid latitude and longitude' });
  }
  try {
    await ensureSchema();
    const exists = await db.query(
      `SELECT cache.device_id, location.subscriber_id
       FROM tr069_device_cache cache
       LEFT JOIN tr069_device_locations location
         ON location.client_id = cache.client_id AND location.device_id = cache.device_id
       WHERE cache.client_id=$1 AND cache.device_id=$2`,
      [id, req.params.deviceId]
    );
    if (!exists.rows[0]) return res.status(404).json({ error: 'ONT not found in this billing account' });
    await db.query(
      `INSERT INTO tr069_device_locations(client_id,device_id,subscriber_id,latitude,longitude,address,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(client_id,device_id) DO UPDATE SET
       subscriber_id=EXCLUDED.subscriber_id,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
       address=EXCLUDED.address,notes=EXCLUDED.notes,updated_at=NOW()`,
      [id, req.params.deviceId, req.body.subscriber_id || null, latitude, longitude, String(req.body.address || '').trim(), String(req.body.notes || '').trim()]
    );
    await recordRequestEvent(req, {
      clientId: id,
      eventType: 'ont.location_updated',
      category: 'ont',
      source: 'tr069_api',
      entityType: 'ont',
      entityId: String(req.params.deviceId).slice(0, 160),
      title: 'ONT location updated',
      payload: {
        latitude,
        longitude,
        address: String(req.body.address || '').trim(),
        subscriber_id: req.body.subscriber_id || null,
      },
      relatedEntities: req.body.subscriber_id ? [{ entityType: 'subscriber', entityId: req.body.subscriber_id, relationship: 'assigned_subscriber' }] : [],
      deduplicationKey: `ont:${id}:${req.params.deviceId}:location:${Date.now()}`,
      sensitivity: 'restricted',
    });
    const previousSubscriberId = exists.rows[0]?.subscriber_id;
    const nextSubscriberId = req.body.subscriber_id || null;
    if (previousSubscriberId && String(previousSubscriberId) !== String(nextSubscriberId || '')) {
      await observeTwinRelationship({
        clientId: id,
        fromEntityType: 'ont',
        fromEntityId: String(req.params.deviceId).slice(0, 160),
        relationship: 'assigned_subscriber',
        toEntityType: 'subscriber',
        toEntityId: previousSubscriberId,
        active: false,
        observedAt: new Date(),
      });
    }
    if (nextSubscriberId) await observeTwinRelationship({
      clientId: id,
      fromEntityType: 'ont',
      fromEntityId: String(req.params.deviceId).slice(0, 160),
      relationship: 'assigned_subscriber',
      toEntityType: 'subscriber',
      toEntityId: nextSubscriberId,
      active: true,
      observedAt: new Date(),
    });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Could not save ONT location' }); }
});

router.post('/devices/:deviceId/action', async (req, res) => {
  const id = clientId(req, res); if (!id) return;
  const action = String(req.body.action || '').trim();
  const allowed = ['refresh', 'reboot', 'set_wifi'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Unsupported TR-069 action' });
  try {
    await ensureSchema();
    const owned = await db.query('SELECT 1 FROM tr069_device_cache WHERE client_id=$1 AND device_id=$2', [id, req.params.deviceId]);
    if (!owned.rows[0]) return res.status(404).json({ error: 'ONT not found in this billing account' });
    const config = await configFor(id);
    let task = { name: action === 'refresh' ? 'refreshObject' : action };
    if (action === 'refresh') task.objectName = '';
    if (action === 'set_wifi') {
      const ssid = String(req.body.ssid || '').trim(); const password = String(req.body.password || '');
      if (!ssid || password.length < 8) return res.status(400).json({ error: 'Enter an SSID and a Wi-Fi password of at least 8 characters' });
      task = { name: 'setParameterValues', parameterValues: [
        ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', ssid, 'xsd:string'],
        ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey', password, 'xsd:string'],
      ] };
    }
    const response = await acsClient(config).post(`/devices/${encodeURIComponent(req.params.deviceId)}/tasks`, task, { params: { connection_request: '' } });
    await recordRequestEvent(req, {
      clientId: id,
      eventType: 'ont.action_queued',
      category: 'ont',
      source: 'tr069_api',
      entityType: 'ont',
      entityId: String(req.params.deviceId).slice(0, 160),
      title: 'ONT action queued',
      description: action,
      payload: {
        action,
        queued: response.status === 202,
        ssid: action === 'set_wifi' ? String(req.body.ssid || '').trim() : null,
      },
      deduplicationKey: `ont:${id}:${req.params.deviceId}:action:${action}:${Date.now()}`,
      sensitivity: 'restricted',
    });
    res.status(response.status === 202 ? 202 : 200).json({ success: true, queued: response.status === 202, task: response.data });
  } catch (error) { res.status(400).json({ error: error.response?.data?.message || error.message || 'TR-069 action failed' }); }
});

router.runTr069TelemetryOnce = runTr069TelemetryOnce;
router.startTr069TelemetryScheduler = startTr069TelemetryScheduler;
module.exports = router;
