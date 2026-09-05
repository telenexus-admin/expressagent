const axios = require('axios');

const KCB_SANDBOX_TOKEN_URL = 'https://uat.buni.kcbgroup.com/token';

function envTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function environmentFrom(value) {
  return String(value || 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('KCB Buni endpoints must use HTTPS');
  return parsed.toString().replace(/\/$/, '');
}

function loadKcbBuniConfig(overrides = {}) {
  const environment = environmentFrom(overrides.environment || process.env.KCB_BUNI_ENVIRONMENT);
  const explicitTokenUrl = overrides.tokenUrl !== undefined
    ? String(overrides.tokenUrl || '').trim()
    : String(process.env.KCB_BUNI_TOKEN_URL || '').trim();

  let tokenUrl = explicitTokenUrl;
  if (!tokenUrl && environment === 'sandbox') tokenUrl = KCB_SANDBOX_TOKEN_URL;
  if (tokenUrl) tokenUrl = safeUrl(tokenUrl);

  const explicitApiBaseUrl = overrides.apiBaseUrl !== undefined
    ? String(overrides.apiBaseUrl || '').trim()
    : String(process.env.KCB_BUNI_API_BASE_URL || '').trim();

  return {
    enabled: overrides.enabled !== undefined ? Boolean(overrides.enabled) : envTrue(process.env.KCB_BUNI_ENABLED),
    environment,
    clientId: String(overrides.clientId || process.env.KCB_BUNI_CLIENT_ID || '').trim(),
    clientSecret: String(overrides.clientSecret || process.env.KCB_BUNI_CLIENT_SECRET || '').trim(),
    tokenUrl,
    apiBaseUrl: explicitApiBaseUrl ? safeUrl(explicitApiBaseUrl) : '',
    commercialApproved: overrides.commercialApproved !== undefined
      ? Boolean(overrides.commercialApproved)
      : envTrue(process.env.KCB_BUNI_COMMERCIAL_APPROVED),
    timeoutMs: Number.isFinite(Number(overrides.timeoutMs))
      ? Math.max(1000, Math.min(60000, Number(overrides.timeoutMs)))
      : Math.max(1000, Math.min(60000, Number(process.env.KCB_BUNI_TIMEOUT_MS || 20000))),
  };
}

function credentialsComplete(config) {
  return Boolean(config?.clientId && config?.clientSecret && config?.tokenUrl);
}

function endpointHost(url) {
  if (!url) return null;
  try { return new URL(url).host; }
  catch (_) { return null; }
}

function publicKcbBuniStatus(config = loadKcbBuniConfig()) {
  const productionEndpointMissing = config.environment === 'production' && !config.tokenUrl;
  return {
    bank: 'kcb',
    name: 'KCB Bank Kenya',
    adapter_phase: 'connection_verification',
    enabled: config.enabled,
    environment: config.environment,
    configured: credentialsComplete(config),
    has_client_id: Boolean(config.clientId),
    has_client_secret: Boolean(config.clientSecret),
    token_host: endpointHost(config.tokenUrl),
    api_host: endpointHost(config.apiBaseUrl),
    commercial_approved: config.commercialApproved,
    production_endpoint_missing: productionEndpointMissing,
    live_dispatch_implemented: false,
    live_dispatch_allowed: false,
    live_dispatch_block_reason: 'kcb_live_settlement_not_implemented',
  };
}

async function getKcbBuniAccessToken(config = loadKcbBuniConfig()) {
  if (!credentialsComplete(config)) {
    if (config.environment === 'production' && !config.tokenUrl) {
      throw new Error('KCB production token URL is not configured. Use the endpoint supplied by KCB during go-live.');
    }
    throw new Error('KCB Buni client ID, client secret and token URL are required');
  }

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials' }).toString();
  const response = await axios.post(config.tokenUrl, body, {
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    timeout: config.timeoutMs,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  const token = response.data?.access_token;
  if (!token) throw new Error('KCB Buni did not return an access token');
  return {
    accessToken: String(token),
    tokenType: String(response.data?.token_type || 'Bearer'),
    expiresIn: Number(response.data?.expires_in || 0) || null,
  };
}

async function testKcbBuniConnection(overrides = {}) {
  const config = loadKcbBuniConfig(overrides);
  const token = await getKcbBuniAccessToken(config);
  return {
    success: true,
    bank: 'kcb',
    environment: config.environment,
    oauth: 'connected',
    token_host: endpointHost(config.tokenUrl),
    token_type: token.tokenType,
    expires_in: token.expiresIn,
    commercial_approved: config.commercialApproved,
    live_dispatch_allowed: false,
  };
}

module.exports = {
  KCB_SANDBOX_TOKEN_URL,
  credentialsComplete,
  endpointHost,
  getKcbBuniAccessToken,
  loadKcbBuniConfig,
  publicKcbBuniStatus,
  testKcbBuniConnection,
};
