const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const HttpError = require('../utils/httpError');
const { envBool, envNumber } = require('../utils/env');

/*
 * Rate limiting of the sensitive auth routes, keyed by client IP + normalized email
 * (so users behind the same campus NAT do not block each other).
 * Env: RATE_LIMIT_ENABLED (default true; "false" disables it, e.g. in tests),
 *      RATE_LIMIT_WINDOW_MS (default 900000 = 15 min), RATE_LIMIT_AUTH_MAX (default 20 per window).
 * The client IP is req.ip, which honours the "trust proxy" setting (TRUST_PROXY).
 */

const emailOf = (req) => {
  const email = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 320) : '';
};

// One limiter (with its own counters) per route name.
const authRateLimit = (name) => {
  const windowMs = envNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
  return rateLimit({
    windowMs,
    limit: envNumber('RATE_LIMIT_AUTH_MAX', 20),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Read at request time, so the setting follows the environment loaded by dotenv.
    skip: () => !envBool('RATE_LIMIT_ENABLED', true),
    keyGenerator: (req) => `${name}|${ipKeyGenerator(req.ip || '')}|${emailOf(req)}`,
    handler: (req, res, next) => {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfter = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : Math.ceil(windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      next(new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many attempts, please try again later', { retryAfter }));
    },
  });
};

module.exports = { authRateLimit };
