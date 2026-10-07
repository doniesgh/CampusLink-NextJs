const mongoose = require('mongoose');
const User = require('../models/userModel');
const Group = require('../models/groupModel');
const HttpError = require('../utils/httpError');
const {
  requireFields,
  normalizeEmail,
  assertObjectId,
  throwIfInvalid,
  escapeRegex,
  parsePagination,
  normalizeLocale,
  LOCALES,
} = require('../utils/validation');
const { idOf } = require('../utils/serialize');
const { revokeAllRefreshTokens } = require('../service/tokenService');
const auditService = require('../service/auditService');

const { ROLES } = User;

const noChanges = () => new HttpError(400, 'NO_CHANGES', 'No changes provided');
const userNotFound = () => new HttpError(404, 'USER_NOT_FOUND', 'User not found');
const emailTaken = () => new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');

const ONLY_STUDENTS_MESSAGE = 'Only students can be assigned to a group';

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
    } else if (field === 'group') {
      // A group id, or null to remove the student from their group.
      if (value === null) changes.group = null;
      else if (typeof value === 'string' && mongoose.isObjectIdOrHexString(value.trim())) {
        changes.group = new mongoose.Types.ObjectId(value.trim());
      } else details.group = 'group must be a group id or null';
    } else if (typeof value !== 'string') {
      details[field] = `${field} must be a string`;
    } else if (field === 'role') {
      changes[field] = value.trim().toUpperCase();
    } else if (field === 'locale') {
      const locale = normalizeLocale(value);
      if (locale) changes.locale = locale;
      else details.locale = `Locale must be one of ${LOCALES.join(', ')}`;
    } else {
      changes[field] = value;
    }
  });

  if (changes.role !== undefined && !ROLES.includes(changes.role)) {
    details.role = `Role must be one of ${ROLES.join(', ')}`;
  }

  return { changes, details };
};

