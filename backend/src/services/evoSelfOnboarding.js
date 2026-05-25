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
      connected_number VARCHAR(80),
      connection_state VARCHAR(40),
      provider_error TEXT,
      connected_at TIMESTAMP WITH TIME ZONE,
      reviewed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_evo_onboarding_status ON evo_client_onboardings(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evo_onboarding_email ON evo_client_onboardings(email);
  `);
  tableReady = true;
}

function providerConfig() {
  const baseUrl = String(process.env.EVOLUTION_API_URL || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env.EVOLUTION_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error('Evolution self-onboarding is not configured on the platform yet.');
  }
  return { baseUrl, headers: { apikey: apiKey, 'Content-Type': 'application/json' } };
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function makeInstanceName(businessName) {
  const slug = String(businessName || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'client';
  return `nexa-${slug}-${crypto.randomBytes(4).toString('hex')}`;
}

function findQr(payload) {
  const candidate = payload?.qrcode?.base64 || payload?.qrcode?.base64Image || payload?.base64 || payload?.qr?.base64 || payload?.data?.qrcode?.base64 || payload?.data?.base64 || null;
  if (!candidate) return null;
  return String(candidate).startsWith('data:image') ? String(candidate) : `data:image/png;base64,${candidate}`;
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
  const result = await axios.post(
    `${baseUrl}/instance/create`,
    { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
    { headers, timeout: 30000 }
  );
  return findQr(result.data) || fetchQr(instanceName);
}

async function getInstanceState(instanceName) {
  const { baseUrl, headers } = providerConfig();
  const result = await axios.get(`${baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`, { headers, timeout: 30000 });
  return { state: findConnectionState(result.data), raw: result.data };
}

function cleanProviderError(err) {
  const providerMessage = typeof err.response?.data === 'object'
    ? JSON.stringify(err.response.data)
    : (err.response?.data || err.message || 'Unknown provider error');
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
             qr_code = NULL, provider_error = NULL, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [stateResult.state, row.id]
      );
      return result.rows[0];
    }
    let qr = row.qr_code;
    if (!qr && !['failed', 'archived'].includes(row.status)) qr = await fetchQr(row.instance_name);
    const result = await db.query(
      `UPDATE evo_client_onboardings
       SET status = CASE WHEN status = 'failed' THEN status ELSE 'pending_qr' END,
           connection_state = $1, qr_code = COALESCE($2, qr_code), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [stateResult.state || 'waiting_scan', qr, row.id]
    );
    return result.rows[0];
  } catch (err) {
    const error = cleanProviderError(err);
    const result = await db.query(
      `UPDATE evo_client_onboardings SET provider_error = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [error, row.id]
    );
    return result.rows[0];
  }
}

module.exports = {
  ensureEvoOnboardingTable,
  makeSessionToken,
  makeInstanceName,
  createInstance,
  refreshOnboarding,
  cleanProviderError,
};