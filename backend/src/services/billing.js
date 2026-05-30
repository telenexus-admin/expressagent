const axios = require('axios');

const DEFAULT_BASE_URL = 'https://riseli.wispman.net/index.php?_route=api';

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

function apiUrl(path) {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  return `${baseUrl()}/${cleanPath}`;
}

async function get(path, params = {}) {
  if (!canUseBilling()) return { success: false, skipped: true, error: 'Billing API is not configured' };

  try {
    const response = await axios.get(apiUrl(path), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      params,
      timeout: timeoutMs(),
    });
    return response.data;
  } catch (err) {
    const code = err.response?.data?.error?.code || err.code || 'billing_lookup_failed';
    const message = err.response?.data?.error?.message || err.message || 'Billing lookup failed';
    return { success: false, error: { code, message }, status: err.response?.status || null };
  }
}

function looksLikeBillingQuestion(text) {
  const value = String(text || '').toLowerCase();
  return /\b(active|expired|expiry|expire|status|account|username|package|plan|price|payment|paid|mpesa|m-pesa|receipt|transaction|recharge|balance|bill|billing|renew|renewal|internet off|not connected|disconnected)\b/.test(value);
}

function wantsPlans(text) {
  return /\b(package|packages|plan|plans|price|prices|cost|how much|mbps|subscription)\b/i.test(String(text || ''));
}

function wantsPayment(text) {
  return /\b(payment|paid|mpesa|m-pesa|receipt|transaction|recharge|invoice|pesapal)\b/i.test(String(text || ''));
}

function wantsClientStatus(text) {
  return /\b(active|expired|expiry|expire|status|account|username|balance|renew|renewal|internet off|not connected|disconnected|why.*off|why.*down)\b/i.test(String(text || ''));
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

async function buildBillingContext({ customerPhone, messageText }) {
  if (!canUseBilling() || !looksLikeBillingQuestion(messageText)) return null;

  const sections = [];

  if (wantsClientStatus(messageText) || wantsPayment(messageText)) {
    const status = await get('v1/clients/status', { phone: customerPhone });
    if (status.success && status.data) {
      sections.push(`CLIENT ACCOUNT STATUS\n${summarizeClientStatus(status.data)}`);
    } else if (status.status === 404) {
      sections.push(`CLIENT ACCOUNT STATUS\nNo client account was found for WhatsApp number +${customerPhone}.`);
    } else if (!status.skipped) {
      sections.push(`CLIENT ACCOUNT STATUS\nLookup failed: ${status.error?.message || 'unavailable'}.`);
    }
  }

  if (wantsPayment(messageText)) {
    const payment = await get('v1/payments/status', { phone: customerPhone });
    if (payment.success && payment.data) {
      sections.push(`LATEST PAYMENT STATUS\n${summarizePayment(payment.data)}`);
    } else if (payment.status === 404) {
      sections.push(`LATEST PAYMENT STATUS\nNo recent payment was found for WhatsApp number +${customerPhone}.`);
    } else if (!payment.skipped) {
      sections.push(`LATEST PAYMENT STATUS\nLookup failed: ${payment.error?.message || 'unavailable'}.`);
    }
  }

  if (wantsPlans(messageText)) {
    const plans = await get('v1/plans', { type: 'PPPOE' });
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
    `Use these facts when answering. Keep the reply short and customer-friendly. ` +
    `Do not expose raw API wording, API errors, credentials, internal IDs unless useful, or unsupported assumptions. ` +
    `If the billing lookup says no account was found for this WhatsApp number, ask for their account number or registered phone.`
  );
}

module.exports = {
  buildBillingContext,
  canUseBilling,
  looksLikeBillingQuestion,
};
