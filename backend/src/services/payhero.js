const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');
const { canUseConfig, loadClientBillingConfig, lookupPaymentAccount } = require('./billing');

const PAYHERO_URL = 'https://backend.payhero.co.ke/api/v2';
const DARAJA_PRODUCTION_URL = 'https://api.safaricom.co.ke';
const DARAJA_SANDBOX_URL = 'https://sandbox.safaricom.co.ke';
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
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_prompt_provider VARCHAR(30) NOT NULL DEFAULT 'payhero'`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_consumer_key TEXT`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_consumer_secret TEXT`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_shortcode VARCHAR(30)`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_passkey TEXT`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_environment VARCHAR(20) NOT NULL DEFAULT 'production'`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_transaction_type VARCHAR(40) NOT NULL DEFAULT 'CustomerPayBillOnline'`);
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

function getPayHeroBasicAuth(fallback = '') {
  return String(process.env.PAYHERO_BASIC_AUTH || process.env.PAYHERO_BASIC_AUTH_TOKEN || fallback || '').trim();
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

function cancelledPayment(text) {
  return /^(?:no|cancel|stop|never mind|nevermind)$/i.test(String(text || '').trim());
}

function selectedFullAmount(text) {
  return /\b(?:full|package price|pay all|renew)\b/i.test(String(text || '').trim());
}

function selectedCustomAmount(text) {
  return /\b(?:another|other|different|custom)\s*(?:amount)?\b/i.test(String(text || '').trim());
}

function isPaymentContext(text) {
  return /\b(pay|payment|paid|prompt|stk|mpesa|m-pesa|lipa|renew|recharge|amount|full|another|other|different|custom|kes|ksh|kshs)\b/i.test(String(text || ''));
}

function shouldClearPaymentState(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return !extractPhone(value) && !extractAmountCandidate(value) && !isPaymentContext(value);
}

function extractAmount(text) {
  const candidate = extractAmountCandidate(text);
  return candidate && candidate >= 10 && candidate <= 500000 ? candidate : null;
}

function extractAmountCandidate(text) {
  const value = String(text || '').replace(/(?:\+?254|0)[17]\d{8}/g, ' ');
  const matches = [...value.matchAll(/\b(?:kes|ksh|kshs)?\s*([1-9][\d, ]{0,8})(?:\.00)?\b/gi)];
  for (const match of matches) {
    const raw = match[1];
    const after = value.slice(match.index + match[0].length, match.index + match[0].length + 12);
    if (/^\s*(?:mbps|gb|mb|days?|months?|hours?)/i.test(after)) continue;
    const amount = Number.parseInt(String(raw).replace(/[,\s]/g, ''), 10);
    if (Number.isInteger(amount)) return amount;
  }
  return null;
}

function extractPhone(text) {
  const match = String(text || '').match(/(?:\+?254|0)[17]\d{8}/);
  return match ? cleanPhone(match[0]) : null;
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

async function sendStoredPaymentPrompt({ client, conversationId, customerName, state, amount }) {
  if (!Number.isInteger(amount) || amount < 10 || amount > 500000) {
    return 'Please enter an amount between KES 10 and KES 500,000.';
  }
  await setPaymentState(conversationId, null);
  const result = await initiatePayHeroPayment({
    client,
    conversationId,
    customerPhone: state.phone,
    customerName: state.accountName || customerName,
    amount,
  });
  if (!result.success) return `I could not send the M-Pesa prompt: ${result.error}`;
  return `M-Pesa prompt sent to +${state.phone} for KES ${formatMoney(amount)}. Complete it using your M-Pesa PIN.`;
}

function darajaBaseUrl(environment) {
  return String(environment || '').toLowerCase() === 'sandbox' ? DARAJA_SANDBOX_URL : DARAJA_PRODUCTION_URL;
}

async function startInvoicePaymentPrompt({ conversationId, amount, invoiceNumber, customerName }) {
  const invoiceAmount = Number.parseInt(amount, 10);
  if (!Number.isInteger(invoiceAmount) || invoiceAmount < 10 || invoiceAmount > 500000) {
    return 'I cannot start payment for this invoice because the invoice amount is invalid.';
  }
  await setPaymentState(conversationId, {
    step: 'manual_payment_details',
    startedAt: new Date().toISOString(),
    phone: null,
    amount: invoiceAmount,
    accountName: customerName || null,
    invoiceNumber: invoiceNumber || null,
  });
  return `Which M-Pesa number should I prompt for invoice ${invoiceNumber || ''} amount KES ${formatMoney(invoiceAmount)}?`;
}

async function prepareManualPayment({ client, conversationId, customerName, messageText = '', previousState = null }) {
  const phone = extractPhone(messageText) || previousState?.phone || null;
  const savedAmount = Number.parseInt(previousState?.amount, 10);
  const amount = extractAmount(messageText) || (Number.isInteger(savedAmount) ? savedAmount : null);
  const amountCandidate = extractAmountCandidate(messageText);

  console.log(
    `[client ${client.id}] Manual PayHero flow: text="${String(messageText || '').slice(0, 80)}", ` +
      `phone=${phone || 'missing'}, amount=${amount || 'missing'}, previous_step=${previousState?.step || 'none'}.`
  );

  if (phone && amount) {
    return sendStoredPaymentPrompt({
      client,
      conversationId,
      customerName,
      state: { phone },
      amount,
    });
  }
  if (phone && amountCandidate != null && !amount) {
    await setPaymentState(conversationId, {
      step: 'manual_payment_details',
      startedAt: new Date().toISOString(),
      phone,
      amount: null,
    });
    return 'Please enter an amount between KES 10 and KES 500,000.';
  }

  await setPaymentState(conversationId, {
    step: 'manual_payment_details',
    startedAt: new Date().toISOString(),
    phone,
    amount,
  });

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
    step: 'choose_amount',
    startedAt: new Date().toISOString(),
    phone: lookup.phone,
    fullAmount: lookup.amount,
    plan: lookup.account.plan,
    status: lookup.account.status || null,
    account: lookup.account.account || lookup.account.username || null,
    accountName: lookup.account.fullname || lookup.account.username || null,
  });
  const name = lookup.account.fullname || lookup.account.username;
  return `${name ? `${name}, I found your account.` : 'I found the account.'}\nStatus: ${lookup.account.status || 'not shown'}.\nPackage: ${lookup.account.plan}.\nFull package price: KES ${formatMoney(lookup.amount)}.\n\nWould you like to pay the full price or another amount? Reply "full" or "another amount".`;
}

async function loadPayHeroConfig(clientId) {
  await ensurePayHeroSchema();
  const result = await db.query(
    `SELECT payhero_enabled, payhero_basic_auth, payhero_channel_id, payhero_provider, payhero_callback_secret,
            payment_prompt_provider, mpesa_consumer_key, mpesa_consumer_secret, mpesa_shortcode,
            mpesa_passkey, mpesa_environment, mpesa_transaction_type
     FROM clients WHERE id = $1`,
    [clientId]
  );
  const row = result.rows[0] || {};
  return {
    enabled: row.payhero_enabled === true,
    paymentProvider: String(row.payment_prompt_provider || 'payhero').trim().toLowerCase(),
    basicAuth: getPayHeroBasicAuth(row.payhero_basic_auth),
    channelId: Number(row.payhero_channel_id) || null,
    provider: String(row.payhero_provider || 'm-pesa').trim(),
    callbackSecret: String(row.payhero_callback_secret || '').trim(),
    mpesa: {
      consumerKey: String(row.mpesa_consumer_key || '').trim(),
      consumerSecret: String(row.mpesa_consumer_secret || '').trim(),
      shortcode: String(row.mpesa_shortcode || '').trim(),
      passkey: String(row.mpesa_passkey || '').trim(),
      environment: String(row.mpesa_environment || 'production').trim().toLowerCase(),
      transactionType: String(row.mpesa_transaction_type || 'CustomerPayBillOnline').trim(),
    },
  };
}

function publicBackendUrl() {
  return String(process.env.PUBLIC_BACKEND_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
}

async function initiatePayHeroPayment({ client, conversationId, customerPhone, customerName, amount }) {
  const config = await loadPayHeroConfig(client.id);
  if (config.paymentProvider === 'daraja') {
    return initiateDarajaPayment({ client, conversationId, customerPhone, customerName, amount, config });
  }
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

async function getDarajaAccessToken(config) {
  const credentials = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString('base64');
  const response = await axios.get(`${darajaBaseUrl(config.mpesa.environment)}/oauth/v1/generate`, {
    params: { grant_type: 'client_credentials' },
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 20000,
  });
  const token = response.data?.access_token;
  if (!token) throw new Error('Daraja did not return an access token.');
  return token;
}

function darajaTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function initiateDarajaPayment({ client, conversationId, customerPhone, customerName, amount, config }) {
  if (!config.enabled) return { success: false, error: 'M-Pesa prompts are not enabled for this client.' };
  if (!config.mpesa.consumerKey || !config.mpesa.consumerSecret || !config.mpesa.shortcode || !config.mpesa.passkey) {
    return { success: false, error: 'Client M-Pesa credentials are incomplete.' };
  }
  const phone = cleanPhone(customerPhone);
  if (!/^254[17]\d{8}$/.test(phone)) return { success: false, error: 'Please send a valid Safaricom M-Pesa phone number.' };
  if (!Number.isInteger(amount) || amount < 10 || amount > 500000) {
    return { success: false, error: 'Please provide an amount between KES 10 and KES 500,000.' };
  }
  const base = publicBackendUrl();
  if (!base || !config.callbackSecret) return { success: false, error: 'Payment callback URL is not configured. Set PUBLIC_BACKEND_URL and save payment settings again.' };
  const timestamp = darajaTimestamp();
  const shortcode = config.mpesa.shortcode;
  const externalReference = `DARAJA-${client.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const password = Buffer.from(`${shortcode}${config.mpesa.passkey}${timestamp}`).toString('base64');
  const callback = `${base}/api/public/payhero/daraja-callback/${client.id}?token=${encodeURIComponent(config.callbackSecret)}`;
  await db.query(
    `INSERT INTO payhero_payment_requests
       (client_id, conversation_id, customer_phone, customer_name, amount, external_reference)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [client.id, conversationId || null, phone, customerName || null, amount, externalReference]
  );
  try {
    const accessToken = await getDarajaAccessToken(config);
    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: config.mpesa.transactionType || 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callback,
      AccountReference: externalReference.slice(0, 40),
      TransactionDesc: `Invoice payment ${customerName || ''}`.slice(0, 100),
    };
    const response = await axios.post(`${darajaBaseUrl(config.mpesa.environment)}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    const data = response.data || {};
    await db.query(
      `UPDATE payhero_payment_requests
       SET checkout_request_id = $1, payhero_reference = $2, status = $3, raw_response = $4::jsonb, updated_at = NOW()
       WHERE external_reference = $5`,
      [data.CheckoutRequestID || null, data.MerchantRequestID || null, String(data.ResponseCode) === '0' ? 'queued' : 'failed', JSON.stringify(data), externalReference]
    );
    if (String(data.ResponseCode) !== '0') return { success: false, error: data.ResponseDescription || 'Daraja rejected the STK request.' };
    return { success: true, externalReference, status: 'QUEUED' };
  } catch (err) {
    const message = apiErrorMessage(err);
    await db.query(
      `UPDATE payhero_payment_requests SET status = 'failed', result_description = $1, raw_response = $2::jsonb, updated_at = NOW()
       WHERE external_reference = $3`,
      [String(message), JSON.stringify(err.response?.data || {}), externalReference]
    );
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
    if (shouldClearPaymentState(messageText)) {
      await setPaymentState(conversationId, null);
      console.log(`[client ${client.id}] Cleared pending PayHero state for conversation ${conversationId}; message was unrelated to payment.`);
      return null;
    }
    if (state.step === 'enter_phone') {
      const suppliedPhone = String(messageText || '').match(/(?:\+?254|0)[17]\d{8}/)?.[0];
      if (!suppliedPhone) return 'Please send a valid Kenyan phone number, for example 0712345678.';
      return prepareAccountPayment({ client, conversationId, phone: suppliedPhone });
    }
    if (state.step === 'choose_amount') {
      if (selectedFullAmount(messageText)) {
        return sendStoredPaymentPrompt({ client, conversationId, customerName, state, amount: Number(state.fullAmount) });
      }
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
    if (state.step === 'manual_payment_details') {
      return prepareManualPayment({ client, conversationId, customerName, messageText, previousState: state });
    }
    await setPaymentState(conversationId, null);
  }

  if (isPaymentStart(messageText)) {
    const config = await loadPayHeroConfig(client.id);
    if (!config.enabled || !config.basicAuth || !config.channelId) {
      return 'I cannot send an M-Pesa prompt yet because payments have not been enabled by the administrator.';
    }
    if (!(await hasBillingLookup(client.id))) {
      return prepareManualPayment({ client, conversationId, customerName, messageText });
    }
    return prepareAccountPayment({ client, conversationId, phone: customerPhone });
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
  if (!(await hasBillingLookup(client.id))) {
    return prepareManualPayment({ client, conversationId, customerName, messageText });
  }
  return prepareAccountPayment({ client, conversationId, phone: customerPhone });
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
  startInvoicePaymentPrompt,
  getPayHeroBasicAuth,
  testPayHeroConnection,
};
