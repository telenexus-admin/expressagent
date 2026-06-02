const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const axios = require('axios');
const FormData = require('form-data');
const { withIspKnowledge } = require('./ispKnowledge');

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

function openaiTimeoutMs() {
  const parsed = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || '20000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
}

function chatModel() {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

function visionModel() {
  return process.env.OPENAI_VISION_MODEL || chatModel();
}

function transcriptionModel() {
  return process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1';
}

function transcriptionTransport() {
  return String(process.env.OPENAI_TRANSCRIPTION_TRANSPORT || 'http').toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableOpenAIError(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  const message = String(err?.message || '').toLowerCase();
  return status === 408 || status === 409 || status === 429 || status >= 500 || message.includes('connection');
}

async function withOpenAIRetry(label, task, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isRetryableOpenAIError(err)) throw err;
      console.warn(`${label} failed on attempt ${attempt}/${attempts}: ${err.message}. Retrying...`);
      await sleep(600 * attempt);
    }
  }
  throw lastError;
}

async function transcribeAudioViaHttp(buffer, filename, contentType) {
  const form = new FormData();
  form.append('file', buffer, {
    filename,
    contentType,
    knownLength: buffer.length,
  });
  form.append('model', transcriptionModel());

  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: openaiTimeoutMs() * 2,
  });
  return response.data;
}

async function generateAIResponse(systemPrompt, messageHistory) {
  const hardenedPrompt = withIspKnowledge(systemPrompt);
  const continuityInstruction =
    `\n\nVISUAL SUPPORT CONTINUITY:\n` +
    `If the earlier conversation includes a reply about a customer photo, treat the visible device names, labels, lights and cable observations already stated in that reply as available context for follow-up questions. ` +
    `For example, if an earlier photo reply identified a MikroTik RouterBOARD hEX, answer a later question about the router using that recorded identification. ` +
    `Do not claim you cannot identify a device simply because the customer asks about it after the image message. Never invent details that were not previously observed.`;
  const messages = [
    { role: 'system', content: `${hardenedPrompt}${continuityInstruction}` },
    ...messageHistory.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })),
  ];

  const response = await getClient().chat.completions.create({
    model: chatModel(),
    messages,
    max_tokens: 1024,
    temperature: 0.45,
  }, { timeout: openaiTimeoutMs() });

  return response.choices[0].message.content;
}

// Inspect a customer-supplied support image, such as router LEDs or cabling.
// The reply is intentionally self-contained because it is persisted in chat history
// and becomes reliable context when the customer asks follow-up questions later.
async function analyzeSupportImage(systemPrompt, messageHistory, imageBuffer, mimeType = 'image/jpeg', caption = '') {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('Image buffer is empty.');
  }

  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`;
  const latestText =
    `You are now performing a careful visual inspection of an ISP customer's troubleshooting photo. ` +
    `${caption ? `The customer caption is: "${caption}". ` : ''}` +
    `Give a useful WhatsApp reply based only on what is actually visible.\n\n` +
    `REQUIRED INSPECTION BEHAVIOUR:\n` +
    `1. First look for visible brand names, model markings and printed labels on every networking device. If any are readable, state them clearly (for example RouterBOARD, hEX, MikroTik, Huawei, TP-Link, LOS, PON, WLAN). Do not hide a readable identification behind generic advice.\n` +
    `2. Describe the visible equipment and physical setup briefly: devices, ports, power adapters, cable connections and visible LEDs.\n` +
    `3. State what cannot be confirmed from the current angle or lighting, especially if indicator lights are not visible.\n` +
    `4. Give the best next troubleshooting step or request the exact close-up photo needed next.\n` +
    `5. Be honest: do not invent a model number, light colour, outage cause or technician dispatch.\n\n` +
    `Your answer must be self-contained because it will be remembered as the visual inspection summary for later customer follow-up. ` +
    `Use a natural, confident and helpful tone; do not say you cannot identify models through photos when a visible label allows identification.`;

  const messages = [
    { role: 'system', content: withIspKnowledge(systemPrompt) },
    ...messageHistory.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })),
    {
      role: 'user',
      content: [
        { type: 'text', text: latestText },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ],
    },
  ];

  const response = await getClient().chat.completions.create({
    model: visionModel(),
    messages,
    max_tokens: 1200,
    temperature: 0.2,
  }, { timeout: openaiTimeoutMs() });

  return response.choices[0].message.content;
}

function audioMimeFromFilename(filename) {
  const value = String(filename || '').toLowerCase();
  if (value.endsWith('.mp3')) return 'audio/mpeg';
  if (value.endsWith('.mp4')) return 'audio/mp4';
  if (value.endsWith('.m4a')) return 'audio/mp4';
  if (value.endsWith('.wav')) return 'audio/wav';
  if (value.endsWith('.webm')) return 'audio/webm';
  if (value.endsWith('.ogg') || value.endsWith('.oga') || value.endsWith('.opus')) return 'audio/ogg';
  return 'application/octet-stream';
}

function normalizeAudioFilename(filename, mimeType) {
  const clean = String(filename || '').replace(/[^\w.-]/g, '');
  if (clean && clean.includes('.')) return clean;
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('mp4') || mime.includes('m4a')) return 'audio.mp4';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'audio.mp3';
  if (mime.includes('wav')) return 'audio.wav';
  if (mime.includes('webm')) return 'audio.webm';
  if (mime.includes('ogg') || mime.includes('opus')) return 'audio.ogg';
  return 'audio.ogg';
}

// Transcribe an audio buffer to text via Whisper.
async function transcribeAudio(buffer, filename = 'audio.ogg', mimeType = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Audio buffer is empty.');
  }
  const safeFilename = normalizeAudioFilename(filename, mimeType);
  const contentType = mimeType || audioMimeFromFilename(safeFilename);
  let result;
  if (transcriptionTransport() === 'http') {
    result = await withOpenAIRetry('Audio transcription HTTP', () =>
      transcribeAudioViaHttp(buffer, safeFilename, contentType)
    );
    return result.text;
  }

  const file = await toFile(buffer, safeFilename, { type: contentType });
  try {
    result = await withOpenAIRetry('Audio transcription', () =>
      getClient().audio.transcriptions.create({
        file,
        model: transcriptionModel(),
      }, { timeout: openaiTimeoutMs() * 2 })
    );
  } catch (err) {
    if (!isRetryableOpenAIError(err)) throw err;
    console.warn(`Audio transcription SDK failed after retries: ${err.message}. Trying direct HTTP upload...`);
    result = await withOpenAIRetry('Audio transcription HTTP fallback', () =>
      transcribeAudioViaHttp(buffer, safeFilename, contentType)
    );
  }
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

module.exports = { generateAIResponse, analyzeSupportImage, transcribeAudio, synthesizeVoice, classifyComplaint, classifyIntent };
