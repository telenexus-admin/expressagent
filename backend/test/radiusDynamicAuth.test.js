const assert = require('assert');

const {
  ATTR,
  MIKROTIK_RATE_LIMIT,
  MIKROTIK_VENDOR_ID,
  RADIUS_CODES,
  buildDynamicAuthorizationPacket,
  disconnectSubscriberSessions,
  integerAttribute,
  updateSubscriberPolicy,
} = require('../src/services/radiusDynamicAuth');

function fakeQueryable({ sessions = null, nas = null } = {}) {
  return {
    async query(sql) {
      if (sql.includes('FROM radacct')) {
        return {
          rows: sessions || [{
            radacctid: 91,
            username: 'john.1024',
            acctsessionid: 'session-abc',
            framedipaddress: '10.30.0.55',
            nasipaddress: '10.78.0.11',
            callingstationid: 'AA:BB:CC:DD:EE:FF',
          }],
        };
      }
      if (sql.includes('FROM nas')) {
        return { rows: nas === null ? [{ nasname: '10.78.0.11', shortname: 'ccr-1', secret: 'test-radius-secret-123456789' }] : nas };
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
}

const timeout = integerAttribute(ATTR.SESSION_TIMEOUT, 3600);
assert.strictEqual(timeout[0], 27);
assert.strictEqual(timeout[1], 6);
assert.strictEqual(timeout.readUInt32BE(2), 3600);

const requestOne = buildDynamicAuthorizationPacket({
  code: RADIUS_CODES.COA_REQUEST,
  identifier: 17,
  secret: 'shared-secret',
  attributes: [timeout],
});
const requestTwo = buildDynamicAuthorizationPacket({
  code: RADIUS_CODES.COA_REQUEST,
  identifier: 17,
  secret: 'shared-secret',
  attributes: [timeout],
});
assert.strictEqual(requestOne.packet[0], RADIUS_CODES.COA_REQUEST);
assert.strictEqual(requestOne.packet[1], 17);
assert.strictEqual(requestOne.packet.readUInt16BE(2), requestOne.packet.length);
assert.deepStrictEqual(requestOne.packet, requestTwo.packet);
assert.notDeepStrictEqual(requestOne.authenticator, Buffer.alloc(16));

(async () => {
  let coaCall;
  const coa = await updateSubscriberPolicy(
    'john.1024',
    { rateLimit: '5M/10M', sessionTimeout: 7200 },
    {
      queryable: fakeQueryable(),
      port: 1700,
      sender: async (input) => {
        coaCall = input;
        return { code: RADIUS_CODES.COA_ACK, bytes: 20 };
      },
    }
  );

  assert.strictEqual(coa.status, 'applied');
  assert.strictEqual(coa.succeeded, 1);
  assert.strictEqual(coaCall.host, '10.78.0.11');
  assert.strictEqual(coaCall.port, 1700);
  assert.strictEqual(coaCall.code, RADIUS_CODES.COA_REQUEST);
  assert.strictEqual(coaCall.secret, 'test-radius-secret-123456789');

  const vendor = coaCall.attributes.find((attribute) => attribute[0] === ATTR.VENDOR_SPECIFIC);
  assert(vendor, 'MikroTik rate-limit VSA must be present');
  assert.strictEqual(vendor.readUInt32BE(2), MIKROTIK_VENDOR_ID);
  assert.strictEqual(vendor[6], MIKROTIK_RATE_LIMIT);
  assert.strictEqual(vendor.subarray(8).toString('utf8'), '5M/10M');

  const sessionTimeout = coaCall.attributes.find((attribute) => attribute[0] === ATTR.SESSION_TIMEOUT);
  assert(sessionTimeout, 'Session-Timeout must be present');
  assert.strictEqual(sessionTimeout.readUInt32BE(2), 7200);

  let disconnectCall;
  const disconnected = await disconnectSubscriberSessions('john.1024', {
    queryable: fakeQueryable(),
    sender: async (input) => {
      disconnectCall = input;
      return { code: RADIUS_CODES.DISCONNECT_ACK, bytes: 20 };
    },
  });
  assert.strictEqual(disconnected.status, 'applied');
  assert.strictEqual(disconnectCall.code, RADIUS_CODES.DISCONNECT_REQUEST);
  assert(disconnectCall.attributes.some((attribute) => attribute[0] === ATTR.ACCT_SESSION_ID));
  assert(disconnectCall.attributes.some((attribute) => attribute[0] === ATTR.USER_NAME));

  const rejected = await disconnectSubscriberSessions('john.1024', {
    queryable: fakeQueryable(),
    sender: async () => ({ code: RADIUS_CODES.DISCONNECT_NAK, bytes: 20 }),
  });
  assert.strictEqual(rejected.status, 'failed');
  assert.strictEqual(rejected.failed, 1);

  const offline = await disconnectSubscriberSessions('john.1024', {
    queryable: fakeQueryable({ sessions: [] }),
    sender: async () => { throw new Error('sender should not be called'); },
  });
  assert.strictEqual(offline.status, 'no_active_session');
  assert.strictEqual(offline.attempted, 0);

  console.log('RADIUS dynamic authorization tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
