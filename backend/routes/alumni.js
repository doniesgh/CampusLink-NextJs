const express = require('express');
const handlers = require('../controllers/alumniController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { userRateLimit } = require('../middleware/rateLimit');

// Module 6 (alumni directory and network), phase 3 contract section 4. Mounted at /api/alumni in app.js.
// Any signed-in user reads the directory and the news wall; ALUMNI manage their profile and post; STUDENTs ask for
// mentoring; ADMINs moderate. See docs/alumni.md.
const router = express.Router();

router.use(requireAuth);
const admin = requireRole('ADMIN');
const alumniOnly = requireRole('ALUMNI');
const studentOnly = requireRole('STUDENT');

const DAY_MS = 24 * 60 * 60 * 1000;
// Contract: 10 posts per day and per alumni.
const postLimit = userRateLimit({
  name: 'alumni-post',
  limitEnv: 'RATE_LIMIT_ALUMNI_POST_MAX',
  defaultLimit: 10,
  windowEnv: 'RATE_LIMIT_ALUMNI_POST_WINDOW_MS',
  defaultWindowMs: DAY_MS,
  message: 'Too many alumni posts, please try again later',
});
// Every request notifies the alumni: a request / withdraw loop must not flood them.
const mentoringLimit = userRateLimit({
  name: 'alumni-mentoring',
  limitEnv: 'RATE_LIMIT_MENTORING_MAX',
  defaultLimit: 10,
  windowEnv: 'RATE_LIMIT_MENTORING_WINDOW_MS',
  defaultWindowMs: DAY_MS,
  message: 'Too many mentoring requests, please try again later',
});

// My profile and my data (fixed paths before /:id).
router.get('/me', alumniOnly, handlers.getMyProfile);
router.put('/me', alumniOnly, handlers.updateMyProfile);
router.get('/me/export', alumniOnly, handlers.exportMyData);
router.delete('/me', alumniOnly, handlers.eraseMyData);

// Directory filters and support list.
router.get('/facets', handlers.getFacets);
router.get('/admin/profiles', admin, handlers.adminListProfiles);

// Mentoring requests.
router.get('/mentoring', handlers.listMentoring);
router.get('/mentoring/:id', handlers.getMentoringRequest);
router.post('/mentoring/:id/accept', handlers.acceptRequest);
router.post('/mentoring/:id/decline', handlers.declineRequest);
router.post('/mentoring/:id/close', handlers.closeRequest);

// News wall.
router.get('/posts', handlers.listPosts);
router.post('/posts', alumniOnly, postLimit, handlers.createPost);
router.delete('/posts/:id', handlers.deletePost);
router.post('/posts/:id/hide', admin, handlers.hidePost);
router.post('/posts/:id/unhide', admin, handlers.unhidePost);

// Directory and profiles (:id = profile id or the alumni's user id).
router.get('/', handlers.listDirectory);
router.get('/:id', handlers.getProfile);
router.post('/:id/mentoring', studentOnly, mentoringLimit, handlers.createMentoringRequest);

module.exports = router;
