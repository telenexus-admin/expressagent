const express = require('express');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { recordRequestEvent } = require('../services/events');
const {
  activateSettlementProfile,
  ensureSettlementSchema,
  getSettlementProfile,
  publicInstitutions,
  reviewSettlementProfile,
  safeProfile,
  saveSettlementProfile,
} = require('../services/settlementProfiles');
const {
  DIRECT_BANK_STK_RAILS,
  railForInstitution,
  validateDirectBankAccount,
} = require('../services/directBankStk');

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

function directInstitutions() {
  return publicInstitutions()
    .filter((item) => DIRECT_BANK_STK_RAILS[item.code])
    .map((item) => ({
      ...item,
      direct_stk: true,
      mpesa_paybill: DIRECT_BANK_STK_RAILS[item.code].paybill,
      collection_model: `Direct M-PESA STK to ${DIRECT_BANK_STK_RAILS[item.code].paybill}`,
      public_notes: `Customer STK payments are initiated by Polyizon and deposited directly into this ISP's ${item.name} account.`,
    }));
}

router.get('/institutions', async (_req, res) => {
  return res.json({ institutions: directInstitutions() });
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

    const institutionCode = String(req.body.institution_code || '').trim().toLowerCase();
    const rail = railForInstitution(institutionCode);
    if (!rail) {
      return res.status(400).json({ error: 'For now, direct bank STK is available only for Equity and Co-operative Bank' });
    }

    const before = await getSettlementProfile(clientId);
    const incomingAccount = String(req.body.account_number || '').trim();
    const keepingExistingAccount = !incomingAccount && before?.institution_code === institutionCode;
    if (!keepingExistingAccount) {
      const validation = validateDirectBankAccount(institutionCode, incomingAccount);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
    }

    const saved = await saveSettlementProfile({
      clientId,
      institutionCode,
      accountName: req.body.account_name,
      accountNumber: incomingAccount,
      branchName: req.body.branch_name,
      collectionReference: '',
    });

    const railReference = `daraja-direct-stk:${rail.paybill}`;
    await reviewSettlementProfile({
      clientId,
      adminId: null,
      decision: 'verified',
      notes: `Self-configured Polyizon direct bank STK destination via M-PESA Paybill ${rail.paybill}`,
      railReference,
    });
    const activated = await activateSettlementProfile({
      clientId,
      adminId: null,
      railReference,
    });
    if (!activated) throw new Error('Could not activate direct bank STK routing');

    await recordRequestEvent(req, {
      eventType: 'settlement.direct_stk_configured',
      category: 'payment',
      source: 'billing_settings',
      entityType: 'settlement_profile',
      entityId: activated.id,
      title: 'Direct bank STK destination configured',
      description: `${client.business_name || client.name} selected ${activated.institution_name} via Paybill ${rail.paybill}`,
      previousState: safeProfile(before),
      newState: safeProfile(activated),
      payload: {
        institution_code: activated.institution_code,
        mpesa_paybill: rail.paybill,
        routing_mode: 'direct_bank_stk',
        verification_status: activated.verification_status,
        routing_status: activated.routing_status,
      },
      deduplicationKey: `settlement:${clientId}:direct-stk:${Date.now()}`,
      sensitivity: 'confidential',
    }).catch((error) => console.error('Direct bank STK settlement audit failed:', error.message));

    return res.json({
      success: true,
      profile: safeProfile(activated),
      direct_stk: {
        institution_code: rail.code,
        institution_name: rail.name,
        mpesa_paybill: rail.paybill,
        active: true,
      },
    });
  } catch (error) {
    const message = String(error.message || 'Could not save settlement profile');
    const status = /required|valid|unsupported|too long|only|exactly|digits/i.test(message) ? 400 : 500;
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

// Direct-bank STK activation is performed only by the guarded self-service profile endpoint above.
// Keep arbitrary operator activation locked so unsupported rails cannot be enabled accidentally.
router.post('/operator/:clientId/activate', (_req, res) => {
  return res.status(409).json({
    error: 'Use the ISP Billing Settings direct-bank configuration for Equity or Co-operative Bank',
  });
});

module.exports = router;
