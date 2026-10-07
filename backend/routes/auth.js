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
const { authRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Mounted at /api/auth. Rate limited per IP + email: 429 TOO_MANY_REQUESTS (see middleware/rateLimit.js).
router.post('/signup', authRateLimit('signup'), signup);
router.post('/login', authRateLimit('login'), login);
router.post('/verify-otp', authRateLimit('verify-otp'), verifyOtp);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/forgot-password', authRateLimit('forgot-password'), forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/change-password', requireAuth, changePassword);

module.exports = router;
