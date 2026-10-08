const mongoose = require('mongoose');
const Program = require('../models/programModel');
const Group = require('../models/groupModel');
const Subject = require('../models/subjectModel');
const Room = require('../models/roomModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const {
  assertObjectId,
  notFound,
  throwIfInvalid,
  readString,
  readInteger,
  readEnum,
  readObjectId,
  readBoolean,
} = require('../utils/validation');
const auditService = require('../service/auditService');

/*
 * /api/academic: programs, groups, subjects and rooms (contract section 2).
 * GET (list / one): any authenticated user. POST / PATCH / DELETE: ADMIN, audited as
 * academic.<resource>.create|update|delete.
 */

const SORT_COLLATION = { locale: 'en', strength: 2, numericOrdering: true };

const alreadyExists = (field, message) => new HttpError(409, 'ALREADY_EXISTS', message, { field });

// ---------- Input parsing: each parser returns { values, details } ----------

const has = (body, field) => body[field] !== undefined;

const readCode = (value, details) => {
  const code = readString(value, 'code', details, { min: 1, max: 20 });
  if (code === undefined) return undefined;
  const upper = code.toUpperCase();
  if (!Program.CODE_PATTERN.test(upper)) {
    details.code = 'Code must be 1 to 20 letters, digits, "-" or "_"';
    return undefined;
  }
  return upper;
};

const requireOnCreate = (body, fields, details) => {
  fields.forEach((field) => {
    if (body[field] === undefined || body[field] === null || body[field] === '') details[field] = `${field} is required`;
  });
};

const parseProgram = async (body, { create }) => {
  const values = {};
  const details = {};
  if (create) requireOnCreate(body, ['name', 'code'], details);
  if (has(body, 'name') && !details.name) values.name = readString(body.name, 'name', details, { min: 1, max: 120 });
  if (has(body, 'code') && !details.code) values.code = readCode(body.code, details);
  if (has(body, 'description')) {
    values.description =
      body.description === null ? '' : readString(body.description, 'description', details, { max: 1000 });
  }
  return { values, details };
};

const parseGroup = async (body, { create }) => {
  const values = {};
  const details = {};
  if (create) requireOnCreate(body, ['name', 'level', 'academicYear', 'program'], details);
  if (has(body, 'name') && !details.name) values.name = readString(body.name, 'name', details, { min: 1, max: 50 });
  if (has(body, 'level') && !details.level) {
    values.level = readInteger(body.level, 'level', details, { min: Group.MIN_LEVEL, max: Group.MAX_LEVEL });
  }
  if (has(body, 'academicYear') && !details.academicYear) {
    const year = readString(body.academicYear, 'academicYear', details, { min: 1, max: 9 });
    if (year !== undefined && !Group.isAcademicYear(year)) details.academicYear = 'Academic year must look like "2026-2027"';
    else values.academicYear = year;
  }
  if (has(body, 'program') && !details.program) {
    const programId = readObjectId(body.program, 'program', details);
    if (programId && !(await Program.exists({ _id: programId }))) details.program = 'Unknown program';
    else values.program = programId;
  }
  return { values, details };
};

const parseSubject = async (body, { create }) => {
  const values = {};
  const details = {};
  if (create) requireOnCreate(body, ['name', 'code'], details);
  if (has(body, 'name') && !details.name) values.name = readString(body.name, 'name', details, { min: 1, max: 120 });
  if (has(body, 'code') && !details.code) values.code = readCode(body.code, details);
  if (has(body, 'color') && body.color !== null && !(create && body.color === '')) {
    const color = readString(body.color, 'color', details, { min: 7, max: 7 });
    if (color !== undefined && !Subject.COLOR_PATTERN.test(color.toUpperCase())) {
      details.color = 'Color must look like "#253C6D"';
    } else if (color !== undefined) values.color = color.toUpperCase();
  }
  if (create && values.color === undefined && !details.color) {
    values.color = Subject.pickSubjectColor(await Subject.estimatedDocumentCount());
  }
  return { values, details };
};

const parseRoom = async (body, { create }) => {
  const values = {};
  const details = {};
  if (create) requireOnCreate(body, ['name'], details);
  if (has(body, 'name') && !details.name) values.name = readString(body.name, 'name', details, { min: 1, max: 50 });
  if (has(body, 'building')) {
    values.building = body.building === null ? '' : readString(body.building, 'building', details, { max: 100 });
  }
  if (has(body, 'capacity')) {
    values.capacity =
      body.capacity === null || body.capacity === ''
        ? null
        : readInteger(body.capacity, 'capacity', details, { min: 1, max: 10000 });
  }
  if (has(body, 'type')) values.type = readEnum(body.type, Room.ROOM_TYPES, 'type', details);
  // Bookings (phase 2): requiresApproval defaults to true for an amphitheater (model default).
  if (has(body, 'bookable')) values.bookable = readBoolean(body.bookable, 'bookable', details);
  if (has(body, 'requiresApproval')) {
    values.requiresApproval = readBoolean(body.requiresApproval, 'requiresApproval', details);
  }
  return { values, details };
};

