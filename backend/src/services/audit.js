const db = require('../db');

async function logActivity({ req, action, entityType, entityId = null, description, metadata = {} }) {
  try {
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

module.exports = { logActivity };
