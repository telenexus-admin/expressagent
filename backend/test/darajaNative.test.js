const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  cleanPhone,
  darajaBaseUrl,
  darajaTimestamp,
  parsePaymentPromptRequest,
} = require('../src/services/daraja');
const { normalizedStkCallback } = require('../src/routes/mpesa');

assert.strictEqual(darajaBaseUrl('production'), 'https://api.safaricom.co.ke');
assert.strictEqual(darajaBaseUrl('sandbox'), 'https://sandbox.safaricom.co.ke');
assert.strictEqual(cleanPhone('0712 345 678'), '254712345678');
assert.strictEqual(cleanPhone('+254 712 345 678'), '254712345678');
assert.match(darajaTimestamp(new Date(2026, 8, 6, 10, 11, 12)), /^20260906101112$/);

const request = parsePaymentPromptRequest('Please send M-Pesa prompt 0712345678 KES 1500', '');
assert.deepStrictEqual(request, { amount: 1500, phone: '254712345678' });

const callback = normalizedStkCallback({
  Body: {
    stkCallback: {
      MerchantRequestID: 'merchant-1',
      CheckoutRequestID: 'checkout-1',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 1500 },
          { Name: 'MpesaReceiptNumber', Value: 'ABC123XYZ' },
          { Name: 'TransactionDate', Value: 20260906101112 },
          { Name: 'PhoneNumber', Value: 254712345678 },
        ],
      },
    },
  },
});
assert.strictEqual(callback.successful, true);
assert.strictEqual(callback.amount, 1500);
assert.strictEqual(callback.receipt, 'ABC123XYZ');
assert.strictEqual(callback.checkoutRequestId, 'checkout-1');

const root = path.resolve(__dirname, '..');
const payheroService = fs.readFileSync(path.join(root, 'src/services/payhero.js'), 'utf8');
const payheroRoute = fs.readFileSync(path.join(root, 'src/routes/payhero.js'), 'utf8');
const darajaService = fs.readFileSync(path.join(root, 'src/services/daraja.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');

assert.ok(!payheroService.includes('backend.payhero.co.ke'), 'PayHero network endpoint must not exist in compatibility service');
assert.ok(!payheroRoute.includes('backend.payhero.co.ke'), 'PayHero network endpoint must not exist in compatibility route');
assert.ok(!darajaService.includes('backend.payhero.co.ke'), 'Daraja service must never call PayHero');
assert.ok(server.includes("app.use('/api/public/mpesa', mpesaRoutes)"), 'Native M-Pesa callback namespace must be mounted');
assert.ok(server.includes("app.use('/api/settings/mpesa', mpesaSettingsRoutes)"), 'Native M-Pesa settings namespace must be mounted');

console.log('Daraja-native payment tests passed');
