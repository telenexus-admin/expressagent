const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { ensureRemarksSchema } = require('../services/clientRemarks');
const { ensureTicketSchema } = require('../services/tickets');

router.use(authMiddleware, scopeMiddleware);

function applyClientScope(req, params, alias) {
  if (!req.scope.isSuperadmin || req.scope.clientId) {
    params.push(req.scope.clientId);
    return `${alias}.client_id = $${params.length}`;
  }
  return 'TRUE';
}

async function ensureEscalationSchema() {
  await db.query(`
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'human';
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS summary TEXT;
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE;
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS request_email_status VARCHAR(20) NOT NULL DEFAULT 'skipped';
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS request_email_error TEXT;
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS confirmation_email_status VARCHAR(20) NOT NULL DEFAULT 'skipped';
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS confirmation_email_error TEXT;
    ALTER TABLE escalations DROP CONSTRAINT IF EXISTS escalations_type_check;
    ALTER TABLE escalations ADD CONSTRAINT escalations_type_check CHECK (type IN ('human', 'installation', 'complaint'));
    ALTER TABLE escalations DROP CONSTRAINT IF EXISTS escalations_notify_status_check;
    ALTER TABLE escalations ADD CONSTRAINT escalations_notify_status_check CHECK (notify_status IN ('sent', 'failed', 'no_support_number', 'logged'));
  `);
}

