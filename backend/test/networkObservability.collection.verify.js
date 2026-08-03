const db = require('../src/db');
const { runNetworkObservabilityOnce } = require('../src/services/networkObservability');

runNetworkObservabilityOnce()
  .then((summary) => {
    console.log(JSON.stringify({ ...summary, read_only: true, commands_executed: false }));
    if (summary.completed + summary.failed !== summary.routers) {
      throw new Error('Not every registered router produced a bounded collection result');
    }
  })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.end());
