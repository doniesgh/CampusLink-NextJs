const express = require('express');
const handlers = require('../controllers/carpoolController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { userRateLimit } = require('../middleware/rateLimit');

// Module 2 (carpooling), phase 3 contract section 2. Mounted at /api/carpool in app.js.
// Loading the controller registers the completion job and the "trip" room authorizer (service/carpoolService.js).
// STUDENTs search, offer, request, chat and rate; ADMINs can read trips and cancel any of them (audited).
const router = express.Router();

const HOUR_MS = 60 * 60 * 1000;

router.use(requireAuth);
const student = requireRole('STUDENT');
const studentOrAdmin = requireRole('STUDENT', 'ADMIN');

// Per-user limits (429 TOO_MANY_REQUESTS, skipped with RATE_LIMIT_ENABLED=false).
const messageLimit = userRateLimit({
  name: 'carpool-message',
  limitEnv: 'RATE_LIMIT_CARPOOL_MESSAGE_MAX',
  defaultLimit: 30,
  windowEnv: 'RATE_LIMIT_CARPOOL_MESSAGE_WINDOW_MS',
  defaultWindowMs: 60 * 1000,
  message: 'Too many messages, please slow down',
});
// Every trip change notifies all its passengers (in-app and push): bounded (security review, phase 3).
const updateLimit = userRateLimit({
  name: 'carpool-trip-update',
  limitEnv: 'RATE_LIMIT_CARPOOL_UPDATE_MAX',
  defaultLimit: 20,
  windowEnv: 'RATE_LIMIT_CARPOOL_WINDOW_MS',
  defaultWindowMs: HOUR_MS,
  message: 'Too many trip changes, please try again later',
});
// Every new trip / request may notify other students: bounded too.
const tripLimit = userRateLimit({
  name: 'carpool-trip',
  limitEnv: 'RATE_LIMIT_CARPOOL_TRIP_MAX',
  defaultLimit: 20,
  windowEnv: 'RATE_LIMIT_CARPOOL_WINDOW_MS',
  defaultWindowMs: HOUR_MS,
  message: 'Too many trips offered, please try again later',
});
const requestLimit = userRateLimit({
  name: 'carpool-request',
  limitEnv: 'RATE_LIMIT_CARPOOL_REQUEST_MAX',
  defaultLimit: 30,
  windowEnv: 'RATE_LIMIT_CARPOOL_WINDOW_MS',
  defaultWindowMs: HOUR_MS,
  message: 'Too many seat requests, please try again later',
});

// Reference data (any signed-in user).
router.get('/places', handlers.listPlaces);
router.get('/settings', handlers.getSettings);

// Trips (fixed paths before /:id).
router.get('/trips', studentOrAdmin, handlers.searchTrips);
router.post('/trips', student, tripLimit, handlers.createTrip);
router.get('/me/trips', studentOrAdmin, handlers.listMyTrips);
router.get('/trips/:id', studentOrAdmin, handlers.getTrip);
router.patch('/trips/:id', student, updateLimit, handlers.updateTrip);
router.post('/trips/:id/cancel', studentOrAdmin, handlers.cancelTrip);

// Seat requests.
router.get('/trips/:id/requests', student, handlers.listTripRequests);
router.post('/trips/:id/requests', student, requestLimit, handlers.createRequest);
router.post('/requests/:id/accept', student, handlers.acceptRequest);
router.post('/requests/:id/decline', student, handlers.declineRequest);
router.post('/requests/:id/cancel', student, handlers.cancelRequest);

// Chat (driver and accepted passengers) and ratings (after the trip).
router.get('/trips/:id/messages', student, handlers.listMessages);
router.post('/trips/:id/messages', student, messageLimit, handlers.postMessage);
router.post('/trips/:id/ratings', student, handlers.rateParticipant);

module.exports = router;
