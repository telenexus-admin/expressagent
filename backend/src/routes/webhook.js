const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateAIResponse, analyzeSupportImage, transcribeAudio, synthesizeVoice, classifyComplaint, classifyIntent } = require('../services/openai');
const {
  sendWhatsAppMessage,
  downloadWhatsAppMedia,
  uploadWhatsAppMedia,
  sendWhatsAppVoiceNote,
} = require('../services/whatsapp');
const { sendSMS } = require('../services/sms');
const { sendInstallationRequestEmail } = require('../services/email');

function formatErr(err) {
  return typeof err.response?.data === 'object'
    ? JSON.stringify(err.response.data)
    : (err.response?.data || err.message || 'unknown error');
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
    await sendSMS(supportNumber, message);
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

    let notifyStatus = 'sent';
    let notifyError = null;
    try {
      await sendSMS(route.emp_phone, notice);
      console.log(`[client ${client.id}] Dispatched intent="${intent}" to employee "${route.emp_name}" (${route.emp_phone}).`);
    } catch (err) {
      notifyStatus = 'failed';
      notifyError = formatErr(err);
      console.error(`Dispatch SMS to employee ${route.emp_name} (${route.emp_phone}) failed:`, notifyError);
    }

    await db.query(
      `INSERT INTO workflow_dispatches
         (conversation_id, client_id, intent_key, employee_id, customer_phone,
          trigger_message, notify_status, notify_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (conversation_id, intent_key) DO NOTHING`,
      [conversation.id, client.id, intent, route.employee_id, phoneNumber, messageText, notifyStatus, notifyError]
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
const HUMAN_KEYWORDS = new Set(['human', 'agent', 'person', 'representative', 'support', 'mtu', 'mwakilishi', 'msaada']);
const HUMAN_ESCALATION_REGEX = new RegExp(`\\b(${[...HUMAN_KEYWORDS].join('|')})\\b`, 'i');
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPRESSNET_CLIENT_ID = 1;

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
    const { conversation } = await findOrCreateConversation(client.id, phoneNumber, profileName);

    let messageText;
    let inboundIsVoice = false;
    let inboundIsImage = false;
    let inboundImageBuffer = null;
    let inboundImageMimeType = null;
    let inboundImageCaption = '';
    if (message.type === 'audio' || message.type === 'voice') {
      const mediaId = message.audio?.id || message.voice?.id;
      try {
        const { buffer, mimeType } = await downloadWhatsAppMedia(client.meta_access_token, mediaId);
        const ext = (mimeType && mimeType.split('/')[1]?.split(';')[0]) || 'ogg';
        const transcript = (await transcribeAudio(buffer, `inbound.${ext}`)).trim();
        if (!transcript) return;
        messageText = transcript;
        inboundIsVoice = true;
        console.log(`[client ${client.id}] Transcribed voice from ${phoneNumber}: "${messageText}"`);
      } catch (err) {
        console.error('Failed to transcribe inbound audio:', err.response?.data || err.message);
        await db.query(`INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'user', $2, $3)`, [conversation.id, '[voice note — transcription failed]', timestamp]);
        if (conversation.opted_out_at) return;
        const notice = "Sorry, I couldn't understand that voice note. Could you send it again or type your message?";
        await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, notice);
        await persistOutgoing(conversation.id, notice);
        return;
      }
    } else if (message.type === 'image' && client.id === EXPRESSNET_CLIENT_ID) {
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
    } else {
      console.log(`[client ${client.id}] Unsupported message type (${message.type}) from ${phoneNumber}.`);
      await db.query(`INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'user', $2, $3)`, [conversation.id, `[${message.type} message — not processed]`, timestamp]);
      if (conversation.opted_out_at) return;
      const notice = client.id === EXPRESSNET_CLIENT_ID
        ? "Sorry, I can handle text, voice notes and router/support photos. Please send one of those."
        : "Sorry, I can only handle text and voice notes right now. Please send one of those.";
      await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, notice);
      await persistOutgoing(conversation.id, notice);
      return;
    }

    const normalized = messageText.toLowerCase();
    const persistedMessageText = inboundIsImage
      ? `[Image received] ${inboundImageCaption || 'Customer sent a router/support photo for checking.'}`
      : messageText;
    await db.query(`INSERT INTO messages (conversation_id, role, content, timestamp) VALUES ($1, 'user', $2, $3)`, [conversation.id, persistedMessageText, timestamp]);
    await db.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversation.id]);

    if (conversation.opted_out_at && RESUME_KEYWORDS.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NULL WHERE id = $1`, [conversation.id]);
      const reply = "You're resubscribed. How can I help you today?";
      await deliverReply(client, phoneNumber, reply, inboundIsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }
    if (conversation.opted_out_at) return;
    if (OPT_OUT_KEYWORDS.has(normalized)) {
      await db.query(`UPDATE conversations SET opted_out_at = NOW() WHERE id = $1`, [conversation.id]);
      const reply = "You've been unsubscribed. You will not receive further messages from this assistant. Reply START at any time to resume.";
      await deliverReply(client, phoneNumber, reply, inboundIsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }
    if (conversation.status === 'human_takeover') return;

    const supportNumber = (client.support_number || '').replace(/[^0-9]/g, '');
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
      const reply = supportNumber
        ? "Thanks — I've forwarded your request to our customer support team. Someone will reach out to you shortly."
        : "Thanks — I've flagged your request for our team. Someone will reach out to you shortly.";
      await deliverReply(client, phoneNumber, reply, inboundIsVoice);
      await persistOutgoing(conversation.id, reply);
      return;
    }

    let installationState = conversation.installation_state || null;
    if (!inboundIsImage && !installationState && INSTALL_REGEX.test(normalized)) {
      await db.query(`UPDATE conversations SET installation_state = 'collecting' WHERE id = $1`, [conversation.id]);
      installationState = 'collecting';
    }

    const historyResult = await db.query(
      `SELECT role, content FROM (
         SELECT role, content, timestamp FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20
       ) recent ORDER BY timestamp ASC`,
      [conversation.id]
    );
    const basePrompt = client.system_prompt || 'You are a helpful customer support agent.';
    const agentName = (client.agent_name || '').trim();
    const voiceId = (client.voice_id || '').trim() || 'alloy';
    let systemPrompt = basePrompt;
    if (agentName) systemPrompt = `Your name is ${agentName}. If a customer asks your name, introduce yourself as ${agentName}.\n\n${systemPrompt}`;
    if (conversation.customer_name) {
      const firstName = conversation.customer_name.split(/\s+/)[0];
      systemPrompt += `\n\nThe customer's WhatsApp display name is "${conversation.customer_name}" (first name: "${firstName}"). For the first reply, begin naturally with "Hi ${firstName}!" or the Swahili equivalent when appropriate. Do not repeat the greeting on every follow-up.`;
    }
    if (supportNumber) systemPrompt += `\n\nIf human escalation is appropriate, tell the customer they can reach live support at ${supportNumber}.`;
    if (client.id === EXPRESSNET_CLIENT_ID) {
      systemPrompt +=
        `\n\nPHOTO-ASSISTED TROUBLESHOOTING FOR EXPRESSNET:\n` +
        `When a customer is reporting internet trouble but cannot clearly describe the router or fibre terminal lights, you may politely ask them to send a clear photo of the device front panel showing the indicator lights and connected cables. ` +
        `Ask them not to include Wi-Fi passwords, account labels or private information in the photo. ` +
        `When a photo is provided, describe only what is clearly visible. Common guidance: a visible red LOS light may indicate a fibre signal problem requiring technical follow-up; a missing power light may suggest checking power; Wi-Fi/WLAN light alone does not confirm internet availability. ` +
        `Never claim that a photo proves the complete fault or that a technician has been dispatched unless the workflow confirms it. If the photo is unclear, ask for a clearer close-up or escalate appropriately.`;
    }
    if (installationState === 'collecting') {
      systemPrompt +=
        `\n\nINSTALLATION ONBOARDING — IN PROGRESS\n` +
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

    const aiTask = inboundIsImage
      ? analyzeSupportImage(systemPrompt, historyResult.rows, inboundImageBuffer, inboundImageMimeType, inboundImageCaption)
      : generateAIResponse(systemPrompt, historyResult.rows);
    const classificationText = inboundIsImage
      ? `Customer sent a router/support image${inboundImageCaption ? ` with caption: ${inboundImageCaption}` : ''}.`
      : messageText;
    const [aiResponse, complaint, intentResult] = await Promise.all([
      aiTask,
      classifyComplaint(classificationText),
      classifyIntent(classificationText),
    ]);

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
        await db.query(`UPDATE conversations SET installation_state = 'submitted', customer_name = COALESCE($1, customer_name) WHERE id = $2`, [installName || null, conversation.id]);
        installationState = 'submitted';
        const firstName = installName.split(/\s+/)[0];
        const customerSms = `Hi ${firstName}, thanks for your installation request. Plan: ${installPlan}. Location: ${installLocation}. Our team has been notified and will contact you shortly to schedule.` + (supportNumber ? ` For urgent help, call/WhatsApp +${supportNumber}.` : '');
        try {
          await sendSMS(phoneNumber, customerSms);
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

    if (intentResult && intentResult.intent) {
      await dispatchToEmployee({ client, conversation, intent: intentResult.intent, messageText: classificationText, phoneNumber });
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
    }

    if (inboundIsVoice) {
      await deliverReply(client, phoneNumber, customerReply, true, voiceId);
      await persistOutgoing(conversation.id, customerReply);
      console.log(`AI voice reply sent to ${phoneNumber}.`);
    } else {
      await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phoneNumber, customerReply);
      await persistOutgoing(conversation.id, customerReply);
      console.log(inboundIsImage ? `AI image-guided reply sent to ${phoneNumber}.` : `AI reply sent to ${phoneNumber}.`);
    }
  } catch (err) {
    console.error('Error processing webhook:', err.message);
  }
});

module.exports = router;
