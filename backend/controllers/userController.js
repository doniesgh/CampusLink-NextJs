const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const { requireFields, normalizeEmail, assertObjectId, throwIfInvalid } = require('../utils/validation');
const { revokeAllRefreshTokens } = require('../service/tokenService');

const { ROLES } = User;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

const noChanges = () => new HttpError(400, 'NO_CHANGES', 'No changes provided');
const userNotFound = () => new HttpError(404, 'USER_NOT_FOUND', 'User not found');
const emailTaken = () => new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPositiveInt = (value, fallback) => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

// Copies the allowed fields present in the body, checking their types.
// Returns { changes, details } where details holds type errors ({ field: message }).
const pickChanges = (body, allowed) => {
  const changes = {};
  const details = {};

  allowed.forEach((field) => {
    if (body[field] === undefined) return;
    const value = body[field];

    if (field === 'twoFactorEnabled') {
      if (typeof value !== 'boolean') details[field] = 'twoFactorEnabled must be a boolean';
      else changes[field] = value;
    } else if (typeof value !== 'string') {
      details[field] = `${field} must be a string`;
    } else if (field === 'role') {
      changes[field] = value.trim().toUpperCase();
    } else {
      changes[field] = value;
    }
  });

  return { changes, details };
};

const findUserOr404 = async (id) => {
  assertObjectId(id);
  const user = await User.findById(id);
  if (!user) throw userNotFound();
  return user;
};

// GET /api/users/me
const getMe = async (req, res) => {
  res.status(200).json(req.user);
};

// PATCH /api/users/me — only firstname, lastname and twoFactorEnabled; other fields are ignored.
const updateMe = async (req, res) => {
  const { changes, details } = pickChanges(req.body ?? {}, ['firstname', 'lastname', 'twoFactorEnabled']);
  throwIfInvalid(details);
  if (Object.keys(changes).length === 0) throw noChanges();

  const user = req.user;
  user.set(changes);
  await user.save();

  res.status(200).json(user);
};

// GET /api/users?role=&email=&page=1&limit=20 [admin]
const listUsers = async (req, res) => {
  const { role, email } = req.query;
  const filter = {};

  if (role !== undefined && String(role).trim() !== '') {
    const normalizedRole = String(role).trim().toUpperCase();
    if (!ROLES.includes(normalizedRole)) {
      throw new HttpError(400, 'INVALID_ROLE', `Role must be one of ${ROLES.join(', ')}`);
    }
    filter.role = normalizedRole;
  }

  if (email !== undefined && String(email).trim() !== '') {
    // Case-insensitive "contains" search.
    filter.email = { $regex: escapeRegex(String(email).trim()), $options: 'i' };
  }

  const page = toPositiveInt(req.query.page, 1);
  const limit = Math.min(toPositiveInt(req.query.limit, DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);

  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  res.status(200).json({ items, total, page, limit });
};

// GET /api/users/stats [admin]
const getUserStats = async (req, res) => {
  const counts = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);

  const stats = Object.fromEntries(ROLES.map((role) => [role, 0]));
  counts.forEach(({ _id, count }) => {
    if (ROLES.includes(_id)) stats[_id] = count;
  });

  res.status(200).json(stats);
};

// POST /api/users [admin]
const createUser = async (req, res) => {
  const body = req.body ?? {};
  requireFields(body, ['firstname', 'lastname', 'email', 'password']);

  const { changes, details } = pickChanges(body, ['role']);
  throwIfInvalid(details);

  const user = new User({
    firstname: body.firstname,
    lastname: body.lastname,
    email: body.email,
    password: body.password,
    role: changes.role || 'STUDENT',
  });
  await user.validate();

  if (await User.exists({ email: user.email })) throw emailTaken();

  await user.save();
  res.status(201).json(user);
};

// GET /api/users/:id [admin]
const getUser = async (req, res) => {
  res.status(200).json(await findUserOr404(req.params.id));
};

// PATCH /api/users/:id [admin]
const updateUser = async (req, res) => {
  const user = await findUserOr404(req.params.id);

  const { changes, details } = pickChanges(req.body ?? {}, [
    'firstname',
    'lastname',
    'email',
    'role',
    'password',
    'twoFactorEnabled',
  ]);
  throwIfInvalid(details);
  if (Object.keys(changes).length === 0) throw noChanges();

  if (changes.email !== undefined) {
    const email = normalizeEmail(changes.email);
    if (email !== user.email && (await User.exists({ email, _id: { $ne: user._id } }))) {
      throw emailTaken();
    }
  }

  // set() + save() so validators and the password hashing hook run.
  user.set(changes);
  const passwordChanged = user.isModified('password');
  await user.save();

  if (passwordChanged) {
    await revokeAllRefreshTokens(user._id);
  }

  res.status(200).json(user);
};

// DELETE /api/users/:id [admin]
const deleteUser = async (req, res) => {
  assertObjectId(req.params.id);

  if (req.user._id.equals(req.params.id)) {
    throw new HttpError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }

  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw userNotFound();

  await revokeAllRefreshTokens(user._id);
  res.status(204).end();
};

module.exports = {
  getMe,
  updateMe,
  listUsers,
  getUserStats,
  createUser,
  getUser,
  updateUser,
  deleteUser,
};
