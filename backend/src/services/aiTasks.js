const db = require('../db');
const { sendWhatsAppMessage } = require('./whatsapp');
const { sendClientText } = require('./clientEvolution');
const { sendSMS } = require('./sms');
const { sendWorkflowEmployeeEmail } = require('./email');
const { buildMikrotikStatusReply } = require('./mikrotik');
const { refreshWebsiteKnowledge, listWebsiteKnowledge } = require('./websiteKnowledge');
const { generateAIResponse } = require('./openai');

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

function normalizeChannel(value) {
  const channel = clean(value, 'whatsapp').toLowerCase();
  return ['whatsapp', 'sms', 'email'].includes(channel) ? channel : 'whatsapp';
}

function normalizeTime(value) {
  const text = clean(value);
  return /^\d{2}:\d{2}$/.test(text) ? text : null;
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
    time: normalizeTime(value.time || value.run_time),
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
  if (normalized.time) {
    const [hours, minutes] = normalized.time.split(':').map(Number);
    next.setHours(hours, minutes, 0, 0);
  }
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

    CREATE TABLE IF NOT EXISTS ai_task_targets (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
      run_id INTEGER REFERENCES ai_task_runs(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      target_type VARCHAR(40) NOT NULL DEFAULT 'customer',
      target_name VARCHAR(180),
      target_phone VARCHAR(80),
      target_email VARCHAR(180),
      channel VARCHAR(40) NOT NULL DEFAULT 'whatsapp',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      error TEXT,
      response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ai_tasks_client ON ai_tasks(client_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_tasks_next_run ON ai_tasks(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_ai_task_runs_task ON ai_task_runs(task_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_task_targets_task ON ai_task_targets(task_id, run_id, status);
  `);
  await db.query(`ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_task_type_check`);
  await db.query(`ALTER TABLE ai_tasks ADD CONSTRAINT ai_tasks_task_type_check CHECK (task_type IN ('engagement_message', 'invoice_send', 'website_summary', 'mikrotik_report'))`);
  await db.query(`ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_status_check`);
  await db.query(`ALTER TABLE ai_tasks ADD CONSTRAINT ai_tasks_status_check CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'failed', 'cancelled'))`);
  await db.query(`ALTER TABLE ai_task_runs DROP CONSTRAINT IF EXISTS ai_task_runs_status_check`);
  await db.query(`ALTER TABLE ai_task_runs ADD CONSTRAINT ai_task_runs_status_check CHECK (status IN ('running', 'completed', 'failed', 'partial'))`);
  await db.query(`ALTER TABLE ai_task_targets DROP CONSTRAINT IF EXISTS ai_task_targets_status_check`);
  await db.query(`ALTER TABLE ai_task_targets ADD CONSTRAINT ai_task_targets_status_check CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'approved', 'replied'))`);
  await db.query(`ALTER TABLE ai_task_targets ADD COLUMN IF NOT EXISTS target_email VARCHAR(180)`);
  await db.query(`ALTER TABLE ai_task_targets ADD COLUMN IF NOT EXISTS channel VARCHAR(40) NOT NULL DEFAULT 'whatsapp'`);
  await db.query(`ALTER TABLE ai_task_targets ADD COLUMN IF NOT EXISTS response_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  schemaReady = true;
}

async function resolveClient(clientId) {
  const result = await db.query(
    `SELECT *
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
            t.title, t.task_type,
            COALESCE((SELECT COUNT(*)::int FROM ai_task_targets target WHERE target.run_id = r.id), 0) AS target_count,
            COALESCE((SELECT COUNT(*)::int FROM ai_task_targets target WHERE target.run_id = r.id AND target.status IN ('sent','replied')), 0) AS sent_count,
            COALESCE((SELECT COUNT(*)::int FROM ai_task_targets target WHERE target.run_id = r.id AND target.status = 'replied'), 0) AS reply_count,
            COALESCE((SELECT COUNT(*)::int FROM ai_task_targets target WHERE target.run_id = r.id AND target.status = 'failed'), 0) AS failed_count
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
  const channel = normalizeChannel(audience.channel);
  const filters = [];
  const params = [clientId];
  filters.push(`client_id = $1`);
  if (channel === 'email') {
    filters.push(`email IS NOT NULL`);
    filters.push(`email <> ''`);
  } else {
    filters.push(`phone_normalized IS NOT NULL`);
    filters.push(`phone_normalized <> ''`);
  }
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
    `SELECT DISTINCT ON (${channel === 'email' ? 'email' : 'phone_normalized'})
       phone_normalized AS phone,
       email,
       COALESCE(full_name, username, account_number, phone) AS name,
       package_name,
       package_price,
       expiration_date
     FROM billing_import_accounts
     WHERE ${filters.join(' AND ')}
     ORDER BY ${channel === 'email' ? 'email' : 'phone_normalized'}, imported_at DESC
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

function parseCustomRecipients(value) {
  const lines = String(value || '')
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const recipients = [];
  for (const line of lines) {
    const parts = line.split(',').map((part) => part.trim()).filter(Boolean);
    const joined = parts.join(' ');
    const email = parts.find((part) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) ||
      (joined.match(/[^\s@]+@[^\s@]+\.[^\s@]+/) || [])[0] ||
      '';
    const phone = parts.find((part) => cleanPhone(part).length >= 7) || '';
    const name = parts.find((part) => part !== email && part !== phone && !/^[+\d\s()-]+$/.test(part)) || '';
    recipients.push({
      name: clean(name, email || phone || 'there'),
      phone: phone ? cleanPhone(phone) : '',
      email,
    });
  }
  return recipients.filter((recipient) => recipient.phone || recipient.email);
}

function customAudienceRecipients(audience = {}) {
  const type = clean(audience.type, 'filtered').toLowerCase();
  if (type === 'custom_numbers') {
    return parseCustomRecipients(audience.custom_numbers || audience.custom_recipients || '');
  }
  if (type === 'custom_group') {
    return parseCustomRecipients(audience.group?.contacts || audience.contacts || '');
  }
  return [];
}

function humanEngagementMessage(task, recipient, client) {
  const company = client.business_name || client.name || 'us';
  const name = clean(recipient.name, 'there').split(/\s+/)[0];
  const tone = clean(task.options?.tone, 'warm');
  const body = clean(task.options?.campaign_message, task.instruction);
  if (tone === 'brief') return `Hello ${name}, ${body}`;
  return `Hello ${name},\n\n${body}\n\nWe truly appreciate you for being part of ${company}.`;
}

async function buildCampaignBrief(task, client) {
  const company = client.business_name || client.name || 'this internet provider';
  const prompt =
    `You are planning a customer engagement mission for ${company}.\n` +
    `Take the admin instruction, understand the goal, broaden it slightly, and create a natural short customer message.\n` +
    `Keep it human, warm, clear, and not spammy. Do not include placeholders. Do not overpromise.\n` +
    `Return JSON only with keys: campaign_goal, customer_message, reply_guidance, report_focus.`;
  const raw = await generateAIResponse(prompt, [
    { role: 'user', content: `Mission title: ${task.title}\nInstruction: ${task.instruction}\nTone: ${task.options?.tone || 'warm'}` },
  ]).catch(() => '');
  try {
    const jsonText = String(raw || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    return {
      campaign_goal: clean(parsed.campaign_goal, task.title),
      customer_message: clean(parsed.customer_message, task.instruction),
      reply_guidance: clean(parsed.reply_guidance, 'Stay on the campaign topic and answer customer replies naturally.'),
      report_focus: clean(parsed.report_focus, 'Track delivery, replies, sentiment, and follow-up needs.'),
    };
  } catch (_) {
    return {
      campaign_goal: task.title,
      customer_message: clean(task.instruction),
      reply_guidance: 'Stay on the campaign topic and answer customer replies naturally.',
      report_focus: 'Track delivery, replies, sentiment, and follow-up needs.',
    };
  }
}

async function insertTaskTarget(task, runId, recipient, channel, status, error = null, payload = {}) {
  await db.query(
    `INSERT INTO ai_task_targets
       (task_id, run_id, client_id, target_type, target_name, target_phone, target_email, channel, status, error, response_payload, updated_at)
     VALUES ($1,$2,$3,'customer',$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())`,
    [
      task.id,
      runId || null,
      task.client_id,
      recipient.name || null,
      cleanPhone(recipient.phone) || null,
      recipient.email || null,
      channel,
      status,
      error,
      JSON.stringify(payload || {}),
    ]
  );
}

async function sendTaskMessage(client, recipient, message, channel, task) {
  if (channel === 'email') {
    if (!recipient.email) throw new Error('Recipient email is missing');
    const result = await sendWorkflowEmployeeEmail(client, { email: recipient.email }, {
      subject: task.title || 'Message from your internet provider',
      message,
    });
    if (result.status !== 'sent') throw new Error(result.error || 'Email was not sent');
    return;
  }
  const cleanTo = cleanPhone(recipient.phone);
  if (!cleanTo) throw new Error('Recipient phone is missing');
  if (channel === 'sms') {
    const result = await sendSMS(cleanTo, message, { client });
    if (result?.status && result.status !== 'sent') throw new Error(result.error || 'SMS was not sent');
    return;
  }
  if (client.evolution_instance_name) {
    await sendClientText(client, cleanTo, message);
    return;
  }
  await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, cleanTo, message);
}

async function runEngagementTask(task, client) {
  const channel = normalizeChannel(task.options?.channel || task.audience?.channel);
  const audience = { ...(task.audience || {}), channel };
  let recipients = customAudienceRecipients(audience);
  let source = recipients.length ? clean(audience.group?.name, audience.type || 'custom') : 'billing_import_accounts';
  if (!recipients.length) recipients = await activeBillingRecipients(task.client_id, audience);
  if (!recipients.length) {
    recipients = channel === 'email' ? [] : await conversationRecipients(task.client_id, audience);
    source = 'conversations';
  }
  const campaign = await buildCampaignBrief(task, client);
  task.options = { ...(task.options || {}), campaign_message: campaign.customer_message, campaign };
  const stats = {
    source,
    channel,
    targets: recipients.length,
    sent: 0,
    failed: 0,
    replies: 0,
    errors: [],
    campaign,
  };
  for (const recipient of recipients) {
    try {
      const message = humanEngagementMessage(task, recipient, client);
      await sendTaskMessage(client, recipient, message, channel, task);
      await insertTaskTarget(task, task.current_run_id, recipient, channel, 'sent', null, {
        sent_message: message,
        campaign_goal: campaign.campaign_goal,
        reply_guidance: campaign.reply_guidance,
      });
      stats.sent += 1;
    } catch (err) {
      stats.failed += 1;
      stats.errors.push({ phone: recipient.phone, email: recipient.email, error: err.message });
      await insertTaskTarget(task, task.current_run_id, recipient, channel, 'failed', err.message, {
        campaign_goal: campaign.campaign_goal,
      });
    }
  }
  const status = stats.sent > 0 && stats.failed > 0 ? 'partial' : stats.sent > 0 ? 'completed' : 'failed';
  const summary =
    `Mission goal: ${campaign.campaign_goal}\n` +
    `Delivery: ${channel} sent to ${stats.sent} of ${stats.targets} target customer${stats.targets === 1 ? '' : 's'}.\n` +
    `How Nexa should handle replies: ${campaign.reply_guidance}\n` +
    `Report focus: ${campaign.report_focus}`;
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
  task.current_run_id = run.id;
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

async function buildActiveMissionReplyContext(clientId, phone, email = '') {
  await ensureAiTaskSchema();
  const cleanTo = cleanPhone(phone);
  const params = [clientId];
  const where = [`t.client_id = $1`, `t.status IN ('active', 'completed')`, `target.status IN ('sent', 'replied')`];
  if (cleanTo) {
    params.push(cleanTo);
    where.push(`regexp_replace(COALESCE(target.target_phone, ''), '[^0-9]', '', 'g') = $${params.length}`);
  } else if (email) {
    params.push(String(email).trim().toLowerCase());
    where.push(`LOWER(COALESCE(target.target_email, '')) = $${params.length}`);
  } else {
    return '';
  }
  const result = await db.query(
    `SELECT t.id, t.title, t.instruction, t.options, target.id AS target_id, target.response_payload, target.updated_at
     FROM ai_task_targets target
     JOIN ai_tasks t ON t.id = target.task_id
     WHERE ${where.join(' AND ')}
     ORDER BY target.updated_at DESC
     LIMIT 1`,
    params
  ).catch(() => ({ rows: [] }));
  const row = result.rows[0];
  if (!row) return '';
  const campaign = row.options?.campaign || row.response_payload || {};
  return `\n\nACTIVE AI TASK CONTEXT:\n` +
    `This customer recently received an AI Task campaign.\n` +
    `Mission: ${row.title}\n` +
    `Admin instruction: ${row.instruction}\n` +
    `Campaign goal: ${campaign.campaign_goal || row.response_payload?.campaign_goal || row.title}\n` +
    `Original sent message: ${row.response_payload?.sent_message || 'not recorded'}\n` +
    `Reply guidance: ${campaign.reply_guidance || row.response_payload?.reply_guidance || 'Stay on the mission topic and answer naturally.'}\n` +
    `When the customer replies, respond like a real person continuing this mission. Stay on-topic, acknowledge their message, ask one useful follow-up when needed, and do not switch into generic support unless they clearly ask for another issue.`;
}

async function recordAiTaskRecipientReply({ clientId, phone, email = '', customerMessage = '', assistantReply = '' }) {
  await ensureAiTaskSchema();
  const cleanTo = cleanPhone(phone);
  if (!cleanTo && !email) return;
  const params = [clientId];
  const where = [`client_id = $1`, `status IN ('sent', 'replied')`];
  if (cleanTo) {
    params.push(cleanTo);
    where.push(`regexp_replace(COALESCE(target_phone, ''), '[^0-9]', '', 'g') = $${params.length}`);
  } else {
    params.push(String(email).trim().toLowerCase());
    where.push(`LOWER(COALESCE(target_email, '')) = $${params.length}`);
  }
  const target = await db.query(
    `SELECT id, response_payload FROM ai_task_targets
     WHERE ${where.join(' AND ')}
     ORDER BY updated_at DESC
     LIMIT 1`,
    params
  ).catch(() => ({ rows: [] }));
  const row = target.rows[0];
  if (!row) return;
  const replies = Array.isArray(row.response_payload?.replies) ? row.response_payload.replies.slice(-20) : [];
  replies.push({ customer_message: customerMessage, assistant_reply: assistantReply, at: new Date().toISOString() });
  await db.query(
    `UPDATE ai_task_targets
     SET status = 'replied',
         response_payload = response_payload || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [row.id, JSON.stringify({ replies, last_customer_message: customerMessage, last_assistant_reply: assistantReply })]
  );
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
  buildActiveMissionReplyContext,
  recordAiTaskRecipientReply,
  updateAiTaskStatus,
  runAiTask,
  startAiTaskScheduler,
};
