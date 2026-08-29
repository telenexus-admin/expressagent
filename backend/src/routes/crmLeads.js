const express = require('express');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

const STAGES = ['new', 'contacted', 'qualified', 'site_survey', 'proposal', 'negotiation', 'won', 'lost'];
const SOURCES = ['website', 'whatsapp', 'facebook', 'instagram', 'referral', 'walk_in', 'phone', 'agent', 'other'];

function clientId(req) { return req.scope?.clientId; }
function actor(req) { return { adminId: req.user?.id || null, agentId: null }; }
function clean(value) { return value === undefined || value === null || value === '' ? null : value; }

router.get('/meta', async (req, res) => {
  try {
    const id = clientId(req);
    if (!id) return res.json({ stages: STAGES, sources: SOURCES, admins: [], agents: [] });
    const [admins, agents] = await Promise.all([
      db.query(`SELECT id, name, email FROM admins WHERE client_id=$1 ORDER BY name`, [id]),
      db.query(`SELECT id, name, email, phone FROM billing_agents WHERE client_id=$1 AND status='active' ORDER BY name`, [id]),
    ]);
    return res.json({ stages: STAGES, sources: SOURCES, admins: admins.rows, agents: agents.rows });
  } catch (error) {
    console.error('CRM meta error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const id = clientId(req);
    if (!id) return res.json({ leads: [], total: 0 });
    const values = [id];
    const where = ['l.client_id=$1'];
    if (req.query.stage && STAGES.includes(req.query.stage)) { values.push(req.query.stage); where.push(`l.stage=$${values.length}`); }
    if (req.query.status) { values.push(req.query.status); where.push(`l.status=$${values.length}`); }
    if (req.query.assignedAdminId) { values.push(Number(req.query.assignedAdminId)); where.push(`l.assigned_admin_id=$${values.length}`); }
    if (req.query.search) { values.push(`%${String(req.query.search).trim()}%`); where.push(`(l.full_name ILIKE $${values.length} OR l.phone ILIKE $${values.length} OR l.email ILIKE $${values.length} OR l.company_name ILIKE $${values.length})`); }
    const result = await db.query(`
      SELECT l.*, a.name AS assigned_admin_name, ba.name AS assigned_agent_name,
             (SELECT MAX(activity_at) FROM crm_lead_activities x WHERE x.lead_id=l.id AND x.client_id=l.client_id) AS last_activity_at
      FROM crm_leads l
      LEFT JOIN admins a ON a.id=l.assigned_admin_id
      LEFT JOIN billing_agents ba ON ba.id=l.assigned_agent_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE l.stage WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'qualified' THEN 3 WHEN 'site_survey' THEN 4 WHEN 'proposal' THEN 5 WHEN 'negotiation' THEN 6 WHEN 'won' THEN 7 ELSE 8 END, l.created_at DESC
      LIMIT 500`, values);
    return res.json({ leads: result.rows, total: result.rowCount });
  } catch (error) {
    console.error('GET /crm/leads error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const id = clientId(req);
    const lead = await db.query(`
      SELECT l.*, a.name AS assigned_admin_name, ba.name AS assigned_agent_name
      FROM crm_leads l LEFT JOIN admins a ON a.id=l.assigned_admin_id LEFT JOIN billing_agents ba ON ba.id=l.assigned_agent_id
      WHERE l.id=$1 AND l.client_id=$2`, [req.params.id, id]);
    if (!lead.rowCount) return res.status(404).json({ error: 'Lead not found' });
    const activities = await db.query(`SELECT * FROM crm_lead_activities WHERE lead_id=$1 AND client_id=$2 ORDER BY activity_at DESC, id DESC`, [req.params.id, id]);
    return res.json({ lead: lead.rows[0], activities: activities.rows });
  } catch (error) {
    console.error('GET /crm/leads/:id error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/leads', async (req, res) => {
  try {
    const id = clientId(req);
    if (!id) return res.status(400).json({ error: 'Client scope is required' });
    const b = req.body || {};
    if (!String(b.full_name || '').trim()) return res.status(400).json({ error: 'Full name is required' });
    const stage = STAGES.includes(b.stage) ? b.stage : 'new';
    const source = SOURCES.includes(b.lead_source) ? b.lead_source : 'other';
    const result = await db.query(`
      INSERT INTO crm_leads (client_id,full_name,company_name,phone,alternative_phone,email,lead_source,stage,status,interested_plan_id,interested_plan_name,expected_monthly_value,county,town,area,installation_address,latitude,longitude,assigned_admin_id,assigned_agent_id,lead_score,notes,next_follow_up_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING *`, [id, String(b.full_name).trim(), clean(b.company_name), clean(b.phone), clean(b.alternative_phone), clean(b.email), source, stage, stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : 'open', clean(b.interested_plan_id), clean(b.interested_plan_name), clean(b.expected_monthly_value), clean(b.county), clean(b.town), clean(b.area), clean(b.installation_address), clean(b.latitude), clean(b.longitude), clean(b.assigned_admin_id), clean(b.assigned_agent_id), Math.max(0, Math.min(100, Number(b.lead_score || 0))), clean(b.notes), clean(b.next_follow_up_at)]);
    const lead = result.rows[0];
    await db.query(`INSERT INTO crm_lead_activities (client_id,lead_id,activity_type,subject,description,created_by_admin_id) VALUES ($1,$2,'note','Lead created','Lead was created in CRM',$3)`, [id, lead.id, actor(req).adminId]);
    return res.status(201).json({ lead });
  } catch (error) {
    console.error('POST /crm/leads error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/leads/:id', async (req, res) => {
  try {
    const id = clientId(req);
    const b = req.body || {};
    const existing = await db.query(`SELECT * FROM crm_leads WHERE id=$1 AND client_id=$2`, [req.params.id, id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'Lead not found' });
    const old = existing.rows[0];
    const stage = b.stage && STAGES.includes(b.stage) ? b.stage : old.stage;
    const status = stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : (b.status || old.status);
    const fields = ['full_name','company_name','phone','alternative_phone','email','lead_source','stage','status','interested_plan_id','interested_plan_name','expected_monthly_value','county','town','area','installation_address','latitude','longitude','assigned_admin_id','assigned_agent_id','lead_score','notes','next_follow_up_at','lost_reason'];
    const values = [];
    const sets = [];
    for (const field of fields) if (Object.prototype.hasOwnProperty.call(b, field)) { values.push(field === 'lead_source' ? (SOURCES.includes(b[field]) ? b[field] : old[field]) : field === 'stage' ? stage : field === 'status' ? status : field === 'lead_score' ? Math.max(0, Math.min(100, Number(b[field] || 0))) : clean(b[field])); sets.push(`${field}=$${values.length}`); }
    if (!sets.length) return res.json({ lead: old });
    values.push(req.params.id, id);
    const updated = await db.query(`UPDATE crm_leads SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${values.length-1} AND client_id=$${values.length} RETURNING *`, values);
    if (old.stage !== stage) await db.query(`INSERT INTO crm_lead_activities (client_id,lead_id,activity_type,subject,description,created_by_admin_id) VALUES ($1,$2,'stage_change','Pipeline stage changed',$3,$4)`, [id, req.params.id, `${old.stage} → ${stage}`, actor(req).adminId]);
    return res.json({ lead: updated.rows[0] });
  } catch (error) {
    console.error('PATCH /crm/leads/:id error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/leads/:id/activities', async (req, res) => {
  try {
    const id = clientId(req);
    const exists = await db.query(`SELECT id FROM crm_leads WHERE id=$1 AND client_id=$2`, [req.params.id, id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Lead not found' });
    const b = req.body || {};
    if (!b.activity_type) return res.status(400).json({ error: 'Activity type is required' });
    const result = await db.query(`INSERT INTO crm_lead_activities (client_id,lead_id,activity_type,subject,description,activity_at,created_by_admin_id) VALUES ($1,$2,$3,$4,$5,COALESCE($6,NOW()),$7) RETURNING *`, [id, req.params.id, String(b.activity_type), clean(b.subject), clean(b.description), clean(b.activity_at), actor(req).adminId]);
    return res.status(201).json({ activity: result.rows[0] });
  } catch (error) {
    console.error('POST /crm/leads/:id/activities error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/leads/:id/convert', async (req, res) => {
  const client = await db.connect();
  try {
    const id = clientId(req);
    await client.query('BEGIN');
    const leadRes = await client.query(`SELECT * FROM crm_leads WHERE id=$1 AND client_id=$2 FOR UPDATE`, [req.params.id, id]);
    if (!leadRes.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Lead not found' }); }
    const lead = leadRes.rows[0];
    if (lead.converted_subscriber_id) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Lead has already been converted', subscriber_id: lead.converted_subscriber_id }); }
    const account = `LEAD-${lead.id}-${Date.now()}`;
    const subscriber = await client.query(`INSERT INTO billing_subscribers (client_id,plan_id,full_name,phone,email,account_number,service_status,radius_status,access_mode) VALUES ($1,$2,$3,$4,$5,$6,'pending','pending','pppoe') RETURNING id,account_number,full_name,phone,email,plan_id`, [id, lead.interested_plan_id || clean(req.body?.plan_id), lead.full_name, lead.phone, lead.email, account]);
    await client.query(`UPDATE crm_leads SET stage='won',status='converted',converted_subscriber_id=$1,updated_at=NOW() WHERE id=$2 AND client_id=$3`, [subscriber.rows[0].id, lead.id, id]);
    await client.query(`INSERT INTO crm_lead_activities (client_id,lead_id,activity_type,subject,description,created_by_admin_id) VALUES ($1,$2,'conversion','Lead converted','Lead converted to billing subscriber #$3',$4)`, [id, lead.id, subscriber.rows[0].id, actor(req).adminId]);
    await client.query('COMMIT');
    return res.json({ lead_id: lead.id, subscriber: subscriber.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /crm/leads/:id/convert error:', error.message);
    return res.status(500).json({ error: 'Unable to convert lead', detail: error.message });
  } finally { client.release(); }
});

module.exports = router;
