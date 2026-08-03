const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  createAiTask,
  ensureAiTaskSchema,
  listAiTaskRuns,
  listAiTasks,
  runAiTask,
  updateAiTaskStatus,
} = require('../services/aiTasks');
const { recordRequestEvent } = require('../services/events');

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
    await recordRequestEvent(req, {
      eventType: 'employee_task.created',
      category: 'employee_task',
      source: 'ai_tasks_api',
      entityType: 'ai_task',
      entityId: task.id,
      title: 'Automation task created',
      description: task.title,
      payload: {
        task_type: task.task_type,
        status: task.status,
        audience: task.audience,
        schedule: task.schedule,
      },
      newState: task,
      deduplicationKey: `ai-task:${task.id}:created`,
      sensitivity: 'confidential',
    });
    res.status(201).json(task);
  } catch (err) {
    console.error('POST /ai-tasks error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to create AI task' });
  }
});

router.get('/runs', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await listAiTaskRuns(clientId, req.query.limit));
  } catch (err) {
    console.error('GET /ai-tasks/runs error:', err.message);
    res.status(500).json({ error: 'Failed to load AI task history' });
  }
});

router.post('/:id/run', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const result = await runAiTask(clientId, req.params.id);
    await recordRequestEvent(req, {
      eventType: result?.status === 'partial' ? 'employee_task.partially_completed' : 'employee_task.completed',
      category: 'employee_task',
      source: 'ai_tasks_api',
      entityType: 'ai_task',
      entityId: req.params.id,
      title: result?.status === 'partial' ? 'Automation task partially completed' : 'Automation task completed',
      payload: {
        run_id: result?.run_id || null,
        status: result?.status || 'completed',
        stats: result?.stats || {},
      },
      relatedEntities: result?.run_id ? [{ entityType: 'ai_task_run', entityId: result.run_id, relationship: 'run' }] : [],
      deduplicationKey: result?.run_id ? `ai-task-run:${result.run_id}` : `ai-task:${req.params.id}:manual-run:${Date.now()}`,
      sensitivity: 'confidential',
    });
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
    await recordRequestEvent(req, {
      eventType: 'employee_task.status_changed',
      category: 'employee_task',
      source: 'ai_tasks_api',
      entityType: 'ai_task',
      entityId: task.id,
      title: 'Automation task status changed',
      payload: { status: task.status },
      newState: { status: task.status },
      deduplicationKey: `ai-task:${task.id}:status:${task.status}:${Date.now()}`,
      sensitivity: 'confidential',
    });
    res.json(task);
  } catch (err) {
    console.error('PATCH /ai-tasks/:id/status error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to update AI task' });
  }
});

module.exports = router;
