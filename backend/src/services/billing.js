const axios = require('axios');
const db = require('../db');

const DEFAULT_BASE_URL = 'https://riseli.wispman.net/index.php?_route=api';
const SUPPORTED_PROVIDERS = ['wispman'];

function enabled() {
  return String(process.env.BILLING_API_ENABLED || '').toLowerCase() === 'true';
}

function provider() {
  return (process.env.BILLING_API_PROVIDER || 'wispman').trim().toLowerCase();
}

function baseUrl() {
  return (process.env.BILLING_API_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function apiKey() {
  return (process.env.BILLING_API_KEY || '').trim();
}

function timeoutMs() {
  const parsed = Number.parseInt(process.env.BILLING_API_TIMEOUT_MS || '6000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6000;
}

function canUseBilling() {
  return enabled() && provider() === 'wispman' && Boolean(apiKey());
}

function envConfig() {
  return {
    enabled: enabled(),
    provider: provider(),
    baseUrl: baseUrl(),
    apiKey: apiKey(),
  };
}

async function loadClientBillingConfig(clientId) {
  if (!clientId) return envConfig();

  try {
    const result = await db.query(
      `SELECT billing_enabled, billing_provider, billing_api_base_url, billing_api_key
       FROM clients
       WHERE id = $1`,
      [clientId]
    );
    const row = result.rows[0];
    if (
      row?.billing_enabled &&
      row.billing_provider &&
      row.billing_api_base_url &&
      row.billing_api_key
    ) {
      return {
        enabled: true,
        provider: String(row.billing_provider).trim().toLowerCase(),
        baseUrl: String(row.billing_api_base_url).trim().replace(/\/+$/, ''),
        apiKey: String(row.billing_api_key).trim(),
      };
    }
  } catch (err) {
    if (err.code !== '42703') console.error('Load client billing config failed:', err.message);
  }

  return envConfig();
}

function canUseConfig(config) {
  return Boolean(
    config?.enabled &&
      config.provider === 'wispman' &&
      config.baseUrl &&
      config.apiKey
  );
}

function apiUrl(path, config = envConfig()) {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const root = String(config.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return `${root}/${cleanPath}`;
}

async function get(path, params = {}, config = envConfig()) {
  if (!canUseConfig(config)) return { success: false, skipped: true, error: 'Billing API is not configured' };

  try {
    const response = await axios.get(apiUrl(path, config), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      params,
      timeout: timeoutMs(),
    });
    return response.data;
  } catch (err) {
    const code = err.response?.data?.error?.code || err.code || 'billing_lookup_failed';
    const message = err.response?.data?.error?.message || err.message || 'Billing lookup failed';
    console.error(`Billing API ${path} failed: ${err.response?.status || 'no-status'} ${code} - ${message}`);
    return { success: false, error: { code, message }, status: err.response?.status || null };
  }
}

async function post(path, body = {}, config = envConfig()) {
  if (!canUseConfig(config)) return { success: false, skipped: true, error: 'Billing API is not configured' };

  try {
    const response = await axios.post(apiUrl(path, config), body, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      timeout: timeoutMs(),
    });
    return response.data;
  } catch (err) {
    const code = err.response?.data?.error?.code || err.code || 'billing_action_failed';
    const message = err.response?.data?.error?.message || err.message || 'Billing action failed';
    console.error(`Billing API ${path} failed: ${err.response?.status || 'no-status'} ${code} - ${message}`);
    return { success: false, error: { code, message }, status: err.response?.status || null };
  }
}

async function testBillingConnection({ provider: selectedProvider, baseUrl: selectedBaseUrl, apiKey: selectedApiKey }) {
  const config = {
    enabled: true,
    provider: String(selectedProvider || 'wispman').trim().toLowerCase(),
    baseUrl: String(selectedBaseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(selectedApiKey || '').trim(),
  };

  if (!SUPPORTED_PROVIDERS.includes(config.provider)) {
    return { success: false, error: 'Unsupported billing system' };
  }

  if (!config.baseUrl || !config.apiKey) {
    return { success: false, error: 'Base URL and API key are required' };
  }

  const result = await get('v1/ping', {}, config);
  if (!result.success) {
    return {
      success: false,
      error: result.error?.message || result.error || 'Connection failed',
      code: result.error?.code || null,
      status: result.status || null,
    };
  }

  return {
    success: true,
    key_name: result.data?.key_name || null,
    scopes: Array.isArray(result.data?.scopes) ? result.data.scopes : [],
    server_time: result.data?.server_time || null,
  };
}

function looksLikeBillingQuestion(text) {
  const value = String(text || '').toLowerCase();
  return /\b(active|expired|expiry|expire|status|account|username|package|plan|price|payment|paid|mpesa|m-pesa|receipt|transaction|recharge|recharged|balance|bill|billing|renew|renewal|internet off|not connected|disconnected)\b/.test(value);
}

function wantsPlans(text) {
  const value = String(text || '');
  if (/\b(my|current|am i on|i am on|i'm on|which)\b.{0,30}\b(package|plan)\b/i.test(value)) return false;
  return /\b(package|packages|plan|plans|price|prices|cost|how much|mbps|subscription)\b/i.test(value);
}

function wantsPayment(text) {
  return /\b(payment|paid|mpesa|m-pesa|receipt|transaction|recharge|recharged|invoice|pesapal)\b/i.test(String(text || ''));
}

function wantsReconnect(text) {
  const value = String(text || '');
  const paidSignal = /\b(paid|payment|mpesa|m-pesa|receipt|transaction|code|sent money|nimelipa|nimetuma)\b/i.test(value);
  const reconnectSignal = /\b(reconnect|connect me|not connected|internet off|still off|activate|renew|renewal|restore|paid but|haijaingia|haijaconnect|recharge)\b/i.test(value);
  return paidSignal && reconnectSignal;
}

function wantsClientStatus(text) {
  return /\b(active|expired|expiry|expire|status|account|username|balance|renew|renewal|recharge|recharged|last recharged|current plan|my plan|my package|which plan|which package|internet off|not connected|disconnected|why.*off|why.*down)\b/i.test(String(text || ''));
}

function hasStandalonePhone(text) {
  return /^(?:\+?254|0)\d[\d\s-]{7,15}$/i.test(String(text || '').trim());
}

function compactPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length >= 10) return `254${digits.slice(1)}`;
  return digits;
}

function extractAccount(text) {
  const value = String(text || '');
  const labelled = value.match(/\b(?:account\s*(?:number|no\.?)?|acc(?:ount)?\s*(?:number|no\.?)?|client\s*id)\s*(?:is|#|:|-)\s*([A-Za-z0-9][A-Za-z0-9_-]{2,39})\b/i);
  if (labelled) {
    const candidate = labelled[1];
    if (!/^(account|number|phone|registered|which|plan|package|status)$/i.test(candidate)) return candidate;
  }
  const standalone = value.match(/\b(ACC[A-Za-z0-9_-]{3,30})\b/i);
  return standalone ? standalone[1] : null;
}

function extractUsername(text) {
  const value = String(text || '');
  const labelled = value.match(/\b(?:username|user\s*name|login)\s*(?:is|:|-)?\s*([A-Za-z0-9][A-Za-z0-9_.-]{2,39})\b/i);
  return labelled ? labelled[1] : null;
}

function extractTransactionId(text) {
  const value = String(text || '');
  const labelled = value.match(/\b(?:transaction|trans(?:action)?\s*id|receipt|mpesa|m-pesa|code)\s*(?:id|code|number|no\.?|is|:|-)?\s*([A-Za-z0-9][A-Za-z0-9_-]{5,49})\b/i);
  if (labelled) return labelled[1];
  const mpesaLike = value.match(/\b([A-Z0-9]{10})\b/);
  return mpesaLike ? mpesaLike[1] : null;
}

function extractLookupKeys({ customerPhone, messageText }) {
  const messagePhone = String(messageText || '').match(/(?:\+?254|0)\d[\d\s-]{7,15}/);
  const account = extractAccount(messageText);
  const username = extractUsername(messageText);
  const transactionId = extractTransactionId(messageText);
  const explicitPhone = compactPhone(messagePhone?.[0]);
  const phone = explicitPhone || compactPhone(customerPhone);

  return { account, username, transactionId, phone, explicitPhone };
}

function clientLookupParams(keys) {
  if (keys.explicitPhone) return { phone: keys.explicitPhone };
  if (keys.account) return { account: keys.account };
  if (keys.username) return { username: keys.username };
  if (keys.phone) return { phone: keys.phone };
  return null;
}

function paymentLookupParams(keys) {
  if (keys.transactionId) return { transaction_id: keys.transactionId };
  if (keys.explicitPhone) return { phone: keys.explicitPhone };
  if (keys.phone) return { phone: keys.phone };
  return null;
}

function summarizeClientStatus(data) {
  if (!data) return null;
  const lines = [
    `Client: ${data.fullname || data.username || data.account || 'Unknown'}`,
    data.phone ? `Phone: ${data.phone}` : null,
    data.account ? `Account: ${data.account}` : null,
    data.username ? `Username: ${data.username}` : null,
    data.status ? `Status: ${data.status}` : null,
    data.plan ? `Plan: ${data.plan}` : null,
    data.service ? `Service: ${data.service}` : null,
    data.router ? `Router: ${data.router}` : null,
    data.expiration ? `Expires: ${data.expiration}${data.expiration_time ? ` ${data.expiration_time}` : ''}` : null,
    data.last_recharged_on ? `Last recharge: ${data.last_recharged_on}` : null,
    data.method ? `Last method: ${data.method}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function summarizePayment(data) {
  if (!data) return null;
  const lines = [
    data.status ? `Payment status: ${data.status}` : null,
    data.gateway ? `Gateway: ${data.gateway}` : null,
    data.transaction_id ? `Transaction ID: ${data.transaction_id}` : null,
    data.reference ? `Reference: ${data.reference}` : null,
    data.amount ? `Amount: ${data.amount} ${data.currency || ''}`.trim() : null,
    data.phone ? `Phone: ${data.phone}` : null,
    data.paid_at ? `Paid at: ${data.paid_at}` : null,
    data.client?.username ? `Linked client: ${data.client.username}` : null,
    data.client?.plan ? `Client plan: ${data.client.plan}` : null,
    data.recharge?.expiration ? `Recharge expires: ${data.recharge.expiration}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function summarizePlans(data) {
  const plans = Array.isArray(data?.plans) ? data.plans.slice(0, 8) : [];
  if (plans.length === 0) return null;
  return plans
    .map((plan) => {
      const price = plan.price != null ? ` - ${plan.price}` : '';
      const validity = plan.validity ? ` / ${plan.validity} ${plan.validity_unit || ''}`.trim() : '';
      return `${plan.name}${price}${validity}`;
    })
    .join('\n');
}

function formatPlanLines(data) {
  const plans = Array.isArray(data?.plans) ? data.plans.filter((plan) => Number(plan.price) > 0).slice(0, 10) : [];
  if (plans.length === 0) return null;
  return plans
    .map((plan) => `${plan.name}: KSh ${Number(plan.price).toLocaleString('en-KE')}/${plan.validity || 1} ${plan.validity_unit || 'Month'}`)
    .join('\n');
}

function accountNotFoundReply(keys) {
  const lookedUp = keys.explicitPhone
    ? `phone +${keys.explicitPhone}`
    : keys.account
    ? `account ${keys.account}`
    : keys.username
    ? `username ${keys.username}`
    : keys.phone
    ? `phone +${keys.phone}`
    : 'those details';
  return `I could not find an account for ${lookedUp}. Please send your registered phone number, account number, or username.`;
}

function clientStatusReply(data) {
  const status = data.status ? String(data.status).toLowerCase() : 'unknown';
  const plan = data.plan || 'not shown';
  const expiry = data.expiration ? `${data.expiration}${data.expiration_time ? ` at ${data.expiration_time}` : ''}` : 'not shown';
  const recharge = data.last_recharged_on || 'not shown';
  const name = data.fullname || data.username || 'your account';

  return (
    `I found ${name}.\n` +
    `Status: ${status}.\n` +
    `Current plan: ${plan}.\n` +
    `Expiry: ${expiry}.\n` +
    `Last recharge: ${recharge}.`
  );
}

function paymentReply(data) {
  const status = data.status || 'unknown';
  const amount = data.amount ? `KSh ${Number(data.amount).toLocaleString('en-KE')}` : 'amount not shown';
  const paidAt = data.paid_at || 'time not shown';
  const method = data.payment_method || data.gateway || 'payment method not shown';
  const recharge = data.recharge?.expiration ? ` Recharge expires on ${data.recharge.expiration}.` : '';

  return `Payment status: ${status}.\nAmount: ${amount}.\nMethod: ${method}.\nPaid at: ${paidAt}.${recharge}`;
}

function rechargeReply(data, meta = {}) {
  const status = data?.status || 'active';
  const plan = data?.plan_name || 'your package';
  const expiry = data?.expiration ? ` It expires on ${data.expiration}${data.time ? ` at ${data.time}` : ''}.` : '';
  const mode = meta?.idempotency === 'already_active'
    ? 'Your account already has an active recharge.'
    : 'I have reconnected your package.';
  return `${mode}\nPlan: ${plan}.\nStatus: ${status}.${expiry}`;
}

function rechargePlanFromPayment(paymentData) {
  return (
    paymentData?.recharge?.plan ||
    paymentData?.client?.plan ||
    paymentData?.plan ||
    null
  );
}

async function reconnectFromPaidPayment({ config, keys, paymentData, messageText }) {
  if (!paymentData || String(paymentData.status || '').toLowerCase() !== 'paid') {
    return null;
  }

  const planName = rechargePlanFromPayment(paymentData);
  if (!planName) {
    return 'I found the payment, but I could not identify the package to reconnect. I have enough to escalate this to support.';
  }

  const client = paymentData.client?.username || paymentData.client?.account || paymentData.client?.phone || paymentData.phone || keys.explicitPhone || keys.phone;
  if (!client) {
    return 'I found the payment, but I could not identify the client account to reconnect. Please send the registered phone number or account number.';
  }

  const result = await post('v1/recharges', {
    client,
    plan_name: planName,
    reference: paymentData.transaction_id || paymentData.reference || keys.transactionId || undefined,
    reason: `AI reconnect after customer reported paid but not connected. Message: ${String(messageText || '').slice(0, 220)}`,
  }, config);

  if (result.success && result.data) return rechargeReply(result.data, result.meta);
  if (result.status === 403 && result.error?.code === 'insufficient_scope') {
    return 'Payment is confirmed, but this billing key cannot reconnect clients yet. Please enable recharge.write on the Wispman API key.';
  }
  if (result.status === 404 && result.error?.code === 'plan_not_found') {
    return `Payment is confirmed, but Wispman could not find the package "${planName}" for recharge. Please ask support to reconnect it.`;
  }
  if (result.status === 404 && result.error?.code === 'client_not_found') {
    return 'Payment is confirmed, but Wispman could not match the client account for reconnect. Please send the registered phone number or account number.';
  }
  return `Payment is confirmed, but automatic reconnect failed: ${result.error?.message || 'billing system unavailable'}. I have enough details for support to follow up.`;
}

async function answerBillingQuestion({ clientId, customerPhone, messageText }) {
  const config = await loadClientBillingConfig(clientId);
  if (!canUseConfig(config) || (!looksLikeBillingQuestion(messageText) && !hasStandalonePhone(messageText))) return null;

  const keys = extractLookupKeys({ customerPhone, messageText });
  const statusWanted = wantsClientStatus(messageText) || hasStandalonePhone(messageText);
  const paymentWanted = wantsPayment(messageText);
  const reconnectWanted = wantsReconnect(messageText);
  const plansWanted = wantsPlans(messageText);

  if (statusWanted || paymentWanted) {
    const params = clientLookupParams(keys);
    if (params) {
      const status = await get('v1/clients/status', params, config);
      if (status.success && status.data && statusWanted && !reconnectWanted) {
        return clientStatusReply(status.data);
      }
      if (status.status === 404 && statusWanted && !paymentWanted) {
        return accountNotFoundReply(keys);
      }
    }
  }

  if (paymentWanted) {
    const params = paymentLookupParams(keys);
    if (params) {
      const payment = await get('v1/payments/status', params, config);
      if (payment.success && payment.data) {
        if (reconnectWanted) {
          const reconnectReply = await reconnectFromPaidPayment({ config, keys, paymentData: payment.data, messageText });
          if (reconnectReply) return reconnectReply;
        }
        return paymentReply(payment.data);
      }
      if (payment.status === 404) {
        return `I could not find that payment. Please send the M-Pesa transaction code or the registered payment phone number.`;
      }
    }
  }

  if (plansWanted) {
    const plans = await get('v1/plans', { type: 'PPPOE' }, config);
    if (plans.success && plans.data) {
      const lines = formatPlanLines(plans.data);
      if (lines) return `Here are some current Expressnet packages:\n${lines}`;
    }
  }

  if (statusWanted || paymentWanted) {
    return `I can check that. Please send your registered phone number, account number, username, or M-Pesa transaction code.`;
  }

  return null;
}

async function lookupPaymentAccount({ clientId, phone }) {
  const config = await loadClientBillingConfig(clientId);
  if (!canUseConfig(config)) return { success: false, reason: 'not_configured' };

  const normalizedPhone = compactPhone(phone);
  if (!normalizedPhone) return { success: false, reason: 'invalid_phone' };

  const status = await get('v1/clients/status', { phone: normalizedPhone }, config);
  if (!status.success || !status.data) {
    return {
      success: false,
      reason: status.status === 404 ? 'not_found' : 'lookup_failed',
      error: status.error?.message || null,
    };
  }

  const account = status.data;
  const planName = String(account.plan || '').trim();
  if (!planName) return { success: false, reason: 'plan_missing', account };

  const plan = await get('v1/plans', { name: planName }, config);
  const planData = Array.isArray(plan.data?.plans) ? plan.data.plans[0] : plan.data?.plans || plan.data;
  const amount = Number(planData?.price);
  if (!plan.success || !Number.isFinite(amount) || amount <= 0) {
    return { success: false, reason: 'price_missing', account, plan: planData || null };
  }

  return {
    success: true,
    phone: normalizedPhone,
    amount: Math.round(amount),
    account,
    plan: planData,
  };
}

async function buildBillingContext({ clientId, customerPhone, messageText }) {
  const config = await loadClientBillingConfig(clientId);
  if (!canUseConfig(config) || !looksLikeBillingQuestion(messageText)) return null;

  const sections = [];
  const keys = extractLookupKeys({ customerPhone, messageText });

  if (wantsClientStatus(messageText) || wantsPayment(messageText)) {
    const params = clientLookupParams(keys);
    const status = params ? await get('v1/clients/status', params, config) : { success: false, skipped: true };
    if (status.success && status.data) {
      sections.push(`CLIENT ACCOUNT STATUS\n${summarizeClientStatus(status.data)}`);
    } else if (status.status === 404) {
      const lookup = keys.account ? `account ${keys.account}` : keys.username ? `username ${keys.username}` : `phone +${keys.phone || customerPhone}`;
      sections.push(`CLIENT ACCOUNT STATUS\nNo client account was found for ${lookup}.`);
    } else if (!status.skipped) {
      sections.push(`CLIENT ACCOUNT STATUS\nLookup failed: ${status.error?.message || 'unavailable'} (${status.error?.code || status.status || 'unknown'}).`);
    }
  }

  if (wantsPayment(messageText)) {
    const params = paymentLookupParams(keys);
    const payment = params ? await get('v1/payments/status', params, config) : { success: false, skipped: true };
    if (payment.success && payment.data) {
      sections.push(`LATEST PAYMENT STATUS\n${summarizePayment(payment.data)}`);
    } else if (payment.status === 404) {
      const lookup = keys.transactionId ? `transaction ${keys.transactionId}` : `phone +${keys.phone || customerPhone}`;
      sections.push(`LATEST PAYMENT STATUS\nNo recent payment was found for ${lookup}.`);
    } else if (!payment.skipped) {
      sections.push(`LATEST PAYMENT STATUS\nLookup failed: ${payment.error?.message || 'unavailable'} (${payment.error?.code || payment.status || 'unknown'}).`);
    }
  }

  if (wantsPlans(messageText)) {
    const plans = await get('v1/plans', { type: 'PPPOE' }, config);
    if (plans.success && plans.data) {
      const summary = summarizePlans(plans.data);
      if (summary) sections.push(`AVAILABLE PPPOE PLANS\n${summary}`);
    } else if (!plans.skipped) {
      sections.push(`AVAILABLE PPPOE PLANS\nLookup failed: ${plans.error?.message || 'unavailable'}.`);
    }
  }

  if (sections.length === 0) return null;

  return (
    `\n\nLIVE BILLING CONTEXT FROM WISPMAN (read-only):\n` +
    `${sections.join('\n\n')}\n\n` +
    `IMPORTANT BILLING RULES:\n` +
    `- You DO have read-only access to these billing facts through Wispman when this context appears.\n` +
    `- Do not say you have no access to account details.\n` +
    `- Do not send the customer to the portal as the main answer unless Wispman lookup failed and you need them to self-check.\n` +
    `- If account data is found, answer directly using the status, plan, expiry and recharge facts above.\n` +
    `- If no account was found for the WhatsApp number, ask for their registered phone, account number, or username.\n` +
    `- Keep the reply short and customer-friendly.\n` +
    `- Do not expose raw API wording, credentials, internal IDs unless useful, or unsupported assumptions.`
  );
}

module.exports = {
  answerBillingQuestion,
  buildBillingContext,
  canUseBilling,
  loadClientBillingConfig,
  lookupPaymentAccount,
  looksLikeBillingQuestion,
  testBillingConnection,
};
