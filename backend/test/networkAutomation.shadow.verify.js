const db = require('../src/db');
const { runShadowPlannerOnce } = require('../src/services/networkAutomation');

async function run() {
  const result = await runShadowPlannerOnce();
  if (result.mode !== 'shadow' || result.automatic_execution !== false || result.commands_executed !== 0) {
    throw new Error('Shadow planner safety boundary changed');
  }
  console.log(JSON.stringify(result));
  await db.end();
}

run().catch(async (error) => { console.error(error); try { await db.end(); } catch (_) {} process.exit(1); });
