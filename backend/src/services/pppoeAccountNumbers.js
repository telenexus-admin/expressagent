const db = require('../db');

let schemaPromise = null;

function normalizePrefix(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function derivePrefix(client = {}) {
  const source = String(client.business_name || client.name || `ISP${client.id || ''}`)
    .trim()
    .toUpperCase();
  const words = source.match(/[A-Z0-9]+/g) || [];
  const firstWord = words[0] || '';
  let base = firstWord.replace(/[^A-Z0-9]/g, '').slice(0, 3);

  if (base.length < 3) {
    const compact = words.join('').replace(/[^A-Z0-9]/g, '');
    base = `${base}${compact}`.slice(0, 3);
  }

  if (base.length < 3) {
    base = `${base}${String(client.id || 0).padStart(3, '0')}`.slice(0, 3);
  }

  return normalizePrefix(base) || 'ISP';
}

async function ensurePppoeAccountNumberSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_account_prefix VARCHAR(8)`);
      await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mpesa_account_sequence BIGINT NOT NULL DEFAULT 0`);
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_mpesa_account_prefix_unique
        ON clients (UPPER(mpesa_account_prefix))
        WHERE mpesa_account_prefix IS NOT NULL AND BTRIM(mpesa_account_prefix) <> ''
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function ensureClientPrefix(queryable, clientId) {
  await ensurePppoeAccountNumberSchema();

  const result = await queryable.query(
    `SELECT id, name, business_name, mpesa_account_prefix, mpesa_account_sequence
     FROM clients
     WHERE id = $1
     FOR UPDATE`,
    [clientId]
  );
  const client = result.rows[0];
  if (!client) throw new Error('Billing client was not found');

  const existingPrefix = normalizePrefix(client.mpesa_account_prefix);
  if (existingPrefix) return existingPrefix;

  const base = derivePrefix(client);
  let chosen = null;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0
      ? base
      : normalizePrefix(`${base.slice(0, 2)}${attempt + 1}`);

    const collision = await queryable.query(
      `SELECT 1
       FROM clients
       WHERE id <> $1
         AND mpesa_account_prefix IS NOT NULL
         AND UPPER(mpesa_account_prefix) = UPPER($2)
       LIMIT 1`,
      [clientId, candidate]
    );

    if (!collision.rows.length) {
      chosen = candidate;
      break;
    }
  }

  if (!chosen) throw new Error('Could not allocate a unique ISP payment prefix');

  await queryable.query(
    `UPDATE clients
     SET mpesa_account_prefix = $2
     WHERE id = $1`,
    [clientId, chosen]
  );

  return chosen;
}

async function allocatePppoeAccountNumber(queryable, clientId) {
  await ensurePppoeAccountNumberSchema();
  const prefix = await ensureClientPrefix(queryable, clientId);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const sequenceResult = await queryable.query(
      `UPDATE clients
       SET mpesa_account_sequence = mpesa_account_sequence + 1
       WHERE id = $1
       RETURNING mpesa_account_sequence`,
      [clientId]
    );

    const sequence = Number(sequenceResult.rows[0]?.mpesa_account_sequence || 0);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('Could not allocate the next PPPoE payment account sequence');
    }

    const accountNumber = `${prefix}${String(sequence).padStart(3, '0')}`;
    const existing = await queryable.query(
      `SELECT 1
       FROM billing_subscribers
       WHERE account_number IS NOT NULL
         AND UPPER(account_number) = UPPER($1)
       LIMIT 1`,
      [accountNumber]
    );

    if (!existing.rows.length) {
      return {
        accountNumber,
        prefix,
        sequence,
      };
    }
  }

  throw new Error('Could not allocate a unique PPPoE payment account number');
}

module.exports = {
  allocatePppoeAccountNumber,
  derivePrefix,
  ensureClientPrefix,
  ensurePppoeAccountNumberSchema,
  normalizePrefix,
};
