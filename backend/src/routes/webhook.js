const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateAIResponse, analyzeSupportImage, transcribeAudio, synthesizeVoice, classifyComplaint, classifyIntent, openAIModelSummary } = require('../services/openai');
const {
  sendWhatsAppMessage,
  sendWhatsAppList,
  downloadWhatsAppMedia,
  uploadWhatsAppMedia,
  sendWhatsAppVoiceNote,
  sendWhatsAppMediaMessage,
} = require('../services/whatsapp');
const { sendSMS } = require('../services/sms');
const { sendInstallationRequestEmail, sendWorkflowEmployeeEmail } = require('../services/email');
const { sendClientText } = require('../services/clientEvolution');
const { createOrUpdateTicket, ticketFromComplaint, ticketFromIntent } = require('../services/tickets');
const { notifyClientAdmins } = require('../services/pushNotifications');
const { answerBillingQuestion, buildBillingContext } = require('../services/billing');
const { matchingMedia, mediaByTags, stripMediaTags, uniqueMediaItems, welcomeMedia } = require('../services/mediaLibrary');
const { buildCustomerIntakeUrl } = require('../services/customerIntake');

function formatErr(err) {
  return typeof err.response?.data === 'object'
    ? JSON.stringify(err.response.data)
    : (err.response?.data || err.message || 'unknown error');
}

function fallbackAiReply(client, messageText = '') {
  const name = String(client.agent_name || 'the assistant').trim();
  const lower = String(messageText || '').toLowerCase();
  if (isPackageInquiry(lower)) {
    return `Here are our current packages:\n${PLAN_LIST_TEXT}`;
  }
  if (/\b(no internet|not working|down|slow|offline|router|los|red light|connection)\b/.test(lower)) {
    return `I have received your internet issue. Please restart the router once, then send a clear photo of the router lights if it is still not working.`;
  }
  if (/\b(pay|payment|paid|bill|billing|expire|expiry|plan|package|recharge)\b/.test(lower)) {
    return `I have received your billing question. Please send your registered phone number or account number so I can check it.`;
  }
  return `I have received your message. Please share one more detail so ${name} can help you properly.`;
}

function runAfterReply(label, task) {
  setImmediate(() => {
    task().catch((err) => {
      console.error(`${label} failed:`, err.message || err);
    });
  });
}

async function notifySupport(client, supportNumber, message) {
  if (!supportNumber) {
    return { notifyStatus: 'no_support_number', notifyError: null };
  }

  const results = { whatsapp: null, sms: null };

  try {
    await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, supportNumber, message);
    results.whatsapp = 'sent';
  } catch (err) {
    results.whatsapp = 'failed';
    results.whatsappError = formatErr(err);
    console.error(`Support WhatsApp to ${supportNumber} failed:`, results.whatsappError);
  }

  try {
    await sendSMS(supportNumber, message, { client });
    results.sms = 'sent';
  } catch (err) {
    results.sms = 'failed';
    results.smsError = formatErr(err);
    console.error(`Support SMS to ${supportNumber} failed:`, results.smsError);
  }

  const notifyStatus = results.whatsapp === 'sent' || results.sms === 'sent' ? 'sent' : 'failed';
  const errorParts = [];
  if (results.whatsapp !== 'sent') errorParts.push(`whatsapp: ${results.whatsappError || 'failed'}`);
  if (results.sms !== 'sent') errorParts.push(`sms: ${results.smsError || 'failed'}`);
  const notifyError = errorParts.length ? errorParts.join(' | ') : null;

  return { notifyStatus, notifyError };
}

async function dispatchToEmployee({ client, conversation, intent, messageText, phoneNumber }) {
  if (!intent || intent === 'general_inquiry') return;

  try {
    await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS notification_channels JSONB NOT NULL DEFAULT '["sms"]'::jsonb`);
    await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await db.query(`ALTER TABLE workflow_dispatches ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await db.query(`UPDATE workflow_routes SET employee_ids = jsonb_build_array(employee_id) WHERE employee_id IS NOT NULL AND employee_ids = '[]'::jsonb`);
    const routeRes = await db.query(
      `SELECT wr.employee_id, wr.employee_ids, wr.is_enabled, wr.notification_channels
       FROM workflow_routes wr
       WHERE wr.client_id = $1 AND wr.intent_key = $2`,
      [client.id, intent]
    );
    const route = routeRes.rows[0];
    const employeeIds = normalizeWorkflowEmployeeIds(route?.employee_ids, route?.employee_id);
    if (!route || !route.is_enabled || employeeIds.length === 0) return;

    const employeesRes = await db.query(
      `SELECT id AS emp_id, name AS emp_name, phone AS emp_phone, email AS emp_email
       FROM employees
       WHERE client_id = $1 AND is_active = TRUE AND id = ANY($2::int[])
       ORDER BY name ASC`,
      [client.id, employeeIds]
    );
    const employees = employeesRes.rows;
    if (employees.length === 0) return;

    const existing = await db.query(
      `SELECT id FROM workflow_dispatches WHERE conversation_id = $1 AND intent_key = $2`,
      [conversation.id, intent]
    );
    if (existing.rows.length > 0) return;

    const nameLine = conversation.customer_name ? `Customer: ${conversation.customer_name}\n` : '';
    const intentLabelMap = {
      new_installation: 'New installation request',
      payment_billing: 'Payment/billing issue',
      technical_issue: 'Technical problem',
      human_request: 'Customer wants a human agent',
      compliment_feedback: 'Compliment/feedback',
    };
    const heading = intentLabelMap[intent] || 'Customer message';
    const notice =
      `${heading}\n\n` +
      nameLine +
      `Customer number: +${phoneNumber}\n` +
      `Their message: "${messageText}"\n\n` +
      `Please follow up directly.`;

    const channels = normalizeWorkflowChannels(route.notification_channels);
    const allResults = await Promise.all(employees.map(async (employee) => ({
      employee,
      results: await sendWorkflowNotice({ client, employee, channels, subject: heading, notice }),
    })));
    const notifyStatus = allResults.some(({ results }) => Object.values(results).some((result) => result.status === 'sent')) ? 'sent' : 'failed';
    const notifyError = allResults.flatMap(({ employee, results }) =>
      Object.entries(results)
        .filter(([, result]) => result.status !== 'sent')
        .map(([channel, result]) => `${employee.emp_name} ${channel}: ${result.error || result.status}`)
    ).join(' | ') || null;
    console.log(`[client ${client.id}] Dispatched intent="${intent}" to ${employees.length} employee(s) via ${channels.join(', ')}.`);

    await db.query(
      `INSERT INTO workflow_dispatches
         (conversation_id, client_id, intent_key, employee_id, employee_ids, customer_phone,
          trigger_message, notify_status, notify_error)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       ON CONFLICT (conversation_id, intent_key) DO NOTHING`,
      [conversation.id, client.id, intent, employees[0].emp_id, JSON.stringify(employees.map((employee) => employee.emp_id)), phoneNumber, messageText, notifyStatus, notifyError]
    );
  } catch (err) {
    console.error('dispatchToEmployee error:', err.message);
  }
}

