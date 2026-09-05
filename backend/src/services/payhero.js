// Deprecated compatibility shim.
// All executable M-Pesa traffic is handled by the native Safaricom Daraja service.
// This file remains temporarily so older internal imports do not break during the cutover.
module.exports = require('./daraja');
