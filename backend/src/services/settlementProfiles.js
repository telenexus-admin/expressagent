const crypto = require('crypto');
const db = require('../db');

const INSTITUTIONS = Object.freeze({
  ncba: {
    code: 'ncba',
    name: 'NCBA Bank Kenya',
    type: 'bank',
    collection_model: 'NCBA Till / M-Pesa Paybill / Virtual Account',
    settlement_capability: 'bank_collection',
    public_notes: 'Supports direct M-Pesa collections into nominated NCBA accounts, virtual accounts and instant payment notifications.',
  },
  kcb: {
    code: 'kcb',
    name: 'KCB Bank Kenya',
    type: 'bank',
    collection_model: 'KCB Lipa na M-Pesa / Host-to-Host',
    settlement_capability: 'bank_collection',
    public_notes: 'Supports aggregated Lipa na M-Pesa collection, real-time credit and reconciliation integration.',
  },
  coop: {
    code: 'coop',
    name: 'Co-operative Bank of Kenya',
    type: 'bank',
    collection_model: 'MCollection / Paybill 400222 / B2B Integration',
    settlement_capability: 'bank_collection',
    public_notes: 'Supports instant direct M-Pesa collections to Co-op business accounts and B2B collection integration.',
  },
  equity: {
    code: 'equity',
    name: 'Equity Bank Kenya',
    type: 'bank',
    collection_model: 'Pay With Equity / Paybill 247247 / API Banking',
    settlement_capability: 'bank_collection',
    public_notes: 'Supports interoperable merchant collections, real-time settlement and host-to-host/API banking.',
  },
});

let schemaPromise;

function encryptionKey() {
  const raw = String(process.env.SETTLEMENT_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error('SETTLEMENT_ENCRYPTION_KEY must be a 64-character hex key');
  }
  return Buffer.from(raw, 'hex');
}

