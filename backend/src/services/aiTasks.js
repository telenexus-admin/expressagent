const db = require('../db');
const { sendWhatsAppMessage } = require('./whatsapp');
const { sendClientText } = require('./clientEvolution');
const { buildMikrotikStatusReply } = require('./mikrotik');
const { refreshWebsiteKnowledge, listWebsiteKnowledge } = require('./websiteKnowledge');

let schemaReady = false;
let schedulerStarted = false;

const TASK_TYPES = ['engagement_message', 'invoice_send', 'website_summary', 'mikrotik_report'];
const TASK_STATUSES = ['draft', 'scheduled', 'active', 'paused', 'completed', 'failed', 'cancelled'];
const RUN_STATUSES = ['running', 'completed', 'failed', 'partial'];

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanPhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizeTaskType(value) {
  const taskType = clean(value, 'engagement_message').toLowerCase();
  return TASK_TYPES.includes(taskType) ? taskType : 'engagement_message';
}

function normalizeStatus(value, fallback = 'draft') {
  const status = clean(value, fallback).toLowerCase();
  return TASK_STATUSES.includes(status) ? status : fallback;
}

function normalizeSchedule(value = {}) {
  const mode = clean(value.mode || value.schedule_mode, 'now').toLowerCase();
  const repeat = clean(value.repeat || value.repeat_interval, 'none').toLowerCase();
  return {
    mode: ['now', 'once', 'recurring'].includes(mode) ? mode : 'now',
    run_at: value.run_at || value.next_run_at || null,
    repeat: ['none', 'daily', 'weekly', 'monthly', 'minutes'].includes(repeat) ? repeat : 'none',
    interval_minutes: Math.max(0, Number(value.interval_minutes || 0) || 0),
  };
}

function nextRunFromSchedule(schedule = {}, from = new Date()) {
  const normalized = normalizeSchedule(schedule);
  if (normalized.mode === 'now') return from;
  if (normalized.mode === 'once') {
    const when = normalized.run_at ? new Date(normalized.run_at) : from;
    return Number.isNaN(when.getTime()) ? from : when;
  }
  if (normalized.repeat === 'minutes' && normalized.interval_minutes > 0) {
    return new Date(from.getTime() + normalized.interval_minutes * 60 * 1000);
  }
  const next = new Date(normalized.run_at || from);
  if (Number.isNaN(next.getTime()) || next <= from) {
    if (normalized.repeat === 'weekly') next.setDate(from.getDate() + 7);
    else if (normalized.repeat === 'monthly') next.setMonth(from.getMonth() + 1);
    else next.setDate(from.getDate() + 1);
  }
  return next;
}

