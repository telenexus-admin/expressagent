const db = require('../db');

let ensured = false;

async function ensureActivityTable() {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_activity_logs (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      admin_name VARCHAR(255),
      admin_email VARCHAR(255),
      action VARCHAR(80) NOT NULL,
      entity_type VARCHAR(80) NOT NULL,
      entity_id INTEGER,
      description TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address VARCHAR(80),
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_client ON admin_activity_logs(client_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_admin ON admin_activity_logs(admin_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON admin_activity_logs(action, created_at DESC)`);
  ensured = true;
}

async function logActivity({ req, action, entityType, entityId = null, description, metadata = {} }) {
  try {
    await ensureActivityTable();
    const user = req?.user || {};
    const scope = req?.scope || {};
    const clientId = user.role === 'superadmin'
      ? (scope.clientId || metadata.client_id || null)
      : (user.client_id || scope.clientId || null);

    await db.query(
      `INSERT INTO admin_activity_logs
         (client_id, admin_id, admin_name, admin_email, action, entity_type, entity_id, description, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
      [
        clientId,
        user.id || null,
        user.name || null,
        user.email || null,
        action,
        entityType,
        entityId,
        description,
        JSON.stringify(metadata || {}),
        req?.ip || null,
        req?.headers?.['user-agent'] || null,
      ]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logActivity, ensureActivityTable };