// ---------- References (409 IN_USE) ----------

// Counts documents of a model registered by another module (0 when it is not registered).
const countIfRegistered = (modelName, filter) => {
  const Model = mongoose.models[modelName];
  return Model ? Model.countDocuments(filter) : Promise.resolve(0);
};

const countReferences = async (checks) => {
  const counts = await Promise.all(checks.map(([, count]) => count));
  const references = {};
  checks.forEach(([name], index) => {
    if (counts[index] > 0) references[name] = counts[index];
  });
  return references;
};

// ---------- Resource definitions ----------

const RESOURCES = {
  programs: {
    Model: Program,
    label: 'Program',
    resource: 'program',
    parse: parseProgram,
    describe: (doc) => `${doc.code} (${doc.name})`,
    duplicate: (values) => (values.code ? { filter: { code: values.code }, field: 'code' } : null),
    references: (id) =>
      countReferences([
        ['groups', Group.countDocuments({ program: id })],
        ['announcements', countIfRegistered('Announcement', { 'audience.programs': id })],
      ]),
  },
  groups: {
    Model: Group,
    label: 'Group',
    resource: 'group',
    parse: parseGroup,
    populate: { path: 'program', select: 'name code' },
    describe: (doc) => `${doc.name} (${doc.academicYear})`,
    duplicate: (values, existing) => {
      const name = values.name ?? existing?.name;
      const academicYear = values.academicYear ?? existing?.academicYear;
      if (values.name === undefined && values.academicYear === undefined) return null;
      return { filter: { name, academicYear }, field: 'name', collation: Group.NAME_COLLATION };
    },
    references: (id) =>
      countReferences([
        ['users', User.countDocuments({ group: id })],
        ['sessions', countIfRegistered('ClassSession', { groups: id })],
        ['announcements', countIfRegistered('Announcement', { 'audience.groups': id })],
        ['assessments', countIfRegistered('Assessment', { group: id })],
      ]),
  },
  subjects: {
    Model: Subject,
    label: 'Subject',
    resource: 'subject',
    parse: parseSubject,
    describe: (doc) => `${doc.code} (${doc.name})`,
    duplicate: (values) => (values.code ? { filter: { code: values.code }, field: 'code' } : null),
    references: (id) =>
      countReferences([
        ['sessions', countIfRegistered('ClassSession', { subject: id })],
        ['forumQuestions', countIfRegistered('ForumQuestion', { subject: id })],
        ['assessments', countIfRegistered('Assessment', { subject: id })],
      ]),
  },
  rooms: {
    Model: Room,
    label: 'Room',
    resource: 'room',
    parse: parseRoom,
    describe: (doc) => doc.name,
    duplicate: (values) =>
      values.name ? { filter: { name: values.name }, field: 'name', collation: Room.NAME_COLLATION } : null,
    references: (id) =>
      countReferences([
        ['sessions', countIfRegistered('ClassSession', { room: id })],
        // Upcoming active bookings (phase 2, module 5); past ones keep a snapshot of the room.
        ['bookings', countIfRegistered('Booking', { room: id, status: { $in: ['PENDING', 'CONFIRMED'] }, endsAt: { $gt: new Date() } })],
      ]),
  },
};

// ---------- Group student counts ----------

