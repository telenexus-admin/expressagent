const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { INTENTS, INTENT_KEYS } = require('../services/intents');

router.use(authMiddleware, scopeMiddleware);

const NOTIFICATION_CHANNELS = ['sms', 'email', 'whatsapp'];

function normalizeChannels(value) {
  const source = Array.isArray(value) ? value : ['sms'];
  const clean = source.map((item) => String(item || '').toLowerCase()).filter((item) => NOTIFICATION_CHANNELS.includes(item));
  return [...new Set(clean)].length ? [...new Set(clean)] : ['sms'];
}

async function ensureWorkflowRouteColumns() {
  await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS notification_channels JSONB NOT NULL DEFAULT '["sms"]'::jsonb`);
  await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS allowed_phone_numbers JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE workflow_dispatches ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`UPDATE workflow_routes SET employee_ids = jsonb_build_array(employee_id) WHERE employee_id IS NOT NULL AND employee_ids = '[]'::jsonb`);
}

function normalizeEmployeeIds(value, fallback = null) {
  const source = Array.isArray(value) ? value : [];
  const ids = source.map((item) => parseInt(item, 10)).filter((item) => Number.isInteger(item) && item > 0);
  if (ids.length === 0 && fallback) ids.push(parseInt(fallback, 10));
  return [...new Set(ids)].filter((item) => Number.isInteger(item) && item > 0);
}

function normalizePhoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length >= 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

function normalizeAllowedPhoneNumbers(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,\n\s]+/);
  return [...new Set(source.map(normalizePhoneDigits).filter((item) => item.length >= 9))];
}

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
    await ensureWorkflowRouteColumns();
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
          `SELECT intent_key, employee_id, employee_ids, allowed_phone_numbers, is_enabled, notification_channels FROM workflow_routes WHERE client_id = $1`,
          [clientId]
        )).rows
      : [];
    const routeMap = Object.fromEntries(
      routesRows.map((r) => [r.intent_key, {
        employee_id: r.employee_id,
        employee_ids: normalizeEmployeeIds(r.employee_ids, r.employee_id),
        allowed_phone_numbers: normalizeAllowedPhoneNumbers(r.allowed_phone_numbers),
        is_enabled: r.is_enabled,
        notification_channels: r.notification_channels,
      }])
    );

    const intents = INTENTS.map((intent) => ({
      ...intent,
      assignedEmployeeId: routeMap[intent.key]?.employee_id ?? null,
      assignedEmployeeIds: routeMap[intent.key]?.employee_ids ?? [],
      allowedPhoneNumbers: routeMap[intent.key]?.allowed_phone_numbers ?? [],
      isEnabled: routeMap[intent.key]?.is_enabled ?? true,
      notificationChannels: normalizeChannels(routeMap[intent.key]?.notification_channels),
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
    body('employee_ids').optional().isArray(),
    body('allowed_phone_numbers').optional().isArray(),
    body('is_enabled').optional().isBoolean(),
    body('notification_channels').optional().isArray(),
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

    const employeeIds = req.body.employee_ids !== undefined
      ? normalizeEmployeeIds(req.body.employee_ids)
      : normalizeEmployeeIds([], req.body.employee_id);
    const employeeId = employeeIds[0] || null;
    const allowedPhoneNumbers = normalizeAllowedPhoneNumbers(req.body.allowed_phone_numbers);
    const isEnabled = req.body.is_enabled === undefined ? true : !!req.body.is_enabled;
    const notificationChannels = normalizeChannels(req.body.notification_channels);

    try {
      await ensureWorkflowRouteColumns();
      if (employeeIds.length > 0) {
        const empCheck = await db.query(
          `SELECT id FROM employees WHERE client_id = $1 AND id = ANY($2::int[])`,
          [clientId, employeeIds]
        );
        if (empCheck.rows.length !== employeeIds.length) {
          return res.status(400).json({ error: 'One or more employees were not found for this client' });
        }
      }

      const result = await db.query(
        `INSERT INTO workflow_routes (client_id, intent_key, employee_id, employee_ids, allowed_phone_numbers, is_enabled, notification_channels, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, NOW())
         ON CONFLICT (client_id, intent_key)
         DO UPDATE SET employee_id = EXCLUDED.employee_id,
                       employee_ids = EXCLUDED.employee_ids,
                       allowed_phone_numbers = EXCLUDED.allowed_phone_numbers,
                       is_enabled = EXCLUDED.is_enabled,
                       notification_channels = EXCLUDED.notification_channels,
                       updated_at = NOW()
         RETURNING intent_key, employee_id, employee_ids, allowed_phone_numbers, is_enabled, notification_channels`,
        [clientId, intentKey, employeeId, JSON.stringify(employeeIds), JSON.stringify(allowedPhoneNumbers), isEnabled, JSON.stringify(notificationChannels)]
      );
      res.json({
        ...result.rows[0],
        employee_ids: normalizeEmployeeIds(result.rows[0].employee_ids, result.rows[0].employee_id),
        allowed_phone_numbers: normalizeAllowedPhoneNumbers(result.rows[0].allowed_phone_numbers),
        notification_channels: normalizeChannels(result.rows[0].notification_channels),
      });
    } catch (err) {
      console.error('PUT /workflows/:intentKey error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// GET /api/workflows/dispatches — recent dispatches (for activity feed)
router.get('/dispatches', async (req, res) => {
  try {
    await ensureWorkflowRouteColumns();
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
              COALESCE(wd.employee_ids, '[]'::jsonb) AS employee_ids,
              e.id AS employee_id, e.name AS employee_name, e.phone AS employee_phone,
              wr.notification_channels
       FROM workflow_dispatches wd
       LEFT JOIN employees e ON e.id = wd.employee_id
       LEFT JOIN workflow_routes wr ON wr.client_id = wd.client_id AND wr.intent_key = wd.intent_key
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
