const db = require('../db');
const { sendSMS } = require('./sms');

const TIME_ZONE = 'Africa/Nairobi';
let tablesReady = false;
let schedulerStarted = false;
let running = false;

async function ensureDailyReportTables() {
  if (tablesReady) return;
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS daily_report_phone VARCHAR(50)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      report_date DATE NOT NULL,
      recipient_phone VARCHAR(50),
      report_text TEXT NOT NULL,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      delivery_error TEXT,
      sent_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (client_id, report_date)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_daily_reports_client_date ON daily_reports(client_id, report_date DESC)`);
  tablesReady = true;
}

function nairobiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nairobiClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return {
    hour: Number(parts.find((part) => part.type === 'hour')?.value || 0),
    minute: Number(parts.find((part) => part.type === 'minute')?.value || 0),
  };
}

async function buildMetrics(clientId, reportDate) {
  const metrics = await db.query(
    `SELECT
       COUNT(DISTINCT CASE WHEN m.role = 'user' THEN m.conversation_id END)::int AS customers_texted,
       COUNT(CASE WHEN m.role = 'user' THEN 1 END)::int AS customer_messages,
       COUNT(CASE WHEN m.role = 'assistant' THEN 1 END)::int AS ai_replies,
       COUNT(DISTINCT CASE WHEN m.role = 'assistant' THEN m.conversation_id END)::int AS ai_cases_handled,
       COUNT(DISTINCT CASE WHEN m.role = 'admin' THEN m.conversation_id END)::int AS admin_conversations,
       COUNT(CASE WHEN m.role = 'admin' THEN 1 END)::int AS admin_replies
     FROM conversations c
     JOIN messages m ON m.conversation_id = c.id
     WHERE c.client_id = $1
       AND (m.timestamp AT TIME ZONE $2)::date = $3::date`,
    [clientId, TIME_ZONE, reportDate]
  );

  const cases = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE type = 'human')::int AS handovers,
       COUNT(*) FILTER (WHERE type = 'installation')::int AS installations,
       COUNT(*) FILTER (WHERE type = 'complaint')::int AS complaints,
       COUNT(*) FILTER (WHERE type = 'human' AND resolved_at IS NOT NULL)::int AS handovers_resolved,
       COUNT(*) FILTER (WHERE type = 'human' AND resolved_at IS NULL)::int AS handovers_pending
     FROM escalations
     WHERE client_id = $1
       AND (created_at AT TIME ZONE $2)::date = $3::date`,
    [clientId, TIME_ZONE, reportDate]
  );

  const escalationFollowUp = await db.query(
    `SELECT COUNT(admin_msg.id)::int AS replies_after_handover
     FROM escalations e
     LEFT JOIN messages admin_msg
       ON admin_msg.conversation_id = e.conversation_id
      AND admin_msg.role = 'admin'
      AND admin_msg.timestamp >= e.created_at
     WHERE e.client_id = $1
       AND e.type = 'human'
       AND (e.created_at AT TIME ZONE $2)::date = $3::date`,
    [clientId, TIME_ZONE, reportDate]
  );

  const handoverDetails = await db.query(
    `SELECT e.id, e.conversation_id, e.customer_name, e.customer_phone, e.trigger_message, e.created_at, e.resolved_at,
            COUNT(admin_msg.id)::int AS admin_replies,
            MAX(admin_msg.timestamp) AS last_admin_reply_at,
            COALESCE((ARRAY_AGG(admin_msg.sender_name ORDER BY admin_msg.timestamp DESC)
              FILTER (WHERE admin_msg.sender_name IS NOT NULL))[1], '') AS last_responded_by
     FROM escalations e
     LEFT JOIN messages admin_msg
       ON admin_msg.conversation_id = e.conversation_id
      AND admin_msg.role = 'admin'
      AND admin_msg.timestamp >= e.created_at
     WHERE e.client_id = $1
       AND e.type = 'human'
       AND (e.created_at AT TIME ZONE $2)::date = $3::date
     GROUP BY e.id
     ORDER BY e.created_at DESC
     LIMIT 20`,
    [clientId, TIME_ZONE, reportDate]
  );

  const details = handoverDetails.rows.map((row) => ({
    ...row,
    outcome: row.resolved_at ? 'resolved' : row.admin_replies > 0 ? 'followed_up' : 'pending_follow_up',
  }));

  let feedbackReviews = 0;
  const remarksTable = await db.query(`SELECT to_regclass('public.client_remarks') AS table_name`);
  if (remarksTable.rows[0]?.table_name) {
    const feedback = await db.query(
      `SELECT COUNT(*) FILTER (WHERE response_key IS NOT NULL)::int AS feedback_reviews
       FROM client_remarks
       WHERE client_id = $1
         AND (responded_at AT TIME ZONE $2)::date = $3::date`,
      [clientId, TIME_ZONE, reportDate]
    );
    feedbackReviews = feedback.rows[0]?.feedback_reviews || 0;
  }

  return {
    ...metrics.rows[0],
    ...cases.rows[0],
    feedback_reviews: feedbackReviews,
    replies_after_handover: escalationFollowUp.rows[0]?.replies_after_handover || 0,
    handovers_followed_up: details.filter((row) => row.outcome === 'followed_up').length,
    handovers_unattended: details.filter((row) => row.outcome === 'pending_follow_up').length,
    handover_details: details,
  };
}

