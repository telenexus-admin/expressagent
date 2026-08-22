const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function normalized(value, limit = 160) {
  return String(value || '').trim().toLowerCase().slice(0, limit);
}

function clientIp(req) {
  return ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');
}

function createLimiter({ windowMs, limit, keyGenerator, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: keyGenerator || clientIp,
    handler: (_req, res) => res.status(429).json({
      error: message || 'Too many requests. Wait before trying again.',
    }),
  });
}

const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${clientIp(req)}:${normalized(req.body?.email)}`,
  message: 'Too many sign-in attempts. Wait 15 minutes before trying again.',
});

const mfaLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  message: 'Too many verification attempts. Wait before trying again.',
});

const forgotPasswordLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 4,
  keyGenerator: (req) => `${clientIp(req)}:${normalized(req.body?.email)}`,
  message: 'If that email belongs to an active administrator, a reset link will arrive shortly.',
});

const resetPasswordLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  message: 'Too many reset attempts. Request a new link later.',
});

const refreshLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: 'Too many session refresh attempts. Sign in again.',
});

const onboardingLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  message: 'Too many router onboarding callbacks from this address.',
});

const paymentLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: 'Too many payment attempts. Wait before trying again.',
});

const portalLoginLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 40,
  message: 'Too many portal login attempts. Wait before trying again.',
});

const publicWriteLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  message: 'Too many requests from this address. Wait before trying again.',
});

module.exports = {
  loginLimiter,
  mfaLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  refreshLimiter,
  onboardingLimiter,
  paymentLimiter,
  portalLoginLimiter,
  publicWriteLimiter,
};
