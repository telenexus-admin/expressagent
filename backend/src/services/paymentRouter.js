const crypto = require('crypto');
const db = require('../db');
const {
  ensureSettlementSchema,
  getSettlementProfile,
  safeProfile,
} = require('./settlementProfiles');

const ADAPTERS = Object.freeze({
  ncba: { code: 'ncba', implemented: false, name: 'NCBA settlement adapter' },
  kcb: { code: 'kcb', implemented: false, name: 'KCB settlement adapter' },
  coop: { code: 'coop', implemented: false, name: 'Co-op settlement adapter' },
  equity: { code: 'equity', implemented: false, name: 'Equity settlement adapter' },
});

const COLLECTION_STATUSES = new Set(['initiated', 'queued', 'paid', 'failed']);
let schemaPromise;

function routerEnabled() {
  return String(process.env.PAYMENT_ROUTER_ENABLED || 'true').toLowerCase() !== 'false';
}

function adapterFor(code) {
  return ADAPTERS[String(code || '').trim().toLowerCase()] || null;
}

function idempotencyKey(clientId, externalReference) {
  return crypto
    .createHash('sha256')
    .update(`${Number(clientId)}:${String(externalReference || '').trim()}`)
    .digest('hex');
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    throw new Error('Payment route amount must be a positive value');
  }
  return Number(amount.toFixed(2));
}

function normalizeCurrency(value) {
  const currency = String(value || 'KES').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Payment route currency must be a three-letter code');
  return currency;
}

function decisionForProfile(profile) {
  if (!profile) return { routeStatus: 'blocked', blockReason: 'settlement_profile_missing' };
  if (profile.verification_status !== 'verified') {
    return { routeStatus: 'blocked', blockReason: `settlement_${profile.verification_status || 'unverified'}` };
  }
  if (profile.routing_status !== 'active') {
    return { routeStatus: 'blocked', blockReason: `settlement_routing_${profile.routing_status || 'disabled'}` };
  }
  const adapter = adapterFor(profile.institution_code);
  if (!adapter?.implemented) return { routeStatus: 'blocked', blockReason: 'settlement_adapter_not_connected' };
  return { routeStatus: 'dispatch_pending', blockReason: null };
}

function safeRoute(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id,
    payment_request_id: row.payment_request_id,
    external_reference: row.external_reference,
    amount: Number(row.amount),
    currency: row.currency,
    collection_provider: row.collection_provider,
    collection_status: row.collection_status,
    settlement_profile_id: row.settlement_profile_id,
    institution_code: row.institution_code,
    route_status: row.route_status,
    block_reason: row.block_reason,
    settlement_snapshot: row.settlement_snapshot || {},
    provider_collection_reference: row.provider_collection_reference || null,
    provider_settlement_reference: row.provider_settlement_reference || null,
    last_error: row.last_error || null,
    collected_at: row.collected_at || null,
    dispatched_at: row.dispatched_at || null,
    settled_at: row.settled_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensurePaymentRouterSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureSettlementSchema();
      await db.query(`
        CREATE TABLE IF NOT EXISTS billing_payment_routes (
          id BIGSERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          payment_request_id BIGINT,
          external_reference VARCHAR(160) NOT NULL,
          amount NUMERIC(14,2) NOT NULL,
          currency VARCHAR(3) NOT NULL DEFAULT 'KES',
          collection_provider VARCHAR(40) NOT NULL DEFAULT 'daraja',
          collection_status VARCHAR(30) NOT NULL DEFAULT 'initiated',
          settlement_profile_id BIGINT REFERENCES billing_settlement_profiles(id) ON DELETE SET NULL,
          institution_code VARCHAR(30),
          route_status VARCHAR(30) NOT NULL DEFAULT 'blocked',
          block_reason VARCHAR(120),
          settlement_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
          provider_collection_reference VARCHAR(180),
          provider_settlement_reference VARCHAR(180),
          last_error TEXT,
          idempotency_key VARCHAR(64) NOT NULL UNIQUE,
          collected_at TIMESTAMP WITH TIME ZONE,
          dispatched_at TIMESTAMP WITH TIME ZONE,
          settled_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT billing_payment_routes_collection_status_check
            CHECK (collection_status IN ('initiated','queued','paid','failed')),
          CONSTRAINT billing_payment_routes_route_status_check
            CHECK (route_status IN ('blocked','dispatch_pending','dispatched','settled','failed'))
        )
      `);
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payment_routes_request ON billing_payment_routes(client_id,payment_request_id) WHERE payment_request_id IS NOT NULL`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_payment_routes_client_status ON billing_payment_routes(client_id,route_status,created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_billing_payment_routes_external ON billing_payment_routes(client_id,external_reference)`);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function assertPaymentOwnership(clientId, paymentRequestId, externalReference) {
  if (!paymentRequestId) return null;
  const result = await db.query(
    `SELECT id,client_id,external_reference,amount,status,payment_provider
     FROM payhero_payment_requests WHERE id=$1 LIMIT 1`,
    [paymentRequestId]
  );
  const payment = result.rows[0];
  if (!payment) {
    const error = new Error('Payment request was not found');
    error.code = 'PAYMENT_REQUEST_NOT_FOUND';
    throw error;
  }
  if (Number(payment.client_id) !== Number(clientId)) {
    const error = new Error('Payment request does not belong to this ISP');
    error.code = 'PAYMENT_TENANT_MISMATCH';
    throw error;
  }
  if (externalReference && String(payment.external_reference) !== String(externalReference)) {
    const error = new Error('Payment reference does not match the ISP payment request');
    error.code = 'PAYMENT_REFERENCE_MISMATCH';
    throw error;
  }
  return payment;
}

