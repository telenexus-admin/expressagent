const express = require('express');
const db = require('../db');
const { generateAIResponse, analyzeSupportImage, transcribeAudio, synthesizeVoice, classifyComplaint, classifyIntent } = require('../services/openai');
const { parseEvolutionInbound } = require('../services/evolution');
const { sendClientText, sendClientVoiceNote, sendClientMedia, downloadClientAudio, downloadClientImage } = require('../services/clientEvolution');
const { createOrUpdateTicket, ticketFromComplaint, ticketFromIntent } = require('../services/tickets');
const { notifyClientAdmins } = require('../services/pushNotifications');
const { sendSMS } = require('../services/sms');
const { sendWorkflowEmployeeEmail } = require('../services/email');
const { answerBillingQuestion, buildBillingContext } = require('../services/billing');
const { buildWebsiteKnowledgeContext } = require('../services/websiteKnowledge');
const { buildMikrotikAdminContext, buildMikrotikStatusReply } = require('../services/mikrotik');
const invoiceRoutes = require('./invoices');
const { claimWelcomeMediaRecipient, matchingMedia, mediaByTags, stripMediaTags, uniqueMediaItems, welcomeMedia } = require('../services/mediaLibrary');
const { buildCustomerIntakeUrl } = require('../services/customerIntake');
const { buildRelocationUrl } = require('../services/relocationRequests');
const { markHumanTakeover } = require('../services/humanTakeoverRecovery');
const { answerPayHeroPrompt } = require('../services/payhero');
const { isBlockedNumber } = require('../services/blockedNumbers');
const { buildActiveMissionReplyContext, recordAiTaskRecipientReply } = require('../services/aiTasks');

