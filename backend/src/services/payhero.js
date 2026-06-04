const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');
const { lookupPaymentAccount } = require('./billing');

const PAYHERO_URL = 'https://backend.payhero.co.ke/api/v2';
const EXPLICIT_PAYMENT_RE = /(?:^\s*(?:pay|prompt|lipa|renew|recharge)\b|\b(?:send|give|initiate|start|request|need|want|make|please)\b.{0,45}\b(?:stk|mpesa|m-pesa|prompt|pay|payment|lipa|renew|recharge)\b|\b(?:stk|mpesa|m-pesa)\s+prompt\b)/i;
let schemaPromise;

async function ensurePayHeroSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_basic_auth TEXT`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_channel_id INTEGER`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_provider VARCHAR(30) NOT NULL DEFAULT 'm-pesa'`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payhero_callback_secret VARCHAR(96)`);
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
      await db.query(`CREATE INDEX IF NOT EXISTS idx_payhero_requests_client ON payhero_payment_requests(client_id, created_at DESC)`);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function cleanPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = `254${phone.slice(1)}`;
  if (phone.startsWith('7') || phone.startsWith('1')) phone = `254${phone}`;
  return phone;
}

function authHeader(value) {
  const token = String(value || '').trim();
  return /^basic\s+/i.test(token) ? token : `Basic ${token}`;
}

function apiErrorMessage(err) {
  const data = err.response?.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object') {
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
    try {
      return JSON.stringify(data);
    } catch {
      return err.message || 'PayHero request failed';
    }
  }
  return err.message || 'PayHero request failed';
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

function selectedCurrentNumber(text) {
  return /\b(?:this|current|same|my|whatsapp)\s*(?:number|phone)?\b|\b(?:yes|yeah|yep|okay|ok)\b/i.test(String(text || '').trim());
}

function selectedAnotherNumber(text) {
  return /\b(?:another|other|different)\s*(?:number|phone)?\b/i.test(String(text || '').trim());
}

function confirmedPayment(text) {
  return /^(?:yes|confirm|proceed|continue|send|okay|ok|do it|pay)$/i.test(String(text || '').trim());
}

function cancelledPayment(text) {
  return /^(?:no|cancel|stop|never mind|nevermind)$/i.test(String(text || '').trim());
}

async function setPaymentState(conversationId, state) {
  await ensurePayHeroSchema();
  await db.query(`UPDATE conversations SET payhero_state = $1::jsonb, updated_at = NOW() WHERE id = $2`, [
    state ? JSON.stringify(state) : null,
    conversationId,
  ]);
}

async function getPaymentState(conversationId) {
  await ensurePayHeroSchema();
  const result = await db.query(`SELECT payhero_state FROM conversations WHERE id = $1`, [conversationId]);
  const state = result.rows[0]?.payhero_state || null;
  if (state?.startedAt && Date.now() - new Date(state.startedAt).getTime() > 15 * 60 * 1000) {
    await setPaymentState(conversationId, null);
    return null;
  }
  return state;
}

function formatMoney(amount) {
  return Number(amount).toLocaleString('en-KE');
}

async function prepareAccountPayment({ client, conversationId, phone }) {
  const lookup = await lookupPaymentAccount({ clientId: client.id, phone });
  if (!lookup.success) {
    if (lookup.reason === 'not_found') return 'I could not find an internet account linked to that number. Please send the registered account phone number.';
    if (lookup.reason === 'price_missing') return `I found the account${lookup.account?.plan ? ` on ${lookup.account.plan}` : ''}, but its package price is not available. Please contact support before paying.`;
    if (lookup.reason === 'not_configured') return 'I cannot check the package amount because the billing system has not been connected.';
    return 'I could not check that account right now. Please try again shortly.';
  }

  await setPaymentState(conversationId, {
    step: 'confirm',
    startedAt: new Date().toISOString(),
    phone: lookup.phone,
    amount: lookup.amount,
    plan: lookup.account.plan,
    accountName: lookup.account.fullname || lookup.account.username || null,
  });
  const name = lookup.account.fullname || lookup.account.username;
  return `${name ? `${name}, your` : 'Your'} package is ${lookup.account.plan} at KES ${formatMoney(lookup.amount)}. Should I send the M-Pesa prompt to +${lookup.phone}? Reply yes to confirm or no to cancel.`;
}