// Checks a group assignment: only for students, and the group must exist.
const checkGroupAssignment = async (groupId, role) => {
  if (groupId === undefined || groupId === null) return;
  if (role !== 'STUDENT') throwIfInvalid({ group: ONLY_STUDENTS_MESSAGE });
  if (!(await Group.exists({ _id: groupId }))) throwIfInvalid({ group: 'Unknown group' });
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

// PATCH /api/users/me — only firstname, lastname, twoFactorEnabled and locale; other fields are ignored.
const updateMe = async (req, res) => {
  const { changes, details } = pickChanges(req.body ?? {}, ['firstname', 'lastname', 'twoFactorEnabled', 'locale']);
  throwIfInvalid(details);
  if (Object.keys(changes).length === 0) throw noChanges();

  const user = req.user;
  user.set(changes);
  await user.save();

  res.status(200).json(user);
};

// Builds the user filter of GET /api/users from the query string.
const buildListFilter = async (query) => {
  const { role, email, q, group, program, level } = query;
  const filter = {};
  const details = {};
  const present = (value) => value !== undefined && String(value).trim() !== '';

  if (present(role)) {
    const normalizedRole = String(role).trim().toUpperCase();
    if (!ROLES.includes(normalizedRole)) {
      throw new HttpError(400, 'INVALID_ROLE', `Role must be one of ${ROLES.join(', ')}`);
    }
    filter.role = normalizedRole;
  }

  if (present(email)) {
    // Case-insensitive "contains" search.
    filter.email = { $regex: escapeRegex(String(email).trim()), $options: 'i' };
  }

  if (present(q)) {
    const regex = { $regex: escapeRegex(String(q).trim().slice(0, 100)), $options: 'i' };
    filter.$or = [{ firstname: regex }, { lastname: regex }, { email: regex }];
  }

  const groupFilter = {};
  if (present(group)) {
    if (mongoose.isObjectIdOrHexString(String(group).trim())) groupFilter._id = String(group).trim();
    else details.group = 'group must be a group id';
  }
  if (present(program)) {
    if (mongoose.isObjectIdOrHexString(String(program).trim())) groupFilter.program = String(program).trim();
    else details.program = 'program must be a program id';
  }
  if (present(level)) {
    const number = Number(level);
    if (Number.isInteger(number) && number >= Group.MIN_LEVEL && number <= Group.MAX_LEVEL) groupFilter.level = number;
    else details.level = `level must be an integer between ${Group.MIN_LEVEL} and ${Group.MAX_LEVEL}`;
  }
  throwIfInvalid(details);

  if (groupFilter.program !== undefined || groupFilter.level !== undefined) {
    filter.group = { $in: await Group.distinct('_id', groupFilter) };
  } else if (groupFilter._id !== undefined) {
    filter.group = new mongoose.Types.ObjectId(groupFilter._id);
  }

  return filter;
};

// GET /api/users?role=&email=&q=&group=&program=&level=&page=1&limit=20 [admin]
const listUsers = async (req, res) => {
  const filter = await buildListFilter(req.query);
  const { page, limit, skip } = parsePagination(req.query);

  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
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

  const { changes, details } = pickChanges(body, ['role', 'locale', 'group']);
  throwIfInvalid(details);

  const role = changes.role || 'STUDENT';
  await checkGroupAssignment(changes.group, role);

  const user = new User({
    firstname: body.firstname,
    lastname: body.lastname,
    email: body.email,
    password: body.password,
    role,
    locale: changes.locale,
    group: changes.group ?? null,
  });
  await user.validate();

  if (await User.exists({ email: user.email })) throw emailTaken();

  await user.save();
  await user.populateGroup();

  await auditService.record(req, {
    action: 'user.create',
    targetType: 'User',
    targetId: user._id,
    summary: `Created ${user.role} account ${user.email}`,
    metadata: { email: user.email, role: user.role, group: idOf(user.group) },
  });

  res.status(201).json(user);
};

// GET /api/users/:id [admin]
const getUser = async (req, res) => {
  res.status(200).json(await findUserOr404(req.params.id));
};

const UPDATABLE_FIELDS = ['firstname', 'lastname', 'email', 'role', 'password', 'twoFactorEnabled', 'locale', 'group'];

// PATCH /api/users/:id [admin]
const updateUser = async (req, res) => {
  const user = await findUserOr404(req.params.id);

  const { changes, details } = pickChanges(req.body ?? {}, UPDATABLE_FIELDS);
  throwIfInvalid(details);
  if (Object.keys(changes).length === 0) throw noChanges();

  const nextRole = changes.role ?? user.role;
  await checkGroupAssignment(changes.group, nextRole);
  // Only students have a group: changing a student's role to another role clears it.
  if (nextRole !== 'STUDENT' && user.group) changes.group = null;

  if (changes.email !== undefined) {
    const email = normalizeEmail(changes.email);
    if (email !== user.email && (await User.exists({ email, _id: { $ne: user._id } }))) {
      throw emailTaken();
    }
  }

  const before = { role: user.role, group: idOf(user.group) };

  // set() + save() so validators and the password hashing hook run.
  user.set(changes);
  const changed = UPDATABLE_FIELDS.filter(
    (field) => user.isModified(field) && !(field === 'group' && idOf(user.group) === before.group)
  );
  const passwordChanged = user.isModified('password');
  await user.save();
  if (changes.group !== undefined) await user.populateGroup();

  if (passwordChanged) {
    await revokeAllRefreshTokens(user._id);
  }

  if (changed.length > 0) {
    const metadata = { changes: changed };
    if (changed.includes('role')) metadata.role = { from: before.role, to: user.role };
    if (changed.includes('group')) metadata.group = { from: before.group, to: idOf(user.group) };
    await auditService.record(req, {
      action: 'user.update',
      targetType: 'User',
      targetId: user._id,
      summary: changed.includes('role')
        ? `Updated ${user.email} (role ${before.role} → ${user.role})`
        : `Updated ${user.email} (${changed.join(', ')})`,
      metadata,
    });
  }

  res.status(200).json(user);
};

// DELETE /api/users/:id [admin]
const deleteUser = async (req, res) => {
  assertObjectId(req.params.id);

  if (req.user._id.equals(req.params.id)) {
    throw new HttpError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }

  const user = await User.findByIdAndDelete(req.params.id).setOptions({ populateGroup: false });
  if (!user) throw userNotFound();

  // Sessions, push subscriptions and in-app notifications of the account go with it.
  const { models } = mongoose;
  await Promise.all([
    revokeAllRefreshTokens(user._id),
    models.PushSubscription?.deleteMany({ user: user._id }),
    models.Notification?.deleteMany({ user: user._id }),
  ]);

  await auditService.record(req, {
    action: 'user.delete',
    targetType: 'User',
    targetId: user._id,
    summary: `Deleted ${user.role} account ${user.email}`,
    metadata: { email: user.email, role: user.role, firstname: user.firstname, lastname: user.lastname },
  });

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