async function recordPaymentRouteIntent({
  clientId,
  paymentRequestId = null,
  externalReference,
  amount,
  currency = 'KES',
  collectionProvider = 'daraja',
  collectionStatus = 'initiated',
}) {
  if (!routerEnabled()) return null;
  await ensurePaymentRouterSchema();

  const tenantId = Number(clientId);
  if (!Number.isInteger(tenantId) || tenantId < 1) throw new Error('A valid ISP client id is required');
  const reference = String(externalReference || '').trim();
  if (!reference || reference.length > 160) throw new Error('A valid payment external reference is required');
  if (!COLLECTION_STATUSES.has(collectionStatus)) throw new Error('Unsupported payment collection status');
  const normalizedAmount = normalizeAmount(amount);
  const normalizedCurrency = normalizeCurrency(currency);
  const provider = String(collectionProvider || 'daraja').trim().toLowerCase().slice(0, 40) || 'daraja';

  const payment = await assertPaymentOwnership(tenantId, paymentRequestId, reference);
  if (payment && Number(payment.amount) !== normalizedAmount) {
    const error = new Error('Payment route amount does not match the ISP payment request');
    error.code = 'PAYMENT_AMOUNT_MISMATCH';
    throw error;
  }

  const profile = await getSettlementProfile(tenantId);
  const decision = decisionForProfile(profile);
  const snapshot = safeProfile(profile) || {};
  const key = idempotencyKey(tenantId, reference);

  const result = await db.query(
    `INSERT INTO billing_payment_routes (
       client_id,payment_request_id,external_reference,amount,currency,
       collection_provider,collection_status,settlement_profile_id,institution_code,
       route_status,block_reason,settlement_snapshot,idempotency_key,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,NOW())
     ON CONFLICT (idempotency_key) DO UPDATE SET
       payment_request_id=COALESCE(billing_payment_routes.payment_request_id,EXCLUDED.payment_request_id),
       collection_status=CASE
         WHEN billing_payment_routes.collection_status='paid' THEN 'paid'
         ELSE EXCLUDED.collection_status
       END,
       settlement_profile_id=EXCLUDED.settlement_profile_id,
       institution_code=EXCLUDED.institution_code,
       route_status=CASE
         WHEN billing_payment_routes.route_status IN ('dispatched','settled') THEN billing_payment_routes.route_status
         ELSE EXCLUDED.route_status
       END,
       block_reason=CASE
         WHEN billing_payment_routes.route_status IN ('dispatched','settled') THEN billing_payment_routes.block_reason
         ELSE EXCLUDED.block_reason
       END,
       settlement_snapshot=CASE
         WHEN billing_payment_routes.route_status IN ('dispatched','settled') THEN billing_payment_routes.settlement_snapshot
         ELSE EXCLUDED.settlement_snapshot
       END,
       updated_at=NOW()
     WHERE billing_payment_routes.client_id=EXCLUDED.client_id
       AND billing_payment_routes.external_reference=EXCLUDED.external_reference
     RETURNING *`,
    [
      tenantId,
      paymentRequestId || null,
      reference,
      normalizedAmount,
      normalizedCurrency,
      provider,
      collectionStatus,
      profile?.id || null,
      profile?.institution_code || null,
      decision.routeStatus,
      decision.blockReason,
      JSON.stringify(snapshot),
      key,
    ]
  );
  if (!result.rows[0]) {
    const error = new Error('Payment route idempotency conflict');
    error.code = 'PAYMENT_ROUTE_CONFLICT';
    throw error;
  }
  return safeRoute(result.rows[0]);
}

