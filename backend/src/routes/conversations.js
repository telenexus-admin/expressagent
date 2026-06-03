const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { synthesizeVoice } = require('../services/openai');
const {
  sendWhatsAppMessage,
  uploadWhatsAppMedia,
  sendWhatsAppVoiceNote,
} = require('../services/whatsapp');
const { sendClientText, sendClientVoiceNote } = require('../services/clientEvolution');
const { sendSMS } = require('../services/sms');
const { sendInstallationConfirmedEmail } = require('../services/email');
const { markHumanTakeover, markAiActive } = require('../services/humanTakeoverRecovery');

router.use(authMiddleware, scopeMiddleware);

const REPLY_MODES = ['auto', 'text', 'voice', 'silent'];

async function ensureConversationReplyModeColumn() {
  await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reply_mode VARCHAR(20) NOT NULL DEFAULT 'auto'`);
  await db.query(`ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_reply_mode_check`);
  await db.query(`ALTER TABLE conversations ADD CONSTRAINT conversations_reply_mode_check CHECK (reply_mode IN ('auto', 'text', 'voice', 'silent'))`);
}

async function ensureClientSmsColumns() {
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(40)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_api_key TEXT`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_sender_id VARCHAR(80)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_configured_at TIMESTAMP WITH TIME ZONE`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS support_email VARCHAR(255)`);
  await db.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS installation_email_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
}