async function loadPayHeroConfig(clientId) {
  await ensurePayHeroSchema();
  const result = await db.query(
    `SELECT payhero_enabled, payhero_basic_auth, payhero_channel_id, payhero_provider, payhero_callback_secret
     FROM clients WHERE id = $1`,
    [clientId]
  );
  const row = result.rows[0] || {};
  return {
    enabled: row.payhero_enabled === true,
    basicAuth: String(row.payhero_basic_auth || '').trim(),
    channelId: Number(row.payhero_channel_id) || null,
    provider: String(row.payhero_provider || 'm-pesa').trim(),
    callbackSecret: String(row.payhero_callback_secret || '').trim(),
  };
}

function publicBackendUrl() {
  return String(process.env.PUBLIC_BACKEND_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
}

async function initiatePayHeroPayment({ client, conversationId, customerPhone, customerName, amount }) {
  const config = await loadPayHeroConfig(client.id);
  if (!config.enabled || !config.basicAuth || !config.channelId) {
    console.warn(
      `[client ${client.id}] PayHero prompt unavailable: enabled=${config.enabled}, has_basic_auth=${Boolean(config.basicAuth)}, channel_id=${config.channelId || 'none'}.`
    );
    return { success: false, error: 'M-Pesa prompts are not configured for this provider.' };
  }
  const phone = cleanPhone(customerPhone);
  if (!/^254[17]\d{8}$/.test(phone)) return { success: false, error: 'Please send a valid Safaricom M-Pesa phone number.' };
  if (!Number.isInteger(amount) || amount < 10 || amount > 500000) {
    return { success: false, error: 'Please provide an amount between KES 10 and KES 500,000.' };
  }
  const externalReference = `NEXA-${client.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const base = publicBackendUrl();
  if (!base || !config.callbackSecret) return { success: false, error: 'Payment callback URL is not configured. Set PUBLIC_BACKEND_URL and save PayHero again.' };
  const callback = `${base}/api/public/payhero/callback/${client.id}?token=${encodeURIComponent(config.callbackSecret)}`;
  let provider = config.provider;
  let networkCode;
  try {
    const channelResponse = await axios.get(`${PAYHERO_URL}/payment_channels/${config.channelId}`, {
      headers: { Authorization: authHeader(config.basicAuth), Accept: 'application/json' },
      timeout: 20000,
    });
    const channel = channelResponse.data?.data || channelResponse.data || {};
    if (String(channel.channel_type || '').toLowerCase() === 'wallet') {
      provider = 'sasapay';
      networkCode = '63902';
    }
  } catch (err) {
    console.warn(`[client ${client.id}] Could not inspect PayHero channel ${config.channelId}; using saved provider ${provider}: ${apiErrorMessage(err)}`);
  }
  const payload = {
    amount,
    phone_number: phone,
    channel_id: config.channelId,
    provider,
    ...(networkCode ? { network_code: networkCode } : {}),
    external_reference: externalReference,
    customer_name: customerName || undefined,
    callback_url: callback,
  };
  console.log(`[client ${client.id}] Sending PayHero prompt: channel_id=${config.channelId}, provider=${provider}, network_code=${networkCode || 'none'}, phone=+${phone}, amount=${amount}.`);
  await db.query(
    `INSERT INTO payhero_payment_requests
       (client_id, conversation_id, customer_phone, customer_name, amount, external_reference)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [client.id, conversationId || null, phone, customerName || null, amount, externalReference]
  );
  try {
    const response = await axios.post(`${PAYHERO_URL}/payments`, payload, {
      headers: { Authorization: authHeader(config.basicAuth), 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 30000,
    });
    const data = response.data || {};
    await db.query(
      `UPDATE payhero_payment_requests
       SET payhero_reference = $1, checkout_request_id = $2, status = $3, raw_response = $4::jsonb, updated_at = NOW()
       WHERE external_reference = $5`,
      [data.reference || null, data.CheckoutRequestID || null, String(data.status || 'queued').toLowerCase(), JSON.stringify(data), externalReference]
    );
    console.log(`[client ${client.id}] PayHero prompt accepted for +${phone}: amount=${amount}, reference=${externalReference}.`);
    return { success: true, externalReference, status: data.status || 'QUEUED', manualInstructions: data.manual_instructions || null };
  } catch (err) {
    const message = apiErrorMessage(err);
    await db.query(
      `UPDATE payhero_payment_requests SET status = 'failed', result_description = $1, raw_response = $2::jsonb, updated_at = NOW()
       WHERE external_reference = $3`,
      [String(message), JSON.stringify(err.response?.data || {}), externalReference]
    );
    console.error(`[client ${client.id}] PayHero prompt failed for +${phone}: ${message}`);
    return { success: false, error: String(message) };
  }
}

async function answerPayHeroPrompt({ client, conversationId, customerPhone, customerName, messageText }) {
  const state = await getPaymentState(conversationId);
  if (state) {
    if (cancelledPayment(messageText)) {
      await setPaymentState(conversationId, null);
      return 'Okay, I have cancelled the payment request.';
    }
    if (state.step === 'choose_phone') {
      if (selectedAnotherNumber(messageText)) {
        await setPaymentState(conversationId, { step: 'enter_phone', startedAt: new Date().toISOString() });
        return 'Please send the phone number linked to the internet account you want to pay for.';
      }
      const suppliedPhone = String(messageText || '').match(/(?:\+?254|0)[17]\d{8}/)?.[0];
      if (selectedCurrentNumber(messageText) || suppliedPhone) {
        return prepareAccountPayment({ client, conversationId, phone: suppliedPhone || customerPhone });
      }
      return `Would you like to pay for the account linked to this WhatsApp number (+${cleanPhone(customerPhone)}) or another number? Reply "this number" or "another number".`;
    }
    if (state.step === 'enter_phone') {
      const suppliedPhone = String(messageText || '').match(/(?:\+?254|0)[17]\d{8}/)?.[0];
      if (!suppliedPhone) return 'Please send a valid Kenyan phone number, for example 0712345678.';
      return prepareAccountPayment({ client, conversationId, phone: suppliedPhone });
    }
    if (state.step === 'confirm') {
      if (!confirmedPayment(messageText)) return `Please reply yes to send the KES ${formatMoney(state.amount)} prompt, or no to cancel.`;
      await setPaymentState(conversationId, null);
      const result = await initiatePayHeroPayment({
        client,
        conversationId,
        customerPhone: state.phone,
        customerName: state.accountName || customerName,
        amount: Number(state.amount),
      });
      if (!result.success) return `I could not send the M-Pesa prompt: ${result.error}`;
      return `M-Pesa prompt sent to +${state.phone} for KES ${formatMoney(state.amount)}. Complete it using your M-Pesa PIN.`;
    }
  }

  if (isPaymentStart(messageText)) {
    const config = await loadPayHeroConfig(client.id);
    if (!config.enabled || !config.basicAuth || !config.channelId) {
      return 'I cannot send an M-Pesa prompt yet because payments have not been enabled by the administrator.';
    }
    await setPaymentState(conversationId, { step: 'choose_phone', startedAt: new Date().toISOString() });
    return `Would you like to pay for the account linked to this WhatsApp number (+${cleanPhone(customerPhone)}) or another number? Reply "this number" or "another number".`;
  }

  const request = parsePaymentPromptRequest(messageText, customerPhone);
  if (!request) return null;
  const config = await loadPayHeroConfig(client.id);
  console.log(
    `[client ${client.id}] PayHero request detected: amount=${request.amount || 'missing'}, phone=+${request.phone}, enabled=${config.enabled}, has_basic_auth=${Boolean(config.basicAuth)}, channel_id=${config.channelId || 'none'}.`
  );
  if (!config.enabled || !config.basicAuth || !config.channelId) {
    return 'I cannot send an M-Pesa prompt yet because payments have not been enabled by the administrator.';
  }
  await setPaymentState(conversationId, { step: 'choose_phone', startedAt: new Date().toISOString() });
  return `Before I send a prompt, should I use the account linked to this WhatsApp number (+${cleanPhone(customerPhone)}) or another number? I will confirm its package and exact price first.`;
}

async function testPayHeroConnection(basicAuth, channelId) {
  const response = await axios.get(`${PAYHERO_URL}/payment_channels`, {
    headers: { Authorization: authHeader(basicAuth), Accept: 'application/json' },
    params: { is_active: true },
    timeout: 20000,
  });
  const channels = Array.isArray(response.data)
    ? response.data
    : Array.isArray(response.data?.payment_channels)
      ? response.data.payment_channels
      : Array.isArray(response.data?.data)
        ? response.data.data
        : [];
  const selectedId = Number(channelId);
  if (selectedId > 0 && !channels.some((channel) => Number(channel.id) === selectedId)) {
    const available = channels.map((channel) => channel.id).filter(Boolean);
    const error = new Error(
      available.length
        ? `Channel ID ${selectedId} was not found. Available active channel IDs: ${available.join(', ')}.`
        : `Channel ID ${selectedId} was not found and this PayHero account has no active payment channels.`
    );
    error.status = 404;
    throw error;
  }
  return { channels, selectedChannel: channels.find((channel) => Number(channel.id) === selectedId) || null };
}

module.exports = {
  cleanPhone,
  answerPayHeroPrompt,
  ensurePayHeroSchema,
  initiatePayHeroPayment,
  loadPayHeroConfig,
  parsePaymentPromptRequest,
  testPayHeroConnection,
};
