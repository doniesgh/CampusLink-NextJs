const express = require('express');
const handlers = require('../controllers/announcementController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { createUpload } = require('../middleware/upload');
const { MAX_ATTACHMENTS } = require('../models/announcementModel');

// Module 7 (announcements), contract section 7. Mounted at /api/announcements in app.js.
const router = express.Router();

router.use(requireAuth);
const managers = requireRole('ADMIN', 'TEACHER');
// JSON bodies pass through; multipart bodies: "data" (JSON) + up to 5 "attachments".
const attachments = createUpload({ field: 'attachments', maxCount: MAX_ATTACHMENTS });

// Fixed paths before /:id.
router.get('/', handlers.listFeed);
router.get('/manage', managers, handlers.listManaged);
router.post('/', managers, attachments, handlers.createAnnouncement);
router.post('/audience-preview', managers, handlers.previewAudience);

router.get('/:id', handlers.getAnnouncement);
router.patch('/:id', managers, attachments, handlers.updateAnnouncement);
router.delete('/:id', managers, handlers.deleteAnnouncement);
router.post('/:id/read', handlers.markRead);
router.post('/:id/publish', managers, handlers.publishAnnouncement);
router.get('/:id/stats', managers, handlers.getStats);
router.get('/:id/attachments/:attachmentId', handlers.downloadAttachment);

module.exports = router;
