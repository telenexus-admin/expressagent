const axios = require('axios');
const zlib = require('zlib');
const db = require('../db');
const { findMikrotikAccount } = require('./mikrotik');

const DEFAULT_BASE_URL = 'https://riseli.wispman.net/index.php?_route=api';
const SUPPORTED_PROVIDERS = ['wispman'];
let importedBillingSchemaReady = false;
let billingTemplateCursor = 0;

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
  return /\b(active|expired|expiry|expire|status|account|client id|clientid|username|password|credential|credentials|login|package|plan|price|payment|paid|mpesa|m-pesa|receipt|transaction|recharge|recharged|balance|bill|billing|renew|renewal|internet off|not connected|disconnected)\b/.test(value);
}

function isRouterAdminOnlyQuestion(text) {
  const value = String(text || '').toLowerCase().trim();
  if (!value) return false;
  const routerSignal = /\b(mikrotik|routeros|winbox|router\s+(status|online|offline|health|uptime|logs?|interfaces?|cpu|memory|users?|sessions?)|interfaces?|router\s+health|network\s+report)\b/.test(value);
  if (!routerSignal) return false;
  const explicitCustomerLookup =
    /(?:\+?254|0)\d[\d\s-]{7,15}/.test(value) ||
    /\b(?:account\s*(?:number|no\.?)?|acc(?:ount)?\s*(?:number|no\.?)?|client\s*id|clientid|username|user\s*name)\b/i.test(value);
  return !explicitCustomerLookup;
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
  return /\b(active|expired|expiry|expire|status|account|client id|clientid|username|balance|renew|renewal|recharge|recharged|last recharged|current plan|my plan|my package|which plan|which package|details|information|info|internet off|not connected|disconnected|why.*off|why.*down)\b/i.test(String(text || ''));
}

function wantsImportedAccountDetails(text) {
  const value = String(text || '');
  if (/\b(password|credentials?|login\s*(?:details?|password|username)?)\b/i.test(value)) return true;
  if (/\b(user\s*name|username)\b/i.test(value) && !/\b(status|active|expired|expiry|expire)\b/i.test(value)) return true;
  if (/\baccount\s*(?:number|no\.?|details?|login)\b/i.test(value) && !/\b(status|active|expired|expiry|expire)\b/i.test(value)) return true;
  if (/\bmy\s+account\b/i.test(value) && !/\b(status|active|expired|expiry|expire|balance|plan|package)\b/i.test(value)) return true;
  return false;
}

function looksLikeImportedLookupText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^(?:hi|hey|hello|hallo|thanks?|thank you|asante|sawa|okay|ok|yes|no|inquiry|help|need help|support|my internet is slow|internet is slow|slow internet)$/i.test(value)) return false;
  if (/\b(?:slow|buffering|not working|no internet|need help|help me|assist|issue|problem|complaint|fault|down|router|wifi|wi-fi|internet)\b/i.test(value)) return false;
  if (/(?:\+?254|0)\d[\d\s-]{7,15}/.test(value)) return true;
  if (/\b(?:account\s*(?:number|no\.?)?|acc(?:ount)?\s*(?:number|no\.?)?|client\s*id|clientid|username|user\s*name)\b/i.test(value)) return true;
  if (/^\d{3,14}$/.test(value)) return true;
  if (/^(?:name|my name is|i am|i'm|this is)\s+[A-Za-z][A-Za-z .'-]{2,80}$/i.test(value)) return true;
  return false;
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

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const IMPORT_FIELD_ALIASES = {
  external_client_id: ['clientid', 'customerid', 'subscriberid', 'id'],
  full_name: ['fullname', 'fullnames', 'clientname', 'customername', 'name', 'names'],
  username: ['username', 'user', 'pppoeusername', 'login'],
  account_number: ['accountnumber', 'accountno', 'account', 'accno'],
  login_username: ['loginusername', 'username', 'user'],
  login_password: ['password', 'plainpassword', 'loginpassword', 'pppoepassword'],
  email: ['email', 'emailaddress'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'contact'],
  physical_address: ['address', 'physicaladdress', 'location'],
  service_type: ['servicetype', 'service'],
  router: ['router', 'nas', 'device', 'mikrotik'],
  radius_profile: ['profile', 'radiusprofile', 'mikrotikprofile', 'pppoeprofile'],
  connection_type: ['connectiontype', 'connection', 'type', 'activity'],
  package_name: ['packagename', 'package', 'plan', 'planname'],
  package_price: ['packageprice', 'price', 'amount', 'cost', 'monthlyfee'],
  account_balance: ['accountbalance', 'balance', 'walletbalance', 'outstandingbalance', 'arrears', 'amountdue', 'dueamount'],
  validity_period: ['packagevalidity', 'validityperiod', 'validity', 'duration'],
  validity_unit: ['validityunit', 'unit', 'durationunit'],
  expiration_date: ['expirationdate', 'expirydate', 'expiry', 'expiredate', 'expires'],
  package_status: ['packagestatus', 'subscriptionstatus', 'packageactive', 'status'],
  client_status: ['clientstatus', 'customerstatus', 'accountstatus'],
  created_date: ['datecreated', 'createddate', 'created', 'registrationdate'],
};

