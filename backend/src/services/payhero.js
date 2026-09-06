// Deprecated compatibility shim.
// All executable M-Pesa traffic is handled by the native Safaricom Daraja service.
// This file remains temporarily so older hotspot/internal imports do not break during the cutover.
//
// Important: legacy hotspot code historically treated PayHero `basicAuth` + channel 9010
// as its readiness signal. Native Daraja/direct-bank payments do not have PayHero basic
// auth, so expose a non-secret compatibility readiness marker derived from the real
// Daraja paymentConfiguration instead of the retired PayHero credentials.
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
      error: payment.error || 'M-Pesa checkout is not ready',
    };
  }

  return {
    enabled: true,
    paymentProvider: 'daraja',
    // Compatibility marker only. It is never sent to Safaricom and contains no secret.
    basicAuth: 'daraja-native-ready',
    channelId: HOTSPOT_COMPAT_CHANNEL_ID,
    environment: payment.config?.environment || 'production',
    directBank: Boolean(payment.destination),
  };
}

module.exports = {
  ...daraja,
  loadPayHeroConfig,
};
