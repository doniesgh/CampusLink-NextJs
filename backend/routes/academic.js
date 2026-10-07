const express = require('express');
const handlers = require('../controllers/academicController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

// Mounted at /api/academic. Reading: any authenticated user. Changes: ADMIN only.
router.use(requireAuth);
const adminOnly = requireRole('ADMIN');

['programs', 'groups', 'subjects', 'rooms'].forEach((plural) => {
  const { list, getOne, create, update, remove } = handlers[plural];
  router.get(`/${plural}`, list);
  router.get(`/${plural}/:id`, getOne);
  router.post(`/${plural}`, adminOnly, create);
  router.patch(`/${plural}/:id`, adminOnly, update);
  router.delete(`/${plural}/:id`, adminOnly, remove);
});

module.exports = router;
