// Deprecated callback compatibility shim.
// New callbacks use /api/public/mpesa/*; this keeps the previous direct-Daraja
// callback namespace alive for STK requests issued before the cutover.
module.exports = require('./mpesa');
