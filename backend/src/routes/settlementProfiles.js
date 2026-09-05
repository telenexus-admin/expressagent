const express = require('express');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { recordRequestEvent } = require('../services/events');
const {
  ensureSettlementSchema,
  getSettlementProfile,
  publicInstitutions,
  reviewSettlementProfile,
  safeProfile,
  saveSettlementProfile,
} = require('../services/settlementProfiles');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

async function requireBillingClient(clientId) {
  if (!clientId) return null;
  const result = await db.query(
    `SELECT id,name,business_name,account_type,status
     FROM clients WHERE id=$1 LIMIT 1`,
    [clientId]
  );
  const client = result.rows[0] || null;
  if (!client || client.account_type !== 'billing') return null;
  return client;
}

function selfClientId(req, res) {
  if (req.scope.isSuperadmin) {
    res.status(403).json({ error: 'Use the operator settlement endpoints for superadmin access' });
    return null;
  }
  return req.scope.clientId;
}

router.get('/institutions', async (_req, res) => {
  return res.json({ institutions: publicInstitutions() });
});

router.get('/profile', async (req, res) => {
  const clientId = selfClientId(req, res);
  if (!clientId) return;
  try {
    await ensureSettlementSchema();
    const client = await requireBillingClient(clientId);
    if (!client) return res.status(403).json({ error: 'Billing workspace access required' });
    const row = await getSettlementProfile(clientId);
    return res.json({ client: { id: client.id, name: client.business_name || client.name }, profile: safeProfile(row) });
  } catch (error) {
    console.error('GET /settlements/profile error:', error.message);
    return res.status(500).json({ error: 'Could not load settlement profile' });
  }
});

router.put('/profile', async (req, res) => {
  const clientId = selfClientId(req, res);
  if (!clientId) return;
  try {
    const client = await requireBillingClient(clientId);
    if (!client) return res.status(403).json({ error: 'Billing workspace access required' });
    const before = await getSettlementProfile(clientId);
    const saved = await saveSettlementProfile({
      clientId,
      institutionCode: req.body.institution_code,
      accountName: req.body.account_name,
      accountNumber: req.body.account_number,
      branchName: req.body.branch_name,
      collectionReference: req.body.collection_reference,
    });
    await recordRequestEvent(req, {
      eventType: 'settlement.profile_submitted',
      category: 'payment',
      source: 'billing_settings',
      entityType: 'settlement_profile',
      entityId: saved.id,
      title: 'Settlement profile submitted',
      description: `${client.business_name || client.name} selected ${saved.institution_name}`,
      previousState: safeProfile(before),
      newState: safeProfile(saved),
      payload: { institution_code: saved.institution_code, verification_status: saved.verification_status },
      deduplicationKey: `settlement:${clientId}:submitted:${Date.now()}`,
      sensitivity: 'confidential',
    }).catch((error) => console.error('Settlement profile audit failed:', error.message));
    return res.json({ success: true, profile: safeProfile(saved) });
  } catch (error) {
    const message = String(error.message || 'Could not save settlement profile');
    const status = /required|valid|unsupported|too long/i.test(message) ? 400 : 500;
    console.error('PUT /settlements/profile error:', message);
    return res.status(status).json({ error: message });
  }
});

router.get('/operator/:clientId', async (req, res) => {
  if (!req.scope.isSuperadmin) return res.status(403).json({ error: 'Superadmin access required' });
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return res.status(400).json({ error: 'Invalid client id' });
  try {
    const client = await requireBillingClient(clientId);
    if (!client) return res.status(404).json({ error: 'Billing account not found' });
    const row = await getSettlementProfile(clientId);
    return res.json({ client, profile: safeProfile(row) });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load settlement profile' });
  }
});

router.post('/operator/:clientId/review', async (req, res) => {
  if (!req.scope.isSuperadmin) return res.status(403).json({ error: 'Superadmin access required' });
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return res.status(400).json({ error: 'Invalid client id' });
  const decision = String(req.body.decision || '').trim().toLowerCase();
  try {
    const client = await requireBillingClient(clientId);
    if (!client) return res.status(404).json({ error: 'Billing account not found' });
    const reviewed = await reviewSettlementProfile({
      clientId,
      adminId: req.user.id,
      decision,
      notes: req.body.notes,
      railReference: req.body.rail_reference,
    });
    if (!reviewed) return res.status(404).json({ error: 'Settlement profile not found' });
    await recordRequestEvent(req, {
      eventType: `settlement.profile_${decision}`,
      category: 'payment',
      source: 'settlement_operator',
      entityType: 'settlement_profile',
      entityId: reviewed.id,
      title: `Settlement profile ${decision}`,
      description: `${client.business_name || client.name}: ${reviewed.institution_name}`,
      newState: safeProfile(reviewed),
      payload: { decision, rail_reference: reviewed.rail_reference || null },
      deduplicationKey: `settlement:${clientId}:${decision}:${Date.now()}`,
      sensitivity: 'confidential',
    }).catch((error) => console.error('Settlement review audit failed:', error.message));
    return res.json({ success: true, profile: safeProfile(reviewed) });
  } catch (error) {
    const message = String(error.message || 'Could not review settlement profile');
    return res.status(/unsupported/i.test(message) ? 400 : 500).json({ error: message });
  }
});

// Live bank routing is intentionally unavailable in phase 1. Verification only moves a profile to "ready".
// A bank/Safaricom adapter must prove the commercial rail before any profile can become "active".
router.post('/operator/:clientId/activate', (_req, res) => {
  return res.status(409).json({
    error: 'Live settlement activation is locked until the bank/Safaricom routing adapter is connected and verified',
  });
});

module.exports = router;
