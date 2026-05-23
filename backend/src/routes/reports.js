const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { sendSMS } = require('../services/sms');
const { ensureDailyReportTables, nairobiDate, createReport } = require('../services/dailyReports');

router.use(authMiddleware, scopeMiddleware);

function clientIdFor(req, res) {
  if (req.scope.clientId) return req.scope.clientId;
  res.status(400).json({ error: 'Select a client before viewing reports' });
  return null;
}

function cleanPhone(phone) {
  return String(phone || '').replace(/[^0-9+]/g, '').trim();
}

async function loadClient(id) {
  const result = await db.query(
    `SELECT id, name, business_name, support_number, daily_report_enabled, daily_report_phone
     FROM clients WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

router.get('/config', async (req, res) => {
  try {
    await ensureDailyReportTables();
    const clientId = clientIdFor(req, res);
    if (!clientId) return;
    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({
      client_id: client.id,
      business_name: client.business_name || client.name,
      daily_report_enabled: client.daily_report_enabled,
      daily_report_phone: client.daily_report_phone || client.support_number || '',
      send_time: '8:00 PM',
      timezone: 'Africa/Nairobi',
    });
  } catch (err) {
    console.error('GET /reports/config error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/config', async (req, res) => {
  try {
    await ensureDailyReportTables();
    const clientId = clientIdFor(req, res);
    if (!clientId) return;
    const enabled = Boolean(req.body.daily_report_enabled);
    const phone = cleanPhone(req.body.daily_report_phone);
    if (enabled && !/^\+?[0-9]{9,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number for the daily SMS report' });
    }
    const result = await db.query(
      `UPDATE clients SET daily_report_enabled = $1, daily_report_phone = $2
       WHERE id = $3
       RETURNING id, name, business_name, daily_report_enabled, daily_report_phone`,
      [enabled, phone || null, clientId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /reports/config error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/preview', async (req, res) => {
  try {
    await ensureDailyReportTables();
    const clientId = clientIdFor(req, res);
    if (!clientId) return;
    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const reportDate = String(req.query.date || nairobiDate()).slice(0, 10);
    const report = await createReport(client, reportDate);
    res.json({ report_date: reportDate, ...report });
  } catch (err) {
    console.error('GET /reports/preview error:', err.message);
    res.status(500).json({ error: 'Failed to prepare report preview' });
  }
});

router.post('/test-sms', async (req, res) => {
  try {
    await ensureDailyReportTables();
    const clientId = clientIdFor(req, res);
    if (!clientId) return;
    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const phone = cleanPhone(req.body.phone || client.daily_report_phone || client.support_number);
    if (!/^\+?[0-9]{9,15}$/.test(phone)) return res.status(400).json({ error: 'Configure a valid SMS number first' });
    const reportDate = nairobiDate();
    const { reportText } = await createReport(client, reportDate);
    await sendSMS(phone, `[TEST REPORT]\n${reportText}`);
    res.json({ success: true, sent_to: phone, report_date: reportDate });
  } catch (err) {
    const message = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message);
    console.error('POST /reports/test-sms error:', message);
    res.status(500).json({ error: `SMS could not be sent: ${message}` });
  }
});

router.get('/history', async (req, res) => {
  try {
    await ensureDailyReportTables();
    const clientId = clientIdFor(req, res);
    if (!clientId) return;
    const result = await db.query(
      `SELECT id, report_date, recipient_phone, report_text, metrics, delivery_status, delivery_error, sent_at, created_at
       FROM daily_reports WHERE client_id = $1 ORDER BY report_date DESC LIMIT 60`,
      [clientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /reports/history error:', err.message);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

module.exports = router;
