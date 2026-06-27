const axios = require('axios');
const zlib = require('zlib');
const db = require('../db');

const DEFAULT_BASE_URL = 'https://riseli.wispman.net/index.php?_route=api';
const SUPPORTED_PROVIDERS = ['wispman'];
let importedBillingSchemaReady = false;

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
  return /\b(active|expired|expiry|expire|status|account|client id|clientid|username|balance|renew|renewal|recharge|recharged|last recharged|current plan|my plan|my package|which plan|which package|internet off|not connected|disconnected|why.*off|why.*down)\b/i.test(String(text || ''));
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
  if (/^(?:hi|hey|hello|hallo|thanks?|thank you|asante|sawa|okay|ok|yes|no)$/i.test(value)) return false;
  if (/(?:\+?254|0)\d[\d\s-]{7,15}/.test(value)) return true;
  if (/\b(?:account\s*(?:number|no\.?)?|acc(?:ount)?\s*(?:number|no\.?)?|client\s*id|clientid|username|user\s*name)\b/i.test(value)) return true;
  if (/^\d{3,14}$/.test(value)) return true;
  return /^[A-Za-z][A-Za-z .'-]{2,80}$/.test(value);
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

async function ensureImportedBillingSchema() {
  if (importedBillingSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_import_batches (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      file_name VARCHAR(255),
      row_count INTEGER NOT NULL DEFAULT 0,
      imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_import_accounts (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      external_client_id VARCHAR(120),
      full_name VARCHAR(255),
      username VARCHAR(180),
      account_number VARCHAR(180),
      login_username VARCHAR(180),
      login_password TEXT,
      email VARCHAR(255),
      phone VARCHAR(80),
      phone_normalized VARCHAR(40),
      physical_address TEXT,
      service_type VARCHAR(120),
      router VARCHAR(180),
      radius_profile VARCHAR(180),
      connection_type VARCHAR(80),
      package_name VARCHAR(180),
      package_price NUMERIC(12,2),
      account_balance NUMERIC(12,2),
      validity_period INTEGER,
      validity_unit VARCHAR(50),
      expiration_date DATE,
      expiration_time VARCHAR(20),
      package_status VARCHAR(40),
      client_status VARCHAR(80),
      created_date DATE,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      source_file VARCHAR(255)
    )
  `);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS external_client_id VARCHAR(120)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS username VARCHAR(180)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS account_number VARCHAR(180)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS login_username VARCHAR(180)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS login_password TEXT`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS email VARCHAR(255)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS phone VARCHAR(80)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS phone_normalized VARCHAR(40)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS physical_address TEXT`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS service_type VARCHAR(120)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS router VARCHAR(180)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS radius_profile VARCHAR(180)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS connection_type VARCHAR(80)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS package_name VARCHAR(180)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS package_price NUMERIC(12,2)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS account_balance NUMERIC(12,2)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS validity_period INTEGER`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS validity_unit VARCHAR(50)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS expiration_date DATE`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS expiration_time VARCHAR(20)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS package_status VARCHAR(40)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS client_status VARCHAR(80)`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS created_date DATE`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`);
  await db.query(`ALTER TABLE billing_import_accounts ADD COLUMN IF NOT EXISTS source_file VARCHAR(255)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_import_accounts_client_phone ON billing_import_accounts(client_id, phone_normalized)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_import_accounts_client_username ON billing_import_accounts(client_id, lower(username))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_import_accounts_client_account ON billing_import_accounts(client_id, lower(account_number))`);
  importedBillingSchemaReady = true;
}

function importRowsForUpload({ fileName, csvText, fileBuffer }) {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    if (!fileBuffer || !fileBuffer.length) throw new Error('Excel upload was empty. Please choose a valid Billnasi XLSX file.');
    return parseXlsxRows(fileBuffer);
  }
  return parseCsv(csvText);
}

async function importBillingCsv({ clientId, fileName, csvText, fileBuffer, billingSystem = 'wispman' }) {
  if (!clientId) throw new Error('Client is required');
  const system = String(billingSystem || 'wispman').trim().toLowerCase();
  if (!['wispman', 'billnasi'].includes(system)) throw new Error('Choose a supported billing system before uploading.');
  const rows = importRowsForUpload({ fileName, csvText, fileBuffer });
  if (rows.length < 2) throw new Error('CSV must include a header row and at least one account row');
  const headers = rows[0].map((header) => String(header || '').trim());
  const accounts = rows
    .slice(1)
    .map((row) => mapImportedRow(headers, row, system))
    .filter((account) => account.full_name || account.username || account.account_number || account.phone_normalized);

  if (accounts.length === 0) throw new Error('No usable client accounts were found in the CSV');

  await ensureImportedBillingSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM billing_import_accounts WHERE client_id = $1`, [clientId]);
    const insert = `
      INSERT INTO billing_import_accounts (
        client_id, external_client_id, full_name, username, account_number, login_username, login_password,
        email, phone, phone_normalized, physical_address, service_type, router, radius_profile, connection_type,
        package_name, package_price, account_balance, validity_period, validity_unit, expiration_date, expiration_time, package_status,
        client_status, created_date, raw, source_file
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27
      )
    `;
    for (const account of accounts) {
      await client.query(insert, [
        clientId,
        account.external_client_id || null,
        account.full_name || null,
        account.username || null,
        account.account_number || null,
        account.login_username || null,
        account.login_password || null,
        account.email || null,
        account.phone || null,
        account.phone_normalized || null,
        account.physical_address || null,
        account.service_type || null,
        account.router || null,
        account.radius_profile || null,
        account.connection_type || null,
        account.package_name || null,
        account.package_price,
        account.account_balance,
        account.validity_period,
        account.validity_unit || null,
        account.expiration_date,
        account.expiration_time || null,
        account.package_status || null,
        account.client_status || null,
        account.created_date,
        JSON.stringify(account.raw || {}),
        String(fileName || 'billing-import.csv').slice(0, 255),
      ]);
    }
    const batch = await client.query(
      `INSERT INTO billing_import_batches (client_id, file_name, row_count)
       VALUES ($1, $2, $3)
       RETURNING id, file_name, row_count, imported_at`,
      [clientId, String(fileName || 'billing-import.csv').slice(0, 255), accounts.length]
    );
    await client.query('COMMIT');
    return { success: true, imported: accounts.length, batch: batch.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function billingImportSummary(clientId) {
  await ensureImportedBillingSchema();
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM billing_import_accounts WHERE client_id = $1`, [clientId]);
  const batch = await db.query(
    `SELECT id, file_name, row_count, imported_at
     FROM billing_import_batches
     WHERE client_id = $1
     ORDER BY imported_at DESC
     LIMIT 1`,
    [clientId]
  );
  return {
    account_count: count.rows[0]?.total || 0,
    last_import: batch.rows[0] || null,
  };
}

