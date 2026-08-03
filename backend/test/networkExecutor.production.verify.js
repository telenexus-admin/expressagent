const fs = require('fs');
const db = require('../src/db');
const {
  ACTION_SUPPORT,
  EXECUTION_ENABLED,
  ensureNetworkExecutorSchema,
  executionFeatureState,
} = require('../src/services/networkExecutor');

async function run() {
  await ensureNetworkExecutorSchema();
  if (EXECUTION_ENABLED) throw new Error('Production network execution must remain disabled during Phase 3 stabilization');
  const state = executionFeatureState();
  if (state.execution_enabled || state.automatic_execution || !state.approval_required || !state.dedicated_credentials_required) {
    throw new Error('Unsafe production executor feature state');
  }
  if (ACTION_SUPPORT.change_default_route.supported || ACTION_SUPPORT.update_radius_endpoint.supported) {
    throw new Error('Critical unsupported actions were accidentally enabled');
  }
  const active = await db.query(`SELECT COUNT(*)::int count FROM network_execution_requests WHERE status IN ('executing','verifying','rolling_back')`);
  if (active.rows[0].count !== 0) throw new Error('Unexpected active production executions');
  const source = fs.readFileSync(require.resolve('../src/services/onePasteOnboarding'), 'utf8');
  if (!source.includes('nexa-executor') || !source.includes('policy=read,write,test,api')) throw new Error('One-paste executor identity is missing');
  const credentials = await db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE enabled)::int enabled FROM network_router_executor_credentials`);
  console.log(JSON.stringify({ ...state, actions: Object.keys(ACTION_SUPPORT).length,
    active_executions: 0, executor_credentials: credentials.rows[0] }));
  await db.end();
}

run().catch(async (error) => { console.error(error); try { await db.end(); } catch (_) {} process.exit(1); });
