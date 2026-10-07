const net = require('node:net');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const HttpError = require('../utils/httpError');
const { envBool, envNumber } = require('../utils/env');

/*
 * Rate limiting of the sensitive auth routes. Every limiter answers 429 TOO_MANY_REQUESTS with a
 * Retry-After header and details.retryAfter (seconds), and is skipped when RATE_LIMIT_ENABLED=false.
 *
 *   authRateLimit(name)      login, signup, forgot-password, verify-otp: per route + IP + normalized email
 *                            (users behind the same campus NAT do not block each other), RATE_LIMIT_AUTH_MAX (20)
 *   authIpRateLimit          the same four routes together, per IP only (credential stuffing over many
 *                            emails), RATE_LIMIT_IP_MAX (100)
 *   changePasswordRateLimit  change-password, per user (use after requireAuth), RATE_LIMIT_PASSWORD_MAX (10)
 *   resetPasswordRateLimit   reset-password, per IP, RATE_LIMIT_RESET_MAX (20)
 *
 * All share RATE_LIMIT_WINDOW_MS (default 900000 = 15 min). Counters are in memory (one set per instance).
 * The client IP is req.ip, which honours the "trust proxy" setting (TRUST_PROXY); IPv6 addresses are
 * grouped by /56 subnet (ipKeyGenerator).
 *
 * The two IP-only limiters (authIpRateLimit, resetPasswordRateLimit) are not applied when req.ip is a
 * loopback address, i.e. a caller on this host that sent no X-Forwarded-For: the Next.js web app relays
 * every browser from loopback when it does not forward the client address (TRUSTED_PROXY_HOPS=0), so an
 * IP-only counter would be shared by all web users. Those requests keep the route + IP + email limiter.
 * Behind a proxy that writes X-Forwarded-For (TRUST_PROXY=loopback + nginx, or Next.js with
 * TRUSTED_PROXY_HOPS >= 1), req.ip is the real client and the per-IP limits apply to everyone.
 */

const windowMs = () => envNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);

const clientIp = (req) => ipKeyGenerator(req.ip || '');

/** True for 127.0.0.0/8, ::1 and IPv4-mapped loopback (::ffff:127.x.x.x). */
const isLoopback = (ip) => {
  const value = String(ip || '').trim().toLowerCase();
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  const v4 = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  return net.isIPv4(v4) && v4.startsWith('127.');
};

const emailOf = (req) => {
  const email = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 320) : '';
};

/**
 * @param {{ limitEnv: string, defaultLimit: number, key: (req) => string, skipLoopback?: boolean }} options
 *        limitEnv: environment variable holding the number of requests allowed per window
 *        skipLoopback: do not count requests whose client IP (req.ip) is a loopback address (IP-only limiters)
 */
const createLimiter = ({ limitEnv, defaultLimit, key, skipLoopback = false }) => {
  const window = windowMs();
  return rateLimit({
    windowMs: window,
    limit: envNumber(limitEnv, defaultLimit),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Read at request time, so the setting follows the environment loaded by dotenv.
    skip: skipLoopback
      ? (req) => !envBool('RATE_LIMIT_ENABLED', true) || isLoopback(req.ip || '')
      : () => !envBool('RATE_LIMIT_ENABLED', true),
    keyGenerator: key,
    handler: (req, res, next) => {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(window / 1000);
      res.set('Retry-After', String(retryAfter));
      next(new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many attempts, please try again later', { retryAfter }));
    },
  });
};

// One limiter (with its own counters) per route name, keyed by IP + email.
const authRateLimit = (name) =>
  createLimiter({
    limitEnv: 'RATE_LIMIT_AUTH_MAX',
    defaultLimit: 20,
    key: (req) => `${name}|${clientIp(req)}|${emailOf(req)}`,
  });

// A single instance shared by login, signup, forgot-password and verify-otp: one counter per IP for all four.
// Not applied to loopback callers without X-Forwarded-For (see above).
const authIpRateLimit = createLimiter({
  limitEnv: 'RATE_LIMIT_IP_MAX',
  defaultLimit: 100,
  key: (req) => `auth-ip|${clientIp(req)}`,
  skipLoopback: true,
});

// Per authenticated user (requireAuth runs first); falls back to the IP if there is no user.
const changePasswordRateLimit = createLimiter({
  limitEnv: 'RATE_LIMIT_PASSWORD_MAX',
  defaultLimit: 10,
  key: (req) => (req.user?._id ? `change-password|user:${req.user._id}` : `change-password|ip:${clientIp(req)}`),
});

// Per IP. Not applied to loopback callers without X-Forwarded-For (see above).
const resetPasswordRateLimit = createLimiter({
  limitEnv: 'RATE_LIMIT_RESET_MAX',
  defaultLimit: 20,
  key: (req) => `reset-password|${clientIp(req)}`,
  skipLoopback: true,
});

module.exports = { authRateLimit, authIpRateLimit, changePasswordRateLimit, resetPasswordRateLimit, isLoopback };
