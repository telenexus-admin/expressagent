const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateAIResponse, transcribeAudio, synthesizeVoice, classifyComplaint, classifyIntent } = require('../services/openai');
const {
  sendWhatsAppMessage,
  downloadWhatsAppMedia,
  uploadWhatsAppMedia,
  sendWhatsAppVoiceNote,
} = require('../services/whatsapp');
const { sendSMS } = require('../services/sms');

function formatErr(err) {
  return typeof err.response?.data === 'object'
    ? JSON.stringify(err.response.data)
    : (err.response?.data || err.message || 'unknown error');
}

// Notify the customer support number via both WhatsApp and SMS.
// Returns aggregate { notifyStatus, notifyError } for the escalations row.
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
    await sendSMS(supportNumber, message);
    results.sms = 'sent';
  } catch (err) {
    results.sms = 'failed';
    results.smsError = formatErr(err);
    console.error(`Support SMS to ${supportNumber} failed:`, results.smsError);
  }

  const notifyStatus =
    results.whatsapp === 'sent' || results.sms === 'sent' ? 'sent' : 'failed';
  const errorParts = [];
  if (results.whatsapp !== 'sent') errorParts.push(`whatsapp: ${results.whatsappError || 'failed'}`);
  if (results.sms !== 'sent') errorParts.push(`sms: ${results.smsError || 'failed'}`);
  const notifyError = errorParts.length ? errorParts.join(' | ') : null;

  return { notifyStatus, notifyError };
}

// Notify the workflow-assigned employee for a detected intent, exactly once per
// (conversation, intent). Skips silently if no route is configured, no employee
// is assigned, the route is disabled, or the dispatch was already fired.
async function dispatchToEmployee({ client, conversation, intent, messageText, phoneNumber }) {
  if (!intent || intent === 'general_inquiry') return;

  try {
    const routeRes = await db.query(
      `SELECT wr.employee_id, wr.is_enabled,
              e.id AS emp_id, e.name AS emp_name, e.phone AS emp_phone, e.is_active AS emp_active
       FROM workflow_routes wr
       LEFT JOIN employees e ON e.id = wr.employee_id
       WHERE wr.client_id = $1 AND wr.intent_key = $2`,
      [client.id, intent]
    );
    const route = routeRes.rows[0];
    if (!route || !route.is_enabled || !route.employee_id || !route.emp_active) return;

    const existing = await db.query(
      `SELECT id FROM workflow_dispatches WHERE conversation_id = $1 AND intent_key = $2`,
      [conversation.id, intent]
    );
    if (existing.rows.length > 0) return;

    const nameLine = conversation.customer_name
      ? `Customer: ${conversation.customer_name}\n`
      : '';
    const businessName = (client.business_name || client.name || 'the team').trim();
    const intentLabelMap = {
      new_installation: 'New installation request',
      payment_billing: 'Payment / billing issue',
      technical_issue: 'Technical problem',
      human_request: 'Customer wants a human agent',
      compliment_feedback: 'Compliment / feedback',
    };
    const heading = intentLabelMap[intent] || 'Customer message';
    const notice =
      `${businessName} workflow alert — ${heading}\n\n` +
      nameLine +
      `Customer number: +${phoneNumber}\n` +
      `Their message: "${messageText}"\n\n` +
      `Please follow up directly.`;

    let notifyStatus = 'sent';
    let notifyError = null;
    try {
      await sendSMS(route.emp_phone, notice);
      console.log(
        `[client ${client.id}] Dispatched intent="${intent}" to employee "${route.emp_name}" (${route.emp_phone}).`
      );
    } catch (err) {
      notifyStatus = 'failed';
      notifyError = formatErr(err);
      console.error(
        `Dispatch SMS to employee ${route.emp_name} (${route.emp_phone}) failed:`,
        notifyError
      );
    }

    await db.query(
      `INSERT INTO workflow_dispatches
         (conversation_id, client_id, intent_key, employee_id, customer_phone,
          trigger_message, notify_status, notify_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (conversation_id, intent_key) DO NOTHING`,
      [
        conversation.id,
        client.id,
        intent,
        route.employee_id,
        phoneNumber,
        messageText,
        notifyStatus,
        notifyError,
      ]
    );
  } catch (err) {
    console.error('dispatchToEmployee error:', err.message);
  }
}

