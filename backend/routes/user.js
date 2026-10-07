const express = require('express');
const {
  getMe,
  updateMe,
  listUsers,
  getUserStats,
  createUser,
  getUser,
  updateUser,
  deleteUser,
} = require('../controllers/userController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

// Mounted at /api/users. Every route needs a valid access token.
router.use(requireAuth);

// Current user (any role). Declared before /:id so "me" is not read as an id.
router.get('/me', getMe);
router.patch('/me', updateMe);

// Administration
const adminOnly = requireRole('ADMIN');
router.get('/', adminOnly, listUsers);
router.get('/stats', adminOnly, getUserStats);
router.post('/', adminOnly, createUser);
router.get('/:id', adminOnly, getUser);
router.patch('/:id', adminOnly, updateUser);
router.delete('/:id', adminOnly, deleteUser);

module.exports = router;
