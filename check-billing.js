require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const db = require('./backend/src/db');

Promise.all([
  db.query(`SELECT id, client_id, full_name, account_number, access_mode, service_status, created_at
            FROM billing_subscribers ORDER BY created_at DESC LIMIT 12`),
  db.query(`SELECT id, client_id, name, cidr, router_id FROM billing_ip_pools ORDER BY created_at DESC LIMIT 12`),
]).then(([subscribers, pools]) => {
  console.log(JSON.stringify({ subscribers: subscribers.rows, pools: pools.rows }));
  process.exit(0);
}).catch((error) => { console.error(error.message); process.exit(1); });
