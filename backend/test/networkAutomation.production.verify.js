const db = require('../src/db');
const {
  FORBIDDEN_PATHS,
  ensureNetworkAutomationSchema,
  getActionCatalog,
  getAutomationOverview,
  listShadowPlans,
} = require('../src/services/networkAutomation');

async function run() {
  await ensureNetworkAutomationSchema();
  const tenants = await db.query(`SELECT id FROM clients WHERE account_type='billing' ORDER BY id`);
  const catalog = getActionCatalog();
  if (catalog.length < 15 || catalog.some((item) => item.execution_allowed || item.phase_2_mode !== 'shadow')) {
    throw new Error('Unsafe or incomplete production action catalogue');
  }
  for (const tenant of tenants.rows) {
    const overview = await getAutomationOverview(tenant.id);
    const plans = await listShadowPlans(tenant.id, { limit: 500 });
    if (overview.mode !== 'shadow' || overview.automatic_execution || overview.execution_allowed || overview.commands_executed !== 0) {
      throw new Error(`Unsafe automation flags for tenant ${tenant.id}`);
    }
    for (const plan of plans) {
      if (plan.client_id !== tenant.id || plan.execution_allowed || plan.commands_executed || plan.mode !== 'shadow') {
        throw new Error(`Unsafe or cross-tenant plan ${plan.id}`);
      }
      const paths = [...(plan.command_preview || []), ...(plan.rollback_preview || [])].map((item) => item.path);
      if (paths.some((path) => FORBIDDEN_PATHS.some((blocked) => path === blocked || path.startsWith(`${blocked}/`)))) {
        throw new Error(`Forbidden RouterOS path stored in plan ${plan.id}`);
      }
    }
  }
  console.log(JSON.stringify({ tenants: tenants.rows.length, actions: catalog.length, mode: 'shadow', automatic_execution: false, commands_executed: 0 }));
  await db.end();
}

run().catch(async (error) => { console.error(error); try { await db.end(); } catch (_) {} process.exit(1); });
