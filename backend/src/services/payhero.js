// Deprecated compatibility shim.
// All executable M-Pesa traffic is handled by the native Safaricom Daraja service.
// This file remains temporarily so older hotspot/internal imports do not break during the cutover.
//
// Important: legacy hotspot code historically treated PayHero `basicAuth` + channel 9010
// as its readiness signal. Native Daraja/direct-bank payments do not have PayHero basic
// auth, so expose non-secret compatibility readiness markers derived from the real
// Daraja paymentConfiguration instead of retired PayHero credentials.
const daraja = require('./daraja');

const HOTSPOT_COMPAT_CHANNEL_ID = Number(
  process.env.HOTSPOT_PAYHERO_CHANNEL_ID || 9010
);

async function loadPayHeroConfig(clientId) {
  const payment = await daraja.paymentConfiguration(clientId);

  if (!payment.ready) {
    return {
      enabled: false,
      paymentProvider: 'daraja',
      basicAuth: '',
      channelId: null,
      directBank: false,
      mpesa: null,
      error: payment.error || 'M-Pesa checkout is not ready',
    };
  }

  const credentialsReady = Boolean(
    payment.config?.consumerKey
    && payment.config?.consumerSecret
    && payment.config?.shortcode
    && payment.config?.passkey
  );

  return {
    enabled: true,
    paymentProvider: 'daraja',
    // Compatibility markers only. No Daraja secret is returned from this shim.
    basicAuth: 'daraja-native-ready',
    channelId: HOTSPOT_COMPAT_CHANNEL_ID,
    environment: payment.config?.environment || 'production',
    directBank: Boolean(payment.destination),
    mpesa: credentialsReady ? {
      consumerKey: 'configured',
      consumerSecret: 'configured',
      shortcode: 'configured',
      passkey: 'configured',
    } : null,
  };
}

async function initiatePayHeroPayment(args = {}) {
  const purpose = String(args?.metadata?.purpose || '').trim();

  // PPPoE customer payments have a hard invariant: never initiate an STK unless
  // Daraja has resolved a direct-to-bank destination for this ISP. This check is
  // performed before Safaricom is called, so disabling the direct-bank feature
  // cannot silently fall back to Polyizon collection for a PPPoE payment.
  if (purpose === 'pppoe_portal') {
    const clientId = Number(args?.client?.id);
    const readiness = Number.isInteger(clientId) && clientId > 0
      ? await daraja.paymentConfiguration(clientId)
      : null;

    if (!readiness?.ready || !readiness.destination) {
      return {
        success: false,
        error: readiness?.error || 'Direct-to-bank M-Pesa is required for PPPoE payments',
      };
    }
  }

  const result = await daraja.initiateDarajaPayment(args);

  if (
    purpose === 'pppoe_portal'
    && result?.success
    && result?.settlement?.mode !== 'direct_bank_stk'
  ) {
    console.error(
      `PPPoE direct-bank invariant failed for ${result.externalReference || 'unknown payment reference'}`
    );
    return {
      success: false,
      error: 'Payment was not confirmed as direct-to-bank. Contact support before retrying.',
    };
  }

  return result;
}

module.exports = {
  ...daraja,
  initiatePayHeroPayment,
  loadPayHeroConfig,
};
