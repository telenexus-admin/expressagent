const axios = require('axios');
const { darajaBaseUrl, getDarajaAccessToken } = require('./daraja');

const BANK_PAYBILL_RAILS = Object.freeze({
  ncba: {
    code: 'ncba',
    name: 'NCBA Bank Kenya',
    paybill: '880100',
    reference_source: 'collection_reference',
    reference_label: 'NCBA Till reference',
    notes: 'NCBA business collections use Paybill 880100 with the assigned NCBA Till reference.',
  },
  kcb: {
    code: 'kcb',
    name: 'KCB Bank Kenya',
    paybill: '522522',
    reference_source: 'account_number',
    reference_label: 'KCB account number',
    notes: 'KCB accepts M-Pesa deposits through Paybill 522522 using the KCB account number.',
  },
  coop: {
    code: 'coop',
    name: 'Co-operative Bank of Kenya',
    paybill: '400200',
    reference_source: 'account_number',
    reference_label: 'Co-op account number',
    notes: 'Co-op direct account deposits use Paybill 400200 with the bank account number.',
  },
  equity: {
    code: 'equity',
    name: 'Equity Bank Kenya',
    paybill: '247247',
    reference_source: 'account_number',
    reference_label: 'Equity account number',
    notes: 'Equity M-Pesa deposits use Paybill 247247 with the Equity account number.',
  },
});

function envTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function loadDarajaB2BConfig() {
  const environment = String(process.env.DARAJA_B2B_ENVIRONMENT || process.env.DARAJA_ENVIRONMENT || 'production')
    .trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  const config = {
    enabled: envTrue(process.env.DARAJA_B2B_ENABLED),
    consumerKey: String(process.env.DARAJA_CONSUMER_KEY || '').trim(),
    consumerSecret: String(process.env.DARAJA_CONSUMER_SECRET || '').trim(),
    shortcode: String(process.env.DARAJA_B2B_SHORTCODE || process.env.DARAJA_SHORTCODE || '').trim(),
    initiator: String(process.env.DARAJA_B2B_INITIATOR || '').trim(),
    securityCredential: String(process.env.DARAJA_B2B_SECURITY_CREDENTIAL || '').trim(),
    environment,
    endpoint: `${darajaBaseUrl(environment)}/mpesa/b2b/v1/paymentrequest`,
  };
  config.configured = Boolean(
    config.consumerKey && config.consumerSecret && config.shortcode &&
    config.initiator && config.securityCredential
  );
  return config;
}

function publicDarajaB2BStatus(config = loadDarajaB2BConfig()) {
  return {
    provider: 'safaricom_daraja',
    rail: 'business_paybill_b2b',
    enabled: config.enabled,
    configured: config.configured,
    environment: config.environment,
    source_shortcode: config.shortcode || null,
    has_initiator: Boolean(config.initiator),
    has_security_credential: Boolean(config.securityCredential),
    endpoint_host: new URL(config.endpoint).hostname,
    ready: Boolean(config.enabled && config.configured),
    supported_banks: Object.values(BANK_PAYBILL_RAILS).map((rail) => ({
      code: rail.code,
      name: rail.name,
      paybill: rail.paybill,
      reference_source: rail.reference_source,
      reference_label: rail.reference_label,
    })),
  };
}

function darajaB2BReady(config = loadDarajaB2BConfig()) {
  return Boolean(config.enabled && config.configured);
}

function bankRail(code) {
  return BANK_PAYBILL_RAILS[String(code || '').trim().toLowerCase()] || null;
}

function cleanReference(value) {
  return String(value || '').trim();
}

function resolveBankPaybillDestination(profile) {
  if (!profile) throw Object.assign(new Error('Settlement profile is missing'), { code: 'SETTLEMENT_PROFILE_MISSING' });
  const rail = bankRail(profile.institution_code);
  if (!rail) throw Object.assign(new Error('Unsupported bank settlement rail'), { code: 'SETTLEMENT_BANK_UNSUPPORTED' });

  const accountNumber = cleanReference(profile.account_number);
  const collectionReference = cleanReference(profile.collection_reference);
  const accountReference = rail.reference_source === 'collection_reference'
    ? collectionReference
    : accountNumber;

  if (!accountReference) {
    const error = new Error(`${rail.reference_label} is required for ${rail.name}`);
    error.code = rail.code === 'ncba' ? 'NCBA_TILL_REFERENCE_REQUIRED' : 'BANK_ACCOUNT_REFERENCE_REQUIRED';
    throw error;
  }
  if (accountReference.length > 100) {
    throw Object.assign(new Error('Bank settlement reference is too long'), { code: 'BANK_REFERENCE_INVALID' });
  }

  return {
    institution_code: rail.code,
    institution_name: rail.name,
    party_b: rail.paybill,
    receiver_identifier_type: '4',
    command_id: 'BusinessPayBill',
    account_reference: accountReference,
  };
}

function buildDarajaB2BPayload({ config, destination, amount, remarks, queueTimeoutUrl, resultUrl }) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 10000000) {
    throw new Error('Settlement amount must be a positive value');
  }
  if (!config?.shortcode || !config?.initiator || !config?.securityCredential) {
    throw new Error('Daraja B2B initiator configuration is incomplete');
  }
  if (!destination?.party_b || !destination?.account_reference) {
    throw new Error('Bank Paybill destination is incomplete');
  }
  return {
    Initiator: config.initiator,
    SecurityCredential: config.securityCredential,
    CommandID: destination.command_id || 'BusinessPayBill',
    SenderIdentifierType: '4',
    RecieverIdentifierType: destination.receiver_identifier_type || '4',
    Amount: Number(numericAmount.toFixed(2)),
    PartyA: config.shortcode,
    PartyB: destination.party_b,
    AccountReference: destination.account_reference,
    Remarks: String(remarks || 'Polyizon ISP settlement').slice(0, 100),
    QueueTimeOutURL: queueTimeoutUrl,
    ResultURL: resultUrl,
  };
}

async function submitDarajaB2B({ destination, amount, remarks, queueTimeoutUrl, resultUrl, config = loadDarajaB2BConfig() }) {
  if (!config.enabled) throw Object.assign(new Error('Daraja B2B settlement is disabled'), { code: 'DARAJA_B2B_DISABLED' });
  if (!config.configured) throw Object.assign(new Error('Daraja B2B settlement credentials are incomplete'), { code: 'DARAJA_B2B_NOT_CONFIGURED' });
  if (!/^https:\/\//i.test(String(queueTimeoutUrl || '')) || !/^https:\/\//i.test(String(resultUrl || ''))) {
    throw new Error('Daraja B2B callback URLs must use HTTPS');
  }
  const token = await getDarajaAccessToken(config);
  const payload = buildDarajaB2BPayload({ config, destination, amount, remarks, queueTimeoutUrl, resultUrl });
  const response = await axios.post(config.endpoint, payload, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 30000,
    maxRedirects: 0,
  });
  return response.data || {};
}

module.exports = {
  BANK_PAYBILL_RAILS,
  bankRail,
  buildDarajaB2BPayload,
  darajaB2BReady,
  loadDarajaB2BConfig,
  publicDarajaB2BStatus,
  resolveBankPaybillDestination,
  submitDarajaB2B,
};
