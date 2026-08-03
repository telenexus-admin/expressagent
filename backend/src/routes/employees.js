const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  appendBillingEvent,
  ensureEventSchema,
  eventActorFromRequest,
  recordRequestEvent,
} = require('../services/events');

router.use(authMiddleware, scopeMiddleware);

const ALLOWED_ROLES = ['technician', 'support', 'manager', 'other'];
const PHONE_REGEX = /^\+?[0-9][0-9\s\-()]{6,19}$/;

function resolveClientId(req) {
  if (req.scope.isSuperadmin) {
    const raw = req.body.client_id ?? req.query.clientId;
    const parsed = raw ? parseInt(raw, 10) : null;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return req.scope.clientId;
}

// GET /api/employees — scoped by client (superadmin sees all unless ?clientId=)
router.get('/', async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where = `WHERE client_id = $${params.length}`;
    }
    const result = await db.query(
      `SELECT id, client_id, name, role, location, phone, email, is_active, created_at
       FROM employees
       ${where}
       ORDER BY is_active DESC, name ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /employees error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('role').optional().isIn(ALLOWED_ROLES).withMessage(`Role must be one of ${ALLOWED_ROLES.join(', ')}`),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('phone').trim().matches(PHONE_REGEX).withMessage('Invalid phone number'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('is_active').optional().isBoolean(),
    body('client_id').optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const clientId = resolveClientId(req);
    if (!clientId) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    try {
      if (req.scope.isSuperadmin) {
        const check = await db.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
        if (check.rows.length === 0) {
          return res.status(400).json({ error: 'client_id does not exist' });
        }
      }

      await ensureEventSchema();
      const client = await db.connect();
      let result;
      try {
        await client.query('BEGIN');
        result = await client.query(
          `INSERT INTO employees (client_id, name, role, location, phone, email, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, client_id, name, role, location, phone, email, is_active, created_at`,
          [
            clientId,
            req.body.name.trim(),
            req.body.role || 'technician',
            req.body.location.trim(),
            req.body.phone.trim(),
            req.body.email,
            req.body.is_active === undefined ? true : !!req.body.is_active,
          ]
        );
        const employee = result.rows[0];
        await appendBillingEvent(client, {
          clientId,
          eventType: 'employee.created',
          category: 'employee',
          source: 'employees_api',
          entityType: 'employee',
          entityId: employee.id,
          ...eventActorFromRequest(req),
          title: 'Employee added',
          description: `${employee.name} was added as ${employee.role}`,
          payload: {
            role: employee.role,
            location: employee.location,
            is_active: employee.is_active,
          },
          newState: {
            role: employee.role,
            location: employee.location,
            is_active: employee.is_active,
          },
          deduplicationKey: `employee:${employee.id}:created`,
          sensitivity: 'confidential',
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An employee with that email already exists for this client' });
      }
      console.error('POST /employees error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.put(
  '/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('role').optional().isIn(ALLOWED_ROLES),
    body('location').optional().trim().notEmpty(),
    body('phone').optional().trim().matches(PHONE_REGEX),
    body('email').optional().isEmail().normalizeEmail(),
    body('is_active').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const existing = await db.query(`SELECT * FROM employees WHERE id = $1`, [req.params.id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      if (!req.scope.isSuperadmin && existing.rows[0].client_id !== req.scope.clientId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const allowed = ['name', 'role', 'location', 'phone', 'email', 'is_active'];
      const updates = [];
      const params = [];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          const raw = req.body[key];
          const val = typeof raw === 'string' ? raw.trim() : raw;
          params.push(val);
          updates.push(`${key} = $${params.length}`);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      params.push(req.params.id);
      const result = await db.query(
        `UPDATE employees SET ${updates.join(', ')} WHERE id = $${params.length}
         RETURNING id, client_id, name, role, location, phone, email, is_active, created_at`,
        params
      );
      const employee = result.rows[0];
      await recordRequestEvent(req, {
        clientId: employee.client_id,
        eventType: 'employee.updated',
        category: 'employee',
        source: 'employees_api',
        entityType: 'employee',
        entityId: employee.id,
        title: 'Employee updated',
        description: `${employee.name}'s employee record was updated`,
        previousState: existing.rows[0],
        newState: employee,
        payload: { changed_fields: allowed.filter((key) => req.body[key] !== undefined) },
        deduplicationKey: `employee:${employee.id}:updated:${Date.now()}`,
        sensitivity: 'confidential',
      });
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An employee with that email already exists for this client' });
      }
      console.error('PUT /employees/:id error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.query(`SELECT * FROM employees WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    if (!req.scope.isSuperadmin && existing.rows[0].client_id !== req.scope.clientId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.query(`DELETE FROM employees WHERE id = $1`, [req.params.id]);
    await recordRequestEvent(req, {
      clientId: existing.rows[0].client_id,
      eventType: 'employee.deleted',
      category: 'employee',
      source: 'employees_api',
      entityType: 'employee',
      entityId: existing.rows[0].id,
      severity: 'warning',
      title: 'Employee removed',
      description: `${existing.rows[0].name} was removed`,
      previousState: existing.rows[0],
      deduplicationKey: `employee:${existing.rows[0].id}:deleted`,
      sensitivity: 'confidential',
    });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /employees/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