const router = express.Router();
const OPT_OUT = new Set(['stop', 'unsubscribe', 'cancel', 'quit', 'end', 'acha', 'simama', 'koma']);
const RESUME = new Set(['start', 'resume', 'subscribe', 'anza', 'endelea']);
const HUMAN_RE = /\b(?:talk|speak|chat|connect|transfer|refer|forward|need|want)\s+(?:(?:me\s+)?(?:to|with)\s+)?(?:a\s+|an\s+)?(?:human|agent|person|representative)\b|\b(?:human|agent|representative|mwakilishi)\s+(?:please|now|tafadhali)\b|\b(?:nataka|naomba|nahitaji)\s+(?:mtu|mwakilishi|msaada)\b/i;
const INSTALL_RE = /\b(want|need|looking for|book|schedule|please|can\s*(?:you|i)|how\s*(?:do|to))\b[^.?!]{0,40}\b(install|installation|new\s+connection|get\s+connected|connect\s+me|fibre|fiber|subscribe|register|sign\s*up)\b|\b(install|installation|new\s+connection|get\s+connected|connect\s+me|subscribe|register|sign\s*up)\b|\b(nataka|naomba|nahitaji|tafadhali)\b[^.?!]{0,40}\b(installation|kuunganishwa|usajili)\b|\bniunganish(e|wa|ie|ieni|eni)\b/i;
const RELOCATION_RE = /\b(relocat(?:e|ion|ing)|transfer|move|moving|shift|shifting)\b[^.?!]{0,60}\b(internet|wifi|wi-?fi|network|router|connection|service|line)\b|\b(internet|wifi|wi-?fi|network|router|connection|service|line)\b[^.?!]{0,60}\b(relocat(?:e|ion|ing)|transfer|move|moving|shift|shifting)\b|\b(nahama|kuhama|hamisha|kuhamisha)\b[^.?!]{0,60}\b(internet|wifi|router|network)\b/i;
const CONNECTION_PROBLEM_RE = /\b(problem|issue|trouble|fault|slow|down|offline|unstable|disconnect|disconnecting|not\s+working|no\s+internet|no\s+network|no\s+connection|cannot\s+connect|can't\s+connect|connected\s+without\s+internet)\b/i;
const TECHNICAL_ISSUE_RE = /\b(no\s+internet|internet\s+down|not\s+working|slow|buffer|lag|disconnect|disconnecting|offline|los|red\s+light|no\s+connection|connection\s+(problem|issue|fault)|problem\s+with\s+(my\s+)?connection)\b/i;
const INVOICE_RE = /\b(invoice|receipt|bill statement|billing statement|tax invoice)\b/i;
const CASUAL_REPLY_RE = /^(?:hi|hey|hello|hallo|thanks?|thank you|asante|sawa|okay|ok|cool|fine|poa|yes|no|nope|alright|great|good|morning|afternoon|evening)[.!?\s]*$/i;
const CASUAL_REPLY_LINE_RE = /(?:^|\n|\r)\s*(?:hi|hey|hello|hallo|thanks?|thank you|asante|sawa|okay|ok|cool|fine|poa|yes|no|nope|alright|great|good|morning|afternoon|evening)[.!?\s]*(?:$|\n|\r)/i;

function safeError(err) {
  return typeof err.response?.data === 'object' ? JSON.stringify(err.response.data) : (err.response?.data || err.message || 'unknown error');
}

function fallbackAiReply(client) {
  const name = String(client.agent_name || 'the assistant').trim();
  return `Hi, this is ${name}. I have received your message. Please tell me what you need help with.`;
}

function payloadShape(payload) {
  const data = payload?.data || payload;
  const firstMessage = Array.isArray(data?.messages) ? data.messages[0] : null;
  const message = data?.message || data?.data?.message || firstMessage?.message || {};
  return JSON.stringify({
    event: payload?.event || payload?.type || null,
    topKeys: Object.keys(payload || {}).slice(0, 10),
    dataKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : [],
    messageKeys: message && typeof message === 'object' ? Object.keys(message).slice(0, 12) : [],
    hasMessagesArray: Array.isArray(data?.messages),
  });
}

function runAfterReply(label, task) {
  setImmediate(() => {
    task().catch((err) => {
      console.error(`${label} failed:`, safeError(err));
    });
  });
}

async function isPendingInvoiceContinuation(conversationId, text) {
  const value = String(text || '').trim();
  if (CASUAL_REPLY_RE.test(value) || CASUAL_REPLY_LINE_RE.test(value)) return false;
  const looksLikeLookup =
    /(?:\+?254|0)\d[\d\s-]{7,15}/.test(value) ||
    /\b(?:account\s*(?:number|no\.?)?|acc(?:ount)?\s*(?:number|no\.?)?|client\s*id|username|user\s*name)\s*(?:is|#|:|-)?\s*[A-Za-z0-9][A-Za-z0-9_.-]{2,39}\b/i.test(value) ||
    /^\d{5,14}$/.test(value) ||
    /^ACC[A-Za-z0-9_-]{3,30}$/i.test(value);
  if (!looksLikeLookup) return false;
  const recent = await db.query(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1 AND role = 'assistant'
     ORDER BY timestamp DESC
     LIMIT 1`,
    [conversationId]
  );
  return recent.rows.some((message) =>
    /\bgenerate the invoice\b|\binvoice\b/i.test(String(message.content || ''))
  );
}

function shouldAutoGenerateInvoice(conversationId, text) {
  const value = String(text || '').trim();
  if (!value || CASUAL_REPLY_RE.test(value) || CASUAL_REPLY_LINE_RE.test(value)) return Promise.resolve(false);
  if (INVOICE_RE.test(value)) return Promise.resolve(true);
  return isPendingInvoiceContinuation(conversationId, value);
}

function audioFilename(mimeType) {
  if (String(mimeType || '').includes('mpeg')) return 'voice-note.mp3';
  if (String(mimeType || '').includes('mp4')) return 'voice-note.m4a';
  if (String(mimeType || '').includes('wav')) return 'voice-note.wav';
  return 'voice-note.ogg';
}

async function transcribeClientVoice(client, messageKey) {
  const first = await downloadClientAudio(client, messageKey);
  try {
    const text = (await transcribeAudio(first.buffer, audioFilename(first.mimeType), first.mimeType)).trim();
    if (text) return { text, buffer: first.buffer, mimeType: first.mimeType };
    throw new Error('Voice note transcription was empty.');
  } catch (err) {
    console.warn(`[evo client ${client.id}] Original voice transcription failed, retrying as MP4:`, safeError(err));
    const fallback = await downloadClientAudio(client, messageKey, { convertToMp4: true });
    const text = (await transcribeAudio(fallback.buffer, audioFilename(fallback.mimeType || 'audio/mp4'), fallback.mimeType || 'audio/mp4')).trim();
    if (!text) throw new Error('Voice note transcription was empty after MP4 retry.');
    return { text, buffer: fallback.buffer, mimeType: fallback.mimeType || 'audio/mp4' };
  }
}

function shouldReplyAsVoice(replyMode, inboundIsVoice) {
  if (replyMode === 'voice') return true;
  if (replyMode === 'text' || replyMode === 'silent') return false;
  return Boolean(inboundIsVoice);
}

function normalizeWorkflowChannels(value) {
  const raw = Array.isArray(value) ? value : ['sms'];
  const allowed = new Set(['sms', 'email', 'whatsapp']);
  const clean = raw.map((item) => String(item || '').toLowerCase()).filter((item) => allowed.has(item));
  return [...new Set(clean)].length ? [...new Set(clean)] : ['sms'];
}

function channelsForWorkflowIntent(intent, value) {
  const channels = normalizeWorkflowChannels(value);
  if (intent === 'human_request' && !channels.includes('whatsapp')) channels.push('whatsapp');
  return channels;
}

function normalizeWorkflowEmployeeIds(value, fallback = null) {
  const raw = Array.isArray(value) ? value : [];
  const ids = raw.map((item) => parseInt(item, 10)).filter((item) => Number.isInteger(item) && item > 0);
  if (ids.length === 0 && fallback) ids.push(parseInt(fallback, 10));
  return [...new Set(ids)].filter((item) => Number.isInteger(item) && item > 0);
}

function normalizeWorkflowPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length >= 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

function normalizeWorkflowPhones(value) {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set(raw.map(normalizeWorkflowPhone).filter((item) => item.length >= 9))];
}

function isInstallationRequest(text) {
  const value = String(text || '');
  if (CONNECTION_PROBLEM_RE.test(value)) return false;
  return INSTALL_RE.test(value);
}

function isRelocationRequest(text) {
  return RELOCATION_RE.test(String(text || ''));
}

function classifyIntentLocal(text) {
  const value = String(text || '').toLowerCase();
  if (/\b(mikrotik|routeros|winbox|interfaces?|ports?|router\s+(status|online|offline|connected|uptime|logs?|log|interfaces?|cpu|memory|reboot|diagnostics?|report|health|data|details)|uptime|pppoe\s+(active|users?)|hotspot\s+(active|users?)|dhcp\s+lease|interface\s+(status|traffic)?|active\s+users?|router\s+health|network\s+report)\b/.test(value)) {
    return { intent: 'router_management', confidence: 0.86 };
  }
  if (/\b(human|agent|person|representative|support|mtu|mwakilishi|msaada|manager|alex)\b/.test(value)) {
    return { intent: 'human_request', confidence: 0.85 };
  }
  if (TECHNICAL_ISSUE_RE.test(value)) {
    return { intent: 'technical_issue', confidence: 0.85 };
  }
  if (isRelocationRequest(value)) {
    return { intent: 'relocation_request', confidence: 0.88 };
  }
  if (isInstallationRequest(value)) {
    return { intent: 'new_installation', confidence: 0.85 };
  }
  if (/\b(pay|payment|paid|mpesa|m-pesa|bill|billing|expire|expiry|recharge|refund|overcharge|invoice)\b/.test(value)) {
    return { intent: 'payment_billing', confidence: 0.85 };
  }
  return { intent: 'general_inquiry', confidence: 0.5 };
}

function isRouterStatusQuestion(text) {
  const value = String(text || '').toLowerCase();
  if (/\b(interfaces?|ports?|logs?|error|alert|warning|users?|sessions?|pppoe|hotspot|dhcp|traffic|cpu|memory)\b/.test(value)) return false;
  return /\b(router\s*(status|online|offline|health)?|is\s+.*router\s+online|mikrotik\s*(status|online|health)?)\b/.test(value);
}

function isRouterAdminFollowupQuestion(text) {
  const value = String(text || '').toLowerCase().trim();
  if (!value) return false;
  if (/\b(account|invoice|payment|pay|billing|expire|expiry|package|password|subscription|balance)\b/.test(value)) return false;
  return /\b(status|health|report|overview|logs?|alerts?|errors?|cpu|processor|memory|storage|disk|uptime|interfaces?|ports?|ethernet|sfp|traffic|bandwidth|queues?|wan|uplink|link|offline|online)\b/.test(value);
}

async function canAnswerRouterManagement(clientId, phoneNumber) {
  await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS allowed_phone_numbers JSONB NOT NULL DEFAULT '[]'::jsonb`);
  const result = await db.query(
    `SELECT allowed_phone_numbers, is_enabled
     FROM workflow_routes
     WHERE client_id = $1 AND intent_key = 'router_management'
     LIMIT 1`,
    [clientId]
  );
  const route = result.rows[0];
  const allowed = normalizeWorkflowPhones(route?.allowed_phone_numbers);
  if (!route || route.is_enabled === false || allowed.length === 0) return false;
  return allowed.includes(normalizeWorkflowPhone(phoneNumber));
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
        await sendClientText(client, employee.emp_phone, notice);
      }
      results[channel] = { status: 'sent', error: null };
    } catch (err) {
      results[channel] = { status: 'failed', error: safeError(err) };
      console.error(`Evolution workflow ${channel} to employee ${employee.emp_name} failed:`, results[channel].error);
    }
  }));
  return results;
}

