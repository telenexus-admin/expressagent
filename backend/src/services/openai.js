const OpenAI = require('openai');
const { toFile } = require('openai/uploads');

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

async function generateAIResponse(systemPrompt, messageHistory) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...messageHistory.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })),
  ];

  const response = await getClient().chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 1024,
    temperature: 0.7,
  });

  return response.choices[0].message.content;
}

// Transcribe an audio buffer to text via Whisper.
async function transcribeAudio(buffer, filename = 'audio.ogg') {
  const file = await toFile(buffer, filename);
  const result = await getClient().audio.transcriptions.create({
    file,
    model: 'whisper-1',
  });
  return result.text;
}

// Synthesize speech to an Opus (OGG) buffer suitable for WhatsApp voice notes.
async function synthesizeVoice(text, voice = 'alloy') {
  const result = await getClient().audio.speech.create({
    model: 'tts-1',
    voice,
    input: text,
    response_format: 'opus',
  });
  return Buffer.from(await result.arrayBuffer());
}

// Dedicated complaint classifier. Returns structured JSON so the webhook can
// log complaints to the Complaints tab without relying on the main reply model
// to emit a hidden marker (which it dropped too often in practice).
async function classifyComplaint(userMessage) {
  const systemPrompt =
    `You classify customer WhatsApp messages for Expressnet, a Kenyan ISP.\n` +
    `Decide whether the customer's latest message is a genuine complaint or service issue.\n\n` +
    `Counts as a complaint: internet down or not working, no connection, red lights on router, ` +
    `slow speeds, getting less than the package speed, frequent disconnections, billing dispute, ` +
    `overcharge, technician didn't show up, poor service, device/router broken, frustration with ` +
    `how an issue was handled.\n\n` +
    `Does NOT count as a complaint: greetings, pricing/package enquiries, installation requests, ` +
    `general questions, asking to speak with a human (unless paired with a specific issue), ` +
    `confirmations, thanks.\n\n` +
    `Reply with JSON only:\n` +
    `{"isComplaint": true | false, "summary": "one English sentence, max 140 chars", "category": "connectivity" | "speed" | "billing" | "support" | "hardware" | "other"}\n\n` +
    `If isComplaint is false, set summary to "" and category to "other". Always write summary in English even if the customer wrote in Swahili.`;

  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 200,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return {
      isComplaint: parsed.isComplaint === true,
      summary: (parsed.summary || '').toString().trim().slice(0, 200),
      category: ['connectivity', 'speed', 'billing', 'support', 'hardware', 'other'].includes(parsed.category)
        ? parsed.category
        : 'other',
    };
  } catch (err) {
    console.error('classifyComplaint failed:', err.message);
    return { isComplaint: false, summary: '', category: 'other' };
  }
}

// Classify a customer message into one of the workflow intents so the webhook
// can dispatch to the right employee. Returns one of the keys from intents.js,
// or 'general_inquiry' as a safe default.
const { INTENT_KEYS } = require('./intents');

async function classifyIntent(userMessage) {
  const systemPrompt =
    `You classify customer WhatsApp messages for a Kenyan ISP into ONE workflow category.\n\n` +
    `Categories:\n` +
    `- new_installation: wants to sign up / install fibre / subscribe / get connected for the first time\n` +
    `- payment_billing: payment problem, refund, overcharge, M-Pesa issue, invoice or bill question\n` +
    `- technical_issue: internet down, slow, router red lights, equipment broken, frequent disconnects\n` +
    `- human_request: explicitly asks for a person/agent/human, or is angry/frustrated\n` +
    `- compliment_feedback: positive feedback, thanks, suggestions worth flagging to a manager\n` +
    `- general_inquiry: pricing questions, hours, coverage area, plans, greetings, anything else\n\n` +
    `Pick the SINGLE best fit. If unsure, choose general_inquiry.\n\n` +
    `Reply with JSON only: {"intent":"<key>","confidence":0..1}`;

  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 60,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    const intent = INTENT_KEYS.includes(parsed.intent) ? parsed.intent : 'general_inquiry';
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    return { intent, confidence };
  } catch (err) {
    console.error('classifyIntent failed:', err.message);
    return { intent: 'general_inquiry', confidence: 0 };
  }
}

module.exports = { generateAIResponse, transcribeAudio, synthesizeVoice, classifyComplaint, classifyIntent };