async function loadConversationWithClient(conversationId, scope) {
  await ensureClientSmsColumns();
  const result = await db.query(
    `SELECT
       conv.*,
       cl.id AS cl_id,
       cl.name AS cl_name,
       cl.business_name AS cl_business_name,
       cl.connection_provider AS cl_connection_provider,
       cl.evolution_instance_name AS cl_evolution_instance_name,
       cl.meta_phone_number_id AS cl_meta_phone_number_id,
       cl.meta_access_token AS cl_meta_access_token,
       cl.agent_name AS cl_agent_name,
       cl.voice_id AS cl_voice_id,
       cl.support_number AS cl_support_number,
       cl.sms_provider AS cl_sms_provider,
       cl.sms_api_key AS cl_sms_api_key,
       cl.sms_sender_id AS cl_sms_sender_id,
       cl.installation_email_enabled AS cl_installation_email_enabled
     FROM conversations conv
     JOIN clients cl ON cl.id = conv.client_id
     WHERE conv.id = $1`,
    [conversationId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!scope.isSuperadmin && row.client_id !== scope.clientId) return null;
  return {
    conversation: {
      id: row.id,
      customer_phone: row.customer_phone,
      customer_name: row.customer_name,
      status: row.status,
      reply_mode: row.reply_mode || 'auto',
      client_id: row.client_id,
      installation_state: row.installation_state,
      opted_out_at: row.opted_out_at,
    },
    client: {
      id: row.cl_id,
      name: row.cl_name,
      business_name: row.cl_business_name,
      connection_provider: row.cl_connection_provider,
      evolution_instance_name: row.cl_evolution_instance_name,
      meta_phone_number_id: row.cl_meta_phone_number_id,
      meta_access_token: row.cl_meta_access_token,
      agent_name: row.cl_agent_name,
      voice_id: row.cl_voice_id,
      support_number: row.cl_support_number,
      sms_provider: row.cl_sms_provider,
      sms_api_key: row.cl_sms_api_key,
      sms_sender_id: row.cl_sms_sender_id,
      installation_email_enabled: row.cl_installation_email_enabled,
    },
  };
}

router.get('/', async (req, res) => {
  try {
    await ensureConversationReplyModeColumn();
    const { status, search } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (!req.scope.isSuperadmin || req.scope.clientId) {
      params.push(req.scope.clientId);
      where += ` AND c.client_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      where += ` AND c.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (c.customer_phone ILIKE $${params.length} OR lm.content ILIKE $${params.length})`;
    }

    const query = `
      SELECT
        c.*,
        lm.content  AS last_message,
        lm.timestamp AS last_message_at,
        lm.role      AS last_message_role
      FROM conversations c
      LEFT JOIN LATERAL (
        SELECT content, timestamp, role
        FROM messages
        WHERE conversation_id = c.id
        ORDER BY timestamp DESC
        LIMIT 1
      ) lm ON true
      ${where}
      ORDER BY COALESCE(lm.timestamp, c.created_at) DESC
    `;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /conversations error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/messages', async (req, res) => {
  try {
    await ensureConversationReplyModeColumn();
    const ownership = await db.query(`SELECT client_id FROM conversations WHERE id = $1`, [req.params.id]);
    if (ownership.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (!req.scope.isSuperadmin && ownership.rows[0].client_id !== req.scope.clientId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const result = await db.query(
      `SELECT
         m.*,
         a.id AS attachment_id,
         a.media_type AS attachment_media_type,
         a.mime_type AS attachment_mime_type,
         a.filename AS attachment_filename
       FROM messages m
       LEFT JOIN LATERAL (
         SELECT id, media_type, mime_type, filename
         FROM message_attachments
         WHERE message_id = m.id
         ORDER BY id ASC
         LIMIT 1
       ) a ON true
       WHERE m.conversation_id = $1
       ORDER BY m.timestamp ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET messages error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/messages/:messageId/attachment', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         a.mime_type,
         a.filename,
         a.data,
         c.client_id
       FROM message_attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = $1
       LIMIT 1`,
      [req.params.messageId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Attachment not found' });

    const attachment = result.rows[0];
    if (!req.scope.isSuperadmin && attachment.client_id !== req.scope.clientId) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename || 'attachment'}"`);
    res.send(attachment.data);
  } catch (err) {
    console.error('GET message attachment error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/reply', async (req, res) => {
  const { message, mode } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message content is required' });

  try {
    await ensureConversationReplyModeColumn();
    const loaded = await loadConversationWithClient(req.params.id, req.scope);
    if (!loaded) return res.status(404).json({ error: 'Conversation not found' });

    const { conversation, client } = loaded;
    const selectedMode = REPLY_MODES.includes(mode) ? mode : conversation.reply_mode || 'auto';
    const shouldSendVoice = selectedMode === 'voice';
    const cleanMessage = message.trim();

    if (shouldSendVoice) {
      const audio = await synthesizeVoice(cleanMessage, client.voice_id || 'alloy');
      if (client.connection_provider === 'evolution') {
        await sendClientVoiceNote(client, conversation.customer_phone, audio);
      } else {
        const mediaId = await uploadWhatsAppMedia(
          client.meta_phone_number_id,
          client.meta_access_token,
          audio,
          'audio/ogg',
          'reply.ogg'
        );
        await sendWhatsAppVoiceNote(client.meta_phone_number_id, client.meta_access_token, conversation.customer_phone, mediaId);
      }
    } else if (client.connection_provider === 'evolution') {
      await sendClientText(client, conversation.customer_phone, cleanMessage);
    } else {
      await sendWhatsAppMessage(
        client.meta_phone_number_id,
        client.meta_access_token,
        conversation.customer_phone,
        cleanMessage
      );
    }

    await db.query(
      `INSERT INTO messages (conversation_id, role, content, sender_name, timestamp)
       VALUES ($1, 'admin', $2, $3, NOW())`,
      [req.params.id, shouldSendVoice ? `[Voice reply] ${cleanMessage}` : cleanMessage, req.user.name]
    );
    await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [req.params.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('POST reply error:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.patch('/:id/reply-mode', async (req, res) => {
  const { reply_mode } = req.body;
  if (!REPLY_MODES.includes(reply_mode)) {
    return res.status(400).json({ error: `Reply mode must be one of: ${REPLY_MODES.join(', ')}` });
  }

  try {
    await ensureConversationReplyModeColumn();
    const loaded = await loadConversationWithClient(req.params.id, req.scope);
    if (!loaded) return res.status(404).json({ error: 'Conversation not found' });

    const result = await db.query(
      `UPDATE conversations SET reply_mode = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [reply_mode, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH reply mode error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/confirm-installation', async (req, res) => {
  try {
    const loaded = await loadConversationWithClient(req.params.id, req.scope);
    if (!loaded) return res.status(404).json({ error: 'Conversation not found' });
    const { conversation, client } = loaded;

    const installationRes = await db.query(
      `SELECT id, customer_email FROM escalations
       WHERE conversation_id = $1 AND type = 'installation'
       ORDER BY created_at DESC LIMIT 1`,
      [conversation.id]
    );
    const installation = installationRes.rows[0] || null;

    const firstName = (conversation.customer_name || '').split(' ')[0].trim();
    const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
    const signoff = (client.agent_name || '').trim() || 'Support';

    const customMessage = (req.body?.message || '').trim();
    const message = customMessage || `${greeting} your installation has been confirmed. Our team will reach out shortly to coordinate the visit. — ${signoff}`;

    await sendSMS(conversation.customer_phone, message, { client });
    await db.query(
      `INSERT INTO messages (conversation_id, role, content, sender_name, timestamp)
       VALUES ($1, 'admin', $2, $3, NOW())`,
      [conversation.id, `[Installation confirmation SMS] ${message}`, req.user.name]
    );
    await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversation.id]);

    let emailResult = { status: 'skipped', error: null };
    if (installation) {
      emailResult = await sendInstallationConfirmedEmail(client, {
        name: conversation.customer_name,
        email: installation.customer_email,
      });
      if (emailResult.status === 'sent') console.log(`Installation confirmation email sent to ${installation.customer_email}.`);
      else if (emailResult.status === 'failed') console.error(`Installation confirmation email to ${installation.customer_email} failed:`, emailResult.error);
    }

    await db.query(
      `UPDATE escalations SET resolved_at = NOW(), confirmation_email_status = $2, confirmation_email_error = $3
       WHERE conversation_id = $1 AND type = 'installation' AND resolved_at IS NULL`,
      [conversation.id, emailResult.status, emailResult.error]
    );

    res.json({ success: true, message, email_status: emailResult.status });
  } catch (err) {
    console.error('POST /conversations/:id/confirm-installation error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to send confirmation SMS' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const valid = ['active', 'resolved', 'human_takeover'];
  if (!valid.includes(status)) return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });

  try {
    const ownership = await db.query(`SELECT client_id FROM conversations WHERE id = $1`, [req.params.id]);
    if (ownership.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (!req.scope.isSuperadmin && ownership.rows[0].client_id !== req.scope.clientId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (status === 'human_takeover') await markHumanTakeover(req.params.id);
    else if (status === 'active') await markAiActive(req.params.id);
    else {
      await db.query(
        `UPDATE conversations SET status = $1, human_takeover_at = NULL, updated_at = NOW() WHERE id = $2`,
        [status, req.params.id]
      );
    }
    const result = await db.query(`SELECT * FROM conversations WHERE id = $1`, [req.params.id]);
    if (status === 'resolved') {
      await db.query(
        `UPDATE escalations SET resolved_at = NOW() WHERE conversation_id = $1 AND resolved_at IS NULL`,
        [req.params.id]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH status error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
