const express = require('express');
const db = require('../db');
const {
  ensureInstallationWorkOrderSchema,
  submitInstallationWorkOrder,
} = require('../services/installationWorkOrders');

const router = express.Router();

router.get('/:token', async (req, res) => {
  try {
    await ensureInstallationWorkOrderSchema();
    const result = await db.query(
      `SELECT wo.id, wo.public_token, wo.status, wo.technician_status, wo.installation_started_at, wo.installation_completed_at,
              wo.installation_time_minutes, wo.power_dcbs, wo.signal_power, wo.equipment_used,
              wo.notes, wo.submitted_at, wo.created_at,
              t.id AS ticket_id, t.title, t.customer_phone, t.customer_name, t.summary,
              c.business_name, c.name AS client_name
       FROM installation_work_orders wo
       JOIN tickets t ON t.id = wo.ticket_id
       JOIN clients c ON c.id = wo.client_id
       WHERE wo.public_token = $1
       LIMIT 1`,
      [req.params.token]
    );
    const workOrder = result.rows[0];
    if (!workOrder) return res.status(404).json({ error: 'Installation work order not found' });

    const inventory = await db.query(
      `SELECT id, name, sku, category, quantity, reorder_level, unit_cost, location
       FROM inventory_items
       WHERE client_id = (SELECT client_id FROM installation_work_orders WHERE public_token = $1)
         AND status = 'active'
       ORDER BY name ASC`,
      [req.params.token]
    );

    res.json({
      work_order: workOrder,
      inventory: inventory.rows,
    });
  } catch (err) {
    console.error('GET /public/installation-work-orders/:token error:', err.message);
    res.status(500).json({ error: 'Failed to load installation work order' });
  }
});

router.post('/:token', async (req, res) => {
  try {
    const updated = await submitInstallationWorkOrder(req.params.token, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Installation work order not found' });
    res.json({ success: true, work_order: updated });
  } catch (err) {
    console.error('POST /public/installation-work-orders/:token error:', err.message);
    res.status(500).json({ error: 'Failed to submit installation report' });
  }
});

module.exports = router;
