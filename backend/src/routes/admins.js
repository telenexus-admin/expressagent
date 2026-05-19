const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

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
];

function normalizePermissions(raw, role) {
  if (role === 'superadmin') return ALL_PERMISSIONS;
  if (!Array.isArray(raw)) return ALL_PERMISSIONS;
  const clean = [...new Set(raw.filter((p) => ALL_PERMISSIONS.includes(p)))];
  return clean.length > 0 ? clean : ['statistics'];
}

router.use(authMiddleware, scopeMiddleware);

// GET /api/admins
// Superadmin (no scope): returns all admins across clients, with client name.
// Superadmin (?clientId=X): returns only admins belonging to that client.
// Regular admin: returns only admins belonging to their own client.
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

// POST /api/admins
// Superadmin: can create admins for any client (pass client_id in body), or another superadmin (omit client_id).
// Regular admin: can create another admin within their own client; role is forced to 'admin'.
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
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password } = req.body;
    let role = req.body.role || 'admin';
    let clientId = req.body.client_id || null;

    if (req.scope.isSuperadmin) {
      if (role === 'superadmin') {
        clientId = null;
      } else if (!clientId) {
        return res.status(400).json({ error: 'client_id is required when creating a regular admin' });
      }
    } else {
      role = 'admin';
      clientId = req.scope.clientId;
    }

    const permissions = normalizePermissions(req.body.permissions, role);

    try {
      if (clientId) {
        const check = await db.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
        if (check.rows.length === 0) {
          return res.status(400).json({ error: 'client_id does not exist' });
        }
      }

      const hash = await bcrypt.hash(password, 12);
      const result = await db.query(
        `INSERT INTO admins (name, email, password_hash, role, client_id, permissions)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, name, email, role, client_id, permissions, created_at`,
        [name, email, hash, role, clientId, JSON.stringify(permissions)]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An admin with that email already exists' });
      }
      console.error('POST /admins error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// DELETE /api/admins/:id
router.delete('/:id', async (req, res) => {
  if (parseInt(req.params.id, 10) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    const target = await db.query(`SELECT id, client_id, role FROM admins WHERE id = $1`, [req.params.id]);
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    const t = target.rows[0];

    if (!req.scope.isSuperadmin) {
      if (t.role === 'superadmin' || t.client_id !== req.scope.clientId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    await db.query(`DELETE FROM admins WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admins error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
