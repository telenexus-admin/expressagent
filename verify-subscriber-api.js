require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const jwt = require('./backend/node_modules/jsonwebtoken');

async function run() {
  const token = jwt.sign({ role: 'admin', client_id: 26 }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const reference = `DIAG-${Date.now()}`;
  const create = await fetch('http://127.0.0.1:3001/api/billing-workspace/subscribers', { method: 'POST', headers, body: JSON.stringify({ full_name: 'Diagnostic Subscriber', account_number: reference, access_mode: 'pppoe', grace_period_days: 0 }) });
  const created = await create.json();
  if (!create.ok) throw new Error(`create ${create.status}: ${JSON.stringify(created)}`);
  const list = await fetch('http://127.0.0.1:3001/api/billing-workspace/subscribers', { headers });
  const subscribers = await list.json();
  const visible = Array.isArray(subscribers) && subscribers.some((row) => row.id === created.id);
  const removal = await fetch(`http://127.0.0.1:3001/api/billing-workspace/subscribers/${created.id}`, { method: 'DELETE', headers });
  if (!removal.ok) throw new Error(`delete ${removal.status}: ${await removal.text()}`);
  console.log(JSON.stringify({ create_status: create.status, visible_in_list: visible, delete_status: removal.status }));
}
run().catch((error) => { console.error(error.message); process.exit(1); });
