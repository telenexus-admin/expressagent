const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findPhoneRecipient,
  normalizeClientEvolutionRecipient,
} = require('./evolutionInboundRecipient');

function runMiddleware(body) {
  const req = { body };
  let called = false;
  normalizeClientEvolutionRecipient(req, {}, () => { called = true; });
  assert.equal(called, true);
  return req;
}

test('prefers remoteJidAlt phone JID over a WhatsApp LID', () => {
  const body = {
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '24700322238@lid',
        remoteJidAlt: '254700322238@s.whatsapp.net',
        fromMe: false,
        id: 'message-1',
      },
      message: { conversation: 'Hello' },
    },
  };

  const req = runMiddleware(body);
  assert.equal(body.data.key.remoteJid, '254700322238@s.whatsapp.net');
  assert.equal(body.data.key.remoteJidLid, '24700322238@lid');
  assert.equal(req.evolutionRecipientNormalized, true);
});

test('finds a nested senderPn when remoteJidAlt is absent', () => {
  const body = {
    data: {
      key: { remoteJid: '24700322238@lid', fromMe: false, id: 'message-2' },
      metadata: { senderPn: '254711222333@s.whatsapp.net' },
      message: { conversation: 'Hi' },
    },
  };

  assert.equal(findPhoneRecipient(body), '254711222333@s.whatsapp.net');
  runMiddleware(body);
  assert.equal(body.data.key.remoteJid, '254711222333@s.whatsapp.net');
});

test('leaves legacy phone JIDs unchanged', () => {
  const body = {
    data: {
      key: {
        remoteJid: '254722333444@s.whatsapp.net',
        remoteJidAlt: '254722333444@s.whatsapp.net',
        fromMe: false,
      },
    },
  };

  const req = runMiddleware(body);
  assert.equal(body.data.key.remoteJid, '254722333444@s.whatsapp.net');
  assert.equal(body.data.key.remoteJidLid, undefined);
  assert.equal(req.evolutionRecipientNormalized, undefined);
});

test('keeps the LID when no safe phone-number alternate exists', () => {
  const body = {
    data: {
      key: { remoteJid: '24700322238@lid', fromMe: false },
      sender: '254700000000',
    },
  };

  runMiddleware(body);
  assert.equal(body.data.key.remoteJid, '24700322238@lid');
  assert.equal(body.data.key.remoteJidLid, undefined);
});