// Send the AI reply either as a text message or a voice note, mirroring the customer's format.
async function deliverReply(client, phoneNumber, text, asVoice, voiceId) {
  if (!asVoice) {
    await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, text);
    return;
  }
  try {
    const voice = voiceId || client.voice_id || 'alloy';
    const audio = await synthesizeVoice(text, voice);
    const mediaId = await uploadWhatsAppMedia(
      client.meta_phone_number_id,
      client.meta_access_token,
      audio,
      'audio/ogg',
      'reply.ogg'
    );
    await sendWhatsAppVoiceNote(client.meta_phone_number_id, client.meta_access_token, phoneNumber, mediaId);
  } catch (err) {
    console.error('Voice reply failed, falling back to text:', err.response?.data || err.message);
    await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, text);
  }
}

const OPT_OUT_KEYWORDS = new Set([
  'stop', 'unsubscribe', 'cancel', 'quit', 'end',
  'acha', 'simama', 'koma',
]);
const RESUME_KEYWORDS = new Set([
  'start', 'resume', 'subscribe',
  'anza', 'endelea',
]);
const HUMAN_KEYWORDS = new Set([
  'human', 'agent', 'person', 'representative', 'support',
  'mtu', 'mwakilishi', 'msaada',
]);
const HUMAN_ESCALATION_REGEX = new RegExp(
  `\\b(${[...HUMAN_KEYWORDS].join('|')})\\b`,
  'i'
);

// Plans the AI presents while collecting installation details. Edit here when pricing changes.
const PLAN_LIST_TEXT =
  `• 10 Mbps – KSh 1,500/month\n` +
  `• 15 Mbps – KSh 2,000/month\n` +
  `• 20 Mbps – KSh 2,500/month\n` +
  `• 30 Mbps – KSh 3,000/month\n` +
  `• 40 Mbps – KSh 4,000/month\n` +
  `Installation fee: KSh 1,000 (one-off).\n` +
  `All packages are unlimited with dedicated download & upload speeds.`;

const INSTALL_MARKER_RE = /<<INSTALL_DETAILS:\s*(\{[\s\S]*?\})\s*>>/;
function stripInstallMarker(text) {
  return text.replace(INSTALL_MARKER_RE, '').trim();
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

const DISCLOSURE_TEMPLATE = (businessName) =>
  `Hi! You're chatting with ${businessName || 'our'} AI assistant. Reply HUMAN any time to reach a person, or STOP to unsubscribe.`;

// GET /webhook — Meta verification handshake. Each client has their own verify_token.
router.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe' || !token) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const result = await db.query(
      `SELECT id, name FROM clients WHERE meta_verify_token = $1 LIMIT 1`,
      [token]
    );
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
  const result = await db.query(
    `SELECT * FROM clients WHERE meta_phone_number_id = $1 AND status = 'active' LIMIT 1`,
    [phoneNumberId]
  );
  return result.rows[0] || null;
}

