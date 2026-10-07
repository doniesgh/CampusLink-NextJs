const express = require('express');
const controller = require('../controllers/timetableController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { createUpload, FILE_TYPES } = require('../middleware/upload');
const { MAX_FILE_MB } = require('../service/timetableImport');

// Module 1 (smart timetable), contract section 6. Mounted at /api/timetable in app.js.
// Reading: any authenticated user. Sessions and import: ADMIN. ICS feed: secret token, no auth.
const router = express.Router();
const adminOnly = requireRole('ADMIN');

// Public calendar feed (the token in the URL is the credential).
router.get('/ics/:token.ics', controller.getCalendarFeed);

// Personal timetable and calendar export.
router.get('/me', requireAuth, controller.getMyTimetable);
router.get('/me/groups', requireAuth, controller.getMyGroups);
router.get('/me/calendar-link', requireAuth, controller.getCalendarLink);
router.post('/me/calendar-link/reset', requireAuth, controller.resetCalendarLink);
router.get('/me/calendar.ics', requireAuth, controller.downloadMyCalendar);

// Browse by group / teacher / room.
router.get('/', requireAuth, controller.browseTimetable);

// Management.
router.get('/sessions/:id', requireAuth, controller.getSession);
router.post('/sessions', requireAuth, adminOnly, controller.createSession);
router.patch('/sessions/:id', requireAuth, adminOnly, controller.updateSession);
router.delete('/sessions/:id', requireAuth, adminOnly, controller.deleteSession);
router.post(
  '/import',
  requireAuth,
  adminOnly,
  createUpload({ field: 'file', types: FILE_TYPES.CSV, maxFileSizeMb: MAX_FILE_MB }),
  controller.importSessions
);

module.exports = router;
