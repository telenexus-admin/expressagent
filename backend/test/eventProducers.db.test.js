const assert = require('assert');
const db = require('../src/db');
const {
  listRecentRadiusSessions,
  radiusEnabled,
} = require('../src/services/radiusSync');
const {
  ensureRadiusSessionEventSchema,
} = require('../src/services/radiusSessionEvents');

async function main() {
  await ensureRadiusSessionEventSchema();
  const table = await db.query(
    `SELECT to_regclass('public.billing_radius_session_event_state') AS name`
  );
  assert.equal(table.rows[0].name, 'billing_radius_session_event_state');

  let radiusQuery = 'disabled';
  let sessionRows = 0;
  if (radiusEnabled()) {
    const subscriber = await db.query(
      `SELECT radius_username
       FROM billing_subscribers
       WHERE radius_username IS NOT NULL AND radius_username <> ''
       ORDER BY id LIMIT 1`
    );
    if (subscriber.rows[0]) {
      const sessions = await listRecentRadiusSessions(
        [subscriber.rows[0].radius_username],
        1
      );
      assert(Array.isArray(sessions));
      radiusQuery = 'ok';
      sessionRows = sessions.length;
    } else {
      radiusQuery = 'no_subscriber';
    }
  }

  console.log(JSON.stringify({
    status: 'ok',
    radius_query: radiusQuery,
    session_rows: sessionRows,
  }));
  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  try { await db.end(); } catch (_) { /* ignore shutdown errors */ }
  process.exit(1);
});