async function ensureAiTaskSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_tasks (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      created_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      title VARCHAR(180) NOT NULL,
      task_type VARCHAR(40) NOT NULL DEFAULT 'engagement_message',
      instruction TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      audience JSONB NOT NULL DEFAULT '{}'::jsonb,
      schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
      options JSONB NOT NULL DEFAULT '{}'::jsonb,
      next_run_at TIMESTAMP WITH TIME ZONE,
      last_run_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_task_runs (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'running',
      started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      finished_at TIMESTAMP WITH TIME ZONE,
      summary TEXT,
      stats JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ai_tasks_client ON ai_tasks(client_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_tasks_next_run ON ai_tasks(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_ai_task_runs_task ON ai_task_runs(task_id, started_at DESC);
  `);
  await db.query(`ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_task_type_check`);
  await db.query(`ALTER TABLE ai_tasks ADD CONSTRAINT ai_tasks_task_type_check CHECK (task_type IN ('engagement_message', 'invoice_send', 'website_summary', 'mikrotik_report'))`);
  await db.query(`ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_status_check`);
  await db.query(`ALTER TABLE ai_tasks ADD CONSTRAINT ai_tasks_status_check CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'failed', 'cancelled'))`);
  await db.query(`ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_status_check`);
  await db.query(`ALTER TABLE ai_task_runs ADD CONSTRAINT ai_task_runs_status_check CHECK (status IN ('running', 'completed', 'failed', 'partial'))`);
  schemaReady = true;
}

async function resolveClient(clientId) {
  const result = await db.query(
    `SELECT id, name, business_name, connection_provider, evolution_instance_name, meta_phone_number_id, meta_access_token
     FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  return result.rows[0] || null;
}

async function createAiTask({ clientId, adminId, payload }) {
  await ensureAiTaskSchema();
  const taskType = normalizeTaskType(payload.task_type);
  const instruction = clean(payload.instruction);
  if (!instruction) throw new Error('Task instruction is required');
  const schedule = normalizeSchedule(payload.schedule || {});
  const status = schedule.mode === 'now' ? 'active' : 'scheduled';
  const nextRun = nextRunFromSchedule(schedule);
  const title = clean(payload.title, instruction.slice(0, 90));
  const result = await db.query(
    `INSERT INTO ai_tasks (client_id, created_by_admin_id, title, task_type, instruction, status, audience, schedule, options, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
     RETURNING *`,
    [
      clientId,
      adminId || null,
      title.slice(0, 180),
      taskType,
      instruction,
      status,
      JSON.stringify(payload.audience || {}),
      JSON.stringify(schedule),
      JSON.stringify(payload.options || {}),
      nextRun,
    ]
  );
  return result.rows[0];
}

async function listAiTasks(clientId) {
  await ensureAiTaskSchema();
  const result = await db.query(
    `SELECT t.*,
            COALESCE((SELECT json_agg(r ORDER BY r.started_at DESC)
                      FROM (SELECT id, status, started_at, finished_at, summary, stats, error
                            FROM ai_task_runs WHERE task_id = t.id ORDER BY started_at DESC LIMIT 5) r), '[]'::json) AS recent_runs
     FROM ai_tasks t
     WHERE t.client_id = $1
     ORDER BY t.created_at DESC
     LIMIT 100`,
    [clientId]
  );
  return result.rows;
}

async function listAiTaskRuns(clientId, limit = 40) {
  await ensureAiTaskSchema();
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 40) || 40));
  const result = await db.query(
    `SELECT r.id, r.task_id, r.status, r.started_at, r.finished_at, r.summary, r.stats, r.error,
            t.title, t.task_type
     FROM ai_task_runs r
     JOIN ai_tasks t ON t.id = r.task_id
     WHERE r.client_id = $1
     ORDER BY r.started_at DESC
     LIMIT $2`,
    [clientId, safeLimit]
  );
  return result.rows;
}

async function updateAiTaskStatus(clientId, taskId, status) {
  await ensureAiTaskSchema();
  const nextStatus = normalizeStatus(status, 'paused');
  const result = await db.query(
    `UPDATE ai_tasks SET status = $3, updated_at = NOW()
     WHERE id = $1 AND client_id = $2 RETURNING *`,
    [taskId, clientId, nextStatus]
  );
  return result.rows[0] || null;
}

async function loadTaskForRun(clientId, taskId) {
  await ensureAiTaskSchema();
  const result = await db.query(`SELECT * FROM ai_tasks WHERE id = $1 AND client_id = $2 LIMIT 1`, [taskId, clientId]);
  return result.rows[0] || null;
}

async function insertRun(task) {
  const result = await db.query(
    `INSERT INTO ai_task_runs (task_id, client_id, status) VALUES ($1, $2, 'running') RETURNING *`,
    [task.id, task.client_id]
  );
  return result.rows[0];
}

async function finishRun(runId, status, summary, stats = {}, error = null) {
  await db.query(
    `UPDATE ai_task_runs
     SET status = $2, summary = $3, stats = $4::jsonb, error = $5, finished_at = NOW()
     WHERE id = $1`,
    [runId, RUN_STATUSES.includes(status) ? status : 'completed', summary || null, JSON.stringify(stats || {}), error || null]
  );
}