async function deliverReply(client, phoneNumber, text, asVoice, voiceId) {
  if (!asVoice) {
    await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, text);
    return;
  }
  try {
    const voice = voiceId || client.voice_id || 'alloy';
    const audio = await synthesizeVoice(text, voice);
    const mediaId = await uploadWhatsAppMedia(client.meta_phone_number_id, client.meta_access_token, audio, 'audio/ogg', 'reply.ogg');
    await sendWhatsAppVoiceNote(client.meta_phone_number_id, client.meta_access_token, phoneNumber, mediaId);
  } catch (err) {
    console.error('Voice reply failed, falling back to text:', err.response?.data || err.message);
    await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, text);
  }
}

const OPT_OUT_KEYWORDS = new Set(['stop', 'unsubscribe', 'cancel', 'quit', 'end', 'acha', 'simama', 'koma']);
const RESUME_KEYWORDS = new Set(['start', 'resume', 'subscribe', 'anza', 'endelea']);
const MENU_KEYWORDS = new Set(['menu', 'options', 'services']);
const HUMAN_KEYWORDS = new Set(['human', 'agent', 'person', 'representative', 'support', 'mtu', 'mwakilishi', 'msaada']);
const HUMAN_ESCALATION_REGEX = new RegExp(`\\b(${[...HUMAN_KEYWORDS].join('|')})\\b`, 'i');
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PLAN_LIST_TEXT =
  `• 10 Mbps – KSh 1,500/month\n` +
  `• 15 Mbps – KSh 2,000/month\n` +
  `• 20 Mbps – KSh 2,500/month\n` +
  `• 30 Mbps – KSh 3,000/month\n` +
  `• 40 Mbps – KSh 4,000/month\n` +
  `Installation fee: KSh 1,000 (one-off).\n` +
  `All packages are unlimited with dedicated download & upload speeds.`;

function isPackageInquiry(text) {
  return /\b(package|packages|plans|price|prices|pricing|cost|costs|mbps|offer|offers|charge|charges)\b/i.test(String(text || ''));
}

function isTechnicalIssue(text) {
  return /\b(no internet|not working|internet.*down|down|slow|offline|router|los|red light|connection|disconnect|disconnecting|wifi|wi-fi|signal)\b/i.test(String(text || ''));
}

const INSTALL_MARKER_RE = /<<INSTALL_DETAILS:\s*(\{[\s\S]*?\})\s*>>/;
function stripInstallMarker(text) {
  return text.replace(INSTALL_MARKER_RE, '').trim();
}

function imageFilename(mimeType) {
  const subtype = String(mimeType || 'image/jpeg').split('/')[1]?.split(';')[0] || 'jpg';
  const safeSubtype = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  return `whatsapp-image.${safeSubtype === 'jpeg' ? 'jpg' : safeSubtype}`;
}

function audioFilename(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  if (value.includes('mpeg')) return 'voice-note.mp3';
  if (value.includes('mp4')) return 'voice-note.m4a';
  if (value.includes('wav')) return 'voice-note.wav';
  if (value.includes('webm')) return 'voice-note.webm';
  return 'voice-note.ogg';
}

async function transcribeDownloadedVoice(buffer, mimeType) {
  return (await transcribeAudio(buffer, audioFilename(mimeType), mimeType || 'audio/ogg')).trim();
}

function normalizeWorkflowChannels(value) {
  const raw = Array.isArray(value) ? value : ['sms'];
  const allowed = new Set(['sms', 'email', 'whatsapp']);
  const clean = raw.map((item) => String(item || '').toLowerCase()).filter((item) => allowed.has(item));
  return [...new Set(clean)].length ? [...new Set(clean)] : ['sms'];
}

