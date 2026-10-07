const express = require('express');
const {
  signup,
  login,
  verifyOtp,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
} = require('../controllers/authController');
const { requireAuth } = require('../middleware/requireAuth');
const {
  authRateLimit,
  authIpRateLimit,
  changePasswordRateLimit,
  resetPasswordRateLimit,
} = require('../middleware/rateLimit');

const router = express.Router();

// Mounted at /api/auth. Rate limits answer 429 TOO_MANY_REQUESTS (see middleware/rateLimit.js):
// signup, login, verify-otp and forgot-password per route + IP + email, then per IP across the four routes;
// change-password per user; reset-password per IP. The per-email limiter runs first, so requests it
// refuses do not use up the IP budget shared by everyone behind the same address. The IP-only limiters
// do not apply to loopback callers without X-Forwarded-For (the web app when it forwards no client IP).
router.post('/signup', authRateLimit('signup'), authIpRateLimit, signup);
router.post('/login', authRateLimit('login'), authIpRateLimit, login);
router.post('/verify-otp', authRateLimit('verify-otp'), authIpRateLimit, verifyOtp);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/forgot-password', authRateLimit('forgot-password'), authIpRateLimit, forgotPassword);
router.post('/reset-password', resetPasswordRateLimit, resetPassword);
router.post('/change-password', requireAuth, changePasswordRateLimit, changePassword);

module.exports = router;
