const requiredSecret = process.env.GATEWAY_SHARED_SECRET || '';

export const config = Object.freeze({
  host: process.env.GATEWAY_BIND_HOST || '127.0.0.1',
  port: Number(process.env.GATEWAY_PORT || 3090),
  sharedSecret: requiredSecret,
  ariUrl: process.env.ARI_URL || 'http://127.0.0.1:8088/ari',
  ariUsername: process.env.ARI_USERNAME || '',
  ariPassword: process.env.ARI_PASSWORD || '',
  ariApp: process.env.ARI_APP || 'nexa-voice-gateway',
  mediaCodec: process.env.MEDIA_CODEC || 'ulaw',
  maxCallSeconds: Number(process.env.MAX_CALL_SECONDS || 1800),
});

export function validateConfig() {
  const errors = [];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) errors.push('GATEWAY_PORT must be a valid port');
  if (config.sharedSecret.length < 32) errors.push('GATEWAY_SHARED_SECRET must be at least 32 characters');
  if (!config.ariUsername) errors.push('ARI_USERNAME is required');
  if (!config.ariPassword) errors.push('ARI_PASSWORD is required');
  if (!Number.isInteger(config.maxCallSeconds) || config.maxCallSeconds < 30) errors.push('MAX_CALL_SECONDS must be at least 30');
  return errors;
}