function normalizeWorkflowEmployeeIds(value, fallback = null) {
  const raw = Array.isArray(value) ? value : [];
  const ids = raw.map((item) => parseInt(item, 10)).filter((item) => Number.isInteger(item) && item > 0);
  if (ids.length === 0 && fallback) ids.push(parseInt(fallback, 10));
  return [...new Set(ids)].filter((item) => Number.isInteger(item) && item > 0);
}

async function sendWorkflowNotice({ client, employee, channels, subject, notice }) {
  const results = {};
  await Promise.all(channels.map(async (channel) => {
    try {
      if (channel === 'sms') {
        if (!employee.emp_phone) throw new Error('Assigned employee has no phone number');
        await sendSMS(employee.emp_phone, notice, { client });
      } else if (channel === 'email') {
        const result = await sendWorkflowEmployeeEmail(client, { email: employee.emp_email }, { subject, message: notice });
        if (result.status !== 'sent') throw new Error(result.error || result.status);
      } else if (channel === 'whatsapp') {
        if (!employee.emp_phone) throw new Error('Assigned employee has no phone number');
        if (client.connection_provider === 'evolution') await sendClientText(client, employee.emp_phone, notice);
        else await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, employee.emp_phone, notice);
      }
      results[channel] = { status: 'sent', error: null };
    } catch (err) {
      results[channel] = { status: 'failed', error: formatErr(err) };
      console.error(`Workflow ${channel} to employee ${employee.emp_name} failed:`, results[channel].error);
    }
  }));
  return results;
}

async function deliverMediaItems(client, phoneNumber, items, conversationId, reason = 'media') {
  for (const item of items || []) {
    try {
      await sendWhatsAppMediaMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, item);
      await persistOutgoing(conversationId, `[Sent ${item.media_type}: ${item.title}]`);
      console.log(`[client ${client.id}] Sent ${reason} media "${item.title}" to ${phoneNumber}.`);
    } catch (err) {
      console.error(`Failed to send media "${item.title}" to ${phoneNumber}:`, formatErr(err));
    }
  }
}

function shouldReplyAsVoice(replyMode, inboundIsVoice) {
  if (replyMode === 'voice') return true;
  if (replyMode === 'text' || replyMode === 'silent') return false;
  return Boolean(inboundIsVoice);
}

const INSTALL_REGEX = new RegExp(
  [
    '\\b(want|need|looking for|book|schedule|please|can\\s*(?:you|i)|how\\s*(?:do|to))\\b' +
      '[^.?!]{0,40}\\b(install|installation|connection|connect|fibre|fiber|subscribe|register|sign\\s*up)\\b',
    '\\b(install|installation|connection|connect|subscribe|register|sign\\s*up)\\s+me\\b',
    '\\b(nataka|naomba|nahitaji|tafadhali)\\b[^.?!]{0,40}\\b(installation|kuunganishwa|usajili)\\b',
    '\\bniunganish(e|wa|ie|ieni|eni)\\b',
  ].join('|'),
  'i'
);

const WELCOME_MENU_ROWS = [
  {
    id: 'express_installation',
    title: 'Installation',
    description: 'Get connected or request a new setup.',
    text: 'I want to request a new installation.',
  },
  {
    id: 'express_billing',
    title: 'Billing & Payments',
    description: 'Check payments, expiry, plan or account status.',
    text: 'I need help with billing or payments.',
  },
  {
    id: 'express_technical',
    title: 'Technical Support',
    description: 'Internet down, slow speeds, router or fibre issue.',
    text: 'My internet has a technical issue.',
  },
  {
    id: 'express_general',
    title: 'General Inquiry',
    description: 'Ask about packages, coverage or anything else.',
    text: 'I have a general inquiry.',
  },
];

function getWelcomeMenuConfig(client) {
  const configured = client.welcome_menu_config && typeof client.welcome_menu_config === 'object'
    ? client.welcome_menu_config
    : {};
  const options = Array.isArray(configured.options) ? configured.options : WELCOME_MENU_ROWS;
  const rows = options
    .slice(0, 10)
    .map((row, index) => ({
      id: String(row.id || WELCOME_MENU_ROWS[index]?.id || `welcome_option_${index + 1}`).trim().slice(0, 200),
      title: String(row.title || '').trim().slice(0, 24),
      description: String(row.description || '').trim().slice(0, 72),
      text: String(row.text || '').trim(),
    }))
    .filter((row) => row.id && row.title && row.text);

  return {
    enabled: client.welcome_menu_enabled !== false,
    body: String(configured.body || '').trim(),
    buttonText: String(configured.button_text || 'Choose option').trim() || 'Choose option',
    footer: String(configured.footer || '').trim(),
    sectionTitle: String(configured.section_title || 'How can I help?').trim() || 'How can I help?',
    rows: rows.length > 0 ? rows : WELCOME_MENU_ROWS,
  };
}

function welcomeMenuText(client, selectedId) {
  const config = getWelcomeMenuConfig(client);
  return new Map(config.rows.map((row) => [row.id, row.text])).get(selectedId);
}

