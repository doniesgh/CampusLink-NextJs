const express = require('express');
const { listNotifications, unreadCount, markRead, markAllRead } = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// Mounted at /api/notifications. Every route works on the current user's notifications.
router.use(requireAuth);

router.get('/', listNotifications);
router.get('/unread-count', unreadCount);
router.post('/read-all', markAllRead);
router.post('/:id/read', markRead);

module.exports = router;
