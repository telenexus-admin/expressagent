const db = require('../db');

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

async function ensureBlockedNumbersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS blocked_numbers (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      phone VARCHAR(50) NOT NULL,
      normalized_phone VARCHAR(50) NOT NULL,
      reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (client_id, normalized_phone)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_blocked_numbers_client ON blocked_numbers(client_id, normalized_phone)`);
}

async function listBlockedNumbers(clientId) {
  await ensureBlockedNumbersTable();
  const result = await db.query(
    `SELECT id, phone, normalized_phone, reason, created_at
     FROM blocked_numbers
     WHERE client_id = $1
     ORDER BY created_at DESC`,
    [clientId]
  );
  return result.rows;
}

async function addBlockedNumber({ clientId, phone, reason }) {
  await ensureBlockedNumbersTable();
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 7) throw new Error('Enter a valid phone number to block');
  const result = await db.query(
    `INSERT INTO blocked_numbers (client_id, phone, normalized_phone, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, normalized_phone)
     DO UPDATE SET phone = EXCLUDED.phone, reason = EXCLUDED.reason
     RETURNING id, phone, normalized_phone, reason, created_at`,
    [clientId, String(phone || '').trim(), normalized, String(reason || '').trim() || null]
  );
  return result.rows[0];
}

async function removeBlockedNumber(clientId, id) {
  await ensureBlockedNumbersTable();
  const result = await db.query(
    `DELETE FROM blocked_numbers WHERE client_id = $1 AND id = $2 RETURNING id`,
    [clientId, id]
  );
  return Boolean(result.rows[0]);
}

async function isBlockedNumber(clientId, phone) {
  await ensureBlockedNumbersTable();
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  const result = await db.query(
    `SELECT id FROM blocked_numbers WHERE client_id = $1 AND normalized_phone = $2 LIMIT 1`,
    [clientId, normalized]
  );
  return Boolean(result.rows[0]);
}

module.exports = {
  ensureBlockedNumbersTable,
  listBlockedNumbers,
  addBlockedNumber,
  removeBlockedNumber,
  isBlockedNumber,
  normalizePhone,
};
