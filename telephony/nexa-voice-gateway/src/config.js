const requiredSecret = process.env.GATEWAY_SHARED_SECRET || '';

export const config = Object.freeze({
  host: process.env.GATEWAY_BIND_HOST || '127.0.0.1',
  port: Number(process.env.GATEWAY_PORT || 3090),
  sharedSecret: requiredSecret,
  ariUrl: process.env.ARI_URL || 'http://127.0.0.1:8088/ari',
  ariUsername: process.env.ARI_USERNAME || '',
  ariPassword: process.env.ARI_PASSWORD || '',
  ariApp: process.env.ARI_APP || 'nexa-voice-gateway',
  externalMediaHost: process.env.EXTERNAL_MEDIA_HOST || '127.0.0.1',
  externalMediaPortStart: Number(process.env.EXTERNAL_MEDIA_PORT || 12000),
  externalMediaPortMax: Number(process.env.EXTERNAL_MEDIA_PORT_MAX || 12100),
  mediaCodec: process.env.MEDIA_CODEC || 'ulaw',
  maxCallSeconds: Number(process.env.MAX_CALL_SECONDS || 1800),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiRealtimeUrl: process.env.OPENAI_REALTIME_URL || 'wss://api.openai.com/v1/realtime',
  openaiModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini',
  openaiVoice: process.env.OPENAI_VOICE || 'marin',
  voiceSpeed: Number(process.env.OPENAI_VOICE_SPEED || 1),
  vadThreshold: Number(process.env.OPENAI_VAD_THRESHOLD || 0.5),
  vadPrefixPaddingMs: Number(process.env.OPENAI_VAD_PREFIX_PADDING_MS || 300),
  vadSilenceDurationMs: Number(process.env.OPENAI_VAD_SILENCE_MS || 500),
  agentPrompt: process.env.NEXA_AGENT_PROMPT || 'You are Nexa, the AI voice assistant for Telenexus Technologies. Speak naturally, clearly, briefly, and professionally. Never invent facts or claim an action happened unless the system confirms it.',
  greetingInstruction: process.env.NEXA_GREETING || 'Greet the caller as Nexa and ask how you can help. Keep the greeting short and natural for a telephone conversation.',
});

export function validateConfig() {
  const errors = [];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) errors.push('GATEWAY_PORT must be a valid port');
  if (config.sharedSecret.length < 32) errors.push('GATEWAY_SHARED_SECRET must be at least 32 characters');
  if (!config.ariUsername) errors.push('ARI_USERNAME is required');
  if (!config.ariPassword) errors.push('ARI_PASSWORD is required');
  if (!Number.isInteger(config.externalMediaPortStart) || config.externalMediaPortStart < 1024 || config.externalMediaPortStart > 65534) errors.push('EXTERNAL_MEDIA_PORT must be a valid port');
  if (!Number.isInteger(config.externalMediaPortMax) || config.externalMediaPortMax < config.externalMediaPortStart || config.externalMediaPortMax > 65535) errors.push('EXTERNAL_MEDIA_PORT_MAX must be valid and >= EXTERNAL_MEDIA_PORT');
  if (config.mediaCodec !== 'ulaw') errors.push('MEDIA_CODEC must be ulaw for the current OpenAI PCMU bridge');
  if (!config.openaiApiKey) errors.push('OPENAI_API_KEY is required');
  if (!config.openaiModel) errors.push('OPENAI_REALTIME_MODEL is required');
  if (!Number.isFinite(config.voiceSpeed) || config.voiceSpeed < 0.25 || config.voiceSpeed > 1.5) errors.push('OPENAI_VOICE_SPEED must be between 0.25 and 1.5');
  if (!Number.isFinite(config.vadThreshold) || config.vadThreshold < 0 || config.vadThreshold > 1) errors.push('OPENAI_VAD_THRESHOLD must be between 0 and 1');
  if (!Number.isInteger(config.maxCallSeconds) || config.maxCallSeconds < 30) errors.push('MAX_CALL_SECONDS must be at least 30');
  return errors;
}
