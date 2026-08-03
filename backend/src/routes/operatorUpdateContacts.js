const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, superadminMiddleware } = require('../middleware/auth');
const { getOperatorSettings, sendEvolutionText } = require('../services/evolution');

const router = express.Router();
router.use(authMiddleware, superadminMiddleware);

function clean(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function normalizePhone(value) {
  return String(value || '').replace(/@s\.whatsapp\.net$/i, '').replace(/[^0-9]/g, '');
}

async function ensureUpdateContactSchema() {
  await db.query(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS official_whatsapp_number VARCHAR(80);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS official_contact_name VARCHAR(160);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS update_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS update_contact_updated_at TIMESTAMP WITH TIME ZONE;

    CREATE TABLE IF NOT EXISTS operator_update_broadcasts (
      id SERIAL PRIMARY KEY,
      title VARCHAR(180) NOT NULL,
      message TEXT NOT NULL,
      created_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_by_name VARCHAR(160),
      total_recipients INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS operator_update_broadcast_recipients (
      id SERIAL PRIMARY KEY,
      broadcast_id INTEGER NOT NULL REFERENCES operator_update_broadcasts(id) ON DELETE CASCADE,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      client_name VARCHAR(255),
      phone VARCHAR(80),
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      error TEXT,
      sent_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_operator_update_recipients_broadcast ON operator_update_broadcast_recipients(broadcast_id);
    CREATE INDEX IF NOT EXISTS idx_clients_official_whatsapp ON clients(official_whatsapp_number);
  `);
}

function serializeContact(row) {
  return {
    id: row.id,
    name: row.name,
    business_name: row.business_name,
    status: row.status,
    connection_provider: row.connection_provider,
    official_whatsapp_number: row.official_whatsapp_number || '',
    official_contact_name: row.official_contact_name || '',
    update_notifications_enabled: row.update_notifications_enabled !== false,
    update_contact_updated_at: row.update_contact_updated_at || null,
    has_update_contact: Boolean(normalizePhone(row.official_whatsapp_number)),
  };
}

async function listContacts() {
  await ensureUpdateContactSchema();
  const result = await db.query(`
    SELECT id, name, business_name, status, connection_provider,
           official_whatsapp_number, official_contact_name,
           update_notifications_enabled, update_contact_updated_at
    FROM clients
    ORDER BY COALESCE(business_name, name), id
  `);
  return result.rows.map(serializeContact);
}

router.get('/contacts', async (_req, res) => {
  try {
    const contacts = await listContacts();
    res.json({
      contacts,
      summary: {
        total: contacts.length,
        configured: contacts.filter((contact) => contact.has_update_contact).length,
        enabled: contacts.filter((contact) => contact.has_update_contact && contact.update_notifications_enabled).length,
      },
    });
  } catch (err) {
    console.error('GET /operator-update-contacts/contacts error:', err.message);
    res.status(500).json({ error: 'Failed to load client update contacts' });
  }
});

router.put('/contacts/:clientId', [
  body('official_whatsapp_number').optional({ checkFalsy: true }).matches(/^\+?[0-9][0-9\s\-()]{6,19}$/).withMessage('Enter a valid WhatsApp number'),
  body('official_contact_name').optional({ checkFalsy: true }).isString().isLength({ max: 160 }),
  body('update_notifications_enabled').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureUpdateContactSchema();
    const phone = normalizePhone(req.body.official_whatsapp_number);
    const result = await db.query(
      `UPDATE clients
       SET official_whatsapp_number = $1,
           official_contact_name = $2,
           update_notifications_enabled = $3,
           update_contact_updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, business_name, status, connection_provider,
                 official_whatsapp_number, official_contact_name,
                 update_notifications_enabled, update_contact_updated_at`,
      [
        phone || null,
        clean(req.body.official_contact_name, 160) || null,
        req.body.update_notifications_enabled !== false,
        req.params.clientId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Client not found' });
    res.json(serializeContact(result.rows[0]));
  } catch (err) {
    console.error('PUT /operator-update-contacts/contacts/:clientId error:', err.message);
    res.status(500).json({ error: 'Failed to save update contact' });
  }
});

router.get('/broadcasts', async (_req, res) => {
  try {
    await ensureUpdateContactSchema();
    const result = await db.query(`
      SELECT b.*,
             COALESCE(
               jsonb_agg(
                 jsonb_build_object(
                   'client_id', r.client_id,
                   'client_name', r.client_name,
                   'phone', r.phone,
                   'status', r.status,
                   'error', r.error,
                   'sent_at', r.sent_at
                 )
                 ORDER BY r.created_at
               ) FILTER (WHERE r.id IS NOT NULL),
               '[]'::jsonb
             ) AS recipients
      FROM operator_update_broadcasts b
      LEFT JOIN operator_update_broadcast_recipients r ON r.broadcast_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
      LIMIT 30
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /operator-update-contacts/broadcasts error:', err.message);
    res.status(500).json({ error: 'Failed to load update broadcasts' });
  }
});

router.post('/broadcasts', [
  body('title').trim().isLength({ min: 3, max: 180 }).withMessage('Title is required'),
  body('message').trim().isLength({ min: 5, max: 4000 }).withMessage('Message is required'),
  body('client_ids').optional().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureUpdateContactSchema();
    const selectedIds = Array.isArray(req.body.client_ids)
      ? req.body.client_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const params = [];
    let filter = `WHERE update_notifications_enabled = TRUE AND official_whatsapp_number IS NOT NULL AND official_whatsapp_number <> ''`;
    if (selectedIds.length) {
      params.push(selectedIds);
      filter += ` AND id = ANY($${params.length}::int[])`;
    }
    const contactResult = await db.query(
      `SELECT id, name, business_name, official_whatsapp_number, official_contact_name
       FROM clients
       ${filter}
       ORDER BY COALESCE(business_name, name), id`,
      params
    );
    const contacts = contactResult.rows
      .map((row) => ({ ...row, phone: normalizePhone(row.official_whatsapp_number) }))
      .filter((row) => row.phone);
    if (!contacts.length) return res.status(400).json({ error: 'No enabled client update contacts found.' });

    const broadcast = await db.query(
      `INSERT INTO operator_update_broadcasts
         (title, message, created_by_admin_id, created_by_name, total_recipients)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        clean(req.body.title, 180),
        clean(req.body.message, 4000),
        req.user?.id || null,
        req.user?.name || req.user?.email || null,
        contacts.length,
      ]
    );
    const broadcastId = broadcast.rows[0].id;
    const settings = await getOperatorSettings({ includeKey: true });
    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      const clientName = contact.business_name || contact.name || `Client ${contact.id}`;
      const personalized = `Hello ${contact.official_contact_name || clientName},\n\n${req.body.message}\n\n- Nexa Team`;
      try {
        await sendEvolutionText(settings, contact.phone, personalized);
        sent += 1;
        await db.query(
          `INSERT INTO operator_update_broadcast_recipients
             (broadcast_id, client_id, client_name, phone, status, sent_at)
           VALUES ($1, $2, $3, $4, 'sent', NOW())`,
          [broadcastId, contact.id, clientName, contact.phone]
        );
      } catch (err) {
        const detail = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message);
        failed += 1;
        await db.query(
          `INSERT INTO operator_update_broadcast_recipients
             (broadcast_id, client_id, client_name, phone, status, error)
           VALUES ($1, $2, $3, $4, 'failed', $5)`,
          [broadcastId, contact.id, clientName, contact.phone, String(detail || 'Failed').slice(0, 1000)]
        );
      }
    }

    const updated = await db.query(
      `UPDATE operator_update_broadcasts
       SET sent_count = $2, failed_count = $3, skipped_count = GREATEST(total_recipients - $2 - $3, 0)
       WHERE id = $1
       RETURNING *`,
      [broadcastId, sent, failed]
    );
    res.status(201).json(updated.rows[0]);
  } catch (err) {
    const detail = typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message);
    console.error('POST /operator-update-contacts/broadcasts error:', detail);
    res.status(500).json({ error: `Update broadcast failed: ${detail}` });
  }
});

module.exports = router;
