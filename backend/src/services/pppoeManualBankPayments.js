const db = require('../db');
const { resolveActiveSettlement } = require('./settlementProfiles');
const {
  DIRECT_BANK_STK_RAILS,
  validateDirectBankAccount,
} = require('./directBankStk');
const {
  applyPppoeSubscriptionPayment,
  ensurePppoePaymentSchema,
  moneyCents,
} = require('./pppoePayments');

let schemaPromise = null;

function normalizeReceipt(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

async function ensureManualBankPaymentSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensurePppoePaymentSchema();
      await db.query(`
        CREATE TABLE IF NOT EXISTS billing_pppoe_manual_bank_claims (
          id BIGSERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          subscriber_id BIGINT NOT NULL REFERENCES billing_subscribers(id) ON DELETE CASCADE,
          plan_id BIGINT,
          account_number VARCHAR(80) NOT NULL,
          expected_amount NUMERIC(14,2) NOT NULL,
          receipt_number VARCHAR(40) NOT NULL,
          payer_phone VARCHAR(80),
          institution_code VARCHAR(30) NOT NULL,
          institution_name VARCHAR(160) NOT NULL,
          bank_paybill VARCHAR(40) NOT NULL,
          bank_account_last4 VARCHAR(8) NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'pending',
          verification_notes TEXT,
          applied_payment_id BIGINT REFERENCES billing_pppoe_mpesa_payments(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          verified_at TIMESTAMPTZ,
          rejected_at TIMESTAMPTZ,
          applied_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT billing_pppoe_manual_bank_claim_status_check
            CHECK (status IN ('pending','applied','rejected','failed'))
        )
      `);
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pppoe_manual_bank_receipt_unique
        ON billing_pppoe_manual_bank_claims (UPPER(receipt_number))
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_pppoe_manual_bank_subscriber
        ON billing_pppoe_manual_bank_claims (client_id, subscriber_id, created_at DESC)
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_pppoe_manual_bank_status
        ON billing_pppoe_manual_bank_claims (client_id, status, created_at DESC)
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function resolveManualBankDestination(clientId) {
  const profile = await resolveActiveSettlement(clientId);
  const code = String(profile.institution_code || '').trim().toLowerCase();
  const rail = DIRECT_BANK_STK_RAILS[code];
  if (!rail) {
    const error = new Error('Manual direct-bank M-Pesa currently supports active Equity or Co-operative Bank settlement profiles');
    error.code = 'MANUAL_BANK_UNSUPPORTED';
    throw error;
  }

  const validation = validateDirectBankAccount(code, profile.account_number);
  if (!validation.valid) {
    const error = new Error(validation.error || 'Configured bank account is not valid for manual M-Pesa deposits');
    error.code = 'MANUAL_BANK_ACCOUNT_INVALID';
    throw error;
  }

  return {
    profileId: profile.id,
    institutionCode: rail.code,
    institutionName: rail.name,
    paybill: rail.paybill,
    accountNumber: validation.account,
    accountLast4: validation.account.slice(-4),
    holdsFunds: false,
  };
}

async function subscriberPaymentContext(clientId, subscriberId) {
  const result = await db.query(
    `SELECT s.id,s.client_id,s.full_name,s.phone,s.account_number,s.plan_id,
            COALESCE(s.access_mode,'pppoe') AS access_mode,
            p.name AS plan_name,p.price AS plan_price,p.validity_days,p.is_active AS plan_is_active
     FROM billing_subscribers s
     JOIN billing_plans p ON p.id=s.plan_id AND p.client_id=s.client_id
     WHERE s.id=$1 AND s.client_id=$2
       AND COALESCE(s.access_mode,'pppoe') IN ('pppoe','pppoe_static')
     LIMIT 1`,
    [subscriberId, clientId]
  );
  return result.rows[0] || null;
}

async function manualBankInstructions({ clientId, subscriberId }) {
  const subscriber = await subscriberPaymentContext(clientId, subscriberId);
  if (!subscriber) {
    const error = new Error('PPPoE subscriber was not found');
    error.code = 'PPPOE_SUBSCRIBER_NOT_FOUND';
    throw error;
  }
  if (subscriber.plan_is_active !== true) {
    const error = new Error('The linked PPPoE package is not active');
    error.code = 'PPPOE_PLAN_INACTIVE';
    throw error;
  }
  const amount = Number(subscriber.plan_price);
  if (!Number.isFinite(amount) || amount < 10 || moneyCents(amount) <= 0) {
    const error = new Error('The linked PPPoE package does not have a valid payable amount');
    error.code = 'PPPOE_PLAN_PRICE_INVALID';
    throw error;
  }

  const destination = await resolveManualBankDestination(clientId);
  return {
    method: 'manual_bank_paybill',
    ready: true,
    holds_funds: false,
    subscriber_id: subscriber.id,
    subscriber_reference: subscriber.account_number,
    amount,
    institution_code: destination.institutionCode,
    institution_name: destination.institutionName,
    paybill: destination.paybill,
    bank_account_number: destination.accountNumber,
    bank_account_last4: destination.accountLast4,
    instructions: [
      'Open M-Pesa and choose Lipa na M-Pesa > Pay Bill.',
      `Business number: ${destination.paybill}.`,
      `Account number: ${destination.accountNumber}.`,
      `Amount: KES ${amount}.`,
      `Keep the M-Pesa receipt and quote subscriber reference ${subscriber.account_number} to your ISP.`,
      'The money goes directly to the ISP bank account. Polyizon never receives or holds the funds.',
    ],
  };
}

async function existingClaimForReceipt(receipt) {
  const result = await db.query(
    `SELECT * FROM billing_pppoe_manual_bank_claims
     WHERE UPPER(receipt_number)=UPPER($1)
     LIMIT 1`,
    [receipt]
  );
  return result.rows[0] || null;
}

async function processedReceiptElsewhere(receipt) {
  const result = await db.query(
    `SELECT source,id,client_id,subscriber_id FROM (
       SELECT 'pppoe_payment'::text AS source,id,client_id,subscriber_id
       FROM billing_pppoe_mpesa_payments
       WHERE UPPER(transaction_id)=UPPER($1)

       UNION ALL

       SELECT 'direct_bank_stk'::text AS source,id,client_id,NULL::bigint AS subscriber_id
       FROM payhero_payment_requests
       WHERE status='paid' AND UPPER(COALESCE(mpesa_receipt_number,''))=UPPER($1)

       UNION ALL

       SELECT 'billing_payment'::text AS source,id,client_id,subscriber_id
       FROM billing_payments
       WHERE status='completed' AND UPPER(COALESCE(reference,''))=UPPER($1)
     ) used
     LIMIT 1`,
    [receipt]
  );
  return result.rows[0] || null;
}

async function createManualBankClaim({ clientId, subscriberId, receiptNumber, payerPhone = null }) {
  await ensureManualBankPaymentSchema();
  const receipt = normalizeReceipt(receiptNumber);
  if (!/^[A-Z0-9]{6,32}$/.test(receipt)) {
    const error = new Error('Enter a valid M-Pesa receipt number');
    error.code = 'MANUAL_BANK_RECEIPT_INVALID';
    throw error;
  }

  const previousClaim = await existingClaimForReceipt(receipt);
  if (previousClaim) {
    if (Number(previousClaim.client_id) === Number(clientId) && Number(previousClaim.subscriber_id) === Number(subscriberId)) {
      return previousClaim;
    }
    const error = new Error('That M-Pesa receipt is already linked to another payment claim');
    error.code = 'MANUAL_BANK_RECEIPT_EXISTS';
    throw error;
  }

  const alreadyProcessed = await processedReceiptElsewhere(receipt);
  if (alreadyProcessed) {
    const error = new Error('That M-Pesa receipt has already been processed by another Polyizon payment flow');
    error.code = 'MANUAL_BANK_RECEIPT_ALREADY_PROCESSED';
    throw error;
  }

  const instructions = await manualBankInstructions({ clientId, subscriberId });
  const subscriber = await subscriberPaymentContext(clientId, subscriberId);

  try {
    const result = await db.query(
      `INSERT INTO billing_pppoe_manual_bank_claims (
         client_id,subscriber_id,plan_id,account_number,expected_amount,receipt_number,payer_phone,
         institution_code,institution_name,bank_paybill,bank_account_last4,status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
       RETURNING *`,
      [
        clientId,
        subscriberId,
        subscriber.plan_id,
        subscriber.account_number,
        instructions.amount,
        receipt,
        payerPhone ? String(payerPhone).trim() : null,
        instructions.institution_code,
        instructions.institution_name,
        instructions.paybill,
        instructions.bank_account_last4,
      ]
    );
    return result.rows[0];
  } catch (error) {
    if (error.code !== '23505') throw error;
    const existing = await existingClaimForReceipt(receipt);
    if (existing && Number(existing.client_id) === Number(clientId) && Number(existing.subscriber_id) === Number(subscriberId)) {
      return existing;
    }
    const conflict = new Error('That M-Pesa receipt is already linked to another payment claim');
    conflict.code = 'MANUAL_BANK_RECEIPT_EXISTS';
    throw conflict;
  }
}

async function listManualBankClaims({ clientId, subscriberId = null, status = null, limit = 100 }) {
  await ensureManualBankPaymentSchema();
  const values = [Number(clientId)];
  const where = ['c.client_id=$1'];
  if (subscriberId) {
    values.push(Number(subscriberId));
    where.push(`c.subscriber_id=$${values.length}`);
  }
  if (status) {
    values.push(String(status));
    where.push(`c.status=$${values.length}`);
  }
  values.push(Math.min(250, Math.max(1, Number(limit) || 100)));
  const result = await db.query(
    `SELECT c.*,s.full_name AS subscriber_name,p.name AS plan_name
     FROM billing_pppoe_manual_bank_claims c
     LEFT JOIN billing_subscribers s ON s.id=c.subscriber_id AND s.client_id=c.client_id
     LEFT JOIN billing_plans p ON p.id=c.plan_id AND p.client_id=c.client_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

async function verifyManualBankClaim({ clientId, subscriberId, claimId, confirmedAmount, notes = null }) {
  await ensureManualBankPaymentSchema();
  const claimResult = await db.query(
    `SELECT * FROM billing_pppoe_manual_bank_claims
     WHERE id=$1 AND client_id=$2 AND subscriber_id=$3
     LIMIT 1`,
    [claimId, clientId, subscriberId]
  );
  const claim = claimResult.rows[0];
  if (!claim) {
    const error = new Error('Manual bank payment claim was not found');
    error.code = 'MANUAL_BANK_CLAIM_NOT_FOUND';
    throw error;
  }
  if (claim.status === 'rejected') {
    const error = new Error('This payment claim was rejected and cannot be applied');
    error.code = 'MANUAL_BANK_CLAIM_REJECTED';
    throw error;
  }

  const amount = Number(confirmedAmount);
  if (moneyCents(amount) !== moneyCents(claim.expected_amount)) {
    const error = new Error(`Confirm the exact bank credit amount of KES ${Number(claim.expected_amount)}`);
    error.code = 'MANUAL_BANK_AMOUNT_MISMATCH';
    throw error;
  }

  const current = await subscriberPaymentContext(clientId, subscriberId);
  if (!current || Number(current.plan_id) !== Number(claim.plan_id) || moneyCents(current.plan_price) !== moneyCents(claim.expected_amount)) {
    const error = new Error('The subscriber package changed after this receipt was recorded. Reject this claim and create a new payment claim.');
    error.code = 'MANUAL_BANK_CLAIM_STALE';
    throw error;
  }

  const stkReuse = await db.query(
    `SELECT id,client_id FROM payhero_payment_requests
     WHERE status='paid' AND UPPER(COALESCE(mpesa_receipt_number,''))=UPPER($1)
     LIMIT 1`,
    [claim.receipt_number]
  );
  if (stkReuse.rows[0]) {
    const error = new Error('This M-Pesa receipt was already processed through a direct-bank STK payment and cannot be applied again manually');
    error.code = 'MANUAL_BANK_RECEIPT_ALREADY_PROCESSED';
    throw error;
  }

  const applied = await applyPppoeSubscriptionPayment({
    transactionId: claim.receipt_number,
    accountNumber: claim.account_number,
    amount,
    payerPhone: claim.payer_phone || current.phone || null,
    paidAt: new Date(),
    source: 'manual_bank_verified',
    shortcode: claim.bank_paybill,
    rawPayload: {
      manual_bank_claim_id: claim.id,
      institution_code: claim.institution_code,
      institution_name: claim.institution_name,
      bank_paybill: claim.bank_paybill,
      bank_account_last4: claim.bank_account_last4,
      verified_by_isp: true,
    },
  });

  const payment = applied.payment || null;
  const samePayment = payment &&
    String(payment.account_number || '').toUpperCase() === String(claim.account_number || '').toUpperCase() &&
    Number(payment.client_id || clientId) === Number(clientId) &&
    Number(payment.subscriber_id || subscriberId) === Number(subscriberId);
  const successful = applied.status === 'applied'
    ? samePayment
    : Boolean(applied.idempotent && payment?.status === 'applied' && samePayment);

  if (applied.idempotent && !samePayment) {
    const error = new Error('This M-Pesa receipt is already attached to a different PPPoE payment and cannot be reused');
    error.code = 'MANUAL_BANK_RECEIPT_ALREADY_PROCESSED';
    throw error;
  }

  const result = await db.query(
    `UPDATE billing_pppoe_manual_bank_claims
     SET status=$2,
         verification_notes=$3,
         verified_at=CASE WHEN $2='applied' THEN COALESCE(verified_at,NOW()) ELSE verified_at END,
         applied_at=CASE WHEN $2='applied' THEN COALESCE(applied_at,NOW()) ELSE applied_at END,
         applied_payment_id=COALESCE($4,applied_payment_id),
         updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [
      claim.id,
      successful ? 'applied' : 'failed',
      String(notes || '').trim() || null,
      payment?.id || null,
    ]
  );

  if (!successful) {
    const error = new Error(`Payment engine returned ${applied.status || 'unknown'}; subscriber was not activated`);
    error.code = 'MANUAL_BANK_APPLY_FAILED';
    error.claim = result.rows[0];
    throw error;
  }

  return {
    claim: result.rows[0],
    payment: applied,
  };
}

async function rejectManualBankClaim({ clientId, subscriberId, claimId, notes = null }) {
  await ensureManualBankPaymentSchema();
  const result = await db.query(
    `UPDATE billing_pppoe_manual_bank_claims
     SET status='rejected',verification_notes=$4,rejected_at=NOW(),updated_at=NOW()
     WHERE id=$1 AND client_id=$2 AND subscriber_id=$3 AND status <> 'applied'
     RETURNING *`,
    [claimId, clientId, subscriberId, String(notes || '').trim() || null]
  );
  if (!result.rows[0]) {
    const error = new Error('Payment claim was not found or has already been applied');
    error.code = 'MANUAL_BANK_CLAIM_NOT_REJECTABLE';
    throw error;
  }
  return result.rows[0];
}

module.exports = {
  createManualBankClaim,
  ensureManualBankPaymentSchema,
  listManualBankClaims,
  manualBankInstructions,
  normalizeReceipt,
  rejectManualBankClaim,
  resolveManualBankDestination,
  verifyManualBankClaim,
};