async function updateTaskAfterRun(task, success) {
  const schedule = normalizeSchedule(task.schedule || {});
  let status = task.status;
  let nextRun = null;
  if (schedule.mode === 'recurring') {
    status = success ? 'active' : 'failed';
    nextRun = success ? nextRunFromSchedule(schedule, new Date()) : null;
  } else {
    status = success ? 'completed' : 'failed';
  }
  await db.query(
    `UPDATE ai_tasks SET status = $2, next_run_at = $3, last_run_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [task.id, status, nextRun]
  );
}

async function activeBillingRecipients(clientId, audience = {}) {
  const limit = Math.min(500, Math.max(1, Number(audience.limit || 200) || 200));
  const filters = [];
  const params = [clientId];
  filters.push(`client_id = $1`);
  filters.push(`phone_normalized IS NOT NULL`);
  filters.push(`phone_normalized <> ''`);
  const status = clean(audience.status || 'active').toLowerCase();
  if (status === 'active') {
    filters.push(`LOWER(COALESCE(package_status, client_status, '')) IN ('active', 'on', 'enabled', 'paid')`);
  } else if (status === 'expired') {
    filters.push(`LOWER(COALESCE(package_status, client_status, '')) IN ('expired', 'off', 'inactive', 'disabled')`);
  }
  if (audience.package_name) {
    params.push(`%${String(audience.package_name).toLowerCase()}%`);
    filters.push(`LOWER(COALESCE(package_name, '')) LIKE $${params.length}`);
  }
  params.push(limit);
  const result = await db.query(
    `SELECT DISTINCT ON (phone_normalized)
       phone_normalized AS phone,
       COALESCE(full_name, username, account_number, phone) AS name,
       package_name,
       package_price,
       expiration_date
     FROM billing_import_accounts
     WHERE ${filters.join(' AND ')}
     ORDER BY phone_normalized, imported_at DESC
     LIMIT $${params.length}`,
    params
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function conversationRecipients(clientId, audience = {}) {
  const limit = Math.min(250, Math.max(1, Number(audience.limit || 100) || 100));
  const result = await db.query(
    `SELECT DISTINCT ON (customer_phone)
       customer_phone AS phone,
       COALESCE(customer_name, customer_phone) AS name
     FROM conversations
     WHERE client_id = $1 AND customer_phone IS NOT NULL AND customer_phone <> ''
       AND status IN ('active', 'human_takeover', 'resolved')
     ORDER BY customer_phone, updated_at DESC
     LIMIT $2`,
    [clientId, limit]
  );
  return result.rows;
}

function humanEngagementMessage(task, recipient, client) {
  const company = client.business_name || client.name || 'us';
  const name = clean(recipient.name, 'there').split(/\s+/)[0];
  const tone = clean(task.options?.tone, 'warm');
  const body = clean(task.instruction);
  if (tone === 'brief') return `Hello ${name}, ${body}`;
  return `Hello ${name},\n\n${body}\n\nWe truly appreciate you for being part of ${company}.`;
}

async function sendClientMessage(client, phone, message) {
  const cleanTo = cleanPhone(phone);
  if (!cleanTo) throw new Error('Recipient phone is missing');
  if (client.evolution_instance_name) {
    await sendClientText(client, cleanTo, message);
    return;
  }
  await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, cleanTo, message);
}

async function runEngagementTask(task, client) {
  const audience = task.audience || {};
  let recipients = await activeBillingRecipients(task.client_id, audience);
  let source = 'billing_import_accounts';
  if (!recipients.length) {
    recipients = await conversationRecipients(task.client_id, audience);
    source = 'conversations';
  }
  const stats = { source, targets: recipients.length, sent: 0, failed: 0, errors: [] };
  for (const recipient of recipients) {
    try {
      await sendClientMessage(client, recipient.phone, humanEngagementMessage(task, recipient, client));
      stats.sent += 1;
    } catch (err) {
      stats.failed += 1;
      stats.errors.push({ phone: recipient.phone, error: err.message });
    }
  }
  const status = stats.sent > 0 && stats.failed > 0 ? 'partial' : stats.sent > 0 ? 'completed' : 'failed';
  const summary = `Engagement sent to ${stats.sent} of ${stats.targets} target customer${stats.targets === 1 ? '' : 's'}.`;
  return { status, summary, stats };
}

async function runMikrotikReportTask(task) {
  const report = await buildMikrotikStatusReply({ clientId: task.client_id });
  return {
    status: report ? 'completed' : 'failed',
    summary: report || 'No MikroTik report was returned.',
    stats: { report },
  };
}

async function runWebsiteSummaryTask(task) {
  const items = await listWebsiteKnowledge(task.client_id);
  const active = items.filter((item) => item.is_active !== false);
  const refreshed = [];
  for (const item of active.slice(0, 3)) {
    try {
      const updated = await refreshWebsiteKnowledge(task.client_id, item.id);
      refreshed.push({ title: updated.title, url: updated.url, summary: updated.summary });
    } catch (err) {
      refreshed.push({ title: item.title, url: item.url, error: err.message });
    }
  }
  return {
    status: refreshed.length ? 'completed' : 'failed',
    summary: refreshed.length ? `Refreshed ${refreshed.length} website knowledge item${refreshed.length === 1 ? '' : 's'}.` : 'No active website knowledge links found.',
    stats: { refreshed },
  };
}

async function runInvoiceTask(task) {
  return {
    status: 'completed',
    summary: 'Invoice mission captured. The invoice executor is queued for the next build so admins can approve generated invoices before sending.',
    stats: { instruction: task.instruction, note: 'approval_required' },
  };
}

async function executeAiTask(task) {
  await ensureAiTaskSchema();
  const client = await resolveClient(task.client_id);
  if (!client) throw new Error('Client not found');
  if (task.task_type === 'engagement_message') return runEngagementTask(task, client);
  if (task.task_type === 'mikrotik_report') return runMikrotikReportTask(task);
  if (task.task_type === 'website_summary') return runWebsiteSummaryTask(task);
  if (task.task_type === 'invoice_send') return runInvoiceTask(task);
  throw new Error('Unsupported task type');
}

async function runAiTask(clientId, taskId) {
  const task = await loadTaskForRun(clientId, taskId);
  if (!task) throw new Error('Task not found');
  const run = await insertRun(task);
  try {
    const result = await executeAiTask(task);
    await finishRun(run.id, result.status, result.summary, result.stats);
    await updateTaskAfterRun(task, result.status === 'completed' || result.status === 'partial');
    return { ...result, run_id: run.id };
  } catch (err) {
    await finishRun(run.id, 'failed', 'Task failed.', {}, err.message);
    await updateTaskAfterRun(task, false);
    throw err;
  }
}

async function runDueTasks() {
  await ensureAiTaskSchema();
  const result = await db.query(
    `SELECT * FROM ai_tasks
     WHERE status IN ('active', 'scheduled') AND next_run_at IS NOT NULL AND next_run_at <= NOW()
     ORDER BY next_run_at ASC
     LIMIT 5`
  );
  for (const task of result.rows) {
    runAiTask(task.client_id, task.id).catch((err) => {
      console.error(`AI task ${task.id} failed:`, err.message);
    });
  }
}

function startAiTaskScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  ensureAiTaskSchema()
    .then(() => console.log('AI task scheduler ready.'))
    .catch((err) => console.error('AI task scheduler schema failed:', err.message));
  setInterval(() => {
    runDueTasks().catch((err) => console.error('AI task scheduler failed:', err.message));
  }, 60000);
}

module.exports = {
  ensureAiTaskSchema,
  createAiTask,
  listAiTasks,
  listAiTaskRuns,
  updateAiTaskStatus,
  runAiTask,
  startAiTaskScheduler,
};
