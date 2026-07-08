const express = require('express');
const { nocHistory, nocOverview } = require('../services/noc');
const { verifyNocLiveToken } = require('../services/nocPublicLinks');

const router = express.Router();

function readToken(req, res) {
  try {
    return verifyNocLiveToken(req.params.token);
  } catch (err) {
    res.status(401).json({ error: err.message || 'Invalid NOC link' });
    return null;
  }
}

router.get('/:token/overview', async (req, res) => {
  const payload = readToken(req, res);
  if (!payload) return;
  try {
    res.json(await nocOverview(payload.clientId, payload.routerId, req.query || {}));
  } catch (err) {
    console.error('GET /public/noc/:token/overview error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to load live NOC overview' });
  }
});

router.get('/:token/history', async (req, res) => {
  const payload = readToken(req, res);
  if (!payload) return;
  try {
    res.json(await nocHistory(payload.clientId, payload.routerId, req.query.range || '1h'));
  } catch (err) {
    console.error('GET /public/noc/:token/history error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to load live NOC history' });
  }
});

module.exports = router;
