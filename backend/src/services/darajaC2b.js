const axios = require('axios');
const {
  darajaBaseUrl,
  getDarajaAccessToken,
} = require('./daraja');
const {
  applyPppoeSubscriptionPayment,
  moneyCents,
  resolvePppoePaymentAccount,
} = require('./pppoePayments');

function centralDarajaConfig() {
  return {
    consumerKey: String(process.env.DARAJA_CONSUMER_KEY || '').trim(),
    consumerSecret: String(process.env.DARAJA_CONSUMER_SECRET || '').trim(),
    shortcode: String(process.env.DARAJA_SHORTCODE || '').trim(),
    environment: String(process.env.DARAJA_ENVIRONMENT || 'production').trim().toLowerCase() === 'sandbox'
      ? 'sandbox'
      : 'production',
  };
}

function callbackToken() {
  return String(
    process.env.DARAJA_C2B_CALLBACK_TOKEN ||
    process.env.DARAJA_CALLBACK_SECRET ||
    ''
  ).trim();
}

function publicBackendUrl() {
  return String(
    process.env.PUBLIC_BACKEND_URL ||
    process.env.PUBLIC_API_URL ||
    ''
  ).trim().replace(/\/$/, '');
}

function c2bUrls() {
  const base = publicBackendUrl();
  const token = callbackToken();
  if (!base || !/^https:\/\//i.test(base)) {
    throw new Error('PUBLIC_BACKEND_URL must be a public HTTPS URL before C2B can be registered');
  }
  if (token.length < 32) {
    throw new Error('DARAJA_C2B_CALLBACK_TOKEN must be configured with at least 32 characters');
  }
  const query = `?token=${encodeURIComponent(token)}`;
  return {
    validation: `${base}/api/public/payments/c2b/validation${query}`,
    confirmation: `${base}/api/public/payments/c2b/confirmation${query}`,
  };
}

function safeC2bUrls() {
  const base = publicBackendUrl();
  return {
    validation: `${base}/api/public/payments/c2b/validation?token=***`,
    confirmation: `${base}/api/public/payments/c2b/confirmation?token=***`,
  };
}

function verifyC2bToken(req) {
  const expected = callbackToken();
  const supplied = String(req.query?.token || '');
  return expected.length >= 32 && supplied === expected;
}

function parseDarajaTransactionTime(value) {
  const text = String(value || '').trim();
  if (!/^\d{14}$/.test(text)) return new Date();
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+03:00`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function normalizeC2bPayload(body = {}) {
  return {
    transactionType: String(body.TransactionType || '').trim(),
    transactionId: String(body.TransID || '').trim().toUpperCase(),
    transactionTime: String(body.TransTime || '').trim(),
    paidAt: parseDarajaTransactionTime(body.TransTime),
    amount: Number(body.TransAmount),
    shortcode: String(body.BusinessShortCode || '').trim(),
    accountNumber: String(body.BillRefNumber || '').trim().toUpperCase().replace(/\s+/g, ''),
    payerPhone: String(body.MSISDN || '').trim(),
    firstName: String(body.FirstName || '').trim(),
    middleName: String(body.MiddleName || '').trim(),
    lastName: String(body.LastName || '').trim(),
    organizationBalance: body.OrgAccountBalance == null ? null : Number(body.OrgAccountBalance),
    raw: body || {},
  };
}

async function validateC2bPayment(body = {}) {
  const config = centralDarajaConfig();
  const payment = normalizeC2bPayload(body);

  if (!config.shortcode) {
    return { accepted: false, code: 1, description: 'Polyizon Paybill is not configured' };
  }

  if (payment.shortcode && payment.shortcode !== config.shortcode) {
    return { accepted: false, code: 1, description: 'Business shortcode does not match Polyizon Paybill' };
  }

  if (!payment.accountNumber) {
    return { accepted: false, code: 1, description: 'Enter the PPPoE account number provided by your ISP' };
  }

  if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
    return { accepted: false, code: 1, description: 'Enter a valid payment amount' };
  }

  const subscriber = await resolvePppoePaymentAccount(payment.accountNumber);
  if (!subscriber) {
    return { accepted: false, code: 1, description: 'The PPPoE account number was not found' };
  }

  const expected = moneyCents(subscriber.plan_price);
  const received = moneyCents(payment.amount);
  if (!subscriber.plan_id || subscriber.plan_is_active !== true || !Number.isInteger(expected) || expected <= 0) {
    return { accepted: false, code: 1, description: 'This account does not have an active payable package' };
  }

  if (received !== expected) {
    return {
      accepted: false,
      code: 1,
      description: `Pay exactly KES ${Number(subscriber.plan_price)} for ${subscriber.plan_name || 'the linked package'}`,
    };
  }

  return {
    accepted: true,
    code: 0,
    description: 'Accepted',
    subscriber: {
      id: subscriber.id,
      client_id: subscriber.client_id,
      account_number: subscriber.account_number,
      plan_id: subscriber.plan_id,
      plan_name: subscriber.plan_name,
      amount: Number(subscriber.plan_price),
    },
  };
}

async function processC2bConfirmation(body = {}) {
  const payment = normalizeC2bPayload(body);
  const config = centralDarajaConfig();

  if (!payment.transactionId) throw new Error('C2B confirmation did not include TransID');
  if (!payment.accountNumber) throw new Error('C2B confirmation did not include BillRefNumber');
  if (!Number.isFinite(payment.amount) || payment.amount <= 0) throw new Error('C2B confirmation did not include a valid TransAmount');
  if (payment.shortcode && config.shortcode && payment.shortcode !== config.shortcode) {
    throw new Error('C2B confirmation shortcode does not match the configured Polyizon Paybill');
  }

  return applyPppoeSubscriptionPayment({
    transactionId: payment.transactionId,
    accountNumber: payment.accountNumber,
    amount: payment.amount,
    payerPhone: payment.payerPhone || null,
    paidAt: payment.paidAt,
    source: 'c2b',
    shortcode: payment.shortcode || config.shortcode || null,
    rawPayload: payment.raw,
  });
}

async function registerC2bUrls() {
  const config = centralDarajaConfig();
  if (!config.consumerKey || !config.consumerSecret) {
    throw new Error('Daraja consumer key and consumer secret are not configured');
  }
  if (!config.shortcode) throw new Error('DARAJA_SHORTCODE is not configured');

  const urls = c2bUrls();
  const token = await getDarajaAccessToken(config);
  const response = await axios.post(
    `${darajaBaseUrl(config.environment)}/mpesa/c2b/v2/registerurl`,
    {
      ShortCode: config.shortcode,
      ResponseType: 'Completed',
      ConfirmationURL: urls.confirmation,
      ValidationURL: urls.validation,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    }
  );

  return {
    success: String(response.data?.ResponseCode || '') === '0' || /success/i.test(String(response.data?.ResponseDescription || '')),
    environment: config.environment,
    shortcode: config.shortcode,
    urls: safeC2bUrls(),
    response: response.data || {},
  };
}

module.exports = {
  c2bUrls,
  centralDarajaConfig,
  normalizeC2bPayload,
  processC2bConfirmation,
  registerC2bUrls,
  safeC2bUrls,
  validateC2bPayment,
  verifyC2bToken,
};
