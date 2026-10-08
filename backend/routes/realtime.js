const express = require('express');
const controller = require('../controllers/realtimeController');
const { requireAuth } = require('../middleware/requireAuth');
const { userRateLimit } = require('../middleware/rateLimit');

// Real-time layer, phase 3 contract section 1. Mounted at /api/realtime in app.js; the Socket.IO server is
// attached to the HTTP server by service/realtime.js (path /socket.io).
const router = express.Router();

router.use(requireAuth);

// A ticket per (re)connection: generous, but bounded (RATE_LIMIT_REALTIME_TICKET_MAX per minute and user).
const ticketLimit = userRateLimit({
  name: 'realtime-ticket',
  limitEnv: 'RATE_LIMIT_REALTIME_TICKET_MAX',
  defaultLimit: 60,
  defaultWindowMs: 60 * 1000,
  message: 'Too many real-time tickets, please try again later',
});

router.get('/ticket', ticketLimit, controller.getTicket);

module.exports = router;
