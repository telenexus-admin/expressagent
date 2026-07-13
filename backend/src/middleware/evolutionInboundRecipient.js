const PHONE_JID_KEYS = new Set([
  'remoteJidAlt',
  'participantAlt',
  'senderPn',
  'participantPn',
  'remoteJidPn',
]);

function isLidJid(value) {
  return /@lid$/i.test(String(value || '').trim());
}

function isPhoneRecipient(value) {
  const text = String(value || '').trim();
  return /@s\.whatsapp\.net$/i.test(text) || /^\+?\d{7,15}$/.test(text);
}

function findPhoneRecipient(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return '';
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (PHONE_JID_KEYS.has(key) && typeof child === 'string' && isPhoneRecipient(child)) {
      return child.trim();
    }
  }

  for (const child of Object.values(value)) {
    if (!child || typeof child !== 'object') continue;
    const found = findPhoneRecipient(child, depth + 1, seen);
    if (found) return found;
  }
  return '';
}

function findMessageKey(payload) {
  const root = payload?.data || payload;
  const data = Array.isArray(root?.messages)
    ? root.messages[0]
    : Array.isArray(root)
      ? root[0]
      : (root?.data || root);

  if (data?.key && typeof data.key === 'object') return data.key;
  if (data?.message?.key && typeof data.message.key === 'object') return data.message.key;

  const seen = new Set();
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return null;
    seen.add(value);
    if (typeof value.remoteJid === 'string' && Object.prototype.hasOwnProperty.call(value, 'fromMe')) {
      return value;
    }
    for (const child of Object.values(value)) {
      const found = walk(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  return walk(payload);
}

function normalizeClientEvolutionRecipient(req, _res, next) {
  try {
    const key = findMessageKey(req.body);
    if (!key || key.fromMe === true || !isLidJid(key.remoteJid)) return next();

    const phoneRecipient = findPhoneRecipient(req.body);
    if (!phoneRecipient) {
      console.warn('[evolution] Incoming @lid message has no phone-number alternate; keeping LID recipient.');
      return next();
    }

    key.remoteJidLid = key.remoteJid;
    key.remoteJid = phoneRecipient;
    req.evolutionRecipientNormalized = true;
  } catch (err) {
    console.error('[evolution] Failed to normalize incoming recipient:', err.message);
  }
  return next();
}

module.exports = {
  findMessageKey,
  findPhoneRecipient,
  isLidJid,
  normalizeClientEvolutionRecipient,
};
