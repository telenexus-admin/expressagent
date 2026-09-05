const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');
const { canUseConfig, loadClientBillingConfig, lookupPaymentAccount } = require('./billing');

const DARAJA_PRODUCTION_URL = 'https://api.safaricom.co.ke';
const DARAJA_SANDBOX_URL = 'https://sandbox.safaricom.co.ke';
const EXPLICIT_PAYMENT_RE = /(?:^\s*(?:pay|prompt|lipa|renew|recharge)\b|\b(?:send|give|initiate|start|request|need|want|make|please)\b.{0,45}\b(?:stk|mpesa|m-pesa|prompt|pay|payment|lipa|renew|recharge)\b|\b(?:stk|mpesa|m-pesa)\s+prompt\b)/i;
let schemaPromise;

function darajaBaseUrl(environment) {
  return String(environment || '').toLowerCase() === 'sandbox'
    ? DARAJA_SANDBOX_URL
    : DARAJA_PRODUCTION_URL;
}

function envTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function cleanPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = `254${phone.slice(1)}`;
  if (phone.startsWith('7') || phone.startsWith('1')) phone = `254${phone}`;
  return phone;
}

function apiErrorMessage(err) {
  const data = err.response?.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object') {
    if (typeof data.errorMessage === 'string') return data.errorMessage;
    if (typeof data.ResponseDescription === 'string') return data.ResponseDescription;
    if (typeof data.ResultDesc === 'string') return data.ResultDesc;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
    try { return JSON.stringify(data); } catch (_) { /* noop */ }
  }
  return err.message || 'Daraja request failed';
}