async function ensureCustomerIntakeTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS customer_intake_submissions (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(80) NOT NULL,
      alternate_phone VARCHAR(80),
      email VARCHAR(255),
      id_number VARCHAR(80),
      plan_interest VARCHAR(140),
      service_type VARCHAR(80),
      county VARCHAR(120),
      area VARCHAR(180) NOT NULL,
      landmark TEXT,
      building_type VARCHAR(80),
      house_description TEXT,
      latitude NUMERIC,
      longitude NUMERIC,
      preferred_date VARCHAR(40),
      preferred_time VARCHAR(40),
      notes TEXT,
      consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
      identity_mime_type VARCHAR(100),
      identity_filename VARCHAR(255),
      identity_document BYTEA,
      special_package_type VARCHAR(30),
      special_package_status VARCHAR(30) NOT NULL DEFAULT 'not_requested',
      special_document_mime_type VARCHAR(100),
      special_document_filename VARCHAR(255),
      special_document BYTEA,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_package_type VARCHAR(30)`);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_package_status VARCHAR(30) NOT NULL DEFAULT 'not_requested'`);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_document_mime_type VARCHAR(100)`);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_document_filename VARCHAR(255)`);
  await db.query(`ALTER TABLE customer_intake_submissions ADD COLUMN IF NOT EXISTS special_document BYTEA`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_intake_client ON customer_intake_submissions(client_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_intake_phone ON customer_intake_submissions(customer_phone)`);
}

// GET /api/escalations/remarks-summary — customer experience totals.
router.get('/remarks-summary', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [];
    const condition = applyClientScope(req, params, 'r');
    const result = await db.query(
      `SELECT
         COUNT(*)::int AS surveys_sent,
         COUNT(*) FILTER (WHERE response_key IS NOT NULL)::int AS responses,
         COUNT(*) FILTER (WHERE response_key = 'excellent')::int AS excellent,
         COUNT(*) FILTER (WHERE response_key = 'okay')::int AS okay,
         COUNT(*) FILTER (WHERE response_key = 'need_help')::int AS need_help,
         COUNT(*) FILTER (WHERE requires_followup = TRUE AND reviewed_at IS NULL)::int AS pending_followup,
         ROUND(COALESCE(AVG(score) FILTER (WHERE score IS NOT NULL), 0), 1)::float AS average_score
       FROM client_remarks r
       WHERE ${condition}`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /escalations/remarks-summary error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/escalations/remarks-list — end-of-chat experience feedback.
router.get('/remarks-list', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [];
    const condition = applyClientScope(req, params, 'r');
    const result = await db.query(
      `SELECT r.id, r.conversation_id, r.customer_name, r.requested_at,
              r.response_key, r.response_label, r.score, r.responded_at,
              r.requires_followup, r.reviewed_at, c.status AS conversation_status
       FROM client_remarks r
       JOIN conversations c ON c.id = r.conversation_id
       WHERE ${condition}
       ORDER BY COALESCE(r.responded_at, r.requested_at) DESC
       LIMIT 250`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /escalations/remarks-list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/escalations/remarks/:id/review — clear an attention-required remark.
router.patch('/remarks/:id/review', async (req, res) => {
  try {
    await ensureRemarksSchema();
    const params = [req.params.id];
    let where = 'id = $1';
    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where += ` AND client_id = $${params.length}`;
    }
    const result = await db.query(
      `UPDATE client_remarks SET reviewed_at = NOW() WHERE ${where} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Remark not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /escalations/remarks/:id/review error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/escalations/installation-intakes — CRM details submitted through the public intake form.
router.get('/installation-intakes', async (req, res) => {
  try {
    await ensureCustomerIntakeTable();
    await ensureTicketSchema();
    const { status } = req.query;

    const params = [];
    const conditions = [applyClientScope(req, params, 'i')];
    if (status === 'open') conditions.push(`COALESCE(t.status, 'open') NOT IN ('resolved', 'closed')`);
    else if (status === 'resolved') conditions.push(`t.status IN ('resolved', 'closed')`);
    const condition = conditions.join(' AND ');
    const result = await db.query(
      `SELECT
         i.id, i.client_id, i.customer_name, i.customer_phone, i.alternate_phone,
         i.email, i.id_number, i.plan_interest, i.service_type, i.county, i.area,
         i.landmark, i.building_type, i.house_description, i.latitude, i.longitude,
         i.preferred_date, i.preferred_time, i.notes, i.consent_accepted,
         i.identity_mime_type, i.identity_filename,
         (i.identity_document IS NOT NULL) AS has_identity_document,
         i.special_package_type, i.special_package_status, i.special_document_mime_type,
         i.special_document_filename, (i.special_document IS NOT NULL) AS has_special_document,
         i.metadata, i.created_at,
         t.id AS ticket_id, t.status AS ticket_status, t.priority AS ticket_priority
       FROM customer_intake_submissions i
       LEFT JOIN LATERAL (
         SELECT id, status, priority
         FROM tickets
         WHERE client_id = i.client_id
           AND customer_phone = i.customer_phone
           AND category = 'installation'
         ORDER BY updated_at DESC
         LIMIT 1
       ) t ON TRUE
       WHERE ${condition}
       ORDER BY i.created_at DESC
       LIMIT 250`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /escalations/installation-intakes error:', err.message);
    res.status(500).json({ error: 'Failed to load installation intake details' });
  }
});

router.get('/installation-intakes/:id/special-document', async (req, res) => {
  try {
    await ensureCustomerIntakeTable();
    const params = [req.params.id];
    let where = 'id = $1';
    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where += ` AND client_id = $${params.length}`;
    }
    const result = await db.query(
      `SELECT special_document, special_document_mime_type, special_document_filename
       FROM customer_intake_submissions WHERE ${where} LIMIT 1`,
      params
    );
    const row = result.rows[0];
    if (!row?.special_document) return res.status(404).json({ error: 'Verification document not found' });
    res.setHeader('Content-Type', row.special_document_mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(row.special_document_filename || 'verification-document').replace(/"/g, '')}"`);
    res.send(row.special_document);
  } catch (err) {
    console.error('GET special verification document error:', err.message);
    res.status(500).json({ error: 'Failed to load verification document' });
  }
});

router.patch('/installation-intakes/:id/special-status', async (req, res) => {
  try {
    await ensureCustomerIntakeTable();
    const status = String(req.body.status || '');
    if (!['pending_review', 'approved', 'more_information', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid verification status' });
    }
    const params = [status, req.params.id];
    let where = 'id = $2 AND special_package_type IS NOT NULL';
    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where += ` AND client_id = $${params.length}`;
    }
    const result = await db.query(
      `UPDATE customer_intake_submissions SET special_package_status = $1 WHERE ${where}
       RETURNING id, special_package_type, special_package_status`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Special package application not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH special package status error:', err.message);
    res.status(500).json({ error: 'Failed to update verification status' });
  }
});

// GET /api/escalations/installation-intakes/:id/identity — secure ID document download.
router.get('/installation-intakes/:id/identity', async (req, res) => {
  try {
    await ensureCustomerIntakeTable();
    const params = [req.params.id];
    let where = 'id = $1';
    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where += ` AND client_id = $${params.length}`;
    }
    const result = await db.query(
      `SELECT identity_document, identity_mime_type, identity_filename
       FROM customer_intake_submissions
       WHERE ${where}
       LIMIT 1`,
      params
    );
    const row = result.rows[0];
    if (!row || !row.identity_document) return res.status(404).json({ error: 'Identity document not found' });
    res.setHeader('Content-Type', row.identity_mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(row.identity_filename || 'identity-document').replace(/"/g, '')}"`);
    res.send(row.identity_document);
  } catch (err) {
    console.error('GET /escalations/installation-intakes/:id/identity error:', err.message);
    res.status(500).json({ error: 'Failed to load identity document' });
  }
});

// GET /api/escalations
router.get('/', async (req, res) => {
  try {
    await ensureEscalationSchema();
    const { status, type } = req.query;
    const conditions = [];
    const params = [];

    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      conditions.push(`e.client_id = $${params.length}`);
    }

    if (status === 'open') conditions.push('e.resolved_at IS NULL');
    else if (status === 'resolved') conditions.push('e.resolved_at IS NOT NULL');

    if (type === 'human' || type === 'installation' || type === 'complaint') {
      params.push(type);
      conditions.push(`e.type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT
         e.id, e.conversation_id, e.customer_phone, e.customer_name, e.customer_email,
         e.trigger_message, e.support_number, e.notify_status, e.notify_error,
         e.request_email_status, e.request_email_error,
         e.confirmation_email_status, e.confirmation_email_error,
         e.resolved_at, e.created_at, e.type, e.summary,
         c.status AS conversation_status
       FROM escalations e
       JOIN conversations c ON c.id = e.conversation_id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /escalations error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/escalations/:id/resolve
router.patch('/:id/resolve', async (req, res) => {
  try {
    const ownership = await db.query(`SELECT client_id FROM escalations WHERE id = $1`, [req.params.id]);
    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Escalation not found' });
    }
    if (!req.scope.isSuperadmin && ownership.rows[0].client_id !== req.scope.clientId) {
      return res.status(404).json({ error: 'Escalation not found' });
    }

    const result = await db.query(
      `UPDATE escalations SET resolved_at = NOW()
       WHERE id = $1 AND resolved_at IS NULL
       RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Escalation not found or already resolved' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /escalations/:id/resolve error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