async function dispatchWorkflowToEmployees({ client, conversation, intent, messageText, phoneNumber }) {
  if (!intent || intent === 'general_inquiry') return;

  try {
    await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS notification_channels JSONB NOT NULL DEFAULT '["sms"]'::jsonb`);
    await db.query(`ALTER TABLE workflow_routes ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await db.query(`ALTER TABLE workflow_dispatches ADD COLUMN IF NOT EXISTS employee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await db.query(`UPDATE workflow_routes SET employee_ids = jsonb_build_array(employee_id) WHERE employee_id IS NOT NULL AND employee_ids = '[]'::jsonb`);

    const routeRes = await db.query(
      `SELECT employee_id, employee_ids, is_enabled, notification_channels
       FROM workflow_routes
       WHERE client_id = $1 AND intent_key = $2
       LIMIT 1`,
      [client.id, intent]
    );
    const route = routeRes.rows[0];
    const employeeIds = normalizeWorkflowEmployeeIds(route?.employee_ids, route?.employee_id);
    if (!route || !route.is_enabled || employeeIds.length === 0) return;

    const employees = (await db.query(
      `SELECT id AS emp_id, name AS emp_name, phone AS emp_phone, email AS emp_email
       FROM employees
       WHERE client_id = $1 AND is_active = TRUE AND id = ANY($2::int[])
       ORDER BY array_position($2::int[], id)`,
      [client.id, employeeIds]
    )).rows;
    if (employees.length === 0) return;

    const intentLabelMap = {
      new_installation: 'New installation request',
      relocation_request: 'Relocation / transfer request',
      payment_billing: 'Payment/billing issue',
      technical_issue: 'Technical problem',
      human_request: 'Customer wants a human agent',
      compliment_feedback: 'Compliment/feedback',
    };
    const heading = intentLabelMap[intent] || 'Customer message';
    const nameLine = conversation.customer_name ? `Customer: ${conversation.customer_name}\n` : '';
    const notice =
      `${heading}\n\n` +
      nameLine +
      `Customer number: +${phoneNumber}\n` +
      `Their message: "${messageText}"\n\n` +
      `Please follow up directly.`;

    const channels = channelsForWorkflowIntent(intent, route.notification_channels);
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

    await db.query(
      `INSERT INTO workflow_dispatches
         (conversation_id, client_id, intent_key, employee_id, employee_ids, customer_phone,
          trigger_message, notify_status, notify_error)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       ON CONFLICT (conversation_id, intent_key)
       DO UPDATE SET employee_id = EXCLUDED.employee_id,
                     employee_ids = EXCLUDED.employee_ids,
                     customer_phone = EXCLUDED.customer_phone,
                     trigger_message = EXCLUDED.trigger_message,
                     notify_status = EXCLUDED.notify_status,
                     notify_error = EXCLUDED.notify_error,
                     created_at = NOW()`,
      [conversation.id, client.id, intent, employees[0].emp_id, JSON.stringify(employees.map((employee) => employee.emp_id)), phoneNumber, messageText, notifyStatus, notifyError]
    );
    console.log(
      `[evo client ${client.id}] Dispatched intent="${intent}" to ${employees.length} employee(s) via ${channels.join(', ')} ` +
      `status=${notifyStatus}${notifyError ? ` error=${notifyError}` : ''}.`
    );
  } catch (err) {
    console.error('Evolution workflow dispatch error:', safeError(err));
  }
}

function imageFilename(mimeType) {
  const subtype = String(mimeType || 'image/jpeg').split('/')[1]?.split(';')[0] || 'jpg';
  const safeSubtype = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  return `whatsapp-image.${safeSubtype === 'jpeg' ? 'jpg' : safeSubtype}`;
}

async function loadClient(id, token, agentId = null) {
  if (agentId) {
    const result = await db.query(
      `SELECT c.*, e.instance_name AS routed_instance_name, e.agent_label AS routed_agent_label
       FROM evo_client_onboardings e
       JOIN clients c ON c.id = e.parent_client_id
       WHERE c.id = $1
         AND c.status = 'active'
         AND e.id = $2
         AND e.request_type = 'additional_agent'
         AND e.status = 'active'
         AND e.webhook_secret = $3
         AND e.routing_active = TRUE
       LIMIT 1`,
      [id, agentId, token]
    );
    const client = result.rows[0];
    if (!client) return null;
    return {
      ...client,
      evolution_instance_name: client.routed_instance_name,
      agent_name: client.routed_agent_label || client.agent_name,
      routed_agent_id: agentId,
    };
  }

  const result = await db.query(
    `SELECT * FROM clients
     WHERE id = $1 AND connection_provider = 'evolution' AND status = 'active'
       AND evolution_webhook_secret = $2 AND evolution_routing_active = TRUE
     LIMIT 1`,
    [id, token]
  );
  return result.rows[0] || null;
}

async function findOrCreateConversation(clientId, phone, name, instanceName = null, options = {}) {
  await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reply_mode VARCHAR(20) NOT NULL DEFAULT 'auto'`);
  await db.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_instance_name VARCHAR(120)`);
  const allowUnassignedMatch = options.allowUnassignedMatch !== false;
  const previous = await db.query(
    `SELECT id FROM conversations
     WHERE client_id = $1 AND customer_phone = $2
       AND (source_instance_name = $3 OR ($4::boolean = TRUE AND source_instance_name IS NULL))
     LIMIT 1`,
    [clientId, phone, instanceName, allowUnassignedMatch]
  );
  const isNewNumber = previous.rows.length === 0;
  const existing = await db.query(
    `SELECT * FROM conversations
     WHERE client_id = $1 AND customer_phone = $2 AND status != 'resolved'
       AND (source_instance_name = $3 OR ($4::boolean = TRUE AND source_instance_name IS NULL))
     ORDER BY created_at DESC LIMIT 1`,
    [clientId, phone, instanceName, allowUnassignedMatch]
  );
  if (existing.rows[0]) {
    if ((name && name !== existing.rows[0].…1446 tokens truncated…|| 'unknown'} ` +
      `remote=${jidType(remoteJid)} ` +
      `alt=${jidType(remoteJidAlt)} ` +
      `participant=${jidType(participantJid)} ` +
      `parsed=${jidType(incoming.replyJid)} ` +
      `target=${jidType(replyTarget)}`
    );

    const { conversation, isNewNumber } = await findOrCreateConversation(
      client.id,
      incoming.phone,
      incoming.name,
      client.evolution_instance_name,
      { allowUnassignedMatch: !client.routed_agent_id }
    );
    if (isNewNumber) {
      await sendWelcomeMedia(client, conversation.id, replyTarget);
    }

    let userText = String(incoming.text || '').trim();
    let storedText = userText;
    let inboundImageBuffer = null;
    let inboundImageMimeType = null;
    if (incoming.isVoice) {
      try {
        const voice = await transcribeClientVoice(client, incoming.messageKey);
        userText = voice.text;
        storedText = `[Voice note] ${userText}`;
      } catch (err) {
        console.error(`[evo client ${client.id}] Voice transcription failed:`, safeError(err));
        await sendClientText(client, replyTarget, "Sorry, I had trouble processing that voice note. Please send it again or type your message.");
        return;
      }
    }
    if (incoming.isImage && client.photo_troubleshooting_enabled !== false) {
      try {
        const { buffer, mimeType } = await downloadClientImage(client, incoming.messageKey);
        const resolvedMimeType = String(mimeType || incoming.mediaMimeType || 'image/jpeg');
        if (!resolvedMimeType.startsWith('image/') && !String(incoming.mediaMimeType || '').startsWith('image/')) {
          throw new Error('Received media is not an image.');
        }
        inboundImageBuffer = buffer;
        inboundImageMimeType = resolvedMimeType.startsWith('image/') ? resolvedMimeType : incoming.mediaMimeType || 'image/jpeg';
        storedText = `[Image received] ${userText || 'Customer sent a router/support photo for checking.'}`;
        userText = userText || '[Customer sent a router/support photo for checking]';
      } catch (err) {
        console.error(`[evo client ${client.id}] Image download failed:`, safeError(err));
        return;
      }
    }
    if (!userText) {
      console.log(`[evo client ${client.id}] Ignored empty message from ${incoming.phone}.`);
      return;
    }

    const savedUserMessage = await saveMessage(conversation.id, 'user', storedText);
    if (inboundImageBuffer) {
      if (savedUserMessage?.id) {
        await db.query(
          `INSERT INTO message_attachments (message_id, media_type, mime_type, filename, data)
           VALUES ($1, 'image', $2, $3, $4)`,
          [savedUserMessage.id, inboundImageMimeType, imageFilename(inboundImageMimeType), inboundImageBuffer]
        );
      }
    }
    runAfterReply('Push notification for inbound Evolution message', () => notifyClientAdmins({
      clientId: client.id,
      conversationId: conversation.id,
      customerName: conversation.customer_name,
      customerPhone: incoming.phone,
      messageText: storedText,
    }));
    console.log(`[evo client ${client.id}] Incoming from ${incoming.phone}: "${userText}"`);
    console.log(
      `[evo client ${client.id}] Conversation state for ${incoming.phone}: ` +
      `id=${conversation.id}, status=${conversation.status}, reply_mode=${conversation.reply_mode || 'auto'}, opted_out=${Boolean(conversation.opted_out_at)}`
    );

    if (await isBlockedNumber(client.id, incoming.phone)) {
      console.log(`[evo client ${client.id}] Reply skipped for ${incoming.phone}: number is blocked in Agent Configuration.`);
      return;
    }

    const normalized = userText.toLowerCase();
    if (conversation.opted_out_at && RESUME.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NULL WHERE id = $1`, [conversation.id]);
      await reply(client, conversation.id, replyTarget, "You're resubscribed. How can I help you today?");
      return;
    }
    if (conversation.opted_out_at) {
      console.log(`[evo client ${client.id}] Reply skipped for ${incoming.phone}: conversation is opted out.`);
      return;
    }
    if (OPT_OUT.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NOW() WHERE id = $1`, [conversation.id]);
      await reply(client, conversation.id, replyTarget, "You've been unsubscribed. Reply START at any time to resume.");
      return;
    }
    if (conversation.status === 'human_takeover') {
      console.log(`[evo client ${client.id}] Reply skipped for ${incoming.phone}: conversation is in human takeover.`);
      return;
    }
    const replyMode = conversation.reply_mode || 'auto';
    if (replyMode === 'silent') {
      console.log(`[evo client ${client.id}] Reply skipped for ${incoming.phone}: reply mode is silent.`);
      return;
    }
    const replyAsVoice = shouldReplyAsVoice(replyMode, incoming.isVoice);

    const preReplyIntent = incoming.isImage ? null : classifyIntentLocal(userText);
    const explicitRouterAdminQuestion = preReplyIntent?.intent === 'router_management';
    const possibleRouterAdminFollowup = !incoming.isImage && isRouterAdminFollowupQuestion(userText);
    if (explicitRouterAdminQuestion || possibleRouterAdminFollowup) {
      const allowedRouterAdmin = await canAnswerRouterManagement(client.id, incoming.phone);
      if (!allowedRouterAdmin) {
        if (!explicitRouterAdminQuestion) {
          console.log(`[evo client ${client.id}] Router-admin-like follow-up from ${incoming.phone} treated as normal customer text because the number is not authorized.`);
        } else {
        console.warn(`[evo client ${client.id}] Router admin question ignored from unauthorized number ${incoming.phone}.`);
        await reply(
          client,
          conversation.id,
          replyTarget,
          'I can help with your internet account, payments, installation or support request. Router administration details are only available to approved admin numbers.',
          replyAsVoice
        );
        return;
        }
      } else {
        if (isRouterStatusQuestion(userText) || /^\s*(status|health|report|overview|router status|mikrotik status)\s*[?.!]*\s*$/i.test(userText)) {
          const statusReply = await buildMikrotikStatusReply({ clientId: client.id });
          await reply(client, conversation.id, replyTarget, statusReply, replyAsVoice);
          console.log(`[evo client ${client.id}] Deterministic router status reply sent to ${incoming.phone}.`);
          return;
        }

        const routerAdminContext = await buildMikrotikAdminContext({ clientId: client.id, messageText: userText });
        const routerPrompt =
          `${client.agent_name ? `Your name is ${client.agent_name}. ` : ''}` +
          `You are answering an authorized router administrator for ${client.business_name || client.name || 'this ISP'}.\n` +
          `Use only the ROUTER ADMIN CONTEXT below to answer the exact router question directly and briefly.\n` +
          `Copy router names, uptime, counts, interface names, statuses, versions, IPs, and logs exactly as shown. Do not round, recalculate, guess, or mix in old conversation context.\n` +
          `For interface, ethernet, SFP, link or port questions, explain which ports are connected/running, which are not linked or disabled, and include TX/RX rates and packet rates when present.\n` +
          `If the requested detail is not present, say it is not available from the current read-only check. Never ask for a router photo in router-admin mode. Do not invent router data.\n` +
          routerAdminContext;
        const recent = await db.query(
          `SELECT role, content FROM (
             SELECT role, content, timestamp FROM messages
             WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 8
           ) history ORDER BY timestamp ASC`,
          [conversation.id]
        );
        let routerReply;
        try {
          routerReply = await generateAIResponse(routerPrompt, recent.rows);
        } catch (err) {
          console.error(`[evo client ${client.id}] Router admin AI reply failed for ${incoming.phone}:`, safeError(err));
          routerReply = 'I checked the router management context, but I could not prepare the answer right now. Please try again shortly.';
        }
        await reply(client, conversation.id, replyTarget, stripMediaTags(routerReply).trim() || 'Router details are not available from the current read-only check.', replyAsVoice);
        console.log(`[evo client ${client.id}] Router admin reply sent to ${incoming.phone}.`);
        return;
      }
    }

    if (!incoming.isImage && /^pay now$/i.test(userText.trim())) {
      const answer = await invoiceRoutes.startLatestInvoicePayment({
        client,
        conversationId: conversation.id,
        customerPhone: incoming.phone,
      });
      await reply(client, conversation.id, replyTarget, answer, false);
      return;
    }

    if (!incoming.isImage && /^pay later$/i.test(userText.trim())) {
      await reply(client, conversation.id, replyTarget, 'No problem. You can pay later using the invoice PDF when ready.', false);
      return;
    }

    if (!incoming.isImage) {
      const paymentPromptReply = await answerPayHeroPrompt({
        client,
        conversationId: conversation.id,
        customerPhone: incoming.phone,
        customerName: conversation.customer_name,
        messageText: userText,
      });
      if (paymentPromptReply) {
        await reply(client, conversation.id, replyTarget, paymentPromptReply, false);
        return;
      }
    }

    if (!incoming.isImage && isRelocationRequest(userText)) {
      const relocationUrl = buildRelocationUrl(client, { phone: incoming.phone, name: conversation.customer_name });
      if (relocationUrl) {
        const answer =
          `Sure, I can help you request a network relocation.\n\n` +
          `Please complete this relocation form:\n${relocationUrl}\n\n` +
          `It captures your new location, preferred visit time, router condition and equipment availability so the field team can prepare well.`;
        await reply(client, conversation.id, replyTarget, answer, replyAsVoice);
        console.log(`[evo client ${client.id}] Relocation form link sent to ${incoming.phone}.`);
        runAfterReply('Evolution relocation workflow dispatch', () => dispatchWorkflowToEmployees({
          client,
          conversation,
          intent: 'relocation_request',
          messageText: userText,
          phoneNumber: incoming.phone,
        }));
        runAfterReply('Evolution relocation ticket creation', () => createOrUpdateTicket({
          clientId: client.id,
          conversationId: conversation.id,
          customerPhone: incoming.phone,
          customerName: conversation.customer_name,
          title: 'Relocation / transfer request',
          category: 'installation',
          priority: 'normal',
          intent: 'relocation_request',
          source: 'whatsapp_evolution',
          summary: userText,
          messageText: userText,
        }));
        return;
      }
    }

    if (!incoming.isImage && isInstallationRequest(userText)) {
      const intakeUrl = buildCustomerIntakeUrl(client, { phone: incoming.phone, name: conversation.customer_name });
      if (intakeUrl) {
        const answer =
          `Please complete this installation form:\n${intakeUrl}\n\n` +
          `It collects your ID scan, location and contact details for the setup team.`;
        await reply(client, conversation.id, replyTarget, answer, replyAsVoice);
        console.log(`[evo client ${client.id}] Installation intake form link sent to ${incoming.phone}.`);
        runAfterReply('Evolution installation ticket creation', () => createOrUpdateTicket({
          clientId: client.id,
          conversationId: conversation.id,
          customerPhone: incoming.phone,
          customerName: conversation.customer_name,
          title: 'Installation request',
          category: 'installation',
          priority: 'normal',
          intent: 'new_installation',
          source: 'whatsapp_evolution',
          summary: userText,
          messageText: userText,
        }));
        return;
      }
    }

    if (!incoming.isImage && await shouldAutoGenerateInvoice(conversation.id, userText)) {
      try {
        const result = await invoiceRoutes.createAndSendCustomerInvoice({
          client,
          customerPhone: incoming.phone,
          customerName: conversation.customer_name,
          messageText: userText,
          req,
        });
        if (result.reply) await reply(client, conversation.id, replyTarget, result.reply, replyAsVoice);
      } catch (err) {
        console.error(`[evo client ${client.id}] Invoice auto-generation failed for ${incoming.phone}:`, safeError(err));
        await reply(client, conversation.id, replyTarget, 'I could not generate the invoice right now. Please send your registered phone number or ask support to assist.', replyAsVoice);
      }
      return;
    }

    if (!incoming.isImage) {
      console.log(`[evo client ${client.id}] Billing direct check for ${incoming.phone}.`);
      let billingReply = await answerBillingQuestion({
        clientId: client.id,
        customerPhone: incoming.phone,
        customerName: conversation.customer_name,
        messageText: userText,
      });
      if (billingReply) {
        const mediaText = `${userText}\n${billingReply}`;
        billingReply = stripMediaTags(billingReply) || 'Here is the media I found for you.';
        await reply(client, conversation.id, replyTarget, billingReply, replyAsVoice);
        await sendMatchedMedia(client, conversation.id, replyTarget, mediaText);
        console.log(`[evo client ${client.id}] Billing reply sent to ${incoming.phone}.`);
        return;
      }
      console.log(`[evo client ${client.id}] No direct billing reply for ${incoming.phone}.`);
    }

    if (HUMAN_RE.test(userText)) {
      await markHumanTakeover(conversation.id);
      await db.query(
        `INSERT INTO escalations (conversation_id, client_id, customer_phone, customer_name, trigger_message, support_number, notify_status, notify_error, type)
         VALUES ($1, $2, $3, $4, $5, $6, 'logged', NULL, 'human')`,
        [conversation.id, client.id, incoming.phone, conversation.customer_name, userText, client.support_number || null]
      );
      runAfterReply('Evolution human workflow dispatch', () => dispatchWorkflowToEmployees({
        client,
        conversation,
        intent: 'human_request',
        messageText: userText,
        phoneNumber: incoming.phone,
      }));
      runAfterReply('Evolution human support ticket creation', () => createOrUpdateTicket({
        clientId: client.id,
        conversationId: conversation.id,
        customerPhone: incoming.phone,
        customerName: conversation.customer_name,
        title: 'Human support requested',
        category: 'human_support',
        priority: 'high',
        intent: 'human_request',
        source: 'whatsapp_evolution',
        summary: userText,
        messageText: userText,
      }));
      const answer = client.support_number
        ? `Thanks â€” I've forwarded your request for human support. You may also reach the team on ${client.support_number}.`
        : "Thanks â€” I've flagged your request for the support team. Someone will follow up shortly.";
      await reply(client, conversation.id, replyTarget, answer, replyAsVoice);
      return;
    }

    const recent = await db.query(
      `SELECT role, content FROM (
         SELECT role, content, timestamp FROM messages
         WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20
       ) history ORDER BY timestamp ASC`,
      [conversation.id]
    );
    let prompt = client.system_prompt || 'You are a helpful customer support agent.';
    if (client.agent_name) {
      prompt = `Your name is ${client.agent_name}. You are the official AI assistant for ${client.business_name || client.name}.\n\n${prompt}`;
    }
    if (conversation.customer_name) {
      prompt += `\n\nThe customer's WhatsApp display name is "${conversation.customer_name}". Use their name naturally when useful, without repeating a greeting in every reply.`;
    }
    const missionContext = await buildActiveMissionReplyContext(client.id, incoming.phone);
    if (missionContext) prompt += missionContext;
    if (client.support_number) {
      prompt += `\n\nWhen a human is required, tell the customer they can reach support at ${client.support_number}.`;
    }
    const intakeUrl = buildCustomerIntakeUrl(client, { phone: incoming.phone, name: conversation.customer_name });
    if (intakeUrl) {
      prompt += `\n\nFor new installation requests, send this intake form link: ${intakeUrl}. It collects ID scan, location and contact details.`;
    }
    const relocationUrl = buildRelocationUrl(client, { phone: incoming.phone, name: conversation.customer_name });
    if (relocationUrl) {
      prompt += `\n\nFor relocation, transfer, moving house, shifting internet, or moving router/service requests, send this relocation form link: ${relocationUrl}. It collects the new location, preferred date, router condition and equipment availability.`;
    }
    if (!incoming.isImage) {
      const websiteContext = await buildWebsiteKnowledgeContext(client.id);
      if (websiteContext) prompt += websiteContext;
      console.log(`[evo client ${client.id}] Building billing context for ${incoming.phone}.`);
      const billingContext = await buildBillingContext({ clientId: client.id, customerPhone: incoming.phone, messageText: userText });
      if (billingContext) prompt += billingContext;
    }
    console.log(`[evo client ${client.id}] Generating AI reply for ${incoming.phone}.`);
    let aiReply;
    try {
      aiReply = incoming.isImage && inboundImageBuffer
        ? await analyzeSupportImage(prompt, recent.rows, inboundImageBuffer, inboundImageMimeType, incoming.text || '')
        : await generateAIResponse(prompt, recent.rows);
    } catch (err) {
      console.error(`[evo client ${client.id}] AI generation failed for ${incoming.phone}:`, safeError(err));
      aiReply = fallbackAiReply(client);
    }
    if (!aiReply || !aiReply.trim()) {
      console.warn(`[evo client ${client.id}] AI returned empty reply for ${incoming.phone}.`);
      return;
    }
    const mediaText = `${userText}\n${aiReply}`;
    const cleanReply = stripMediaTags(aiReply).trim() || 'Here is the media I found for you.';
    console.log(`[evo client ${client.id}] Sending AI reply to ${incoming.phone}.`);
    await reply(client, conversation.id, replyTarget, cleanReply, replyAsVoice);
    if (!incoming.isImage) await sendMatchedMedia(client, conversation.id, replyTarget, mediaText);
    else await sendMatchedMedia(client, conversation.id, replyTarget, aiReply);
    await recordAiTaskRecipientReply({
      clientId: client.id,
      phone: incoming.phone,
      customerMessage: userText,
      assistantReply: cleanReply,
    });
    console.log(`[evo client ${client.id}] AI reply sent to ${incoming.phone}.`);
    runAfterReply('Evolution post-reply ticket workflow', async () => {
      const [complaint, intentResult] = await Promise.all([
        classifyComplaint(userText),
        classifyIntent(userText),
      ]);
      if (intentResult?.intent) {
        await ticketFromIntent({
          client,
          conversation,
          intent: intentResult.intent,
          messageText: userText,
          source: 'whatsapp_evolution',
        });
      }
      if (complaint?.isComplaint) {
        await ticketFromComplaint({
          client,
          conversation,
          complaint,
          messageText: userText,
          source: 'whatsapp_evolution',
        });
      }
    });
  } catch (err) {
    console.error('Evolution client webhook processing failed:', safeError(err));
  }
});

module.exports = router;

