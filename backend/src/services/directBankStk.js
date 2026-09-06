const { resolveActiveSettlement } = require('./settlementProfiles');

const DIRECT_BANK_STK_RAILS = Object.freeze({
  equity: Object.freeze({
    code: 'equity',
    name: 'Equity Bank Kenya',
    paybill: '247247',
  }),
  coop: Object.freeze({
    code: 'coop',
    name: 'Co-operative Bank of Kenya',
    paybill: '400200',
  }),
});

function envTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function directBankStkEnabled() {
  return envTrue(process.env.DARAJA_DIRECT_BANK_ENABLED);
}

function railForInstitution(code) {
  return DIRECT_BANK_STK_RAILS[String(code || '').trim().toLowerCase()] || null;
}

function normalizeBankAccount(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function validateDirectBankAccount(institutionCode, accountNumber) {
  const code = String(institutionCode || '').trim().toLowerCase();
  const account = normalizeBankAccount(accountNumber);
  if (!railForInstitution(code)) {
    return { valid: false, error: 'Only Equity and Co-operative Bank direct M-PESA routing is currently supported' };
  }
  if (code === 'coop' && !/^\d{14}$/.test(account)) {
    return { valid: false, error: 'Co-operative Bank account number must be exactly 14 digits' };
  }
  if (code === 'equity' && !/^\d{10,20}$/.test(account)) {
    return { valid: false, error: 'Equity Bank account number must contain 10 to 20 digits' };
  }
  return { valid: true, account };
}

async function resolveDirectBankStkDestination(clientId) {
  if (!directBankStkEnabled()) {
    const error = new Error('Direct bank STK routing is disabled');
    error.code = 'DIRECT_BANK_STK_DISABLED';
    throw error;
  }

  const profile = await resolveActiveSettlement(clientId);
  const rail = railForInstitution(profile.institution_code);
  if (!rail) {
    const error = new Error('Configure an active Equity or Co-operative Bank account in Billing Settings');
    error.code = 'DIRECT_BANK_STK_UNSUPPORTED_BANK';
    throw error;
  }

  const validation = validateDirectBankAccount(rail.code, profile.account_number);
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.code = 'DIRECT_BANK_STK_INVALID_ACCOUNT';
    throw error;
  }

  return {
    profileId: profile.id,
    institutionCode: rail.code,
    institutionName: rail.name,
    paybill: rail.paybill,
    accountNumber: validation.account,
    accountLast4: validation.account.slice(-4),
  };
}

module.exports = {
  DIRECT_BANK_STK_RAILS,
  directBankStkEnabled,
  normalizeBankAccount,
  railForInstitution,
  resolveDirectBankStkDestination,
  validateDirectBankAccount,
};
