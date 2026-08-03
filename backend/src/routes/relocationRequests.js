const express = require('express');
const db = require('../db');
const { buildRelocationUrl, createRelocationRequest, ensureRelocationSchema } = require('../services/relocationRequests');

const router = express.Router();

router.get('/:clientId', async (req, res) => {
  try {
    await ensureRelocationSchema();
    const result = await db.query(
      `SELECT id, name, business_name, agent_name
       FROM clients
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [req.params.clientId]
    );
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Relocation form is not available' });
    res.json({
      client_id: client.id,
      business_name: client.business_name || client.name || 'your ISP',
      agent_name: client.agent_name || 'AI assistant',
      relocation_url: buildRelocationUrl(client, req.query),
    });
  } catch (err) {
    console.error('GET /public/relocation-request error:', err.message);
    res.status(500).json({ error: 'Failed to load relocation form' });
  }
});

router.post('/:clientId', async (req, res) => {
  try {
    await ensureRelocationSchema();
    const result = await db.query(
      `SELECT id, name, business_name, agent_name
       FROM clients
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [req.params.clientId]
    );
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Relocation form is not available' });
    const request = await createRelocationRequest(client, {
      ...req.body,
      user_agent: req.headers['user-agent'],
      ip: req.ip,
    });
    res.status(201).json({
      success: true,
      id: request.id,
      message: 'Relocation request received. Our team will review your new location and contact you for scheduling.',
    });
  } catch (err) {
    console.error('POST /public/relocation-request error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to submit relocation request' });
  }
});

module.exports = router;
