const express = require('express');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { recordRequestEvent } = require('../services/events');
const { isEmailConfigured, sendEmail } = require('../services/email');
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function centralPolyizonEmailAddress() {
  return String(process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM_EMAIL || '').trim();
}

function maskedEmail(value) {
  const email = String(value || '').trim();
  const at = email.indexOf('@');
  if (at <= 1) return email ? 'configured' : null;
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

async function sendBankDestinationRequestReceivedEmail({ client, requesterEmail, profile }) {
  const contactEmail = String(client.contact_email || '').trim();
  const fallbackEmail = String(requesterEmail || '').trim();
  const recipient = contactEmail || fallbackEmail;
  const recipientSource = contactEmail ? 'account_contact_email' : (fallbackEmail ? 'requesting_admin_email' : 'none');

  if (!recipient) {
    return { status: 'skipped', error: 'Billing account has no linked email address', recipientSource };
  }

  const fromAddress = centralPolyizonEmailAddress();
  if (!fromAddress || !isEmailConfigured({})) {
    return { status: 'skipped', error: 'Polyizon central email is not configured', recipientSource };
  }

  const view = safeProfile(profile) || {};
  const businessName = String(client.business_name || client.name || 'your Polyizon account').trim();
  const contactName = String(client.official_contact_name || '').trim();
  const firstName = contactName.split(/\s+/)[0] || 'there';
  const bankName = String(view.institution_name || 'the selected bank').trim();
  const accountMasked = String(view.account_number_masked || 'masked for security').trim();
  const subject = 'Bank Destination Request Received — Polyizon';

  const text = [
    `Hello ${firstName},`,
    '',
    `We have received your request to configure the bank destination for ${businessName}.`,
    '',
    `Bank: ${bankName}`,
    `Account: ${accountMasked}`,
    '',
    'Your request is now under review. The review may take up to 24 hours.',
    'For your security, the requested bank destination will not become active until it has been reviewed and approved by Polyizon.',
    '',
    'We will notify you once the review is complete.',
    '',
    'Regards,',
    'Polyizon Support',
    'Polyizon',
  ].join('\n');

  const html = `
    <div style="margin:0;padding:32px 16px;background:#f5f7f8;font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.6">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.06)">
        <div style="padding:24px 28px;background:#052e25;color:#ffffff">
          <div style="font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7">Polyizon M-PESA Gateway</div>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25">Bank destination request received</h1>
        </div>
        <div style="padding:28px">
          <p style="margin:0 0 16px">Hello ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 18px">We have received your request to configure the bank destination for <strong>${escapeHtml(businessName)}</strong>.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;margin:18px 0">
            <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700">Request details</div>
            <div style="margin-top:10px"><strong>Bank:</strong> ${escapeHtml(bankName)}</div>
            <div style="margin-top:4px"><strong>Account:</strong> ${escapeHtml(accountMasked)}</div>
            <div style="margin-top:4px"><strong>Status:</strong> Pending review</div>
          </div>
          <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px;padding:16px 18px;margin:18px 0;color:#065f46">
            <strong>Review time</strong><br>
            Your request is now under review. The review may take up to <strong>24 hours</strong>.
          </div>
          <p style="margin:18px 0">For your security, the requested bank destination will not become active until it has been reviewed and approved by Polyizon.</p>
          <p style="margin:18px 0">We will notify you once the review is complete.</p>
          <p style="margin:28px 0 0;color:#475569">Regards,<br><strong style="color:#0f172a">Polyizon Support</strong><br>Polyizon</p>
        </div>
      </div>
    </div>`;

  const result = await sendEmail({}, {
    from: `Polyizon <${fromAddress}>`,
    to: [recipient],
    reply_to: fromAddress,
    subject,
    text,
    html,
  });

  return { ...result, recipientSource, recipientMasked: maskedEmail(recipient) };
}

async function requireBillingClient(clientId) {
  if (!clientId) return null;
  const result = await db.query(
    `SELECT id,name,business_name,account_type,status,contact_email,official_contact_name
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

function canManageBankDestination(req) {
  return Array.isArray(req.user?.permissions) && req.user.permissions.includes('admins');
}

function directInstitutions() {
  return publicInstitutions()
    .filter((item) => DIRECT_BANK_STK_RAILS[item.code])
    .map((item) => ({
      ...item,
      direct_stk: true,
      mpesa_paybill: DIRECT_BANK_STK_RAILS[item.code].paybill,
      collection_model: `Direct M-PESA STK to ${DIRECT_BANK_STK_RAILS[item.code].paybill}`,
      public_notes: `Once approved, customer STK payments initiated by Polyizon are deposited directly into this ISP's ${item.name} account.`,
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
    return res.json({
      client: { id: client.id, name: client.business_name || client.name },
      profile: safeProfile(row),
      can_manage: canManageBankDestination(req),
      review_window_hours: 24,
    });
  } catch (error) {
    console.error('GET /settlements/profile error:', error.message);
    return res.status(500).json({ error: 'Could not load settlement profile' });
  }
});