function encryptValue(value) {
  const clean = String(value || '').trim();
  if (!clean) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

function decryptValue(payload) {
  if (!payload) return '';
  const [ivValue, tagValue, ciphertextValue] = String(payload).split('.');
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Stored settlement credential is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function last4(value) {
  const clean = String(value || '').replace(/\s+/g, '');
  return clean ? clean.slice(-4) : null;
}

function mask(lastFour) {
  return lastFour ? `••••${lastFour}` : '';
}

function institution(code) {
  return INSTITUTIONS[String(code || '').trim().toLowerCase()] || null;
}

function publicInstitutions() {
  return Object.values(INSTITUTIONS).map((item) => ({ ...item }));
}

async function ensureSettlementSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS billing_settlement_profiles (
          id BIGSERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
          institution_code VARCHAR(30) NOT NULL,
          institution_name VARCHAR(160) NOT NULL,
          institution_type VARCHAR(30) NOT NULL DEFAULT 'bank',
          account_name VARCHAR(200) NOT NULL,
          account_number_ciphertext TEXT NOT NULL,
          account_number_last4 VARCHAR(8) NOT NULL,
          branch_name VARCHAR(160),
          collection_reference_ciphertext TEXT,
          collection_reference_last4 VARCHAR(8),
          routing_mode VARCHAR(40) NOT NULL DEFAULT 'polyizon_gateway',
          verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
          routing_status VARCHAR(30) NOT NULL DEFAULT 'disabled',
          verification_notes TEXT,
          verified_at TIMESTAMP WITH TIME ZONE,
          verified_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
          rail_reference VARCHAR(180),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT billing_settlement_profiles_institution_check
            CHECK (institution_code IN ('ncba','kcb','coop','equity')),
          CONSTRAINT billing_settlement_profiles_verification_check
            CHECK (verification_status IN ('pending','verified','rejected','suspended')),
          CONSTRAINT billing_settlement_profiles_routing_check
            CHECK (routing_status IN ('disabled','ready','active')),
          CONSTRAINT billing_settlement_profiles_mode_check
            CHECK (routing_mode IN ('polyizon_gateway','isp_direct','bank_collection'))
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_settlement_profiles_status ON billing_settlement_profiles(verification_status, routing_status, updated_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_settlement_profiles_institution ON billing_settlement_profiles(institution_code, verification_status)`);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function safeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    institution_code: row.institution_code,
    institution_name: row.institution_name,
    institution_type: row.institution_type,
    account_name: row.account_name,
    account_number_masked: mask(row.account_number_last4),
    branch_name: row.branch_name || '',
    collection_reference_masked: mask(row.collection_reference_last4),
    routing_mode: row.routing_mode,
    verification_status: row.verification_status,
    routing_status: row.routing_status,
    verification_notes: row.verification_notes || '',
    verified_at: row.verified_at || null,
    rail_reference: row.rail_reference || null,
    configured: true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getSettlementProfile(clientId) {
  await ensureSettlementSchema();
  const result = await db.query(
    `SELECT * FROM billing_settlement_profiles WHERE client_id=$1 LIMIT 1`,
    [clientId]
  );
  return result.rows[0] || null;
}

async function saveSettlementProfile({ clientId, institutionCode, accountName, accountNumber, branchName, collectionReference }) {
  await ensureSettlementSchema();
  const selected = institution(institutionCode);
  if (!selected) throw new Error('Unsupported settlement institution');

  const existing = await getSettlementProfile(clientId);
  const cleanAccountName = String(accountName || '').trim();
  const cleanAccountNumber = String(accountNumber || '').trim();
  const cleanBranch = String(branchName || '').trim();
  const cleanReference = String(collectionReference || '').trim();

  if (!cleanAccountName || cleanAccountName.length > 200) throw new Error('A valid bank account name is required');
  if (cleanBranch.length > 160) throw new Error('Branch name is too long');
  if (cleanReference.length > 120) throw new Error('Collection reference is too long');

  const sameInstitution = existing && existing.institution_code === selected.code;
  if (!cleanAccountNumber && !sameInstitution) {
    throw new Error('Enter a valid bank account number');
  }
  if (cleanAccountNumber && !/^[A-Za-z0-9.\-\/ ]{4,40}$/.test(cleanAccountNumber)) {
    throw new Error('Enter a valid bank account number');
  }

  const accountCiphertext = cleanAccountNumber
    ? encryptValue(cleanAccountNumber)
    : existing.account_number_ciphertext;
  const accountLast4 = cleanAccountNumber
    ? last4(cleanAccountNumber)
    : existing.account_number_last4;

  const result = await db.query(
    `INSERT INTO billing_settlement_profiles (
       client_id,institution_code,institution_name,institution_type,account_name,
       account_number_ciphertext,account_number_last4,branch_name,
       collection_reference_ciphertext,collection_reference_last4,
       routing_mode,verification_status,routing_status,verification_notes,
       verified_at,verified_by_admin_id,rail_reference,metadata,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'polyizon_gateway','pending','disabled',NULL,NULL,NULL,NULL,'{}'::jsonb,NOW())
     ON CONFLICT (client_id) DO UPDATE SET
       institution_code=EXCLUDED.institution_code,
       institution_name=EXCLUDED.institution_name,
       institution_type=EXCLUDED.institution_type,
       account_name=EXCLUDED.account_name,
       account_number_ciphertext=EXCLUDED.account_number_ciphertext,
       account_number_last4=EXCLUDED.account_number_last4,
       branch_name=EXCLUDED.branch_name,
       collection_reference_ciphertext=EXCLUDED.collection_reference_ciphertext,
       collection_reference_last4=EXCLUDED.collection_reference_last4,
       routing_mode='polyizon_gateway',
       verification_status='pending',
       routing_status='disabled',
       verification_notes=NULL,
       verified_at=NULL,
       verified_by_admin_id=NULL,
       rail_reference=NULL,
       metadata='{}'::jsonb,
       updated_at=NOW()
     RETURNING *`,
    [
      clientId,
      selected.code,
      selected.name,
      selected.type,
      cleanAccountName,
      accountCiphertext,
      accountLast4,
      cleanBranch || null,
      cleanReference ? encryptValue(cleanReference) : null,
      cleanReference ? last4(cleanReference) : null,
    ]
  );
  return result.rows[0];
}

async function reviewSettlementProfile({ clientId, adminId, decision, notes, railReference }) {
  await ensureSettlementSchema();
  if (!['verified', 'rejected', 'suspended'].includes(decision)) throw new Error('Unsupported verification decision');
  const routingStatus = decision === 'verified' ? 'ready' : 'disabled';
  const result = await db.query(
    `UPDATE billing_settlement_profiles
     SET verification_status=$2,
         routing_status=$3,
         verification_notes=$4,
         verified_at=CASE WHEN $2='verified' THEN NOW() ELSE NULL END,
         verified_by_admin_id=$5,
         rail_reference=CASE WHEN $2='verified' THEN NULLIF($6,'') ELSE NULL END,
         updated_at=NOW()
     WHERE client_id=$1
     RETURNING *`,
    [clientId, decision, routingStatus, String(notes || '').trim() || null, adminId || null, String(railReference || '').trim()]
  );
  return result.rows[0] || null;
}

async function activateSettlementProfile({ clientId, adminId, railReference }) {
  await ensureSettlementSchema();
  const cleanRail = String(railReference || '').trim();
  if (!cleanRail) throw new Error('A verified bank/Safaricom rail reference is required before activation');
  const result = await db.query(
    `UPDATE billing_settlement_profiles
     SET routing_status='active', rail_reference=$2, verified_by_admin_id=COALESCE($3,verified_by_admin_id), updated_at=NOW()
     WHERE client_id=$1 AND verification_status='verified' AND routing_status='ready'
     RETURNING *`,
    [clientId, cleanRail, adminId || null]
  );
  return result.rows[0] || null;
}

async function resolveActiveSettlement(clientId) {
  const row = await getSettlementProfile(clientId);
  if (!row || row.verification_status !== 'verified' || row.routing_status !== 'active') {
    const error = new Error('ISP settlement routing is not active');
    error.code = 'SETTLEMENT_NOT_ACTIVE';
    throw error;
  }
  return {
    ...safeProfile(row),
    account_number: decryptValue(row.account_number_ciphertext),
    collection_reference: decryptValue(row.collection_reference_ciphertext),
  };
}

module.exports = {
  INSTITUTIONS,
  activateSettlementProfile,
  decryptValue,
  encryptValue,
  ensureSettlementSchema,
  getSettlementProfile,
  institution,
  publicInstitutions,
  resolveActiveSettlement,
  reviewSettlementProfile,
  safeProfile,
  saveSettlementProfile,
};
