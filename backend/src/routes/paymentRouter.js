const express = require('express');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { getSettlementProfile, safeProfile } = require('../services/settlementProfiles');
const {
  ADAPTERS,
  decisionForProfile,
  ensurePaymentRouterSchema,
  getPaymentRoute,
  refreshPaymentRoute,
  routerEnabled,
} = require('../services/paymentRouter');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function scopedClientId(req, res) {
  const clientId = req.scope.isSuperadmin ? req.scope.clientId : req.scope.clientId;
  if (!clientId) {
    res.status(400).json({ error: 'Select a billing account before inspecting its payment router' });
    return null;
  }
  return Number(clientId);
}

async function requireBillingClient(clientId) {
  const result = await db.query(
    `SELECT id,name,business_name,account_type,status FROM clients WHERE id=$1 LIMIT 1`,
    [clientId]
  );
  const client = result.rows[0] || null;
  if (!client || client.account_type !== 'billing') return null;
  return client;
}

router.get('/status', async (req, res) => {
  const clientId = scopedClientId(req, res);
  if (!clientId) return;
  try {
    await ensurePaymentRouterSchema();
    const client = await requireBillingClient(clientId);
    if (!client) return res.status(404).json({ error: 'Billing account not found' });
    const profile = await getSettlementProfile(clientId);
    const decision = decisionForProfile(profile);
    return res.json({
      enabled: routerEnabled(),
      client: { id: client.id, name: client.business_name || client.name },
      settlement_profile: safeProfile(profile),
      decision: {
        route_status: decision.routeStatus,
        block_reason: decision.blockReason,
      },
      adapters: Object.values(ADAPTERS).map((adapter) => ({
        code: adapter.code,
        name: adapter.name,
        implemented: adapter.implemented,
      })),
    });
  } catch (error) {
    console.error('Payment router status failed:', error.message);
    return res.status(500).json({ error: 'Could not load payment router status' });
  }
});

router.post('/payments/:paymentRequestId/plan', async (req, res) => {
  const clientId = scopedClientId(req, res);
  if (!clientId) return;
  const paymentRequestId = Number(req.params.paymentRequestId);
  if (!Number.isInteger(paymentRequestId) || paymentRequestId < 1) {
    return res.status(400).json({ error: 'Invalid payment request id' });
  }
  try {
    const client = await requireBillingClient(clientId);
    if (!client) return res.status(404).json({ error: 'Billing account not found' });
    const route = await refreshPaymentRoute({ clientId, paymentRequestId });
    return res.json({ success: true, route });
  } catch (error) {
    const status = ['PAYMENT_TENANT_MISMATCH', 'PAYMENT_REFERENCE_MISMATCH'].includes(error.code)
      ? 403
      : error.code === 'PAYMENT_REQUEST_NOT_FOUND'
        ? 404
        : 400;
    return res.status(status).json({ error: error.message, code: error.code || null });
  }
});

router.get('/payments/:paymentRequestId', async (req, res) => {
  const clientId = scopedClientId(req, res);
  if (!clientId) return;
  const paymentRequestId = Number(req.params.paymentRequestId);
  if (!Number.isInteger(paymentRequestId) || paymentRequestId < 1) {
    return res.status(400).json({ error: 'Invalid payment request id' });
  }
  try {
    const route = await getPaymentRoute({ clientId, paymentRequestId });
    if (!route) return res.status(404).json({ error: 'Payment route not found' });
    return res.json({ route });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load payment route' });
  }
});

module.exports = router;