function importedAccountToStatus(row) {
  if (!row) return null;
  const price = Number(row.package_price);
  const balance = Number(row.account_balance);
  const formatDbDate = (value) => {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  };
  return {
    fullname: row.full_name,
    name: row.full_name,
    username: row.username || row.login_username,
    login_username: row.login_username || row.username,
    login_password: row.login_password,
    password: row.login_password,
    account: row.account_number || row.external_client_id,
    account_number: row.account_number,
    external_client_id: row.external_client_id,
    phone: row.phone_normalized || row.phone,
    email: row.email,
    address: row.physical_address,
    status: row.package_status || row.client_status,
    plan: row.package_name || row.radius_profile,
    service: row.service_type,
    router: row.router,
    profile: row.radius_profile,
    connection_type: row.connection_type,
    price: Number.isFinite(price) ? price : 0,
    package_price: Number.isFinite(price) ? price : 0,
    account_balance: Number.isFinite(balance) ? balance : null,
    validity: row.validity_period,
    validity_unit: row.validity_unit,
    expiration: formatDbDate(row.expiration_date),
    expiration_time: row.expiration_time || '',
    last_recharged_on: formatDbDate(row.created_date),
    raw: row.raw,
  };
}

async function findImportedAccount({ clientId, customerPhone, messageText }) {
  if (!clientId) return null;
  await ensureImportedBillingSchema();
  const text = String(messageText || '').trim();
  const keys = extractLookupKeys({ customerPhone, messageText: text });
  const explicitPhone = compactPhone(text) || keys.explicitPhone;
  const fallbackPhone = keys.phone || compactPhone(customerPhone);
  const attempts = [];
  if (explicitPhone) attempts.push({ clause: 'phone_normalized = $2', values: [explicitPhone] });
  if (keys.account) {
    attempts.push({
      clause: 'lower(account_number) = lower($2) OR lower(external_client_id) = lower($2) OR ltrim(account_number, $3) = ltrim($2, $3) OR ltrim(external_client_id, $3) = ltrim($2, $3)',
      values: [keys.account, '0'],
    });
  }
  if (keys.username) {
    attempts.push({
      clause: 'lower(username) = lower($2) OR lower(login_username) = lower($2) OR ltrim(username, $3) = ltrim($2, $3) OR ltrim(login_username, $3) = ltrim($2, $3)',
      values: [keys.username, '0'],
    });
  }
  if (text && !explicitPhone && !keys.account && !keys.username) {
    attempts.push({
      clause: 'lower(username) = lower($2) OR lower(account_number) = lower($2) OR lower(external_client_id) = lower($2) OR lower(full_name) = lower($2) OR ltrim(username, $3) = ltrim($2, $3) OR ltrim(account_number, $3) = ltrim($2, $3) OR ltrim(external_client_id, $3) = ltrim($2, $3)',
      values: [text, '0'],
    });
    attempts.push({ clause: 'full_name ILIKE $2', values: [`%${text}%`] });
  }
  if (fallbackPhone && fallbackPhone !== explicitPhone) attempts.push({ clause: 'phone_normalized = $2', values: [fallbackPhone] });

  for (const attempt of attempts) {
    const result = await db.query(
      `SELECT * FROM billing_import_accounts
       WHERE client_id = $1 AND (${attempt.clause})
       ORDER BY imported_at DESC, id DESC
       LIMIT 1`,
      [clientId, ...attempt.values]
    );
    if (result.rows[0]) return importedAccountToStatus(result.rows[0]);
  }
  return null;
}

