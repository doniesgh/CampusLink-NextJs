const express = require('express');
const handlers = require('../controllers/attendanceController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

// Module 9 (attendance), phase 2 contract section 3.1. Mounted at /api/attendance in app.js.
const router = express.Router();

router.use(requireAuth);
const staff = requireRole('TEACHER', 'ADMIN');

router.get('/me', handlers.getMine);
router.get('/alerts', requireRole('ADMIN'), handlers.listAlerts);
router.get('/sessions', staff, handlers.listSessions);
router.get('/sessions/:sessionId', staff, handlers.getRollCall);
router.put('/sessions/:sessionId', staff, handlers.saveRollCall);

module.exports = router;
