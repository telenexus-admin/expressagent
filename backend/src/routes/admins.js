const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');

router.use(authMiddleware, superadminMiddleware);

// GET /api/admins
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, email, role, created_at FROM admins ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /admins error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admins
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').optional().isIn(['admin', 'superadmin']).withMessage('Invalid role'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, role = 'admin' } = req.body;

    try {
      const hash = await bcrypt.hash(password, 12);
      const result = await db.query(
        `INSERT INTO admins (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, role, created_at`,
        [name, email, hash, role]
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
    const result = await db.query(`DELETE FROM admins WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admins error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
