const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { INTENTS, INTENT_KEYS } = require('../services/intents');

router.use(authMiddleware, scopeMiddleware);

function resolveClientId(req) {
  if (req.scope.isSuperadmin) {
    const raw = req.query.clientId ?? req.body.client_id;
    const parsed = raw ? parseInt(raw, 10) : null;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return req.scope.clientId;
}

// GET /api/workflows — canonical intents + the client's current assignments + active employees
router.get('/', async (req, res) => {
  try {
    const clientId = resolveClientId(req);
    if (!clientId && !req.scope.isSuperadmin) {
      return res.status(400).json({ error: 'No client scope' });
    }

    const employees = clientId
      ? (await db.query(
          `SELECT id, name, role, phone, email FROM employees
           WHERE client_id = $1 AND is_active = TRUE
           ORDER BY name ASC`,
          [clientId]
        )).rows
      : [];

    const routesRows = clientId
      ? (await db.query(
          `SELECT intent_key, employee_id, is_enabled FROM workflow_routes WHERE client_id = $1`,
          [clientId]
        )).rows
      : [];
    const routeMap = Object.fromEntries(
      routesRows.map((r) => [r.intent_key, { employee_id: r.employee_id, is_enabled: r.is_enabled }])
    );

    const intents = INTENTS.map((intent) => ({
      ...intent,
      assignedEmployeeId: routeMap[intent.key]?.employee_id ?? null,
      isEnabled: routeMap[intent.key]?.is_enabled ?? true,
    }));

    res.json({ intents, employees });
  } catch (err) {
    console.error('GET /workflows error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/workflows/:intentKey — assign or unassign an employee for an intent
router.put(
  '/:intentKey',
  [
    body('employee_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('is_enabled').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const intentKey = req.params.intentKey;
    if (!INTENT_KEYS.includes(intentKey)) {
      return res.status(400).json({ error: 'Unknown intent' });
    }

    const clientId = resolveClientId(req);
    if (!clientId) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const rawEmployeeId = req.body.employee_id;
    const employeeId = rawEmployeeId === null || rawEmployeeId === undefined || rawEmployeeId === ''
      ? null
      : parseInt(rawEmployeeId, 10);
    const isEnabled = req.body.is_enabled === undefined ? true : !!req.body.is_enabled;

    try {
      if (employeeId !== null) {
        const empCheck = await db.query(
          `SELECT id FROM employees WHERE id = $1 AND client_id = $2`,
          [employeeId, clientId]
        );
        if (empCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Employee not found for this client' });
        }
      }

      const result = await db.query(
        `INSERT INTO workflow_routes (client_id, intent_key, employee_id, is_enabled, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (client_id, intent_key)
         DO UPDATE SET employee_id = EXCLUDED.employee_id,
                       is_enabled = EXCLUDED.is_enabled,
                       updated_at = NOW()
         RETURNING intent_key, employee_id, is_enabled`,
        [clientId, intentKey, employeeId, isEnabled]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('PUT /workflows/:intentKey error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// GET /api/workflows/dispatches — recent dispatches (for activity feed)
router.get('/dispatches', async (req, res) => {
  try {
    const clientId = resolveClientId(req);
    const params = [];
    let where = '';
    if (clientId) {
      params.push(clientId);
      where = `WHERE wd.client_id = $${params.length}`;
    } else if (!req.scope.isSuperadmin) {
      return res.json([]);
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    params.push(limit);

    const result = await db.query(
      `SELECT wd.id, wd.intent_key, wd.customer_phone, wd.trigger_message,
              wd.notify_status, wd.notify_error, wd.created_at,
              e.id AS employee_id, e.name AS employee_name, e.phone AS employee_phone
       FROM workflow_dispatches wd
       LEFT JOIN employees e ON e.id = wd.employee_id
       ${where}
       ORDER BY wd.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /workflows/dispatches error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
