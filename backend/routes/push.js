const express = require('express');
const { getVapidPublicKey, subscribe, unsubscribe } = require('../controllers/pushController');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// Mounted at /api/push.
router.get('/vapid-public-key', getVapidPublicKey);
router.post('/subscriptions', requireAuth, subscribe);
router.delete('/subscriptions', requireAuth, unsubscribe);

module.exports = router;
