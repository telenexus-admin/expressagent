const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');

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
  if (!Array.isArray(raw) || raw.length === 0) return ALL_PERMISSIONS;
  const clean = [...new Set(raw.filter((p) => ALL_PERMISSIONS.includes(p)))];
  return clean.length > 0 ? clean : ['statistics'];
}

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    try {
      const result = await db.query(
        `SELECT a.*, c.name AS client_name, c.business_name AS client_business_name, c.status AS client_status
         FROM admins a
         LEFT JOIN clients c ON c.id = a.client_id
         WHERE a.email = $1`,
        [email]
      );
      if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

      const admin = result.rows[0];
      const valid = await bcrypt.compare(password, admin.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      if (admin.role !== 'superadmin' && admin.client_status === 'suspended') {
        return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
      }

      const permissions = normalizePermissions(admin.permissions, admin.role);
      const tokenPayload = {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        name: admin.name,
        client_id: admin.client_id || null,
        permissions,
      };
      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '24h' });

      res.json({
        token,
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          client_id: admin.client_id || null,
          client_name: admin.client_name || null,
          client_business_name: admin.client_business_name || null,
          permissions,
        },
      });
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