async function importedPlans(clientId) {
  await ensureImportedBillingSchema();
  const result = await db.query(
    `SELECT package_name AS name, MAX(package_price)::numeric AS price, MAX(validity_period) AS validity, MAX(validity_unit) AS validity_unit
     FROM billing_import_accounts
     WHERE client_id = $1 AND package_name IS NOT NULL AND package_name <> ''
     GROUP BY package_name
     ORDER BY MAX(package_price) NULLS LAST, package_name
     LIMIT 12`,
    [clientId]
  );
  return result.rows.map((row) => ({
    name: row.name,
    price: Number(row.price || 0),
    validity: row.validity || 1,
    validity_unit: row.validity_unit || 'Month',
  }));
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
  const account = data.account || data.account_number || data.username || 'not shown';
  const planName = data.plan || data.package_name || data.profile || '';
  const priceValue = Number(data.price ?? data.package_price ?? data.plan_price ?? data.amount);
  const planPrice = Number.isFinite(priceValue) && priceValue > 0
    ? `${planName ? `${planName} - ` : ''}KSh ${priceValue.toLocaleString('en-KE')}`
    : (planName || 'not shown');
  const balanceValue = Number(data.account_balance ?? data.balance ?? data.wallet_balance ?? data.outstanding_balance ?? data.arrears);
  const balance = Number.isFinite(balanceValue)
    ? `KSh ${balanceValue.toLocaleString('en-KE')}`
    : 'not shown';
  const expiry = data.expiration ? `${data.expiration}${data.expiration_time ? ` at ${data.expiration_time}` : ''}` : 'not shown';
  const recharge = data.last_recharged_on || 'not shown';

  return (
    `I found:\n` +
    `Status: ${status}.\n` +
    `Account number: ${account}.\n` +
    `Current plan Price: ${planPrice}.\n` +
    `Account Balance: ${balance}.\n` +
    `Expiry: ${expiry}.\n` +
    `Last recharge: ${recharge}.`
  );
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

async function answerBillingQuestion({ clientId, customerPhone, messageText }) {
  const config = await loadClientBillingConfig(clientId);
  const canBeImportedLookup = looksLikeImportedLookupText(messageText);
  if (!looksLikeBillingQuestion(messageText) && !hasStandalonePhone(messageText) && !canBeImportedLookup) return null;

  const keys = extractLookupKeys({ customerPhone, messageText });
  const accountDetailsWanted = wantsImportedAccountDetails(messageText);
  const statusWanted = wantsClientStatus(messageText) || hasStandalonePhone(messageText);
  const paymentWanted = wantsPayment(messageText);
  const reconnectWanted = wantsReconnect(messageText);
  const plansWanted = wantsPlans(messageText);

  if (!looksLikeBillingQuestion(messageText) && canBeImportedLookup) {
    const imported = await findImportedAccount({ clientId, customerPhone, messageText });
    return imported ? clientStatusReply(imported) : null;
  }

  if (accountDetailsWanted) {
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
  importBillingCsv,
  loadClientBillingConfig,
  lookupInvoiceCustomer,
  lookupPaymentAccount,
  looksLikeBillingQuestion,
  testBillingConnection,
};