async function sendWelcomeMenu(client, phoneNumber, conversationId) {
  const config = getWelcomeMenuConfig(client);
  if (!config.enabled) return false;

  const agentName = (client.agent_name || 'Imani').trim();
  const business = (client.business_name || client.name || 'Expressnet').trim();
  const body = config.body ||
    `Hi, I'm ${agentName}, your ${business} assistant.\n\n` +
      `What would you like help with today?`;
  const visibleBody = stripMediaTags(body) || `Hi, I'm ${agentName}, your ${business} assistant.`;
  const visibleFooter = stripMediaTags(config.footer || `${business} support`) || `${business} support`;

  await sendWhatsAppList(
    client.meta_phone_number_id,
    client.meta_access_token,
    phoneNumber,
    visibleBody,
    config.buttonText,
    [{ title: config.sectionTitle, rows: config.rows }],
    visibleFooter
  );
  await persistOutgoing(conversationId, `${visibleBody} [${config.rows.map((row) => row.title).join(' | ')}]`);
  const taggedAttachments = await mediaByTags(client.id, `${body}\n${config.footer || ''}\n${client.system_prompt || ''}`);
  const attachments = uniqueMediaItems(taggedAttachments, await welcomeMedia(client.id));
  await deliverMediaItems(client, phoneNumber, attachments, conversationId, 'welcome');
  return true;
}

router.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe' || !token) return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await db.query(`SELECT id, name FROM clients WHERE meta_verify_token = $1 LIMIT 1`, [token]);
    if (result.rows.length > 0) {
      console.log(`Webhook verified by Meta for client "${result.rows[0].name}" (id=${result.rows[0].id}).`);
      return res.status(200).send(challenge);
    }
  } catch (err) {
    console.error('Webhook verify lookup failed:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }

  console.warn('Webhook verification failed — no client matched the verify_token.');
  return res.status(403).json({ error: 'Forbidden' });
});

async function findClientByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  const result = await db.query(`SELECT * FROM clients WHERE meta_phone_number_id = $1 AND status = 'active' LIMIT 1`, [phoneNumberId]);
  return result.rows[0] || null;
}

