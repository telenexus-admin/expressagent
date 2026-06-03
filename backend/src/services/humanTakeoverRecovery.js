const db = require('../db');

let timer = null;
let running = false;

function recoveryMinutes() {
  const parsed = Number.parseInt(process.env.HUMAN_TAKEOVER_AUTO_RESUME_MINUTES || '6', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
}

async function ensureHumanTakeoverColumn() {
  await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS human_takeover_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`
    UPDATE conversations
    SET human_takeover_at = COALESCE(human_takeover_at, updated_at, NOW())
    WHERE status = 'human_takeover'
  `);
}

async function markHumanTakeover(conversationId) {
  await ensureHumanTakeoverColumn();
  await db.query(
    `UPDATE conversations
     SET status = 'human_takeover', human_takeover_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [conversationId]
  );
}

async function markAiActive(conversationId) {
  await ensureHumanTakeoverColumn();
  await db.query(
    `UPDATE conversations
     SET status = 'active', human_takeover_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [conversationId]
  );
}

async function runHumanTakeoverRecovery() {
  if (running) return;
  running = true;
  try {
    await ensureHumanTakeoverColumn();
    const minutes = recoveryMinutes();
    const result = await db.query(
      `UPDATE conversations
       SET status = 'active', human_takeover_at = NULL, updated_at = NOW()
       WHERE status = 'human_takeover'
         AND human_takeover_at <= NOW() - ($1::int * INTERVAL '1 minute')
       RETURNING id, client_id, customer_phone`,
      [minutes]
    );
    if (result.rows.length > 0) {
      console.log(`Auto-resumed ${result.rows.length} human takeover conversation(s) after ${minutes} minutes.`);
    }
  } catch (err) {
    console.error('Human takeover auto-resume scanner failed:', err.message);
  } finally {
    running = false;
  }
}

function startHumanTakeoverRecoveryScheduler() {
  if (timer) return;
  runHumanTakeoverRecovery();
  timer = setInterval(runHumanTakeoverRecovery, 60 * 1000);
  console.log(`Human takeover auto-resume scheduler ready for ${recoveryMinutes()} minutes.`);
}

module.exports = {
  ensureHumanTakeoverColumn,
  markHumanTakeover,
  markAiActive,
  startHumanTakeoverRecoveryScheduler,
};
