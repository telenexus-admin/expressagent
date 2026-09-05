const assert = require('assert');
const axios = require('axios');
const {
  KCB_SANDBOX_TOKEN_URL,
  credentialsComplete,
  loadKcbBuniConfig,
  publicKcbBuniStatus,
  testKcbBuniConnection,
} = require('../src/services/kcbBuni');

async function run() {
  const sandbox = loadKcbBuniConfig({
    environment: 'sandbox',
    clientId: 'sandbox-client',
    clientSecret: 'sandbox-secret',
    tokenUrl: '',
  });
  assert.strictEqual(sandbox.environment, 'sandbox');
  assert.strictEqual(sandbox.tokenUrl, KCB_SANDBOX_TOKEN_URL);
  assert.strictEqual(credentialsComplete(sandbox), true);

  const productionMissingEndpoint = loadKcbBuniConfig({
    environment: 'production',
    clientId: 'production-client',
    clientSecret: 'production-secret',
    tokenUrl: '',
    commercialApproved: true,
  });
  assert.strictEqual(productionMissingEndpoint.tokenUrl, '');
  assert.strictEqual(credentialsComplete(productionMissingEndpoint), false);

  const safe = publicKcbBuniStatus(loadKcbBuniConfig({
    enabled: true,
    environment: 'production',
    clientId: 'real-client-id',
    clientSecret: 'super-secret-value',
    tokenUrl: 'https://bank.example.test/token',
    apiBaseUrl: 'https://bank.example.test/api',
    commercialApproved: true,
  }));
  assert.strictEqual(safe.configured, true);
  assert.strictEqual(safe.has_client_id, true);
  assert.strictEqual(safe.has_client_secret, true);
  assert.strictEqual(safe.token_host, 'bank.example.test');
  assert.strictEqual(safe.commercial_approved, true);
  assert.strictEqual(safe.live_dispatch_implemented, false);
  assert.strictEqual(safe.live_dispatch_allowed, false);
  assert.ok(!JSON.stringify(safe).includes('real-client-id'));
  assert.ok(!JSON.stringify(safe).includes('super-secret-value'));

  assert.throws(
    () => loadKcbBuniConfig({ environment: 'sandbox', tokenUrl: 'http://insecure.example.test/token' }),
    /HTTPS/
  );

  const originalPost = axios.post;
  let captured;
  axios.post = async (url, body, options) => {
    captured = { url, body, options };
    return {
      data: {
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    };
  };

  try {
    const result = await testKcbBuniConnection({
      environment: 'sandbox',
      clientId: 'ci-client',
      clientSecret: 'ci-secret',
      tokenUrl: KCB_SANDBOX_TOKEN_URL,
      commercialApproved: false,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.oauth, 'connected');
    assert.strictEqual(result.live_dispatch_allowed, false);
    assert.strictEqual(captured.url, KCB_SANDBOX_TOKEN_URL);
    assert.strictEqual(captured.body, 'grant_type=client_credentials');
    assert.strictEqual(
      captured.options.headers.Authorization,
      `Basic ${Buffer.from('ci-client:ci-secret').toString('base64')}`
    );
    assert.strictEqual(captured.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  } finally {
    axios.post = originalPost;
  }

  console.log('KCB Buni adapter tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