function columnIndex(cellRef = '') {
  const letters = String(cellRef).replace(/[^A-Z]/gi, '').toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function xmlDecode(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function zipEntries(buffer) {
  const entries = new Map();
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSig) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('XLSX file could not be read. Please export a valid Excel workbook or CSV.');
  const total = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  let offset = centralOffset;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported XLSX compression method ${method}`);
    entries.set(name, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXmlAttributes(value) {
  const attrs = {};
  String(value || '').replace(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g, (_, key, val) => {
    attrs[key] = xmlDecode(val);
    return '';
  });
  return attrs;
}

function parseSharedStrings(xml) {
  const strings = [];
  const siMatches = String(xml || '').match(/<si\b[\s\S]*?<\/si>/g) || [];
  for (const si of siMatches) {
    const parts = [];
    si.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, text) => {
      parts.push(xmlDecode(text));
      return '';
    });
    strings.push(parts.join(''));
  }
  return strings;
}

function parseXlsxRows(buffer) {
  const entries = zipEntries(buffer);
  const sheetName = [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!sheetName) throw new Error('XLSX file does not contain a worksheet.');
  const shared = entries.has('xl/sharedStrings.xml') ? parseSharedStrings(entries.get('xl/sharedStrings.xml').toString('utf8')) : [];
  const sheet = entries.get(sheetName).toString('utf8');
  const rows = [];
  const rowMatches = sheet.match(/<row\b[\s\S]*?<\/row>/g) || [];
  for (const rowXml of rowMatches) {
    const row = [];
    const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) || [];
    for (const cellXml of cellMatches) {
      const open = cellXml.match(/^<c\b([^>]*)>/);
      const attrs = parseXmlAttributes(open?.[1] || '');
      const index = columnIndex(attrs.r || '');
      let value = '';
      if (attrs.t === 'inlineStr') {
        const texts = [];
        cellXml.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, text) => {
          texts.push(xmlDecode(text));
          return '';
        });
        value = texts.join('');
      } else {
        const v = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        value = v ? xmlDecode(v[1]) : '';
        if (attrs.t === 's') value = shared[Number(value)] || '';
      }
      row[index] = value;
    }
    if (row.some((value) => String(value || '').trim() !== '')) rows.push(row.map((value) => value || ''));
  }
  return rows;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const input = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => String(value).trim() !== '')) rows.push(row);
  return rows;
}

function parseImportedDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(slash[2]).padStart(2, '0')}-${String(slash[1]).padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseImportedTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return '';
  let hour = Number(match[1]);
  const suffix = String(match[4] || '').toLowerCase();
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  const seconds = match[3] ? `:${match[3]}` : '';
  return `${String(hour).padStart(2, '0')}:${match[2]}${seconds}`;
}

function parseImportedNumber(value) {
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceFromPackageName(value) {
  const text = String(value || '');
  const match = text.match(/@\s*([0-9]+(?:[,.][0-9]+)?)/) || text.match(/\b([0-9]+(?:[,.][0-9]+)?)\s*(?:ksh|kshs|kes)\b/i);
  if (!match) return null;
  return parseImportedNumber(match[1]);
}

function cleanImportedStatus(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapImportedRow(headers, row, billingSystem = 'wispman') {
  const byHeader = new Map();
  headers.forEach((header, index) => byHeader.set(normalizeHeader(header), String(row[index] || '').trim()));
  const pick = (field) => {
    for (const alias of IMPORT_FIELD_ALIASES[field] || []) {
      if (byHeader.has(alias)) return byHeader.get(alias);
    }
    return '';
  };

  const imported = {
    external_client_id: pick('external_client_id'),
    full_name: pick('full_name'),
    username: pick('username'),
    account_number: pick('account_number'),
    login_username: pick('login_username') || pick('username'),
    login_password: pick('login_password'),
    email: pick('email'),
    phone: pick('phone'),
    phone_normalized: compactPhone(pick('phone')),
    physical_address: pick('physical_address'),
    service_type: pick('service_type'),
    router: pick('router'),
    radius_profile: pick('radius_profile'),
    connection_type: pick('connection_type'),
    package_name: pick('package_name'),
    package_price: parseImportedNumber(pick('package_price')),
    account_balance: parseImportedNumber(pick('account_balance')),
    validity_period: parseImportedNumber(pick('validity_period')),
    validity_unit: pick('validity_unit'),
    expiration_date: parseImportedDate(pick('expiration_date')),
    expiration_time: parseImportedTime(pick('expiration_date')),
    package_status: cleanImportedStatus(pick('package_status')),
    client_status: cleanImportedStatus(pick('client_status')),
    created_date: parseImportedDate(pick('created_date')),
    raw: Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])),
  };

  if (String(billingSystem || '').toLowerCase() === 'billnasi') {
    imported.account_number = imported.account_number || imported.username || imported.external_client_id;
    imported.login_username = imported.login_username || imported.username;
    imported.package_price = imported.package_price ?? priceFromPackageName(imported.package_name);
    imported.client_status = imported.client_status || imported.connection_type;
    imported.service_type = imported.service_type || 'Billnasi';
  }

  return imported;
}

async function e…6083 tokens truncated…ckage, with expiry on '+expiry+'. Your account number is '+account+', and your router is '+(data.router || 'not shown')+'.\nIs there anything else I can help you with today?',
    'I found your account, '+name+' 😊 Everything looks good—your '+planPrice+' package is '+status+' until '+expiry+'. Your account number is '+account+', and the service is connected through '+(data.router || 'your network')+'.\nWould you like me to help with anything else?',
  ];
  const reply = templates[billingTemplateCursor++ % templates.length];
  return extraLines.length ? reply+'\n'+extraLines.join('\n') : reply;
}

function importedAccountDetailsReply(data) {
  if (!data) return null;
  const account = data.account || data.account_number || data.external_client_id || 'not shown';
  const username = data.username || data.login_username || 'not shown';
  const password = data.login_password || data.password || 'not shown';
  const phone = data.phone || 'not shown';
  const plan = data.plan || data.package_name || data.profile || 'not shown';
  return (
    `I found your account details:\n` +
    `Account number: ${account}.\n` +
    `Username: ${username}.\n` +
    `Password: ${password}.\n` +
    `Phone: ${phone}.\n` +
    `Current plan: ${plan}.`
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

function invoiceCustomerFromStatus(data, fallback = {}) {
  if (!data) return null;
  const plan = data.plan || data.service || fallback.plan || '';
  const price = Number(data.price || data.amount || data.package_price || data.plan_price || fallback.price || 0);
  return {
    name: data.fullname || data.name || data.customer_name || data.username || fallback.name || '',
    phone: compactPhone(data.phone || fallback.phone),
    email: data.email || '',
    address: [data.address, data.area, data.location].filter(Boolean).join(', '),
    account: data.account || data.username || '',
    plan,
    price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : 0,
    expiry: data.expiration || data.expiry || data.expire_date || '',
    status: data.status || '',
    raw: data,
  };
}

async function lookupInvoiceCustomer({ clientId, query, customerPhone }) {
  const imported = await findImportedAccount({ clientId, customerPhone, messageText: query });
  if (imported) {
    return { success: true, customer: invoiceCustomerFromStatus(imported, { name: query, phone: customerPhone }) };
  }

  const config = await loadClientBillingConfig(clientId);
  if (!canUseConfig(config)) return { success: false, reason: 'not_configured', error: 'Billing API is not configured' };

  const text = String(query || '').trim();
  const keys = extractLookupKeys({ customerPhone, messageText: text });
  const attempts = [];
  const phone = compactPhone(text) || keys.phone || compactPhone(customerPhone);
  if (phone) attempts.push({ phone });
  if (keys.account) attempts.push({ account: keys.account });
  if (keys.username) attempts.push({ username: keys.username });
  if (text && !phone && !keys.account && !keys.username) {
    attempts.push({ username: text }, { account: text }, { name: text }, { query: text });
  }

  const seen = new Set();
  for (const params of attempts) {
    const key = JSON.stringify(params);
    if (seen.has(key)) continue;
    seen.add(key);
    const status = await get('v1/clients/status', params, config);
    if (status.success && status.data) {
      const customer = invoiceCustomerFromStatus(status.data, { name: text, phone });
      if (customer?.plan && !customer.price) {
        const plan = await get('v1/plans', { name: customer.plan }, config);
        const plans = Array.isArray(plan.data?.plans) ? plan.data.plans : [];
        const planData = plans[0] || plan.data?.plan || plan.data;
        const amount = Number(planData?.price);
        if (plan.success && Number.isFinite(amount) && amount > 0) customer.price = Math.round(amount * 100) / 100;
      }
      return { success: true, customer };
    }
  }

  return { success: false, reason: 'not_found', error: 'Customer was not found in the billing system' };
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

async function answerBillingQuestion({ clientId, customerPhone, customerName, messageText }) {
  if (isRouterAdminOnlyQuestion(messageText)) return null;

  const config = await loadClientBillingConfig(clientId);
  const numberOnlyLookup = /^\s*(?:\+?254|0)[0-9]{9,12}\s*$/.test(String(messageText || ""));
  const canBeImportedLookup = looksLikeImportedLookupText(messageText);
  if (!looksLikeBillingQuestion(messageText) && !hasStandalonePhone(messageText) && !numberOnlyLookup && !canBeImportedLookup) return null;

  const keys = extractLookupKeys({ customerPhone, messageText });
  const accountDetailsWanted = wantsImportedAccountDetails(messageText);
  const statusWanted = wantsClientStatus(messageText) || hasStandalonePhone(messageText) || numberOnlyLookup;
  const paymentWanted = wantsPayment(messageText);
  const reconnectWanted = wantsReconnect(messageText);
  const plansWanted = wantsPlans(messageText);

  if (!looksLikeBillingQuestion(messageText) && canBeImportedLookup && !numberOnlyLookup) {
    const mikrotik = await findMikrotikAccount({ clientId, customerPhone, messageText });
    if (mikrotik) return clientStatusReply(mikrotik, { customerName });
    const imported = await findImportedAccount({ clientId, customerPhone, messageText });
    return imported ? clientStatusReply(imported) : null;
  }

  if (accountDetailsWanted) {
    if (/\b(password|credentials?|login)\b/i.test(String(messageText || ''))) {
      const imported = await findImportedAccount({ clientId, customerPhone, messageText });
      if (imported) return importedAccountDetailsReply(imported);
      return accountNotFoundReply(keys);
    }
    const mikrotik = await findMikrotikAccount({ clientId, customerPhone, messageText });
    if (mikrotik) return clientStatusReply(mikrotik, { customerName });
    const imported = await findImportedAccount({ clientId, customerPhone, messageText });
    if (imported) return importedAccountDetailsReply(imported);
    return accountNotFoundReply(keys);
  }

  if (plansWanted && !canUseConfig(config)) {
    const plans = await importedPlans(clientId);
    const lines = formatPlanLines({ plans });
    if (lines) return `Here are the current packages I have on file:\n${lines}`;
  }

  if (!canUseConfig(config)) {
    if (statusWanted || paymentWanted) {
      const mikrotik = await findMikrotikAccount({ clientId, customerPhone, messageText });
      if (mikrotik && statusWanted && !reconnectWanted) return clientStatusReply(mikrotik, { customerName });
      const imported = await findImportedAccount({ clientId, customerPhone, messageText });
      if (imported && statusWanted && !reconnectWanted) return clientStatusReply(imported);
      if (imported && paymentWanted) {
        return `I found ${imported.fullname || imported.username || 'your account'}.\nCurrent plan: ${imported.plan || 'not shown'}.\nAmount: KSh ${Number(imported.price || 0).toLocaleString('en-KE')}.\nExpiry: ${imported.expiration || 'not shown'}.`;
      }
    }
    if (statusWanted || paymentWanted) return accountNotFoundReply(keys);
    return null;
  }

  let liveStatusNotFound = false;
  if (statusWanted || paymentWanted) {
    const mikrotik = await findMikrotikAccount({ clientId, customerPhone, messageText });
    if (mikrotik && statusWanted && !reconnectWanted) return clientStatusReply(mikrotik, { customerName });
    const params = clientLookupParams(keys);
    if (params) {
      const status = await get('v1/clients/status', params, config);
      if (status.success && status.data && statusWanted && !reconnectWanted) {
        return clientStatusReply(status.data);
      }
      if (status.status === 404 && statusWanted && !paymentWanted) {
        liveStatusNotFound = true;
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
        const imported = await findImportedAccount({ clientId, customerPhone, messageText });
        if (imported) {
          return `I found ${imported.fullname || imported.username || 'your account'}.\nCurrent plan: ${imported.plan || 'not shown'}.\nAmount: KSh ${Number(imported.price || 0).toLocaleString('en-KE')}.\nExpiry: ${imported.expiration || 'not shown'}.`;
        }
        return `I could not find that payment. Please send the M-Pesa transaction code or the registered payment phone number.`;
      }
    }
  }

  if ((statusWanted && liveStatusNotFound) || (statusWanted && !paymentWanted)) {
    const imported = await findImportedAccount({ clientId, customerPhone, messageText });
    if (imported && !reconnectWanted) return clientStatusReply(imported);
    if (liveStatusNotFound) return accountNotFoundReply(keys);
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
  const imported = await findImportedAccount({ clientId, customerPhone: phone, messageText: phone });
  if (imported) {
    const amount = Number(imported.price || imported.package_price || 0);
    if (Number.isFinite(amount) && amount > 0) {
      return {
        success: true,
        phone: compactPhone(phone) || imported.phone,
        amount: Math.round(amount),
        account: imported,
        plan: {
          name: imported.plan,
          price: amount,
          validity: imported.validity || 1,
          validity_unit: imported.validity_unit || 'Month',
        },
      };
    }
  }

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
  if (!looksLikeBillingQuestion(messageText)) return null;

  const sections = [];
  const keys = extractLookupKeys({ customerPhone, messageText });
  const imported = await findImportedAccount({ clientId, customerPhone, messageText });
  const accountDetailsWanted = wantsImportedAccountDetails(messageText);

  if (imported && !canUseConfig(config) && (wantsClientStatus(messageText) || wantsPayment(messageText))) {
    sections.push(`IMPORTED BILLING ACCOUNT\n${summarizeClientStatus(imported)}`);
  }

  if (imported && accountDetailsWanted) {
    sections.push(
      `IMPORTED ACCOUNT DETAILS\n` +
      `Account: ${imported.account || 'not shown'}\n` +
      `Username: ${imported.username || 'not shown'}\n` +
      `Password: ${imported.login_password || 'not shown'}`
    );
  }

  if (wantsPlans(messageText)) {
    const plans = await importedPlans(clientId);
    const summary = summarizePlans({ plans });
    if (summary) sections.push(`IMPORTED BILLING PLANS\n${summary}`);
  }

  if (!canUseConfig(config)) {
    if (sections.length === 0) return null;
    return (
      `\n\nBILLING CONTEXT FROM UPLOADED CSV (read-only):\n` +
      `${sections.join('\n\n')}\n\n` +
      `IMPORTANT BILLING RULES:\n` +
      `- You DO have read-only access to these uploaded billing facts when this context appears.\n` +
      `- Do not say you have no access to account details.\n` +
      `- Answer directly using the status, plan, expiry, package and contact facts above.\n` +
      `- If imported account details include a password and the customer asked for it, you may provide it briefly.\n` +
      `- If no account was found for the WhatsApp number, ask for their registered phone, account number, or username.\n` +
      `- Keep the reply short and customer-friendly.\n` +
      `- Do not expose raw internal data. Only provide a password when the customer explicitly asks for their own login details and the imported CSV matched their WhatsApp/account.`
    );
  }

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
  billingImportSummary,
  buildBillingContext,
  canUseBilling,
  canUseConfig,
  deleteBillingImport,
  importBillingCsv,
  loadClientBillingConfig,
  lookupInvoiceCustomer,
  lookupPaymentAccount,
  looksLikeBillingQuestion,
  testBillingConnection,
};
