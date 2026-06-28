const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  createWebsiteKnowledge,
  deleteWebsiteKnowledge,
  listWebsiteKnowledge,
  refreshWebsiteKnowledge,
  updateWebsiteKnowledge,
} = require('../services/websiteKnowledge');

const router = express.Router();
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
    res.json(await listWebsiteKnowledge(clientId));
  } catch (err) {
    console.error('GET /website-knowledge error:', err.message);
    res.status(500).json({ error: 'Failed to load website knowledge' });
  }
});

router.post('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const item = await createWebsiteKnowledge(clientId, {
      url: req.body.url,
      title: req.body.title,
      summary: req.body.summary,
      auto_refresh_enabled: req.body.auto_refresh_enabled,
      refresh_interval_minutes: req.body.refresh_interval_minutes,
    });
    res.status(201).json(item);
  } catch (err) {
    console.error('POST /website-knowledge error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to add website knowledge' });
  }
});

router.patch('/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const item = await updateWebsiteKnowledge(clientId, req.params.id, {
      title: req.body.title,
      summary: req.body.summary,
      is_active: req.body.is_active,
      auto_refresh_enabled: req.body.auto_refresh_enabled,
      refresh_interval_minutes: req.body.refresh_interval_minutes,
    });
    if (!item) return res.status(404).json({ error: 'Website knowledge not found' });
    res.json(item);
  } catch (err) {
    console.error('PATCH /website-knowledge error:', err.message);
    res.status(500).json({ error: 'Failed to update website knowledge' });
  }
});

router.post('/:id/refresh', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const item = await refreshWebsiteKnowledge(clientId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Website knowledge not found' });
    res.json(item);
  } catch (err) {
    console.error('POST /website-knowledge/:id/refresh error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to refresh website knowledge' });
  }
});

router.delete('/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const deleted = await deleteWebsiteKnowledge(clientId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Website knowledge not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /website-knowledge error:', err.message);
    res.status(500).json({ error: 'Failed to delete website knowledge' });
  }
});

module.exports = router;
