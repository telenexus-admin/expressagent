const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { SMS_PROVIDERS, ensureSmsSchema } = require('../services/sms');

router.use(authMiddleware, scopeMiddleware);

function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

router.get('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;

  try {
    await ensureSmsSchema();
    const result = await db.query(
      `SELECT sms_provider, sms_api_key, sms_sender_id, sms_partner_id
       FROM clients WHERE id = $1`,
      [clientId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client not found' });

    const row = result.rows[0];
    res.json({
      sms_provider: row.sms_provider || 'blessed',
      sms_sender_id: row.sms_sender_id || '',
      sms_partner_id: row.sms_partner_id || '',
      sms_api_key_configured: Boolean(row.sms_api_key),
    });
  } catch (err) {
    console.error('GET /sms-settings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;

  const { sms_provider, sms_api_key, sms_sender_id, sms_partner_id } = req.body;

  try {
    await ensureSmsSchema();
    const currentResult = await db.query(
      `SELECT sms_provider, sms_api_key, sms_sender_id, sms_partner_id
       FROM clients WHERE id = $1`,
      [clientId]
    );
    if (!currentResult.rows.length) return res.status(404).json({ error: 'Client not found' });

    const current = currentResult.rows[0];
    const provider = String(sms_provider ?? current.sms_provider ?? 'blessed').trim().toLowerCase();
    const providerChanged = provider !== (current.sms_provider || 'blessed');
    const enteredApiKey = String(sms_api_key || '').trim();
    const apiKey = enteredApiKey || (providerChanged ? '' : (current.sms_api_key || ''));
    const senderId = sms_sender_id === undefined
      ? (providerChanged ? '' : (current.sms_sender_id || ''))
      : String(sms_sender_id || '').trim();
    const partnerId = sms_partner_id === undefined
      ? (providerChanged ? '' : (current.sms_partner_id || ''))
      : String(sms_partner_id || '').trim();

    if (!SMS_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: 'SMS provider must be Blessed Text, Savvy or Talk Sasa' });
    }

    if (provider === 'savvy') {
      if (!apiKey && !process.env.SAVVY_API_KEY) {
        return res.status(400).json({ error: 'Savvy API key is required' });
      }
      if (!partnerId && !process.env.SAVVY_PARTNER_ID) {
        return res.status(400).json({ error: 'Savvy Partner ID is required' });
      }
      if (!senderId && !process.env.SAVVY_SENDER_ID) {
        return res.status(400).json({ error: 'Savvy Sender ID / Shortcode is required' });
      }
    }

    if (provider === 'blessed') {
      if (!apiKey && !process.env.BLESSED_API_KEY) {
        return res.status(400).json({ error: 'Blessed Text API key is required' });
      }
      if (!senderId && !process.env.BLESSED_SENDER_ID) {
        return res.status(400).json({ error: 'Blessed Text Sender ID is required' });
      }
    }

    if (provider === 'talksasa') {
      if (!apiKey && !process.env.TALK_SASA_API_TOKEN && !process.env.TALKSASA_API_TOKEN) {
        return res.status(400).json({ error: 'Talk Sasa API token is required' });
      }
      if (!senderId && !process.env.TALK_SASA_SENDER_ID && !process.env.TALKSASA_SENDER_ID) {
        return res.status(400).json({ error: 'Talk Sasa Sender ID is required' });
      }
    }

    const updates = ['sms_provider = $1', 'sms_sender_id = $2', 'sms_partner_id = $3'];
    const params = [provider, senderId || null, partnerId || null];

    if (enteredApiKey) {
      params.push(enteredApiKey);
      updates.push(`sms_api_key = $${params.length}`);
    } else if (providerChanged) {
      updates.push('sms_api_key = NULL');
    }

    params.push(clientId);
    await db.query(
      `UPDATE clients SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /sms-settings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
