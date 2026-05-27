const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { logActivity } = require('../services/audit');

const ALL_PERMISSIONS = [
  'statistics',
  'conversations',
  'tickets',
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

function normalizePermissions(raw, role) {
  if (role === 'superadmin') return ALL_PERMISSIONS;
  if (!Array.isArray(raw)) return ALL_PERMISSIONS;
  const clean = [...new Set(raw.filter((p) => ALL_PERMISSIONS.includes(p)))];
  return clean.length > 0 ? clean : ['statistics'];
}

router.use(authMiddleware, scopeMiddleware);

router.get('/', async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where = `WHERE a.client_id = $${params.length}`;
    }
    const result = await db.query(
      `SELECT a.id, a.name, a.email, a.role, a.client_id, a.permissions, a.created_at, c.name AS client_name
       FROM admins a
       LEFT JOIN clients c ON c.id = a.client_id
       ${where}
       ORDER BY a.created_at ASC`,
      params
    );
    res.json(result.rows.map((row) => ({
      ...row,
      permissions: normalizePermissions(row.permissions, row.role),
    })));
  } catch (err) {
    console.error('GET /admins error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').optional().isIn(['admin', 'superadmin']).withMessage('Invalid role'),
    body('client_id').optional().isInt({ min: 1 }).withMessage('client_id must be a positive integer'),
    body('permissions').optional().isArray().withMessage('permissions must be an array'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password } = req.body;
    let role = req.body.role || 'admin';
    let clientId = req.body.client_id || null;

    if (req.scope.isSuperadmin) {
      if (role === 'superadmin') clientId = null;
      else if (!clientId) return res.status(400).json({ error: 'client_id is required when creating a regular admin' });
    } else {
      role = 'admin';
      clientId = req.scope.clientId;
    }

    const permissions = normalizePermissions(req.body.permissions, role);

    try {
      if (clientId) {
        const check = await db.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
        if (check.rows.length === 0) return res.status(400).json({ error: 'client_id does not exist' });
      }

      const hash = await bcrypt.hash(password, 12);
      const result = await db.query(
        `INSERT INTO admins (name, email, password_hash, role, client_id, permissions)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, name, email, role, client_id, permissions, created_at`,
        [name, email, hash, role, clientId, JSON.stringify(permissions)]
      );
      const created = result.rows[0];
      await logActivity({
        req,
        action: 'admin_created',
        entityType: 'admin',
        entityId: created.id,
        description: `${req.user.name} created admin ${created.name}`,
        metadata: { target_email: created.email, target_role: created.role, permissions: created.permissions, client_id: created.client_id },
      });
      res.status(201).json(created);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'An admin with that email already exists' });
      console.error('POST /admins error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.delete('/:id', async (req, res) => {
  if (parseInt(req.params.id, 10) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

  try {
    const target = await db.query(`SELECT id, name, email, client_id, role FROM admins WHERE id = $1`, [req.params.id]);
    if (target.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });
    const t = target.rows[0];

    if (!req.scope.isSuperadmin) {
      if (t.role === 'superadmin' || t.client_id !== req.scope.clientId) return res.status(403).json({ error: 'Forbidden' });
    }

    await db.query(`DELETE FROM admins WHERE id = $1`, [req.params.id]);
    await logActivity({
      req,
      action: 'admin_deleted',
      entityType: 'admin',
      entityId: t.id,
      description: `${req.user.name} deleted admin ${t.name}`,
      metadata: { target_email: t.email, target_role: t.role, client_id: t.client_id },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admins error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
