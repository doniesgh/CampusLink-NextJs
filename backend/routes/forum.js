const express = require('express');
const handlers = require('../controllers/forumController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { userRateLimit } = require('../middleware/rateLimit');

// Module 4 (help forum), phase 2 contract section 2. Mounted at /api/forum in app.js.
// Any signed-in user reads, asks, answers, votes, follows and reports; moderation is for ADMINs.
const router = express.Router();

router.use(requireAuth);
const admin = requireRole('ADMIN');

// Questions (fixed paths before /:id).
router.get('/questions', handlers.listQuestions);
router.get('/questions/similar', handlers.similarQuestions);
// Anti-spam: every new answer notifies the followers of the question (security review, phase 2).
const postLimit = userRateLimit({
  name: 'forum-post',
  limitEnv: 'RATE_LIMIT_FORUM_POST_MAX',
  defaultLimit: 30,
  windowEnv: 'RATE_LIMIT_FORUM_WINDOW_MS',
  defaultWindowMs: 60 * 60 * 1000,
  skip: (req) => req.user?.role === 'ADMIN',
  message: 'Too many forum posts, please try again later',
});

router.post('/questions', postLimit, handlers.createQuestion);
router.get('/questions/:id', handlers.getQuestion);
router.patch('/questions/:id', handlers.updateQuestion);
router.delete('/questions/:id', handlers.deleteQuestion);
router.post('/questions/:id/answers', postLimit, handlers.createAnswer);
router.post('/questions/:id/accept', handlers.acceptAnswer);
router.post('/questions/:id/vote', handlers.voteQuestion);
router.post('/questions/:id/follow', handlers.followQuestion);
router.delete('/questions/:id/follow', handlers.unfollowQuestion);
router.post('/questions/:id/report', postLimit, handlers.reportQuestion);
router.post('/questions/:id/hide', admin, handlers.hideQuestion);
router.post('/questions/:id/unhide', admin, handlers.unhideQuestion);

// Answers.
router.patch('/answers/:id', handlers.updateAnswer);
router.delete('/answers/:id', handlers.deleteAnswer);
router.post('/answers/:id/vote', handlers.voteAnswer);
router.post('/answers/:id/report', postLimit, handlers.reportAnswer);
router.post('/answers/:id/hide', admin, handlers.hideAnswer);
router.post('/answers/:id/unhide', admin, handlers.unhideAnswer);

// Moderation queue (ADMIN).
router.get('/reports', admin, handlers.listReports);
router.post('/reports/:id/resolve', admin, handlers.resolveReport);

// Profiles, leaderboard, tags.
router.get('/profiles/me', handlers.getMyProfile);
router.get('/profiles/:userId', handlers.getProfile);
router.get('/leaderboard', handlers.getLeaderboard);
router.get('/tags', handlers.listTags);

module.exports = router;
