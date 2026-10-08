const express = require('express');
const controller = require('../controllers/bookingController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { userRateLimit } = require('../middleware/rateLimit');

// Module 5 (room and equipment bookings), phase 2 contract section 1.2. Mounted at /api/bookings.
// Loading the controller registers the reminder jobs (service/bookingService.js).
const router = express.Router();

const HOUR_MS = 60 * 60 * 1000;

router.use(requireAuth);
const adminOnly = requireRole('ADMIN');
// ALUMNI cannot book (403 FORBIDDEN).
const canBook = requireRole('STUDENT', 'TEACHER', 'ADMIN');

// Per-user limits (429 TOO_MANY_REQUESTS): every PENDING request notifies the admins and cancelling frees the
// slot and the student's seat, so a create / cancel loop must stay bounded (RATE_LIMIT_BOOKING_* variables).
// Admins are not limited when they cancel (moderation, audited).
const createLimit = userRateLimit({
  name: 'booking-create',
  limitEnv: 'RATE_LIMIT_BOOKING_CREATE_MAX',
  defaultLimit: 30,
  windowEnv: 'RATE_LIMIT_BOOKING_WINDOW_MS',
  defaultWindowMs: HOUR_MS,
  message: 'Too many booking requests, please try again later',
});
const cancelLimit = userRateLimit({
  name: 'booking-cancel',
  limitEnv: 'RATE_LIMIT_BOOKING_CANCEL_MAX',
  defaultLimit: 30,
  windowEnv: 'RATE_LIMIT_BOOKING_WINDOW_MS',
  defaultWindowMs: HOUR_MS,
  skip: (req) => req.user?.role === 'ADMIN',
  message: 'Too many cancellations, please try again later',
});

// Fixed paths before /:id.
router.get('/availability', controller.getAvailability);
router.get('/free-rooms', controller.getFreeRooms);
router.get('/me', controller.listMyBookings);
router.get('/stats', adminOnly, controller.getStats);
router.get('/', adminOnly, controller.listBookings);
router.post('/', canBook, createLimit, controller.createBooking);

router.get('/:id', controller.getBooking);
router.post('/:id/cancel', cancelLimit, controller.cancelBooking);
router.post('/:id/approve', adminOnly, controller.approveBooking);
router.post('/:id/reject', adminOnly, controller.rejectBooking);

module.exports = router;