async function markPaymentCollectionStatus({ clientId, paymentRequestId, status, providerReference = null, errorMessage = null }) {
  if (!routerEnabled()) return null;
  await ensurePaymentRouterSchema();
  if (!COLLECTION_STATUSES.has(status)) throw new Error('Unsupported payment collection status');
  const tenantId = Number(clientId);
  await assertPaymentOwnership(tenantId, paymentRequestId);
  const result = await db.query(
    `UPDATE billing_payment_routes
     SET collection_status=$3::varchar,
         provider_collection_reference=COALESCE(NULLIF($4::varchar,''),provider_collection_reference),
         last_error=CASE WHEN $3::text='failed' THEN NULLIF($5::text,'') ELSE last_error END,
         collected_at=CASE WHEN $3::text='paid' THEN COALESCE(collected_at,NOW()) ELSE collected_at END,
         updated_at=NOW()
     WHERE client_id=$1 AND payment_request_id=$2
     RETURNING *`,
    [tenantId, paymentRequestId, status, String(providerReference || '').trim(), String(errorMessage || '').trim()]
  );
  return safeRoute(result.rows[0] || null);
}

async function refreshPaymentRoute({ clientId, paymentRequestId }) {
  await ensurePaymentRouterSchema();
  const payment = await assertPaymentOwnership(clientId, paymentRequestId);
  return recordPaymentRouteIntent({
    clientId,
    paymentRequestId,
    externalReference: payment.external_reference,
    amount: Number(payment.amount),
    collectionProvider: payment.payment_provider || 'daraja',
    collectionStatus: ['paid', 'failed', 'queued'].includes(payment.status) ? payment.status : 'initiated',
  });
}

async function prepareSettlementDispatch({ clientId, routeId }) {
  await ensurePaymentRouterSchema();
  const tenantId = Number(clientId);
  const result = await db.query(`SELECT * FROM billing_payment_routes WHERE id=$1 AND client_id=$2 LIMIT 1`, [routeId, tenantId]);
  const route = result.rows[0];
  if (!route) {
    const error = new Error('Payment settlement route was not found for this ISP');
    error.code = 'PAYMENT_ROUTE_NOT_FOUND';
    throw error;
  }
  if (route.collection_status !== 'paid') {
    const error = new Error('Payment has not been confirmed as collected');
    error.code = 'PAYMENT_NOT_COLLECTED';
    throw error;
  }
  const profile = await getSettlementProfile(tenantId);
  const decision = decisionForProfile(profile);
  if (decision.routeStatus !== 'dispatch_pending') {
    const error = new Error(`Settlement dispatch is blocked: ${decision.blockReason}`);
    error.code = 'SETTLEMENT_DISPATCH_BLOCKED';
    error.reason = decision.blockReason;
    throw error;
  }
  const adapter = adapterFor(profile.institution_code);
  if (!adapter?.implemented) {
    const error = new Error('The selected bank settlement adapter is not connected');
    error.code = 'SETTLEMENT_ADAPTER_NOT_CONNECTED';
    throw error;
  }

  // Deliberately do not decrypt or return bank credentials here until a concrete adapter is implemented.
  // Each adapter must resolve credentials internally after all tenant, payment and route guards pass.
  return {
    route: safeRoute(route),
    adapter: { code: adapter.code, name: adapter.name },
  };
}

async function getPaymentRoute({ clientId, paymentRequestId }) {
  await ensurePaymentRouterSchema();
  const result = await db.query(
    `SELECT * FROM billing_payment_routes WHERE client_id=$1 AND payment_request_id=$2 LIMIT 1`,
    [clientId, paymentRequestId]
  );
  return safeRoute(result.rows[0] || null);
}

module.exports = {
  ADAPTERS,
  adapterFor,
  decisionForProfile,
  ensurePaymentRouterSchema,
  getPaymentRoute,
  idempotencyKey,
  markPaymentCollectionStatus,
  prepareSettlementDispatch,
  recordPaymentRouteIntent,
  refreshPaymentRoute,
  routerEnabled,
  safeRoute,
};
