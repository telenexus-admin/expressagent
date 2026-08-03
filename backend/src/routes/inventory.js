const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    const fallbackClientId = parseInt(process.env.DEFAULT_CLIENT_ID || process.env.EXPRESSNET_CLIENT_ID || '1', 10);
    if (Number.isInteger(fallbackClientId) && fallbackClientId > 0) return fallbackClientId;
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

async function ensureInventoryTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name VARCHAR(180) NOT NULL,
      sku VARCHAR(80),
      category VARCHAR(120),
      quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
      reorder_level NUMERIC(12,2) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      location VARCHAR(160),
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_status_check`);
  await db.query(`ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_status_check CHECK (status IN ('active', 'archived'))`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inventory_items_client_status ON inventory_items(client_id, status, name)`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_client_sku_unique ON inventory_items(client_id, LOWER(sku)) WHERE sku IS NOT NULL AND sku <> ''`);
}

function cleanItem(body) {
  return {
    name: String(body.name || '').trim().slice(0, 180),
    sku: String(body.sku || '').trim().slice(0, 80) || null,
    category: String(body.category || '').trim().slice(0, 120) || null,
    quantity: Number(body.quantity || 0),
    reorder_level: Number(body.reorder_level || 0),
    unit_cost: Number(body.unit_cost || 0),
    location: String(body.location || '').trim().slice(0, 160) || null,
    notes: String(body.notes || '').trim() || null,
  };
}

function itemValidators() {
  return [
    body('name').trim().isLength({ min: 2, max: 180 }).withMessage('Item name is required'),
    body('sku').optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
    body('category').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
    body('quantity').optional().isFloat({ min: 0 }).withMessage('Quantity cannot be negative'),
    body('reorder_level').optional().isFloat({ min: 0 }).withMessage('Reorder level cannot be negative'),
    body('unit_cost').optional().isFloat({ min: 0 }).withMessage('Unit cost cannot be negative'),
    body('location').optional({ checkFalsy: true }).trim().isLength({ max: 160 }),
    body('notes').optional({ checkFalsy: true }).isString(),
  ];
}

router.get('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;

  try {
    await ensureInventoryTable();
    const status = req.query.status === 'archived' ? 'archived' : 'active';
    const result = await db.query(
      `SELECT id, name, sku, category, quantity, reorder_level, unit_cost, location, notes, status, created_at, updated_at
       FROM inventory_items
       WHERE client_id = $1 AND status = $2
       ORDER BY name ASC`,
      [clientId, status]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /inventory error:', err.message);
    res.status(500).json({ error: 'Failed to load inventory' });
  }
});

router.get('/summary', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;

  try {
    await ensureInventoryTable();
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_items,
         COUNT(*) FILTER (WHERE status = 'active' AND quantity <= reorder_level)::int AS low_stock_items,
         COALESCE(SUM(quantity), 0)::float AS total_quantity,
         COALESCE(SUM(quantity * unit_cost), 0)::float AS stock_value
       FROM inventory_items
       WHERE client_id = $1`,
      [clientId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /inventory/summary error:', err.message);
    res.status(500).json({ error: 'Failed to load inventory summary' });
  }
});

router.post('/', itemValidators(), async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    await ensureInventoryTable();
    const item = cleanItem(req.body);
    const result = await db.query(
      `INSERT INTO inventory_items (client_id, name, sku, category, quantity, reorder_level, unit_cost, location, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, sku, category, quantity, reorder_level, unit_cost, location, notes, status, created_at, updated_at`,
      [clientId, item.name, item.sku, item.category, item.quantity, item.reorder_level, item.unit_cost, item.location, item.notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This SKU already exists in inventory.' });
    console.error('POST /inventory error:', err.message);
    res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

router.put('/:id', itemValidators(), async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    await ensureInventoryTable();
    const item = cleanItem(req.body);
    const result = await db.query(
      `UPDATE inventory_items
       SET name = $1, sku = $2, category = $3, quantity = $4, reorder_level = $5,
           unit_cost = $6, location = $7, notes = $8, updated_at = NOW()
       WHERE id = $9 AND client_id = $10
       RETURNING id, name, sku, category, quantity, reorder_level, unit_cost, location, notes, status, created_at, updated_at`,
      [item.name, item.sku, item.category, item.quantity, item.reorder_level, item.unit_cost, item.location, item.notes, req.params.id, clientId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Inventory item not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This SKU already exists in inventory.' });
    console.error('PUT /inventory/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

router.patch('/:id/status', [body('status').isIn(['active', 'archived'])], async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    await ensureInventoryTable();
    const result = await db.query(
      `UPDATE inventory_items SET status = $1, updated_at = NOW()
       WHERE id = $2 AND client_id = $3
       RETURNING id, name, sku, category, quantity, reorder_level, unit_cost, location, notes, status, created_at, updated_at`,
      [req.body.status, req.params.id, clientId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Inventory item not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /inventory/:id/status error:', err.message);
    res.status(500).json({ error: 'Failed to update inventory item status' });
  }
});

module.exports = router;
