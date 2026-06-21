const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

const ALL_PERMISSIONS = [
  'statistics',
  'conversations',
  'escalations',
  'installations',
  'complaints',
  'ai_health',
  'admins',
  'employees',
  'workflow',
  'agent',
  'logs',
];

// Creates a short-lived, client-scoped session for the platform operator.
// The client password is never read, changed or exposed.
router.post('/:clientId', async (req, res) => {
  try {
    const clientId = Number.parseInt(req.params.clientId, 10);
    if (!Number.isInteger(clientId) || clientId < 1) {
      return res.status(400).json({ error: 'A valid client is required' });
    }

    const result = await db.query(
      `SELECT id, name, business_name, status
       FROM clients
       WHERE id = $1
       LIMIT 1`,
      [clientId]
    );
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Activate this client before opening its dashboard' });
    }

    const displayName = client.business_name || client.name;
    const tokenPayload = {
      id: req.user.id,
      email: req.user.email,
      role: 'admin',
      name: `${req.user.name || 'Operator'} · Operator Access`,
      client_id: client.id,
      permissions: ALL_PERMISSIONS,
      operator_impersonation: true,
      operator_id: req.user.id,
    };
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '2h' });

    res.json({
      token,
      admin: {
        ...tokenPayload,
        client_name: client.name,
        client_business_name: client.business_name || null,
        operator_impersonation: true,
        accessed_client_name: displayName,
      },
    });
  } catch (err) {
    console.error('POST /operator-access/:clientId error:', err.message);
    res.status(500).json({ error: 'Could not open the client dashboard' });
  }
});

module.exports = router;
