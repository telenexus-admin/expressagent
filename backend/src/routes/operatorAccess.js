const express = require('express');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { startImpersonation, returnFromImpersonation, adminView } = require('../security/adminSessions');
const { logActivity } = require('../services/audit');

const router = express.Router();
router.use(authMiddleware);

router.post('/return', async (req, res) => {
  try {
    if (!req.user.operator_impersonation) return res.status(400).json({ error: 'No operator access session is active.' });
    const admin = await returnFromImpersonation(req, res);
    if (!admin) return res.status(401).json({ error: 'The operator session expired. Sign in again.' });
    return res.json({ admin });
  } catch (error) {
    console.error('POST /operator-access/return error:', error.message);
    return res.status(500).json({ error: 'Could not return to the operator dashboard.' });
  }
});

router.post('/:clientId', superadminMiddleware, async (req, res) => {
  try {
    const clientId = Number.parseInt(req.params.clientId, 10);
    if (!Number.isInteger(clientId) || clientId < 1) return res.status(400).json({ error: 'A valid client is required.' });
    const result = await db.query(`SELECT id,name,business_name,status,account_type FROM clients WHERE id=$1 LIMIT 1`, [clientId]);
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found.' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Activate this client before opening its dashboard.' });
    await startImpersonation(req, res, client.id);
    const admin = adminView({
      ...req.authRow,
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      acting_role: 'admin',
      acting_client_id: client.id,
      client_name: client.name,
      client_business_name: client.business_name,
      client_account_type: client.account_type,
      permissions: req.user.permissions,
    });
    admin.accessed_client_name = client.business_name || client.name;
    await logActivity({
      req,
      action: 'operator_client_access',
      entityType: 'client',
      entityId: client.id,
      description: `${req.user.name || 'Operator'} opened ${client.business_name || client.name}'s dashboard.`,
      metadata: { client_id: client.id, secure_session: true },
    });
    return res.json({ admin });
  } catch (error) {
    console.error('POST /operator-access/:clientId error:', error.message);
    return res.status(500).json({ error: 'Could not open the client dashboard.' });
  }
});

module.exports = router;