async function findOrCreateConversation(clientId, phoneNumber, profileName) {
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
      const updated = await db.query(
        `UPDATE conversations SET customer_name = $1 WHERE id = $2 RETURNING *`,
        [cleanName, conv.id]
      );
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
  await db.query(
    `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'assistant', $2, NOW())`,
    [conversationId, content]
  );
  await db.query(
    `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );
}

// POST /webhook — incoming messages from WhatsApp
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

    // Route by the phone_number_id Meta delivered the message to.
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

    if (message.type === 'audio' || message.type === 'voice') {
      const mediaId = message.audio?.id || message.voice?.id;
      try {
        const { buffer, mimeType } = await downloadWhatsAppMedia(client.meta_access_token, mediaId);
        const ext = (mimeType && mimeType.split('/')[1]?.split(';')[0]) || 'ogg';
        const transcript = (await transcribeAudio(buffer, `inbound.${ext}`)).trim();
        if (!transcript) {
          console.log(`Empty transcript from ${phoneNumber} audio — ignoring.`);
          return;
        }
        messageText = transcript;
        inboundIsVoice = true;
        console.log(`[client ${client.id}] Transcribed voice from ${phoneNumber}: "${messageText}"`);
      } catch (err) {
        console.error('Failed to transcribe inbound audio:', err.response?.data || err.message);
        await db.query(
          `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'user', $2, $3)`,
          [conversation.id, '[voice note — transcription failed]', timestamp]
        );
        if (conversation.opted_out_at) return;
        const notice = "Sorry, I couldn't understand that voice note. Could you send it again or type your message?";
        await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, notice);
        await persistOutgoing(conversation.id, notice);
        return;
      }
    } else if (message.type === 'text') {
      messageText = message.text.body.trim();
      console.log(`[client ${client.id}] Incoming from ${phoneNumber}: "${messageText}"`);
    } else {
      console.log(`[client ${client.id}] Unsupported message type (${message.type}) from ${phoneNumber}.`);
      await db.query(
        `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'user', $2, $3)`,
        [conversation.id, `[${message.type} message — not processed]`, timestamp]
      );
      if (conversation.opted_out_at) return;
      const notice = "Sorry, I can only handle text and voice notes right now. Please send one of those.";
      await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, notice);
      await persistOutgoing(conversation.id, notice);
      return;
    }

    const normalized = messageText.toLowerCase();

    await db.query(
      `INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'user', $2, $3)`,
      [conversation.id, messageText, timestamp]
    );
    await db.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [conversation.id]
    );

    if (conversation.opted_out_at && RESUME_KEYWORDS.has(normalized)) {
      await db.query(
        `UPDATE conversations SET opted_out_at = NULL WHERE id = $1`,
        [conversation.id]
      );
      const reply = "You're resubscribed. How can I help you today?";
      await deliverReply(client, phoneNumber, reply, inboundIsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }

    if (conversation.opted_out_at) {
      console.log(`Conversation ${conversation.id} is opted out — no reply sent.`);
      return;
    }

    if (OPT_OUT_KEYWORDS.has(normalized)) {
      await db.query(
        `UPDATE conversations SET opted_out_at = NOW() WHERE id = $1`,
        [conversation.id]
      );
      const reply = "You've been unsubscribed. You will not receive further messages from this assistant. Reply START at any time to resume.";
      await deliverReply(client, phoneNumber, reply, inboundIsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }

    if (conversation.status === 'human_takeover') {
      console.log(`Conversation ${conversation.id} under human takeover — skipping AI.`);
      return;
    }

    const supportNumber = (client.support_number || '').replace(/[^0-9]/g, '');

    if (HUMAN_ESCALATION_REGEX.test(normalized)) {
      await db.query(
        `UPDATE conversations SET status = 'human_takeover' WHERE id = $1`,
        [conversation.id]
      );

      const nameLine = conversation.customer_name
        ? `Customer name: ${conversation.customer_name}\n`
        : '';
      const notice =
        `Customer support request\n\n` +
        nameLine +
        `Customer number: +${phoneNumber}\n` +
        `Their message: "${messageText}"\n\n` +
        `Please reach out to them directly.`;

      const { notifyStatus, notifyError } = await notifySupport(client, supportNumber, notice);
      if (notifyStatus === 'sent') {
        console.log(`Forwarded escalation to support (${supportNumber}) for customer ${phoneNumber}.`);
      } else if (notifyStatus === 'no_support_number') {
        console.warn(`[client ${client.id}] Human escalation but no support_number configured.`);
      }

      await db.query(
        `INSERT INTO escalations
           (conversation_id, client_id, customer_phone, customer_name, trigger_message,
            support_number, notify_status, notify_error, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'human')`,
        [
          conversation.id,
          client.id,
          phoneNumber,
          conversation.customer_name,
          messageText,
          supportNumber || null,
          notifyStatus,
          notifyError,
        ]
      );

      const reply = supportNumber
        ? "Thanks — I've forwarded your request to our customer support team. Someone will reach out to you shortly."
        : "Thanks — I've flagged your request for our team. Someone will reach out to you shortly.";
      await deliverReply(client, phoneNumber, reply, inboundIsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }

    let installationState = conversation.installation_state || null;
    if (!installationState && INSTALL_REGEX.test(normalized)) {
      await db.query(
        `UPDATE conversations SET installation_state = 'collecting' WHERE id = $1`,
        [conversation.id]
      );
      installationState = 'collecting';
    }

    const historyResult = await db.query(
      `SELECT role, content FROM (
         SELECT role, content, timestamp FROM messages
         WHERE conversation_id = $1
         ORDER BY timestamp DESC
         LIMIT 20
       ) recent
       ORDER BY timestamp ASC`,
      [conversation.id]
    );

    const basePrompt = client.system_prompt || 'You are a helpful customer support agent.';
    const agentName = (client.agent_name || '').trim();
    const voiceId = (client.voice_id || '').trim() || 'alloy';

    let systemPrompt = basePrompt;
    if (agentName) {
      systemPrompt = `Your name is ${agentName}. If a customer asks your name, introduce yourself as ${agentName}.\n\n${systemPrompt}`;
    }
    if (conversation.customer_name) {
      const firstName = conversation.customer_name.split(/\s+/)[0];
      systemPrompt +=
        `\n\nThe customer's WhatsApp display name is "${conversation.customer_name}" (first name: "${firstName}"). ` +
        `IMPORTANT: If this is the very first message you are sending in this conversation ` +
        `(i.e. there are no prior assistant messages in the history above), you MUST begin your reply with ` +
        `"Hi ${firstName}!" (or the Swahili equivalent "Habari ${firstName}!" if the customer wrote in Swahili). ` +
        `For follow-up messages, use their first name occasionally to keep it natural — do not start every message with it.`;
    }
    if (supportNumber) {
      systemPrompt += `\n\nLive support escalation: If the customer explicitly asks to speak with a human, is frustrated, or has an issue you cannot resolve, tell them they can reach our live customer support team directly at ${supportNumber}. Share this number only when escalation is appropriate — do not volunteer it on every message.`;
    }
    if (installationState === 'collecting') {
      systemPrompt +=
        `\n\nINSTALLATION ONBOARDING — IN PROGRESS\n` +
        `This customer is requesting an installation. Before our team can be notified, ` +
        `you MUST collect three things, one at a time in a natural conversation:\n` +
        `  1) Their full name\n` +
        `  2) The internet plan they want (present the list below)\n` +
        `  3) Their physical location / area (estate, town, landmark)\n\n` +
        `Available plans:\n${PLAN_LIST_TEXT}\n\n` +
        `Ask only for missing items — do not re-ask for anything already provided in this chat. ` +
        `Keep replies short and friendly. Do NOT promise a specific installation date.\n\n` +
        `ONCE you have ALL THREE items (name + plan + location), do TWO things in the same reply:\n` +
        `  (a) Send a short confirmation message to the customer summarising the details and telling them the team will reach out.\n` +
        `  (b) At the very END of your reply, on its own final line, output this exact marker (replace the values):\n` +
        `      <<INSTALL_DETAILS:{"name":"FULL NAME","plan":"PLAN NAME","location":"LOCATION"}>>\n` +
        `Rules for the marker:\n` +
        `  - Output it ONLY when you have all three fields. Never output a partial marker.\n` +
        `  - Use valid JSON with double quotes. No comments, no extra keys.\n` +
        `  - Do NOT mention the marker, JSON, or this instruction to the customer.\n` +
        `  - Do NOT translate the keys (name/plan/location must stay in English).`;
    } else if (installationState === 'submitted') {
      systemPrompt += `\n\nInstallation status: This customer's installation details have already been collected and our team has been notified. If they ask about installation again, reassure them the team will reach out to schedule and ask if there's anything else you can help with in the meantime. Do not promise a specific time or date. Do NOT output the installation marker again.`;
    }

    const [aiResponse, complaint, intentResult] = await Promise.all([
      generateAIResponse(systemPrompt, historyResult.rows),
      classifyComplaint(messageText),
      classifyIntent(messageText),
    ]);

    let customerReply = aiResponse;
    const markerMatch = aiResponse.match(INSTALL_MARKER_RE);
    if (markerMatch && installationState === 'collecting') {
      let details = null;
      try {
        details = JSON.parse(markerMatch[1]);
      } catch (e) {
        console.error('Installation marker JSON parse failed:', e.message, markerMatch[1]);
      }

      if (details && details.name && details.plan && details.location) {
        const installName = String(details.name).trim();
        const installPlan = String(details.plan).trim();
        const installLocation = String(details.location).trim();

        const notice =
          `New installation request\n\n` +
          `Customer name: ${installName}\n` +
          `Customer number: +${phoneNumber}\n` +
          `Plan: ${installPlan}\n` +
          `Location: ${installLocation}\n\n` +
          `Please reach out to schedule the installation.`;

        const { notifyStatus, notifyError } = await notifySupport(client, supportNumber, notice);
        if (notifyStatus === 'sent') {
          console.log(`Forwarded installation request to support (${supportNumber}) for customer ${phoneNumber}.`);
        } else if (notifyStatus === 'no_support_number') {
          console.warn(`[client ${client.id}] Installation submitted but no support_number configured.`);
        }

        await db.query(
          `INSERT INTO escalations
             (conversation_id, client_id, customer_phone, customer_name, trigger_message,
              support_number, notify_status, notify_error, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'installation')`,
          [
            conversation.id,
            client.id,
            phoneNumber,
            installName,
            `Plan: ${installPlan} | Location: ${installLocation}`,
            supportNumber || null,
            notifyStatus,
            notifyError,
          ]
        );

        await db.query(
          `UPDATE conversations SET installation_state = 'submitted', customer_name = COALESCE($1, customer_name) WHERE id = $2`,
          [installName || null, conversation.id]
        );
        installationState = 'submitted';

        const firstName = installName.split(/\s+/)[0];
        const greeting = firstName ? `Hi ${firstName}, ` : '';
        const businessName = (client.business_name || client.name || 'our team').trim();
        const customerSms =
          `${greeting}thanks for your ${businessName} installation request. ` +
          `Plan: ${installPlan}. Location: ${installLocation}. ` +
          `Our team has been notified and will contact you shortly to schedule.` +
          (supportNumber ? ` Urgent? Call/WhatsApp +${supportNumber}.` : '');
        try {
          await sendSMS(phoneNumber, customerSms);
          console.log(`Installation confirmation SMS sent to ${phoneNumber}.`);
        } catch (err) {
          console.error(
            `Installation confirmation SMS to ${phoneNumber} failed:`,
            formatErr(err)
          );
        }
      }
    }
    customerReply = stripInstallMarker(customerReply);

    if (intentResult && intentResult.intent) {
      await dispatchToEmployee({
        client,
        conversation,
        intent: intentResult.intent,
        messageText,
        phoneNumber,
      });
    }

    if (complaint && complaint.isComplaint && complaint.summary) {
      try {
        await db.query(
          `INSERT INTO escalations
             (conversation_id, client_id, customer_phone, customer_name, trigger_message,
              support_number, notify_status, notify_error, type, summary)
           VALUES ($1, $2, $3, $4, $5, NULL, 'logged', NULL, 'complaint', $6)`,
          [
            conversation.id,
            client.id,
            phoneNumber,
            conversation.customer_name,
            `[${complaint.category}] ${messageText}`,
            complaint.summary,
          ]
        );
        console.log(`Logged complaint from ${phoneNumber}: "${complaint.summary}"`);
      } catch (err) {
        console.error('Failed to log complaint:', err.message);
      }
    }

    const isFirstReply = isNew && !conversation.disclosure_sent_at;
    if (isFirstReply) {
      await db.query(
        `UPDATE conversations SET disclosure_sent_at = NOW() WHERE id = $1`,
        [conversation.id]
      );
    }

    const disclosure = DISCLOSURE_TEMPLATE(client.business_name || client.name);

    if (inboundIsVoice) {
      if (isFirstReply) {
        await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, disclosure);
        await persistOutgoing(conversation.id, disclosure);
      }
      await deliverReply(client, phoneNumber, customerReply, true, voiceId);
      await persistOutgoing(conversation.id, customerReply);
      console.log(`AI voice reply sent to ${phoneNumber}.`);
    } else {
      const outgoing = isFirstReply ? `${disclosure}\n\n${customerReply}` : customerReply;
      await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, outgoing);
      await persistOutgoing(conversation.id, outgoing);
      console.log(`AI reply sent to ${phoneNumber}.`);
    }
  } catch (err) {
    console.error('Error processing webhook:', err.message);
  }
});

module.exports = router;