router.put('/profile', async (req, res) => {
  const clientId = selfClientId(req, res);
  if (!clientId) return;
  if (!canManageBankDestination(req)) {
    return res.status(403).json({ error: 'Bank destination changes require ISP administrator permission' });
  }

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
    let accountNumber = incomingAccount;

    if (!keepingExistingAccount) {
      const validation = validateDirectBankAccount(institutionCode, incomingAccount);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      accountNumber = validation.account;
    }

    const requested = await saveSettlementProfile({
      clientId,
      institutionCode,
      accountName: req.body.account_name,
      accountNumber,
      branchName: req.body.branch_name,
      collectionReference: '',
    });

    await recordRequestEvent(req, {
      eventType: 'settlement.direct_stk_requested',
      category: 'payment',
      source: 'billing_settings',
      entityType: 'settlement_profile',
      entityId: requested.id,
      title: 'Direct bank destination review requested',
      description: `${client.business_name || client.name} requested ${requested.institution_name} via Paybill ${rail.paybill}`,
      previousState: safeProfile(before),
      newState: safeProfile(requested),
      payload: {
        institution_code: requested.institution_code,
        mpesa_paybill: rail.paybill,
        routing_mode: 'direct_bank_stk',
        verification_status: requested.verification_status,
        routing_status: requested.routing_status,
        review_window_hours: 24,
      },
      deduplicationKey: `settlement:${clientId}:direct-stk-request:${Date.now()}`,
      sensitivity: 'confidential',
    }).catch((error) => console.error('Direct bank STK request audit failed:', error.message));

    let emailNotification;
    try {
      emailNotification = await sendBankDestinationRequestReceivedEmail({
        client,
        requesterEmail: req.user?.email,
        profile: requested,
      });
    } catch (error) {
      emailNotification = { status: 'failed', error: error.message || 'Email delivery failed', recipientSource: 'unknown' };
    }

    if (emailNotification.status !== 'sent') {
      console.error(`Direct bank STK request email ${emailNotification.status}:`, emailNotification.error || 'unknown error');
    }

    await recordRequestEvent(req, {
      eventType: 'settlement.direct_stk_request_email',
      category: 'communication',
      source: 'billing_settings',
      entityType: 'settlement_profile',
      entityId: requested.id,
      title: 'Bank destination request receipt email processed',
      description: `Polyizon bank destination request email status: ${emailNotification.status}`,
      newState: {
        delivery_status: emailNotification.status,
        recipient_source: emailNotification.recipientSource || null,
      },
      payload: {
        delivery_status: emailNotification.status,
        recipient_source: emailNotification.recipientSource || null,
        recipient_masked: emailNotification.recipientMasked || null,
      },
      deduplicationKey: `settlement:${clientId}:direct-stk-request-email:${requested.id}:${Date.now()}`,
      sensitivity: 'confidential',
    }).catch((error) => console.error('Direct bank STK request email audit failed:', error.message));

    return res.json({
      success: true,
      request_received: true,
      review_window_hours: 24,
      profile: safeProfile(requested),
      direct_stk: {
        institution_code: rail.code,
        institution_name: rail.name,
        mpesa_paybill: rail.paybill,
        active: false,
        status: 'pending_review',
      },
      email_notification: {
        status: emailNotification.status,
        recipient: emailNotification.recipientMasked || null,
      },
      message: 'Your bank destination request has been received and will be reviewed within 24 hours. A confirmation email has been sent to the email linked to your Polyizon account when email delivery is available.',
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
    return res.json({ client, profile: safeProfile(row), review_window_hours: 24 });
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

    const current = await getSettlementProfile(clientId);
    if (!current) return res.status(404).json({ error: 'Settlement profile not found' });

    let railReference = '';
    if (decision === 'verified') {
      const rail = railForInstitution(current.institution_code);
      if (!rail) return res.status(400).json({ error: 'Only Equity and Co-operative Bank direct STK requests can be approved' });
      railReference = `daraja-direct-stk:${rail.paybill}`;
    }

    const reviewed = await reviewSettlementProfile({
      clientId,
      adminId: req.user.id,
      decision,
      notes: req.body.notes,
      railReference,
    });
    if (!reviewed) return res.status(404).json({ error: 'Settlement profile not found' });

    let finalProfile = reviewed;
    if (decision === 'verified') {
      const activated = await activateSettlementProfile({
        clientId,
        adminId: req.user.id,
        railReference,
      });
      if (!activated) throw new Error('Could not activate approved direct bank STK routing');
      finalProfile = activated;
    }

    await recordRequestEvent(req, {
      eventType: `settlement.profile_${decision}`,
      category: 'payment',
      source: 'settlement_operator',
      entityType: 'settlement_profile',
      entityId: finalProfile.id,
      title: decision === 'verified' ? 'Direct bank destination approved and activated' : `Settlement profile ${decision}`,
      description: `${client.business_name || client.name}: ${finalProfile.institution_name}`,
      newState: safeProfile(finalProfile),
      payload: {
        decision,
        rail_reference: finalProfile.rail_reference || null,
        routing_status: finalProfile.routing_status,
      },
      deduplicationKey: `settlement:${clientId}:${decision}:${Date.now()}`,
      sensitivity: 'confidential',
    }).catch((error) => console.error('Settlement review audit failed:', error.message));

    return res.json({
      success: true,
      profile: safeProfile(finalProfile),
      activated: decision === 'verified' && finalProfile.routing_status === 'active',
    });
  } catch (error) {
    const message = String(error.message || 'Could not review settlement profile');
    return res.status(/unsupported|only/i.test(message) ? 400 : 500).json({ error: message });
  }
});

// Approval of a supported direct-bank request activates it atomically in the review endpoint above.
// Keep arbitrary activation locked so unsupported or unreviewed destinations cannot be enabled.
router.post('/operator/:clientId/activate', (_req, res) => {
  return res.status(409).json({
    error: 'Approve the pending Equity or Co-operative Bank request through the settlement review workflow',
  });
});

module.exports = router;
