const axios = require('axios');
const crypto = require('crypto');
const db = require('../db');

let tableReady = false;

async function ensureEvoOnboardingTable() {
  if (tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS evo_client_onboardings (
      id SERIAL PRIMARY KEY,
      business_name VARCHAR(255) NOT NULL,
      owner_name VARCHAR(255) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      email VARCHAR(255) NOT NULL,
      location VARCHAR(255),
      service_interest VARCHAR(80) DEFAULT 'customer_support',
      consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
      session_token VARCHAR(96) NOT NULL UNIQUE,
      instance_name VARCHAR(120) NOT NULL UNIQUE,
      status VARCHAR(30) NOT NULL DEFAULT 'pending_qr' CHECK (status IN ('provisioning', 'pending_qr', 'connected', 'reviewed', 'active', 'failed', 'archived')),
      qr_code TEXT,
      pairing_code VARCHAR(40),
      pairing_number VARCHAR(50),
      connection_method VARCHAR(20) DEFAULT 'qr' CHECK (connection_method IN ('qr', 'pairing_code')),
      connected_number VARCHAR(80),
      connection_state VARCHAR(40),
      provider_error TEXT,
      webhook_secret VARCHAR(120),
      routing_active BOOLEAN NOT NULL DEFAULT FALSE,
      phone_otp_hash TEXT,
      phone_otp_expires_at TIMESTAMP WITH TIME ZONE,
      phone_otp_sent_at TIMESTAMP WITH TIME ZONE,
      phone_verified_at TIMESTAMP WITH TIME ZONE,
      request_type VARCHAR(40) NOT NULL DEFAULT 'new_client',
      parent_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      agent_label VARCHAR(80),
      connected_at TIMESTAMP WITH TIME ZONE,
      reviewed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS pairing_code VARCHAR(40);
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS pairing_number VARCHAR(50);
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS connection_method VARCHAR(20) DEFAULT 'qr';
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS phone_otp_hash TEXT;
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS phone_otp_expires_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS phone_otp_sent_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(120);
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS routing_active BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS request_type VARCHAR(40) NOT NULL DEFAULT 'new_client';
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS parent_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
    ALTER TABLE evo_client_onboardings ADD COLUMN IF NOT EXISTS agent_label VARCHAR(80);
    ALTER TABLE evo_client_onboardings DROP CONSTRAINT IF EXISTS evo_client_onboardings_request_type_check;
    ALTER TABLE evo_client_onboardings ADD CONSTRAINT evo_client_onboardings_request_type_check CHECK (request_type IN ('new_client', 'additional_agent'));
    ALTER TABLE evo_client_onboardings DROP CONSTRAINT IF EXISTS evo_client_onboardings_connection_method_check;
    ALTER TABLE evo_client_onboardings ADD CONSTRAINT evo_client_onboardings_connection_method_check CHECK (connection_method IN ('qr', 'pairing_code'));
    CREATE INDEX IF NOT EXISTS idx_evo_onboarding_status ON evo_client_onboardings(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evo_onboarding_email ON evo_client_onboardings(email);
  `);
  tableReady = true;
}

function providerConfig() {
  const baseUrl = String(process.env.EVOLUTION_API_URL || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env.EVOLUTION_API_KEY || '').trim();
  if (!baseUrl || !apiKey) throw new Error('Evolution self-onboarding is not configured on the platform yet.');
  return { baseUrl, headers: { apikey: apiKey, 'Content-Type': 'application/json' } };
}

function cleanPhone(number) {
  return String(number || '').replace(/[^0-9]/g, '');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function makeInstanceName(businessName) {
  const slug = String(businessName || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'client';
  return `nexa-${slug}-${crypto.randomBytes(4).toString('hex')}`;
}

function findQr(payload) {
  const candidate = payload?.qrcode?.base64 || payload?.qrcode?.base64Image || payload?.base64 || payload?.qr?.base64 || payload?.data?.qrcode?.base64 || payload?.data?.base64 || null;
  if (!candidate) return null;
  return String(candidate).startsWith('data:image') ? String(candidate) : `data:image/png;base64,${candidate}`;
}

function findPairingCode(payload) {
  const candidate = (
    payload?.pairingCode ||
    payload?.pairing_code ||
    payload?.code ||
    payload?.data?.pairingCode ||
    payload?.data?.pairing_code ||
    payload?.data?.code ||
    payload?.instance?.pairingCode ||
    payload?.instance?.pairing_code ||
    payload?.data?.instance?.pairingCode ||
    payload?.data?.instance?.pairing_code ||
    null
  );
  if (!candidate) return null;
  const cleaned = String(candidate).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned || String(candidate).trim();
}

function findConnectionState(payload) {
  return String(payload?.instance?.state || payload?.state || payload?.data?.instance?.state || payload?.data?.state || '').toLowerCase();
}

async function fetchQr(instanceName) {
  const { baseUrl, headers } = providerConfig();
  const result = await axios.get(`${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`, { headers, timeout: 30000 });
  return findQr(result.data);
}

async function createInstance(instanceName) {
  const { baseUrl, headers } = providerConfig();
  const result = await axios.post(`${baseUrl}/instance/create`, { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }, { headers, timeout: 30000 });
  return findQr(result.data) || fetchQr(instanceName);
}

async function requestPairingFromExistingInstance(instanceName, number) {
  const { baseUrl, headers } = providerConfig();
  const encoded = encodeURIComponent(instanceName);
  const attempts = [
    () => axios.get(`${baseUrl}/instance/connect/${encoded}`, { headers, params: { number }, timeout: 30000 }),
    () => axios.get(`${baseUrl}/instance/connect/${encoded}`, { headers, params: { phoneNumber: number }, timeout: 30000 }),
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const pairingCode = findPairingCode(result.data);
      if (pairingCode) return String(pairingCode);
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function createPairingInstance(instanceName, phoneNumber) {
  const { baseUrl, headers } = providerConfig();
  const number = cleanPhone(phoneNumber);
  if (!number || number.length < 8) throw new Error('A valid WhatsApp number with country code is required.');

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await axios.post(
        `${baseUrl}/instance/create`,
        { instanceName, qrcode: false, number, integration: 'WHATSAPP-BAILEYS' },
        { headers, timeout: 30000 }
      );
      await delay(2500 + (attempt * 1000));
      const pairingCode = await requestPairingFromExistingInstance(instanceName, number);
      if (pairingCode) return { pairingCode: String(pairingCode), number };
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const message = cleanProviderError(err).toLowerCase();
      const canRetry = status === 409 || status === 423 || status === 429 || status >= 500 || message.includes('already') || message.includes('exists') || message.includes('closed');
      if (!canRetry || attempt === 2) break;
      await delay(1200 * (attempt + 1));
    }
  }
  const detail = lastError ? cleanProviderError(lastError) : 'Evolution did not return a pairing code.';
  throw new Error(`Evolution did not return a pairing code after creating a phone-pairing instance. ${detail}`);
}

async function removeInstance(instanceName) {
  const { baseUrl, headers } = providerConfig();
  if (!instanceName) return;
  try {
    await axios.delete(`${baseUrl}/instance/delete/${encodeURIComponent(instanceName)}`, { headers, timeout: 30000 });
  } catch (err) {
    console.warn(`Could not clean unused Evolution instance ${instanceName}:`, err.response?.status || err.message);
  }
}

async function requestPairingCode(instanceName, phoneNumber, options = {}) {
  const number = cleanPhone(phoneNumber);
  if (!number || number.length < 8) throw new Error('A valid WhatsApp number with country code is required.');

  if (!options.forceFresh) {
    try {
      const pairingCode = await requestPairingFromExistingInstance(instanceName, number);
      if (pairingCode) return { pairingCode, number };
    } catch (err) {
      const status = err.response?.status;
      if (status && status !== 404 && status !== 400) {
        console.warn(`Could not get pairing code from existing Evolution instance ${instanceName}:`, cleanProviderError(err));
      }
    }
  }

  await removeInstance(instanceName);
  await delay(1500);
  return createPairingInstance(instanceName, number);
}

async function requestQrReconnect(instanceName) {
  try {
    const qr = await fetchQr(instanceName);
    if (qr) return qr;
  } catch (err) {
    console.warn(`Could not fetch reconnect QR for ${instanceName}, recreating instance:`, err.response?.status || err.message);
  }
  await removeInstance(instanceName);
  return createInstance(instanceName);
}

async function getInstanceState(instanceName) {
  const { baseUrl, headers } = providerConfig();
  const result = await axios.get(`${baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`, { headers, timeout: 30000 });
  return { state: findConnectionState(result.data), raw: result.data };
}

function cleanProviderError(err) {
  const providerMessage = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message || 'Unknown provider error');
  return String(providerMessage).slice(0, 500);
}

async function refreshOnboarding(row) {
  if (!row || ['archived', 'active'].includes(row.status)) return row;
  try {
    const stateResult = await getInstanceState(row.instance_name);
    const connected = ['open', 'connected'].includes(stateResult.state);
    if (connected) {
      const result = await db.query(
        `UPDATE evo_client_onboardings
         SET status = CASE WHEN status = 'active' THEN status ELSE 'connected' END,
             connection_state = $1, connected_at = COALESCE(connected_at, NOW()),
             qr_code = NULL, pairing_code = NULL, provider_error = NULL, updated_at = NOW()
         WHERE id = $2 RETURNING *`, [stateResult.state, row.id]
      );
      return result.rows[0];
    }
    let qr = row.qr_code;
    if (!qr && row.connection_method !== 'pairing_code' && !['failed', 'archived'].includes(row.status)) qr = await fetchQr(row.instance_name);
    const result = await db.query(
      `UPDATE evo_client_onboardings
       SET status = CASE WHEN status = 'failed' THEN status ELSE 'pending_qr' END,
           connection_state = $1, qr_code = COALESCE($2, qr_code), updated_at = NOW()
       WHERE id = $3 RETURNING *`, [stateResult.state || 'waiting_connection', qr, row.id]
    );
    return result.rows[0];
  } catch (err) {
    const error = cleanProviderError(err);
    const result = await db.query(`UPDATE evo_client_onboardings SET provider_error = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [error, row.id]);
    return result.rows[0];
  }
}

module.exports = {
  ensureEvoOnboardingTable,
  makeSessionToken,
  makeInstanceName,
  createInstance,
  createPairingInstance,
  requestPairingCode,
  requestQrReconnect,
  removeInstance,
  refreshOnboarding,
  getInstanceState,
  cleanProviderError,
};