async function findOrCreateConversation(clientId, phoneNumber, profileName) {
  await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reply_mode VARCHAR(20) NOT NULL DEFAULT 'auto'`);
  const cleanName = (profileName || '').trim() || null;
  const existing = await db.query(
    `SELECT * FROM conversations
     WHERE customer_phone = $1 AND client_id = $2 AND status != 'resolved'
     ORDER BY created_at DESC LIMIT 1`,
    [phoneNumber, clientId]
  );
  if (existing.rows.length > 0) {
    const conv = existing.rows[0];
    if (cleanName && cleanName !== conv.customer_name) {
      const updated = await db.query(`UPDATE conversations SET customer_name = $1 WHERE id = $2 RETURNING *`, [cleanName, conv.id]);
      return { conversation: updated.rows[0], isNew: false };
    }
    return { conversation: conv, isNew: false };
  }
  const inserted = await db.query(
    `INSERT INTO conversations (customer_phone, customer_name, status, client_id)
     VALUES ($1, $2, 'active', $3) RETURNING *`,
    [phoneNumber, cleanName, clientId]
  );
  return { conversation: inserted.rows[0], isNew: true };
}

async function persistOutgoing(conversationId, content) {
  await db.query(`INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'assistant', $2, NOW())`, [conversationId, content]);
  await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
}

router.post('/', async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const incomingMessages = value?.messages;
    if (!incomingMessages || incomingMessages.length === 0) return;

    const phoneNumberId = value?.metadata?.phone_number_id;
    const client = await findClientByPhoneNumberId(phoneNumberId);
    if (!client) {
      console.warn(`No active client found for phone_number_id=${phoneNumberId} — dropping message.`);
      return;
    }

    const message = incomingMessages[0];
    const phoneNumber = message.from;
    const profileName = value?.contacts?.[0]?.profile?.name;
    const timestamp = new Date(parseInt(message.timestamp, 10) * 1000);
    const { conversation, isNew } = await findOrCreateConversation(client.id, phoneNumber, profileName);

    let messageText;
    let inboundIsVoice = false;
    let inboundIsImage = false;
    let inboundImageBuffer = null;
    let inboundImageMimeType = null;
    let inboundImageCaption = '';
    let inboundVoiceBuffer = null;
    let inboundVoiceMimeType = null;
    if (message.type === 'audio' || message.type === 'voice') {
      const mediaId = message.audio?.id || message.voice?.id;
      inboundIsVoice = true;
      try {
        const { buffer, mimeType } = await downloadWhatsAppMedia(client.meta_access_token, mediaId);
        inboundVoiceBuffer = buffer;
        inboundVoiceMimeType = mimeType || 'audio/ogg';
        const transcript = await transcribeDownloadedVoice(buffer, mimeType);
        if (!transcript) throw new Error('Voice note transcription was empty.');
        messageText = transcript;
        console.log(`[client ${client.id}] Transcribed voice from ${phoneNumber}: "${messageText}"`);
      } catch (err) {
        console.error('Failed to transcribe inbound audio:', err.response?.data || err.message);
        const failedVoiceMessage = await db.query(
          `INSERT INTO messages (conversation_id, role, content, timestamp)
           VALUES ($1, 'user', $2, $3)
           RETURNING id`,
          [conversation.id, '[voice note - transcription failed]', timestamp]
        );
        if (inboundVoiceBuffer) {
          await db.query(
            `INSERT INTO message_attachments (message_id, media_type, mime_type, filename, data)
             VALUES ($1, 'audio', $2, $3, $4)`,
            [
              failedVoiceMessage.rows[0].id,
              inboundVoiceMimeType || 'audio/ogg',
              audioFilename(inboundVoiceMimeType),
              inboundVoiceBuffer,
            ]
          );
        }
        if (conversation.opted_out_at) return;
        const notice = "Sorry, I couldn't understand that voice note. Could you send it again or type your message?";
        await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, notice);
        await persistOutgoing(conversation.id, notice);
        return;
      }
    } else if (message.type === 'image' && client.photo_troubleshooting_enabled !== false) {
      const mediaId = message.image?.id;
      inboundImageCaption = String(message.image?.caption || '').trim();
      try {
        const { buffer, mimeType } = await downloadWhatsAppMedia(client.meta_access_token, mediaId);
        if (!String(mimeType || '').startsWith('image/')) throw new Error('Received media is not an image.');
        inboundImageBuffer = buffer;
        inboundImageMimeType = mimeType;
        inboundIsImage = true;
        messageText = inboundImageCaption || '[Customer sent a router/support photo for checking]';
        console.log(`[client ${client.id}] Received support image from ${phoneNumber}${inboundImageCaption ? `: "${inboundImageCaption}"` : '.'}`);
      } catch (err) {
        console.error('Failed to process inbound support image:', err.response?.data || err.message);
        const notice = "Sorry, I couldn't open that photo. Please send a clear photo again, showing the router lights and cables.";
        await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, notice);
        await persistOutgoing(conversation.id, notice);
        return;
      }
    } else if (message.type === 'text') {
      messageText = message.text.body.trim();
      console.log(`[client ${client.id}] Incoming from ${phoneNumber}: "${messageText}"`);
    } else if (message.type === 'interactive') {
      const reply = message.interactive?.list_reply || message.interactive?.button_reply;
      const selectedId = reply?.id;
      messageText = welcomeMenuText(client, selectedId) || reply?.title || '';
      if (!messageText) {
        console.log(`[client ${client.id}] Ignoring unsupported interactive reply from ${phoneNumber}.`);
        return;
      }
      console.log(`[client ${client.id}] Incoming menu choice from ${phoneNumber}: "${messageText}" (${selectedId || 'no-id'})`);
    } else {
      console.log(`[client ${client.id}] Ignoring unsupported message type (${message.type}) from ${phoneNumber} without sending a customer reply.`);
      return;
    }

    const normalized = messageText.toLowerCase();
    const persistedMessageText = inboundIsImage
      ? `[Image received] ${inboundImageCaption || 'Customer sent a router/support photo for checking.'}`
      : inboundIsVoice
      ? `[Voice note] ${messageText}`
      : messageText;
    const storedMessage = await db.query(
      `INSERT INTO messages (conversation_id, role, content, timestamp)
       VALUES ($1, 'user', $2, $3)
       RETURNING id`,
      [conversation.id, persistedMessageText, timestamp]
    );
    if (inboundIsImage && inboundImageBuffer) {
      await db.query(
        `INSERT INTO message_attachments (message_id, media_type, mime_type, filename, data)
         VALUES ($1, 'image', $2, $3, $4)`,
        [
          storedMessage.rows[0].id,
          inboundImageMimeType || 'image/jpeg',
          imageFilename(inboundImageMimeType),
          inboundImageBuffer,
        ]
      );
    } else if (inboundIsVoice && inboundVoiceBuffer) {
      await db.query(
        `INSERT INTO message_attachments (message_id, media_type, mime_type, filename, data)
         VALUES ($1, 'audio', $2, $3, $4)`,
        [
          storedMessage.rows[0].id,
          inboundVoiceMimeType || 'audio/ogg',
          audioFilename(inboundVoiceMimeType),
          inboundVoiceBuffer,
        ]
      );
    }
    await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversation.id]);
    runAfterReply('Push notification for inbound Meta message', () => notifyClientAdmins({
      clientId: client.id,
      conversationId: conversation.id,
      customerName: conversation.customer_name,
      customerPhone: phoneNumber,
      messageText: persistedMessageText,
    }));
    const replyMode = conversation.reply_mode || 'auto';
    const replyAsVoice = shouldReplyAsVoice(replyMode, inboundIsVoice);
    console.log(
      `[client ${client.id}] Conversation state for ${phoneNumber}: ` +
      `id=${conversation.id}, status=${conversation.status}, reply_mode=${replyMode}, opted_out=${Boolean(conversation.opted_out_at)}, installation_state=${conversation.installation_state || 'none'}`
    );

    if (conversation.opted_out_at && RESUME_KEYWORDS.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NULL WHERE id = $1`, [conversation.id]);
      const reply = "You're resubscribed. How can I help you today?";
      await deliverReply(client, phoneNumber, reply, replyAsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }
    if (conversation.opted_out_at) {
      console.log(`[client ${client.id}] Reply skipped for ${phoneNumber}: conversation is opted out.`);
      return;
    }
    if (OPT_OUT_KEYWORDS.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NOW() WHERE id = $1`, [conversation.id]);
      const reply = "You've been unsubscribed. You will not receive further messages from this assistant. Reply START at any time to resume.";
      await deliverReply(client, phoneNumber, reply, replyAsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }
    if (conversation.status === 'human_takeover') {
      console.log(`[client ${client.id}] Reply skipped for ${phoneNumber}: conversation is in human takeover.`);
      return;
    }
    if (replyMode === 'silent') {
      console.log(`[client ${client.id}] Reply skipped for ${phoneNumber}: reply mode is silent.`);
      return;
    }

    const supportNumber = (client.support_number || '').replace(/[^0-9]/g, '');
    if (!inboundIsImage && message.type !== 'interactive' && (isNew || MENU_KEYWORDS.has(normalized))) {
      const sentMenu = await sendWelcomeMenu(client, phoneNumber, conversation.id);
      if (sentMenu) {
        console.log(`Welcome menu sent to ${phoneNumber}.`);
        return;
      }
    }

    const voiceId = (client.voice_id || '').trim() || 'alloy';
    if (!inboundIsImage && isPackageInquiry(messageText)) {
      const reply = `Here are our current packages:\n${PLAN_LIST_TEXT}`;
      await deliverReply(client, phoneNumber, reply, replyAsVoice, voiceId);
      await persistOutgoing(conversation.id, reply);
      console.log(`Package list reply sent to ${phoneNumber}.`);
      return;
    }

    if (!inboundIsImage && isTechnicalIssue(messageText)) {
      const reply =
        `Sorry about that. Please try this:\n` +
        `1. Restart the router and wait 3 minutes.\n` +
        `2. Check if the LOS light is red.\n` +
        `3. Send a clear photo of the router lights.\n\n` +
        `I will guide you from there.`;
      await deliverReply(client, phoneNumber, reply, replyAsVoice, voiceId);
      await persistOutgoing(conversation.id, reply);
      console.log(`Technical issue reply sent to ${phoneNumber}.`);
      return;
    }

    if (!inboundIsImage && HUMAN_ESCALATION_REGEX.test(normalized)) {
      await db.query(`UPDATE conversations SET status = 'human_takeover' WHERE id = $1`, [conversation.id]);
      const nameLine = conversation.customer_name ? `Customer name: ${conversation.customer_name}\n` : '';
      const notice = `Customer support request\n\n${nameLine}Customer number: +${phoneNumber}\nTheir message: "${messageText}"\n\nPlease reach out to them directly.`;
      const { notifyStatus, notifyError } = await notifySupport(client, supportNumber, notice);
      await db.query(
        `INSERT INTO escalations (conversation_id, client_id, customer_phone, customer_name, trigger_message, support_number, notify_status, notify_error, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'human')`,
        [conversation.id, client.id, phoneNumber, conversation.customer_name, messageText, supportNumber || null, notifyStatus, notifyError]
      );
      runAfterReply('Human support ticket creation', () => createOrUpdateTicket({
        clientId: client.id,
        conversationId: conversation.id,
        customerPhone: phoneNumber,
        customerName: conversation.customer_name,
        title: 'Human support requested',
        category: 'human_support',
        priority: 'high',
        intent: 'human_request',
        source: 'whatsapp_meta',
        summary: messageText,
        messageText,
      }));
      const reply = supportNumber
        ? "Thanks — I've forwarded your request to our customer support team. Someone will reach out to you shortly."
        : "Thanks — I've flagged your request for our team. Someone will reach out to you shortly.";
      await deliverReply(client, phoneNumber, reply, inboundIsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }

    let installationState = conversation.installation_state || null;
    if (installationState === 'collecting') {
      await db.query(`UPDATE conversations SET installation_state = NULL WHERE id = $1`, [conversation.id]);
      installationState = null;
      console.log(`[client ${client.id}] Cleared stale installation collection state for ${phoneNumber}.`);
    }
    if (!inboundIsImage && !installationState && INSTALL_REGEX.test(normalized)) {
      const intakeUrl = buildCustomerIntakeUrl(client, { phone: phoneNumber, name: conversation.customer_name });
      if (intakeUrl) {
        const reply =
          `Please complete this installation form:\n${intakeUrl}\n\n` +
          `It collects your ID scan, location and contact details for the setup team.`;
        await deliverReply(client, phoneNumber, reply, replyAsVoice, voiceId);
        await persistOutgoing(conversation.id, reply);
        console.log(`Installation intake form link sent to ${phoneNumber}.`);
        return;
      }
    }

    if (!inboundIsImage && installationState !== 'collecting') {
      console.log(`[client ${client.id}] Billing direct check for ${phoneNumber}.`);
      let billingReply = await answerBillingQuestion({ clientId: client.id, customerPhone: phoneNumber, messageText });
      if (billingReply) {
        const taggedMedia = await mediaByTags(client.id, `${messageText}\n${billingReply}`);
        billingReply = stripMediaTags(billingReply) || 'Here is the media I found for you.';
        await deliverReply(client, phoneNumber, billingReply, replyAsVoice, voiceId);
        await persistOutgoing(conversation.id, billingReply);
        const mediaMatches = await matchingMedia(client.id, `${messageText}\n${billingReply}`);
        await deliverMediaItems(client, phoneNumber, uniqueMediaItems(taggedMedia, mediaMatches), conversation.id, 'matched');
        console.log(`Billing reply sent to ${phoneNumber}.`);
        return;
      }
      console.log(`[client ${client.id}] No direct billing reply for ${phoneNumber}.`);
    }

    const historyResult = await db.query(
      `SELECT role, content FROM (
         SELECT role, content, timestamp FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20
       ) recent ORDER BY timestamp ASC`,
      [conversation.id]
    );
    const basePrompt = client.system_prompt || 'You are a helpful customer support agent.';
    const agentName = (client.agent_name || '').trim();
    let systemPrompt = basePrompt;
    if (agentName) {
      systemPrompt = `Your name is ${agentName}. You are the official AI assistant for ${client.business_name || client.name || 'this ISP'}.\n\n${systemPrompt}`;
    }
    if (conversation.customer_name) {
      systemPrompt += `\n\nThe customer's WhatsApp display name is "${conversation.customer_name}". Use their name naturally when useful, without repeating a greeting in every reply.`;
    }
    systemPrompt +=
      `\n\nREPLY DISCIPLINE:\n` +
      `Always answer the customer's latest message directly. If they state a problem, start solving that problem immediately. ` +
      `Do not send a generic introduction after the welcome message. Keep replies short, practical and professional.`;
    if (supportNumber) systemPrompt += `\n\nIf human escalation is appropriate, tell the customer they can reach live support at ${supportNumber}.`;
    if (client.photo_troubleshooting_enabled !== false) {
      systemPrompt +=
        `\n\nPHOTO-ASSISTED TROUBLESHOOTING:\n` +
        `When a customer is reporting internet trouble but cannot clearly describe the router or fibre terminal lights, you may politely ask them to send a clear photo of the device front panel showing the indicator lights and connected cables. ` +
        `Ask them not to include Wi-Fi passwords, account labels or private information in the photo. ` +
        `When a photo is provided, describe only what is clearly visible. Common guidance: a visible red LOS light may indicate a fibre signal problem requiring technical follow-up; a missing power light may suggest checking power; Wi-Fi/WLAN light alone does not confirm internet availability. ` +
        `Never claim that a photo proves the complete fault or that a technician has been dispatched unless the workflow confirms it. If the photo is unclear, ask for a clearer close-up or escalate appropriately.`;
    }
    if (installationState === 'collecting') {
      const intakeUrl = buildCustomerIntakeUrl(client, { phone: phoneNumber, name: conversation.customer_name });
      systemPrompt +=
        `\n\nINSTALLATION ONBOARDING — IN PROGRESS\n` +
        (intakeUrl
          ? `Prefer sending this installation intake form link so the customer can submit ID scan, exact location and contact details: ${intakeUrl}\n` +
            `If they cannot open the link, collect the details in chat as a fallback.\n`
          : '') +
        `Collect these four items one at a time before submitting the request:\n` +
        `1) Full name\n2) Preferred internet plan\n3) Physical location / landmark\n4) Email address for confirmation\n\n` +
        `Available plans:\n${PLAN_LIST_TEXT}\n\n` +
        `Ask only for missing items. Keep replies short and friendly. Do not promise a specific installation date. ` +
        `If the supplied email does not look valid, politely ask the customer to resend a valid email address.\n\n` +
        `Only once you have ALL FOUR values, send a short request-received confirmation and at the very end output exactly one final marker line:\n` +
        `<<INSTALL_DETAILS:{"name":"FULL NAME","plan":"PLAN NAME","location":"LOCATION","email":"CUSTOMER EMAIL"}>>\n` +
        `Use valid JSON and keep the keys name, plan, location and email in English. Never explain this marker to the customer.`;
    } else if (installationState === 'submitted') {
      systemPrompt += `\n\nThis customer's installation request has already been submitted. Reassure them that the team will contact them; do not submit it again.`;
    }

    if (!inboundIsImage) {
      console.log(`[client ${client.id}] Building billing context for ${phoneNumber}.`);
      const billingContext = await buildBillingContext({ clientId: client.id, customerPhone: phoneNumber, messageText });
      if (billingContext) systemPrompt += billingContext;
    }

    console.log(`[client ${client.id}] Generating AI reply for ${phoneNumber}. OpenAI config: ${JSON.stringify(openAIModelSummary())}`);
    const aiTask = inboundIsImage
      ? analyzeSupportImage(systemPrompt, historyResult.rows, inboundImageBuffer, inboundImageMimeType, inboundImageCaption)
      : generateAIResponse(systemPrompt, historyResult.rows);
    const classificationText = inboundIsImage
      ? `Customer sent a router/support image${inboundImageCaption ? ` with caption: ${inboundImageCaption}` : ''}.`
      : messageText;
    let aiResponse;
    try {
      aiResponse = await aiTask;
    } catch (err) {
      console.error(`[client ${client.id}] AI generation failed for ${phoneNumber}:`, formatErr(err));
      aiResponse = fallbackAiReply(client, messageText);
    }

    let customerReply = aiResponse;
    const markerMatch = aiResponse.match(INSTALL_MARKER_RE);
    if (markerMatch && installationState === 'collecting') {
      let details = null;
      try {
        details = JSON.parse(markerMatch[1]);
      } catch (err) {
        console.error('Installation marker JSON parse failed:', err.message, markerMatch[1]);
      }
      if (details && details.name && details.plan && details.location && EMAIL_REGEX.test(String(details.email || '').trim())) {
        const installName = String(details.name).trim();
        const installPlan = String(details.plan).trim();
        const installLocation = String(details.location).trim();
        const installEmail = String(details.email).trim().toLowerCase();
        const notice =
          `New installation request\n\nCustomer name: ${installName}\nCustomer number: +${phoneNumber}\n` +
          `Email: ${installEmail}\nPlan: ${installPlan}\nLocation: ${installLocation}\n\nPlease reach out to schedule the installation.`;
        const { notifyStatus, notifyError } = await notifySupport(client, supportNumber, notice);
        const emailResult = await sendInstallationRequestEmail(client, {
          name: installName,
          plan: installPlan,
          location: installLocation,
          email: installEmail,
        });
        if (emailResult.status === 'sent') console.log(`Installation request email sent to ${installEmail}.`);
        else if (emailResult.status === 'failed') console.error(`Installation request email to ${installEmail} failed:`, emailResult.error);

        await db.query(
          `INSERT INTO escalations
             (conversation_id, client_id, customer_phone, customer_name, customer_email, trigger_message,
              support_number, notify_status, notify_error, type, request_email_status, request_email_error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'installation', $10, $11)`,
          [conversation.id, client.id, phoneNumber, installName, installEmail, `Plan: ${installPlan} | Location: ${installLocation}`, supportNumber || null, notifyStatus, notifyError, emailResult.status, emailResult.error]
        );
        runAfterReply('Installation ticket creation', () => createOrUpdateTicket({
          clientId: client.id,
          conversationId: conversation.id,
          customerPhone: phoneNumber,
          customerName: installName,
          title: 'Installation request',
          category: 'installation',
          priority: 'normal',
          intent: 'new_installation',
          source: 'whatsapp_meta',
          summary: `Plan: ${installPlan} | Location: ${installLocation} | Email: ${installEmail}`,
          messageText: classificationText,
        }));
        await db.query(`UPDATE conversations SET installation_state = 'submitted', customer_name = COALESCE($1, customer_name) WHERE id = $2`, [installName || null, conversation.id]);
        installationState = 'submitted';
        const firstName = installName.split(/\s+/)[0];
        const customerSms = `Hi ${firstName}, thanks for your installation request. Plan: ${installPlan}. Location: ${installLocation}. Our team has been notified and will contact you shortly to schedule.` + (supportNumber ? ` For urgent help, call/WhatsApp +${supportNumber}.` : '');
        try {
          await sendSMS(phoneNumber, customerSms, { client });
          console.log(`Installation confirmation SMS sent to ${phoneNumber}.`);
        } catch (err) {
          console.error(`Installation confirmation SMS to ${phoneNumber} failed:`, formatErr(err));
        }
      } else if (details && details.email) {
        console.warn(`Installation marker ignored because email is invalid: ${details.email}`);
        customerReply = 'Please share a valid email address so I can send your installation confirmation.';
      }
    }
    customerReply = stripInstallMarker(customerReply);
    const taggedReplyMedia = await mediaByTags(client.id, `${messageText}\n${customerReply}`);
    customerReply = stripMediaTags(customerReply) || 'Here is the media I found for you.';

    if (replyAsVoice) {
      console.log(`[client ${client.id}] Sending AI voice reply to ${phoneNumber}.`);
      await deliverReply(client, phoneNumber, customerReply, true, voiceId);
      await persistOutgoing(conversation.id, customerReply);
      console.log(`AI voice reply sent to ${phoneNumber} using mode=${replyMode}.`);
    } else {
      console.log(`[client ${client.id}] Sending AI text reply to ${phoneNumber}.`);
      const sendResult = await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, customerReply);
      const messageId = sendResult?.messages?.[0]?.id || sendResult?.message_id || 'unknown';
      console.log(`[client ${client.id}] WhatsApp text accepted for ${phoneNumber}: message_id=${messageId}`);
      await persistOutgoing(conversation.id, customerReply);
      console.log(inboundIsImage ? `AI image-guided reply sent to ${phoneNumber}.` : `AI reply sent to ${phoneNumber} using mode=${replyMode}.`);
    }
    if (!inboundIsImage) {
      const mediaMatches = await matchingMedia(client.id, `${messageText}\n${customerReply}`);
      await deliverMediaItems(client, phoneNumber, uniqueMediaItems(taggedReplyMedia, mediaMatches), conversation.id, 'matched');
    } else if (taggedReplyMedia.length > 0) {
      await deliverMediaItems(client, phoneNumber, taggedReplyMedia, conversation.id, 'tagged');
    }

    runAfterReply('Post-reply ticket workflow', async () => {
      const [complaint, intentResult] = await Promise.all([
        classifyComplaint(classificationText),
        classifyIntent(classificationText),
      ]);
      if (intentResult && intentResult.intent) {
        await dispatchToEmployee({ client, conversation, intent: intentResult.intent, messageText: classificationText, phoneNumber });
        await ticketFromIntent({
          client,
          conversation: { ...conversation, customer_phone: phoneNumber },
          intent: intentResult.intent,
          messageText: classificationText,
          source: 'whatsapp_meta',
        });
      }
      if (complaint && complaint.isComplaint && complaint.summary) {
        try {
          await db.query(
            `INSERT INTO escalations (conversation_id, client_id, customer_phone, customer_name, trigger_message, support_number, notify_status, notify_error, type, summary)
             VALUES ($1, $2, $3, $4, $5, NULL, 'logged', NULL, 'complaint', $6)`,
            [conversation.id, client.id, phoneNumber, conversation.customer_name, `[${complaint.category}] ${classificationText}`, complaint.summary]
          );
        } catch (err) {
          console.error('Failed to log complaint:', err.message);
        }
        await ticketFromComplaint({
          client,
          conversation: { ...conversation, customer_phone: phoneNumber },
          complaint,
          messageText: classificationText,
          source: 'whatsapp_meta',
        });
      }
    });
  } catch (err) {
    console.error('Error processing webhook:', err.message);
  }
});

module.exports = router;
