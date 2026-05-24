const db = require('../db');

const FEEDBACK_BUTTONS = [
  { id: 'cx_excellent', title: 'Excellent' },
  { id: 'cx_okay', title: 'Okay' },
  { id: 'cx_need_help', title: 'Need help' },
];

const FEEDBACK_CHOICES = {
  cx_excellent: { key: 'excellent', label: 'Excellent', score: 5, requiresFollowup: false },
  cx_okay: { key: 'okay', label: 'Okay', score: 3, requiresFollowup: false },
  cx_need_help: { key: 'need_help', label: 'Still needs help', score: 1, requiresFollowup: true },
};

let schemaReady = false;
let schemaPromise = null;

async function ensureRemarksSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS client_remarks (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        customer_phone VARCHAR(50) NOT NULL,
        customer_name VARCHAR(255),
        survey_reason TEXT,
        requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        response_key VARCHAR(30) CHECK (response_key IN ('excellent', 'okay', 'need_help')),
        response_label VARCHAR(60),
        score INTEGER CHECK (score BETWEEN 1 AND 5),
        responded_at TIMESTAMP WITH TIME ZONE,
        requires_followup BOOLEAN NOT NULL DEFAULT FALSE,
        reviewed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE (conversation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_client_remarks_client_requested ON client_remarks(client_id, requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_client_remarks_followup ON client_remarks(client_id, requires_followup, reviewed_at);
    `).then(() => { schemaReady = true; });
  }
  return schemaPromise;
}

function looksLikeConversationComplete(customerMessage, agentReply = '') {
  const text = String(customerMessage || '').toLowerCase().trim();
  const reply = String(agentReply || '').toLowerCase();
  if (!text || text.length > 180) return false;
  if (/\b(not working|still not|still down|no internet|not fixed|didn'?t work|red los|problem|issue remains|help me|same issue)\b/i.test(text)) return false;
  const clearClosure = /\b(thank you|thanks|asante|sorted|resolved|fixed now|working now|it works now|it is working|it works|all good|that'?s all|i'?m good)\b/i;
  const politeClosure = /^(okay|ok|sawa|poa|great|nice|perfect|good)\s*(thanks|thank you|asante)?[.! ]*$/i;
  if (!(clearClosure.test(text) || politeClosure.test(text))) return false;
  if (/share|send|provide|what is your|please confirm|try these steps|close-up photo/i.test(reply)) return false;
  return true;
}

async function hasSurveyForConversation(conversationId) {
  await ensureRemarksSchema();
  const result = await db.query('SELECT id, response_key FROM client_remarks WHERE conversation_id = $1 LIMIT 1', [conversationId]);
  return result.rows[0] || null;
}

async function createSurveyRequest({ clientId, conversationId, customerPhone, customerName, reason }) {
  await ensureRemarksSchema();
  const result = await db.query(
    `INSERT INTO client_remarks (client_id, conversation_id, customer_phone, customer_name, survey_reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (conversation_id) DO NOTHING
     RETURNING *`,
    [clientId, conversationId, customerPhone, customerName || null, reason || null]
  );
  return result.rows[0] || null;
}

async function saveButtonResponse(conversationId, buttonId) {
  await ensureRemarksSchema();
  const choice = FEEDBACK_CHOICES[buttonId];
  if (!choice) return null;
  const result = await db.query(
    `UPDATE client_remarks
     SET response_key = $1, response_label = $2, score = $3, responded_at = NOW(), requires_followup = $4
     WHERE conversation_id = $5 AND response_key IS NULL
     RETURNING *`,
    [choice.key, choice.label, choice.score, choice.requiresFollowup, conversationId]
  );
  return result.rows[0] ? { remark: result.rows[0], choice } : null;
}

module.exports = { FEEDBACK_BUTTONS, ensureRemarksSchema, looksLikeConversationComplete, hasSurveyForConversation, createSurveyRequest, saveButtonResponse };
