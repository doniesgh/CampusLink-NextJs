const express = require('express');
const handlers = require('../controllers/analyticsController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { userRateLimit } = require('../middleware/rateLimit');

// Each PDF recomputes the analytics and renders a document: cap it per user (security review, phase 2).
const reportLimit = userRateLimit({
  name: 'analytics-report',
  limitEnv: 'RATE_LIMIT_REPORT_MAX',
  defaultLimit: 20,
  windowEnv: 'RATE_LIMIT_REPORT_WINDOW_MS',
  defaultWindowMs: 60 * 60 * 1000,
  message: 'Too many report downloads, please try again later',
});

// Module 9 (student analytics and PDF report), phase 2 contract section 3.3. Mounted at /api/analytics in app.js.
const router = express.Router();

router.use(requireAuth);
const student = requireRole('STUDENT');
const adminOnly = requireRole('ADMIN');

router.get('/me', student, handlers.getMine);
router.get('/me/report.pdf', student, reportLimit, handlers.getMyReport);
router.get('/groups/:groupId', requireRole('TEACHER', 'ADMIN'), handlers.getGroup);
router.get('/students/:id', adminOnly, handlers.getStudent);
router.get('/students/:id/report.pdf', adminOnly, reportLimit, handlers.getStudentReport);

module.exports = router;