function mainIssue(metrics) {
  const items = [
    { label: 'installation requests', count: Number(metrics.installations) || 0 },
    { label: 'service complaints', count: Number(metrics.complaints) || 0 },
    { label: 'requests for human support', count: Number(metrics.handovers) || 0 },
  ].sort((a, b) => b.count - a.count);

  if (items[0].count > 0) return items[0].label;
  if ((Number(metrics.customer_messages) || 0) > 0) return 'general support questions';
  return 'low customer activity';
}

function engagementLevel(metrics) {
  const customers = Number(metrics.customers_texted) || 0;
  if (customers >= 30) return 'high';
  if (customers >= 8) return 'moderate';
  return 'low';
}

function customerMood(metrics) {
  const complaints = Number(metrics.complaints) || 0;
  const handovers = Number(metrics.handovers) || 0;
  const customers = Number(metrics.customers_texted) || 0;
  if (customers === 0) return 'quiet';
  if (complaints + handovers > customers / 2) return 'concerned';
  if (complaints > 0 || handovers > 0) return 'mixed';
  return 'positive';
}

function formatReport(client, reportDate, metrics) {
  const business = client.business_name || client.name || 'ISP';
  const agentName = (client.agent_name || '').trim() || 'AI Customer Support Agent';
  return [
    `Good evening Boss,`,
    ``,
    `Here is today's customer engagement report for *${business}*:`,
    ``,
    `👥 Clients assisted: *${metrics.customers_texted || 0}*`,
    `💬 Total replies sent: *${metrics.ai_replies || 0}*`,
    `🤝 Handovers to human support: *${metrics.handovers || 0}*`,
    `⭐ Clients who gave feedback/reviews: *${metrics.feedback_reviews || 0}*`,
    ``,
    `📌 Insight: Today, most clients contacted us about *${mainIssue(metrics)}*. Engagement was *${engagementLevel(metrics)}*, and customers generally showed *${customerMood(metrics)}* responses toward our services.`,
    ``,
    `— ${agentName}, AI Customer Support Agent`,
  ].join('\n');
}

async function createReport(client, reportDate) {
  await ensureDailyReportTables();
  const metrics = await buildMetrics(client.id, reportDate);
  const reportText = formatReport(client, reportDate, metrics);
  return { metrics, reportText };
}

async function sendClientReport(client, reportDate, { force = false } = {}) {
  await ensureDailyReportTables();
  const phone = String(client.daily_report_phone || client.support_number || '').replace(/[^0-9]/g, '');
  if (!phone) return { status: 'skipped', error: 'No daily report SMS phone configured' };

  const existing = await db.query(`SELECT id, delivery_status FROM daily_reports WHERE client_id = $1 AND report_date = $2::date`, [client.id, reportDate]);
  if (!force && existing.rows[0]?.delivery_status === 'sent') return { status: 'already_sent', report: existing.rows[0] };

  const { metrics, reportText } = await createReport(client, reportDate);
  let status = 'sent';
  let error = null;
  let sentAt = new Date();
  try {
    await sendSMS(phone, reportText);
    console.log(`Daily report SMS sent for client ${client.id} to ${phone}.`);
  } catch (err) {
    status = 'failed';
    error = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message);
    sentAt = null;
    console.error(`Daily report SMS failed for client ${client.id}:`, error);
  }

  const result = await db.query(
    `INSERT INTO daily_reports (client_id, report_date, recipient_phone, report_text, metrics, delivery_status, delivery_error, sent_at)
     VALUES ($1, $2::date, $3, $4, $5::jsonb, $6, $7, $8)
     ON CONFLICT (client_id, report_date) DO UPDATE SET
       recipient_phone = EXCLUDED.recipient_phone,
       report_text = EXCLUDED.report_text,
       metrics = EXCLUDED.metrics,
       delivery_status = EXCLUDED.delivery_status,
       delivery_error = EXCLUDED.delivery_error,
       sent_at = EXCLUDED.sent_at
     RETURNING *`,
    [client.id, reportDate, phone, reportText, JSON.stringify(metrics), status, error, sentAt]
  );
  return { status, report: result.rows[0] };
}

async function runDueReports() {
  if (running) return;
  running = true;
  try {
    await ensureDailyReportTables();
    const clock = nairobiClock();
    if (clock.hour < 20) return;
    const reportDate = nairobiDate();
    const clients = await db.query(
      `SELECT id, name, business_name, support_number, daily_report_phone, agent_name
       FROM clients
       WHERE status = 'active' AND daily_report_enabled = TRUE`
    );
    for (const client of clients.rows) {
      await sendClientReport(client, reportDate);
    }
  } catch (err) {
    console.error('Daily report scheduler error:', err.message);
  } finally {
    running = false;
  }
}

function startDailyReportScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  ensureDailyReportTables().catch((err) => console.error('Daily reports setup failed:', err.message));
  setTimeout(runDueReports, 8000);
  setInterval(runDueReports, 60000);
  console.log('Daily SMS report scheduler ready for 8:00 PM Africa/Nairobi.');
}

module.exports = {
  ensureDailyReportTables,
  nairobiDate,
  createReport,
  sendClientReport,
  startDailyReportScheduler,
};
