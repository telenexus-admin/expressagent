const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  createAiTask,
  ensureAiTaskSchema,
  listAiTasks,
  runAiTask,
  updateAiTaskStatus,
} = require('../services/aiTasks');

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
    res.json(await listAiTasks(clientId));
  } catch (err) {
    console.error('GET /ai-tasks error:', err.message);
    res.status(500).json({ error: 'Failed to load AI tasks' });
  }
});

router.post('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const task = await createAiTask({
      clientId,
      adminId: req.user?.id || null,
      payload: req.body || {},
    });
    res.status(201).json(task);
  } catch (err) {
    console.error('POST /ai-tasks error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to create AI task' });
  }
});

router.post('/:id/run', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const result = await runAiTask(clientId, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('POST /ai-tasks/:id/run error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to run AI task' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureAiTaskSchema();
    const task = await updateAiTaskStatus(clientId, req.params.id, req.body?.status);
    if (!task) return res.status(404).json({ error: 'AI task not found' });
    res.json(task);
  } catch (err) {
    console.error('PATCH /ai-tasks/:id/status error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to update AI task' });
  }
});

module.exports = router;