const studentCounts = async (groupIds) => {
  if (groupIds.length === 0) return new Map();
  const rows = await User.aggregate([
    { $match: { group: { $in: groupIds }, role: 'STUDENT' } },
    { $group: { _id: '$group', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map(({ _id, count }) => [String(_id), count]));
};

const serializeGroups = async (groups) => {
  const counts = await studentCounts(groups.map((group) => group._id));
  return groups.map((group) => ({ ...group.toJSON(), studentCount: counts.get(String(group._id)) ?? 0 }));
};

const serialize = async (def, doc) => (def.Model === Group ? (await serializeGroups([doc]))[0] : doc.toJSON());

// ---------- Handlers ----------

const ensureNotDuplicate = async (def, values, existing) => {
  const duplicate = def.duplicate(values, existing);
  if (!duplicate) return;
  const query = def.Model.exists({ ...duplicate.filter, ...(existing ? { _id: { $ne: existing._id } } : {}) });
  if (duplicate.collation) query.collation(duplicate.collation);
  if (await query) {
    throw alreadyExists(duplicate.field, `A ${def.resource} with this ${duplicate.field} already exists`);
  }
};

const findOr404 = async (def, id) => {
  assertObjectId(id);
  const query = def.Model.findById(id);
  if (def.populate) query.populate(def.populate);
  const doc = await query;
  if (!doc) throw notFound(def.label);
  return doc;
};

// Builds the list filter of groups (?program=&level=&academicYear=).
const groupListFilter = (query) => {
  const filter = {};
  const details = {};
  const present = (value) => value !== undefined && String(value).trim() !== '';
  if (present(query.program)) {
    const id = readObjectId(String(query.program), 'program', details);
    if (id) filter.program = id;
  }
  if (present(query.level)) {
    const level = readInteger(String(query.level), 'level', details, { min: Group.MIN_LEVEL, max: Group.MAX_LEVEL });
    if (level !== undefined) filter.level = level;
  }
  if (present(query.academicYear)) {
    if (Group.isAcademicYear(String(query.academicYear).trim())) filter.academicYear = String(query.academicYear).trim();
    else details.academicYear = 'Academic year must look like "2026-2027"';
  }
  throwIfInvalid(details);
  return filter;
};

const list = (def) => async (req, res) => {
  const filter = def.Model === Group ? groupListFilter(req.query) : {};
  const query = def.Model.find(filter).sort({ name: 1, _id: 1 }).collation(SORT_COLLATION);
  if (def.populate) query.populate(def.populate);
  const docs = await query;
  res.status(200).json(def.Model === Group ? await serializeGroups(docs) : docs);
};

const getOne = (def) => async (req, res) => {
  res.status(200).json(await serialize(def, await findOr404(def, req.params.id)));
};

const create = (def) => async (req, res) => {
  const { values, details } = await def.parse(req.body ?? {}, { create: true });
  throwIfInvalid(details);
  await ensureNotDuplicate(def, values, null);

  const doc = await def.Model.create(values);
  if (def.populate) await doc.populate(def.populate);

  await auditService.record(req, {
    action: `academic.${def.resource}.create`,
    targetType: def.label,
    targetId: doc._id,
    summary: `Created ${def.resource} ${def.describe(doc)}`,
    metadata: { values: doc.toJSON() },
  });

  res.status(201).json(await serialize(def, doc));
};

const update = (def) => async (req, res) => {
  const doc = await findOr404(def, req.params.id);
  const { values, details } = await def.parse(req.body ?? {}, { create: false });
  throwIfInvalid(details);
  if (Object.keys(values).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No changes provided');
  await ensureNotDuplicate(def, values, doc);

  const before = doc.toJSON();
  doc.set(values);
  const changes = Object.keys(values).filter((field) => doc.isModified(field));
  await doc.save();
  if (def.populate) await doc.populate(def.populate);

  if (changes.length > 0) {
    const after = doc.toJSON();
    await auditService.record(req, {
      action: `academic.${def.resource}.update`,
      targetType: def.label,
      targetId: doc._id,
      summary: `Updated ${def.resource} ${def.describe(doc)} (${changes.join(', ')})`,
      metadata: {
        changes,
        before: Object.fromEntries(changes.map((field) => [field, before[field]])),
        after: Object.fromEntries(changes.map((field) => [field, after[field]])),
      },
    });
  }

  res.status(200).json(await serialize(def, doc));
};

const remove = (def) => async (req, res) => {
  const doc = await findOr404(def, req.params.id);

  const references = await def.references(doc._id);
  if (Object.keys(references).length > 0) {
    throw new HttpError(409, 'IN_USE', `This ${def.resource} is still in use`, { references });
  }

  await def.Model.deleteOne({ _id: doc._id });

  await auditService.record(req, {
    action: `academic.${def.resource}.delete`,
    targetType: def.label,
    targetId: doc._id,
    summary: `Deleted ${def.resource} ${def.describe(doc)}`,
    metadata: { values: doc.toJSON() },
  });

  res.status(204).end();
};

// Handlers per resource: { programs: { list, getOne, create, update, remove }, ... }
const handlers = Object.fromEntries(
  Object.entries(RESOURCES).map(([plural, def]) => [
    plural,
    { list: list(def), getOne: getOne(def), create: create(def), update: update(def), remove: remove(def) },
  ])
);

module.exports = handlers;
