const express = require('express');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { setClientWebhook } = require('../services/clientEvolution');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

async function ensureRoutingField() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS evolution_routing_active BOOLEAN NOT NULL DEFAULT FALSE`);
}

router.get('/:clientId/status', async (req, res) => {
  try {
    await ensureRoutingField();
    const result = await db.query(
      `SELECT id, name, business_name, connection_provider, evolution_instance_name, evolution_routing_active
       FROM clients WHERE id = $1 AND connection_provider = 'evolution' LIMIT 1`,
      [req.params.clientId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Evolution client workspace not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /evo-routing/:clientId/status error:', err.message);
    res.status(500).json({ error: 'Could not read Evolution routing status' });
  }
});

router.post('/:clientId/activate', async (req, res) => {
  try {
    await ensureRoutingField();
    const result = await db.query(
      `SELECT * FROM clients WHERE id = $1 AND connection_provider = 'evolution' AND status = 'active' LIMIT 1`,
      [req.params.clientId]
    );
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Evolution client workspace not found' });
    if (!client.evolution_webhook_secret || !client.evolution_instance_name) {
      return res.status(400).json({ error: 'This workspace is missing its Evolution connection details.' });
    }
    await setClientWebhook(client);
    const updated = await db.query(
      `UPDATE clients SET evolution_routing_active = TRUE WHERE id = $1 RETURNING id, business_name, evolution_instance_name, evolution_routing_active`,
      [client.id]
    );
    console.log(`[evo client ${client.id}] Live AI routing activated for instance ${client.evolution_instance_name}.`);
    res.json({ success: true, client: updated.rows[0] });
  } catch (err) {
    const detail = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message);
    console.error('POST /evo-routing/:clientId/activate error:', detail);
    res.status(502).json({ error: 'Could not connect the Evolution webhook for this client.' });
  }
});

module.exports = router;