async function ensureDarajaSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      // Native Daraja configuration. Old PayHero columns/tables remain only for historical/FK compatibility.
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_consumer_key TEXT`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_consumer_secret TEXT`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_shortcode VARCHAR(30)`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_passkey TEXT`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_environment VARCHAR(20) NOT NULL DEFAULT 'production'`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_transaction_type VARCHAR(40) NOT NULL DEFAULT 'CustomerPayBillOnline'`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_callback_secret VARCHAR(96)`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_configured_at TIMESTAMP WITH TIME ZONE`);
      await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS payment_state JSONB`);

      // Legacy columns are retained because historical rows and older deployed clients may still reference them.
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_callback_secret VARCHAR(96)`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_prompt_provider VARCHAR(30) NOT NULL DEFAULT 'daraja'`);
      await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS payhero_state JSONB`);

      await db.query(`
        CREATE TABLE IF NOT EXISTS payhero_payment_requests (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
          customer_phone VARCHAR(80) NOT NULL,
          customer_name VARCHAR(255),
          amount INTEGER NOT NULL,
          external_reference VARCHAR(120) NOT NULL UNIQUE,
          payhero_reference VARCHAR(120),
          checkout_request_id VARCHAR(180),
          status VARCHAR(40) NOT NULL DEFAULT 'initiated',
          result_description TEXT,
          mpesa_receipt_number VARCHAR(100),
          raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.query(`ALTER TABLE payhero_payment_requests ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await db.query(`ALTER TABLE payhero_payment_requests ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(30) NOT NULL DEFAULT 'legacy_payhero'`);
      await db.query(`ALTER TABLE payhero_payment_requests ADD COLUMN IF NOT EXISTS merchant_request_id VARCHAR(180)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_mpesa_requests_client ON payhero_payment_requests(client_id, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_mpesa_requests_checkout ON payhero_payment_requests(client_id, checkout_request_id) WHERE checkout_request_id IS NOT NULL`);

      // Migrate only configurations that were already using the direct Daraja branch.
      await db.query(`
        UPDATE clients
        SET mpesa_enabled = TRUE,
            mpesa_callback_secret = COALESCE(mpesa_callback_secret, payhero_callback_secret),
            payment_prompt_provider = 'daraja',
            mpesa_configured_at = COALESCE(mpesa_configured_at, NOW())
        WHERE payment_prompt_provider = 'daraja'
          AND payhero_enabled = TRUE
          AND mpesa_consumer_key IS NOT NULL
          AND mpesa_consumer_secret IS NOT NULL
          AND mpesa_shortcode IS NOT NULL
          AND mpesa_passkey IS NOT NULL
      `);
      await db.query(`
        UPDATE conversations
        SET payment_state = payhero_state
        WHERE payment_state IS NULL AND payhero_state IS NOT NULL
      `);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function credentialsComplete(config) {
  return Boolean(
    config?.consumerKey &&
    config?.consumerSecret &&
    config?.shortcode &&
    config?.passkey
  );
}

async function loadDarajaConfig(clientId, overrides = {}) {
  await ensureDarajaSchema();
  const result = await db.query(
    `SELECT id, mpesa_enabled, mpesa_consumer_key, mpesa_consumer_secret, mpesa_shortcode,
            mpesa_passkey, mpesa_environment, mpesa_transaction_type, mpesa_callback_secret,
            mpesa_configured_at, payhero_enabled, payhero_callback_secret, payment_prompt_provider
     FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Billing client was not found');

  let callbackSecret = String(
    overrides.callbackSecret || row.mpesa_callback_secret || process.env.DARAJA_CALLBACK_SECRET || row.payhero_callback_secret || ''
  ).trim();
  if (!callbackSecret) {
    callbackSecret = crypto.randomBytes(32).toString('hex');
    await db.query(`UPDATE clients SET mpesa_callback_secret = $1 WHERE id = $2`, [callbackSecret, clientId]);
  }

  const config = {
    enabled:
      overrides.enabled !== undefined
        ? Boolean(overrides.enabled)
        : row.mpesa_enabled === true || envTrue(process.env.DARAJA_ENABLED) ||
          (row.payment_prompt_provider === 'daraja' && row.payhero_enabled === true),
    consumerKey: String(overrides.consumerKey || row.mpesa_consumer_key || process.env.DARAJA_CONSUMER_KEY || '').trim(),
    consumerSecret: String(overrides.consumerSecret || row.mpesa_consumer_secret || process.env.DARAJA_CONSUMER_SECRET || '').trim(),
    shortcode: String(overrides.shortcode || row.mpesa_shortcode || process.env.DARAJA_SHORTCODE || '').trim(),
    passkey: String(overrides.passkey || row.mpesa_passkey || process.env.DARAJA_PASSKEY || '').trim(),
    environment: String(overrides.environment || row.mpesa_environment || process.env.DARAJA_ENVIRONMENT || 'production').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production',
    transactionType: String(overrides.transactionType || row.mpesa_transaction_type || process.env.DARAJA_TRANSACTION_TYPE || 'CustomerPayBillOnline').trim(),
    callbackSecret,
    configuredAt: row.mpesa_configured_at || null,
  };
  return config;
}

async function getDarajaAccessToken(config) {
  if (!config.consumerKey || !config.consumerSecret) {
    throw new Error('Daraja consumer key and consumer secret are not configured');
  }
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const response = await axios.get(`${darajaBaseUrl(config.environment)}/oauth/v1/generate`, {
    params: { grant_type: 'client_credentials' },
    headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
    timeout: 20000,
  });
  const token = response.data?.access_token;
  if (!token) throw new Error('Daraja did not return an access token');
  return token;
}

function darajaTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function stkPassword(config, timestamp) {
  return Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');
}

function publicBackendUrl() {
  return String(process.env.PUBLIC_BACKEND_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
}

async function initiateDarajaPayment({ client, conversationId, customerPhone, customerName, amount, metadata = null }) {
  const config = await loadDarajaConfig(client.id);
  if (!config.enabled) return { success: false, error: 'M-Pesa payments are not enabled for this client.' };
  if (!credentialsComplete(config)) return { success: false, error: 'Daraja credentials are incomplete.' };

  const phone = cleanPhone(customerPhone);
  if (!/^254[17]\d{8}$/.test(phone)) return { success: false, error: 'Please send a valid Safaricom M-Pesa phone number.' };
  if (!Number.isInteger(amount) || amount < 10 || amount > 500000) {
    return { success: false, error: 'Please provide an amount between KES 10 and KES 500,000.' };
  }

  const base = publicBackendUrl();
  if (!base || !config.callbackSecret) {
    return { success: false, error: 'Daraja callback URL is not configured. Set PUBLIC_BACKEND_URL and the callback secret.' };
  }

  const timestamp = darajaTimestamp();
  const externalReference = `MPESA-${client.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const callback = `${base}/api/public/mpesa/stk-callback/${client.id}?token=${encodeURIComponent(config.callbackSecret)}`;

  await db.query(
    `INSERT INTO payhero_payment_requests
       (client_id, conversation_id, customer_phone, customer_name, amount, external_reference, metadata, payment_provider)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'daraja')`,
    [client.id, conversationId || null, phone, customerName || null, amount, externalReference, JSON.stringify(metadata || {})]
  );

  try {
    const token = await getDarajaAccessToken(config);
    const payload = {
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config, timestamp),
      Timestamp: timestamp,
      TransactionType: config.transactionType || 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: callback,
      AccountReference: externalReference.slice(0, 40),
      TransactionDesc: String(metadata?.description || `Internet payment ${customerName || ''}`).slice(0, 100),
    };
    const response = await axios.post(`${darajaBaseUrl(config.environment)}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 30000,
    });
    const data = response.data || {};
    const accepted = String(data.ResponseCode) === '0';
    await db.query(
      `UPDATE payhero_payment_requests
       SET checkout_request_id=$1, merchant_request_id=$2, payhero_reference=$2,
           status=$3, result_description=$4, raw_response=$5::jsonb, updated_at=NOW()
       WHERE external_reference=$6`,
      [
        data.CheckoutRequestID || null,
        data.MerchantRequestID || null,
        accepted ? 'queued' : 'failed',
        data.ResponseDescription || data.CustomerMessage || null,
        JSON.stringify(data),
        externalReference,
      ]
    );
    if (!accepted) return { success: false, error: data.ResponseDescription || data.CustomerMessage || 'Daraja rejected the STK request.' };
    return {
      success: true,
      externalReference,
      status: 'QUEUED',
      checkoutRequestId: data.CheckoutRequestID || null,
      merchantRequestId: data.MerchantRequestID || null,
      customerMessage: data.CustomerMessage || null,
    };
  } catch (err) {
    const message = apiErrorMessage(err);
    await db.query(
      `UPDATE payhero_payment_requests
       SET status='failed', result_description=$1, raw_response=$2::jsonb, updated_at=NOW()
       WHERE external_reference=$3`,
      [String(message), JSON.stringify(err.response?.data || {}), externalReference]
    );
    return { success: false, error: String(message) };
  }
}

async function queryDarajaStkStatus({ clientId, checkoutRequestId }) {
  const config = await loadDarajaConfig(clientId);
  if (!credentialsComplete(config)) throw new Error('Daraja credentials are incomplete');
  const timestamp = darajaTimestamp();
  const token = await getDarajaAccessToken(config);
  const response = await axios.post(
    `${darajaBaseUrl(config.environment)}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 30000,
    }
  );
  return response.data || {};
}

async function testDarajaConnection(clientId, overrides = {}) {
  const config = await loadDarajaConfig(clientId, overrides);
  if (!credentialsComplete(config)) throw new Error('Daraja consumer key, consumer secret, shortcode and passkey are required');
  await getDarajaAccessToken(config);
  return {
    success: true,
    environment: config.environment,
    shortcode: config.shortcode,
    transaction_type: config.transactionType,
    oauth: 'connected',
  };
}

function parsePaymentPromptRequest(text, fallbackPhone) {
  const value = String(text || '');
  if (!EXPLICIT_PAYMENT_RE.test(value)) return null;
  const phoneMatch = value.match(/(?:\+?254|0)[17]\d{8}/);
  const withoutPhone = phoneMatch ? value.replace(phoneMatch[0], ' ') : value;
  const amountMatch = withoutPhone.match(/\b(?:kes|ksh|kshs)\s*([1-9]\d{1,6})(?:\.00)?\b|\b([1-9]\d{1,6})(?:\.00)?\b(?!\s*(?:mbps|gb|mb|days?|months?|hours?))/i);
  return {
    amount: amountMatch ? Number.parseInt(amountMatch[1] || amountMatch[2], 10) : null,
    phone: cleanPhone(phoneMatch?.[0] || fallbackPhone),
  };
}

function isPaymentStart(text) {
  return /\b(?:i\s+(?:want|need|would like)\s+to\s+pay|can\s+i\s+pay|how\s+(?:can|do)\s+i\s+pay|pay\s+my\s+(?:bill|account|internet|package)|renew\s+my\s+(?:internet|package|plan)|make\s+(?:a\s+)?payment)\b/i.test(String(text || ''));
}
function cancelledPayment(text) { return /^(?:no|cancel|stop|never mind|nevermind)$/i.test(String(text || '').trim()); }
function selectedFullAmount(text) { return /\b(?:full|package price|pay all|renew)\b/i.test(String(text || '').trim()); }
function selectedCustomAmount(text) { return /\b(?:another|other|different|custom)\s*(?:amount)?\b/i.test(String(text || '').trim()); }
function isPaymentContext(text) { return /\b(pay|payment|paid|prompt|stk|mpesa|m-pesa|lipa|renew|recharge|amount|full|another|other|different|custom|kes|ksh|kshs)\b/i.test(String(text || '')); }
function extractAmountCandidate(text) {
  const value = String(text || '').replace(/(?:\+?254|0)[17]\d{8}/g, ' ');
  const matches = [...value.matchAll(/\b(?:kes|ksh|kshs)?\s*([1-9][\d, ]{0,8})(?:\.00)?\b/gi)];
  for (const match of matches) {
    const after = value.slice(match.index + match[0].length, match.index + match[0].length + 12);
    if (/^\s*(?:mbps|gb|mb|days?|months?|hours?)/i.test(after)) continue;
    const amount = Number.parseInt(String(match[1]).replace(/[,\s]/g, ''), 10);
    if (Number.isInteger(amount)) return amount;
  }
  return null;
}
function extractAmount(text) {
  const value = extractAmountCandidate(text);
  return value && value >= 10 && value <= 500000 ? value : null;
}
function extractPhone(text) {
  const match = String(text || '').match(/(?:\+?254|0)[17]\d{8}/);
  return match ? cleanPhone(match[0]) : null;
}
function shouldClearPaymentState(text) {
  const value = String(text || '').trim();
  return Boolean(value) && !extractPhone(value) && !extractAmountCandidate(value) && !isPaymentContext(value);
}
function formatMoney(amount) { return Number(amount).toLocaleString('en-KE'); }

async function setPaymentState(conversationId, state) {
  await ensureDarajaSchema();
  await db.query(
    `UPDATE conversations SET payment_state=$1::jsonb, payhero_state=NULL, updated_at=NOW() WHERE id=$2`,
    [state ? JSON.stringify(state) : null, conversationId]
  );
}
async function getPaymentState(conversationId) {
  await ensureDarajaSchema();
  const result = await db.query(`SELECT COALESCE(payment_state,payhero_state) AS state FROM conversations WHERE id=$1`, [conversationId]);
  const state = result.rows[0]?.state || null;
  if (state?.startedAt && Date.now() - new Date(state.startedAt).getTime() > 15 * 60 * 1000) {
    await setPaymentState(conversationId, null);
    return null;
  }
  return state;
}

async function sendStoredPaymentPrompt({ client, conversationId, customerName, state, amount }) {
  if (!Number.isInteger(amount) || amount < 10 || amount > 500000) return 'Please enter an amount between KES 10 and KES 500,000.';
  await setPaymentState(conversationId, null);
  const result = await initiateDarajaPayment({
    client,
    conversationId,
    customerPhone: state.phone,
    customerName: state.accountName || customerName,
    amount,
  });
  if (!result.success) return `I could not send the M-Pesa prompt: ${result.error}`;
  return `M-Pesa prompt sent to +${state.phone} for KES ${formatMoney(amount)}. Complete it using your M-Pesa PIN.`;
}

async function startInvoicePaymentPrompt({ conversationId, amount, invoiceNumber, customerName }) {
  const invoiceAmount = Number.parseInt(amount, 10);
  if (!Number.isInteger(invoiceAmount) || invoiceAmount < 10 || invoiceAmount > 500000) {
    return 'I cannot start payment for this invoice because the invoice amount is invalid.';
  }
  await setPaymentState(conversationId, {
    step: 'manual_payment_details', startedAt: new Date().toISOString(), phone: null,
    amount: invoiceAmount, accountName: customerName || null, invoiceNumber: invoiceNumber || null,
  });
  return `Which M-Pesa number should I prompt for invoice ${invoiceNumber || ''} amount KES ${formatMoney(invoiceAmount)}?`;
}

async function prepareManualPayment({ client, conversationId, customerName, messageText = '', previousState = null }) {
  const phone = extractPhone(messageText) || previousState?.phone || null;
  const savedAmount = Number.parseInt(previousState?.amount, 10);
  const amount = extractAmount(messageText) || (Number.isInteger(savedAmount) ? savedAmount : null);
  const amountCandidate = extractAmountCandidate(messageText);
  if (phone && amount) return sendStoredPaymentPrompt({ client, conversationId, customerName, state: { phone }, amount });
  if (phone && amountCandidate != null && !amount) {
    await setPaymentState(conversationId, { step: 'manual_payment_details', startedAt: new Date().toISOString(), phone, amount: null });
    return 'Please enter an amount between KES 10 and KES 500,000.';
  }
  await setPaymentState(conversationId, { step: 'manual_payment_details', startedAt: new Date().toISOString(), phone, amount });
  if (!phone && !amount) return 'Please send the M-Pesa number to prompt and the amount. Example: 0712345678 1500.';
  if (!phone) return `Which M-Pesa number should I prompt for KES ${formatMoney(amount)}?`;
  return `How much should I prompt +${phone} to pay?`;
}

async function hasBillingLookup(clientId) {
  const config = await loadClientBillingConfig(clientId);
  return canUseConfig(config);
}

async function prepareAccountPayment({ client, conversationId, phone }) {
  const lookup = await lookupPaymentAccount({ clientId: client.id, phone });
  if (!lookup.success) {
    if (lookup.reason === 'not_found') {
      await setPaymentState(conversationId, { step: 'enter_phone', startedAt: new Date().toISOString() });
      return 'This WhatsApp number is not linked to an internet account. Please reply with the phone number registered on the account.';
    }
    if (lookup.reason === 'price_missing') return `I found the account${lookup.account?.plan ? ` on ${lookup.account.plan}` : ''}, but its package price is not available. Please contact support before paying.`;
    if (lookup.reason === 'not_configured') return 'I cannot check the package amount because the billing system has not been connected.';
    return 'I could not check that account right now. Please try again shortly.';
  }
  await setPaymentState(conversationId, {
    step: 'choose_amount', startedAt: new Date().toISOString(), phone: lookup.phone, fullAmount: lookup.amount,
    plan: lookup.account.plan, status: lookup.account.status || null,
    account: lookup.account.account || lookup.account.username || null,
    accountName: lookup.account.fullname || lookup.account.username || null,
  });
  const name = lookup.account.fullname || lookup.account.username;
  return `${name ? `${name}, I found your account.` : 'I found the account.'}\nStatus: ${lookup.account.status || 'not shown'}.\nPackage: ${lookup.account.plan}.\nFull package price: KES ${formatMoney(lookup.amount)}.\n\nWould you like to pay the full price or another amount? Reply "full" or "another amount".`;
}

async function answerDarajaPrompt({ client, conversationId, customerPhone, customerName, messageText }) {
  const state = await getPaymentState(conversationId);
  if (state) {
    if (cancelledPayment(messageText)) { await setPaymentState(conversationId, null); return 'Okay, I have cancelled the payment request.'; }
    if (shouldClearPaymentState(messageText)) { await setPaymentState(conversationId, null); return null; }
    if (state.step === 'enter_phone') {
      const suppliedPhone = String(messageText || '').match(/(?:\+?254|0)[17]\d{8}/)?.[0];
      if (!suppliedPhone) return 'Please send a valid Kenyan phone number, for example 0712345678.';
      return prepareAccountPayment({ client, conversationId, phone: suppliedPhone });
    }
    if (state.step === 'choose_amount') {
      if (selectedFullAmount(messageText)) return sendStoredPaymentPrompt({ client, conversationId, customerName, state, amount: Number(state.fullAmount) });
      if (selectedCustomAmount(messageText)) {
        await setPaymentState(conversationId, { ...state, step: 'enter_amount', startedAt: new Date().toISOString() });
        return 'Please enter the amount you want to pay.';
      }
      const amount = extractAmount(messageText);
      if (amount) return sendStoredPaymentPrompt({ client, conversationId, customerName, state, amount });
      return `Would you like to pay the full package price of KES ${formatMoney(state.fullAmount)} or another amount? Reply "full" or enter the amount.`;
    }
    if (state.step === 'enter_amount') {
      const amount = extractAmount(messageText);
      if (!amount) return 'Please enter the amount you want to pay, for example 1000.';
      return sendStoredPaymentPrompt({ client, conversationId, customerName, state, amount });
    }
    if (state.step === 'manual_payment_details') return prepareManualPayment({ client, conversationId, customerName, messageText, previousState: state });
    await setPaymentState(conversationId, null);
  }

  const request = parsePaymentPromptRequest(messageText, customerPhone);
  if (!isPaymentStart(messageText) && !request) return null;
  const config = await loadDarajaConfig(client.id);
  if (!config.enabled || !credentialsComplete(config)) {
    return 'I cannot send an M-Pesa prompt yet because Daraja payments have not been enabled by the administrator.';
  }
  if (!(await hasBillingLookup(client.id))) return prepareManualPayment({ client, conversationId, customerName, messageText });
  return prepareAccountPayment({ client, conversationId, phone: customerPhone });
}

// Compatibility exports keep existing callers stable while the provider is fully Daraja-native.
const ensurePayHeroSchema = ensureDarajaSchema;
const initiatePayHeroPayment = initiateDarajaPayment;
const loadPayHeroConfig = async (clientId) => {
  const config = await loadDarajaConfig(clientId);
  return {
    enabled: config.enabled,
    paymentProvider: 'daraja',
    basicAuth: null,
    channelId: null,
    provider: 'm-pesa',
    callbackSecret: config.callbackSecret,
    mpesa: {
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
      shortcode: config.shortcode,
      passkey: config.passkey,
      environment: config.environment,
      transactionType: config.transactionType,
    },
  };
};
const answerPayHeroPrompt = answerDarajaPrompt;
function getPayHeroBasicAuth() { return ''; }
async function testPayHeroConnection() {
  throw new Error('PayHero has been retired. Use the native Daraja settings test.');
}

module.exports = {
  answerDarajaPrompt,
  cleanPhone,
  credentialsComplete,
  darajaBaseUrl,
  darajaTimestamp,
  ensureDarajaSchema,
  getDarajaAccessToken,
  initiateDarajaPayment,
  loadDarajaConfig,
  parsePaymentPromptRequest,
  queryDarajaStkStatus,
  startInvoicePaymentPrompt,
  testDarajaConnection,
  // compatibility aliases
  answerPayHeroPrompt,
  ensurePayHeroSchema,
  getPayHeroBasicAuth,
  initiatePayHeroPayment,
  loadPayHeroConfig,
  testPayHeroConnection,
};
