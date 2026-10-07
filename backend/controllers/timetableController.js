const crypto = require('crypto');
const mongoose = require('mongoose');
const ClassSession = require('../models/classSessionModel');
const Subject = require('../models/subjectModel');
const Group = require('../models/groupModel');
const Room = require('../models/roomModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const time = require('../utils/time');
const { publicApiUrl } = require('../utils/env');
const {
  assertObjectId,
  notFound,
  throwIfInvalid,
  readString,
  readEnum,
  readObjectId,
  readObjectIdList,
} = require('../utils/validation');
const auditService = require('../service/auditService');
const timetableService = require('../service/timetableService');
const icsService = require('../service/icsService');
const { analyzeImport } = require('../service/timetableImport');

/*
 * /api/timetable (contract section 6, Module 1).
 * Reading: any authenticated user. Management and import: ADMIN. ICS feed: secret token, no auth.
 */

const { serializeSession, SESSION_TYPES, SESSION_STATUSES, NOTES_MAX_LENGTH, MAX_GROUPS } = ClassSession;
const SCOPES = ['occurrence', 'series'];
const UPDATABLE_FIELDS = ['subject', 'teacher', 'groups', 'room', 'startsAt', 'endsAt', 'type', 'notes', 'status'];
const CALENDAR_TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
const SORT_COLLATION = { locale: 'en', strength: 2, numericOrdering: true };
const MAX_AUDITED_IDS = 50;

const isPresent = (value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
const idString = (value) => (value === null || value === undefined ? null : String(value?._id ?? value));
const sameId = (a, b) => idString(a) === idString(b);
const sameIds = (a = [], b = []) => {
  const left = a.map(idString).sort();
  const right = b.map(idString).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
};
const validationError = (details) => new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', details);

// ---------- Reading ----------

// Optional id filters of the query string (?subject=&teacher=&group=&room=) → ClassSession filter.
const FILTER_PATHS = { subject: 'subject', teacher: 'teacher', group: 'groups', room: 'room' };
const parseIdFilters = (query, fields) => {
  const details = {};
  const filter = {};
  fields.forEach((field) => {
    if (!isPresent(query[field])) return;
    const id = readObjectId(query[field], field, details);
    if (id) filter[FILTER_PATHS[field]] = id;
  });
  throwIfInvalid(details);
  return filter;
};

const combine = (...filters) => {
  const parts = filters.filter((filter) => filter && Object.keys(filter).length > 0);
  if (parts.length === 0) return {};
  return parts.length === 1 ? parts[0] : { $and: parts };
};

// GET /api/timetable/me?from&to&subject&teacher → { from, to, items, hint? }
const getMyTimetable = async (req, res) => {
  const { from, to } = timetableService.parseRange(req.query);
  const extra = parseIdFilters(req.query, ['subject', 'teacher']);
  const { filter, hint } = timetableService.personalFilter(req.user);
  const body = { from, to, items: [] };
  if (filter) {
    body.items = (await timetableService.findSessions(combine(filter, extra), from, to)).map(serializeSession);
  }
  if (hint) body.hint = hint;
  res.status(200).json(body);
};

// GET /api/timetable?group|teacher|room&from&to (&subject) → { from, to, items }
const browseTimetable = async (req, res) => {
  if (!['group', 'teacher', 'room'].some((field) => isPresent(req.query[field]))) {
    throw new HttpError(400, 'MISSING_FIELDS', 'Provide at least one of group, teacher or room', {
      fields: ['group', 'teacher', 'room'],
    });
  }
  const filter = parseIdFilters(req.query, ['group', 'teacher', 'room', 'subject']);
  const { from, to } = timetableService.parseRange(req.query);
  const items = (await timetableService.findSessions(filter, from, to)).map(serializeSession);
  res.status(200).json({ from, to, items });
};

// Group JSON of the academic API: { id, name, level, academicYear, program, studentCount }.
const serializeGroups = async (groupIds) => {
  if (groupIds.length === 0) return [];
  const [groups, counts] = await Promise.all([
    Group.find({ _id: { $in: groupIds } })
      .populate({ path: 'program', select: 'name code' })
      .sort({ name: 1, _id: 1 })
      .collation(SORT_COLLATION),
    User.aggregate([
      { $match: { group: { $in: groupIds }, role: 'STUDENT' } },
      { $group: { _id: '$group', count: { $sum: 1 } } },
    ]),
  ]);
  const byGroup = new Map(counts.map(({ _id, count }) => [String(_id), count]));
  return groups.map((group) => ({ ...group.toJSON(), studentCount: byGroup.get(String(group._id)) ?? 0 }));
};

// GET /api/timetable/me/groups → STUDENT: own group (or []), TEACHER: groups they teach, else [].
const getMyGroups = async (req, res) => {
  let ids = [];
  if (req.user.role === 'STUDENT' && req.user.group) ids = [req.user.group._id ?? req.user.group];
  if (req.user.role === 'TEACHER') ids = await timetableService.taughtGroupIds(req.user._id);
  res.status(200).json(await serializeGroups(ids.map((id) => new mongoose.Types.ObjectId(String(id)))));
};

const findSessionOr404 = async (id) => {
  assertObjectId(id);
  const session = await ClassSession.findById(id);
  if (!session) throw notFound('Session');
  return session;
};

// GET /api/timetable/sessions/:id → ClassSession (any authenticated user).
const getSession = async (req, res) => {
  assertObjectId(req.params.id);
  const [session] = await timetableService.findSessionsByIds([new mongoose.Types.ObjectId(req.params.id)]);
  if (!session) throw notFound('Session');
  res.status(200).json(serializeSession(session));
};

// ---------- Body parsing (management) ----------

/**
 * Reads the session fields present in `body` into `values` (ObjectIds, Dates, strings), checking
 * that the referenced documents exist. Problems go to `details` ({ field: message }).
 */
const readSessionFields = async (body, details, { allowStatus }) => {
  const values = {};
  // Fields already reported (e.g. "is required") are not read again.
  const has = (field) => body[field] !== undefined && !details[field];

  if (has('subject')) values.subject = readObjectId(body.subject, 'subject', details);
  if (has('teacher')) values.teacher = readObjectId(body.teacher, 'teacher', details);
  if (has('groups')) {
    const groups = readObjectIdList(body.groups, 'groups', details, { max: MAX_GROUPS });
    if (groups && groups.length === 0) details.groups = 'groups must contain at least one group';
    else values.groups = groups;
  }
  if (has('room')) {
    values.room = body.room === null || body.room === '' ? null : readObjectId(body.room, 'room', details);
  }
  ['startsAt', 'endsAt'].forEach((field) => {
    if (!has(field)) return;
    const date = timetableService.parseInstant(body[field], { allowDateOnly: false });
    if (date) values[field] = date;
    else details[field] = `${field} must be an ISO 8601 date-time`;
  });
  if (has('type')) values.type = readEnum(body.type, SESSION_TYPES, 'type', details);
  if (has('notes')) {
    values.notes = body.notes === null ? '' : readString(body.notes, 'notes', details, { max: NOTES_MAX_LENGTH });
  }
  if (allowStatus && has('status')) values.status = readEnum(body.status, SESSION_STATUSES, 'status', details);

  // References (only for well-formed ids).
  const checks = [];
  if (values.subject && !details.subject) {
    checks.push(
      Subject.exists({ _id: values.subject }).then((found) => {
        if (!found) details.subject = 'Unknown subject';
      })
    );
  }
  if (values.teacher && !details.teacher) {
    checks.push(
      User.findById(values.teacher)
        .select('role')
        .setOptions({ populateGroup: false })
        .lean()
        .then((user) => {
          if (!user) details.teacher = 'Unknown teacher';
          else if (user.role !== 'TEACHER') details.teacher = 'teacher must be a TEACHER account';
        })
    );
  }
  if (values.groups && !details.groups) {
    checks.push(
      Group.countDocuments({ _id: { $in: values.groups } }).then((count) => {
        if (count !== values.groups.length) details.groups = 'Unknown group';
      })
    );
  }
  if (values.room && !details.room) {
    checks.push(
      Room.exists({ _id: values.room }).then((found) => {
        if (!found) details.room = 'Unknown room';
      })
    );
  }
  await Promise.all(checks);
  return values;
};

const readScope = (value, details) => {
  if (!isPresent(value)) return 'occurrence';
  const scope = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (!SCOPES.includes(scope)) {
    details.scope = `scope must be one of ${SCOPES.join(', ')}`;
    return undefined;
  }
  return scope;
};

// ---------- Descriptions (audit) ----------

const describeSession = (session) => {
  const groups = (session.groups || []).map((group) => group.name).filter(Boolean).join(', ');
  const subject = session.subject?.code || 'session';
  const when = `${time.formatLocalDate(session.startsAt)} ${time.formatLocalTime(session.startsAt)}`;
  return `${subject}${groups ? ` for ${groups}` : ''} on ${when}`;
};

const limitIds = (ids) => ids.slice(0, MAX_AUDITED_IDS).map(String);

// ---------- Create ----------

// POST /api/timetable/sessions → 201 { items, seriesId }
const createSession = async (req, res) => {
  const body = req.body ?? {};
  const details = {};
  ['subject', 'teacher', 'groups', 'startsAt', 'endsAt'].forEach((field) => {
    if (!isPresent(body[field])) details[field] = `${field} is required`;
  });
  const values = await readSessionFields(body, details, { allowStatus: false });

  let occurrences = null;
  if (values.startsAt && values.endsAt && !details.startsAt && !details.endsAt) {
    const problem = timetableService.checkSessionTimes(values.startsAt, values.endsAt);
    if (problem) details.endsAt = problem;
  }
  if (body.repeat !== undefined && body.repeat !== null) {
    const until = body.repeat && typeof body.repeat === 'object' ? body.repeat.until : undefined;
    if (typeof until !== 'string' || !time.parseDateOnly(until)) {
      details['repeat.until'] = 'repeat.until must be a date (YYYY-MM-DD)';
    } else if (values.startsAt && values.endsAt && !details.startsAt && !details.endsAt) {
      const result = timetableService.weeklyOccurrences(values.startsAt, values.endsAt, until.trim());
      if (result.error === 'BEFORE_START') details['repeat.until'] = 'repeat.until must not be before the first session';
      else if (result.error === 'TOO_MANY') {
        details['repeat.until'] = `A weekly series has at most ${timetableService.MAX_SERIES_OCCURRENCES} sessions (26 weeks)`;
      } else occurrences = result.occurrences;
    }
  }
  throwIfInvalid(details);

  const seriesId = occurrences ? new mongoose.Types.ObjectId() : null;
  const docs = (occurrences || [{ startsAt: values.startsAt, endsAt: values.endsAt }]).map(({ startsAt, endsAt }) => ({
    _id: new mongoose.Types.ObjectId(),
    subject: values.subject,
    teacher: values.teacher,
    groups: values.groups,
    room: values.room ?? null,
    startsAt,
    endsAt,
    type: values.type ?? 'LECTURE',
    status: 'SCHEDULED',
    notes: values.notes ?? '',
    seriesId,
    change: null,
    source: 'MANUAL',
    createdBy: req.user._id,
  }));

  const conflicts = await timetableService.findConflicts(docs.map((doc) => ({ key: String(doc._id), ...doc })));
  if (conflicts.length > 0) throw timetableService.conflictError(conflicts);

  await ClassSession.insertMany(docs);
  const items = await timetableService.findSessionsByIds(docs.map((doc) => doc._id));
  const first = items[0];

  await auditService.record(req, {
    action: 'timetable.session.create',
    targetType: 'ClassSession',
    targetId: first._id,
    summary: `Created ${describeSession(first)}${
      seriesId ? ` (weekly series of ${items.length} until ${time.formatLocalDate(items.at(-1).startsAt)})` : ''
    }`,
    metadata: {
      count: items.length,
      seriesId: seriesId ? String(seriesId) : null,
      sessionIds: limitIds(items.map((item) => item._id)),
      subject: first.subject?.code ?? null,
      teacher: idString(first.teacher),
      groups: first.groups.map((group) => group.name),
      room: first.room?.name ?? null,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      type: first.type,
    },
  });

  res.status(201).json({ items: items.map(serializeSession), seriesId: seriesId ? String(seriesId) : null });
};

// ---------- Update ----------

// Sessions of the scope: the occurrence, or this and the following occurrences of its series.
const scopeTargets = async (session, scope) => {
  if (scope !== 'series' || !session.seriesId) return [session];
  return ClassSession.find({ seriesId: session.seriesId, startsAt: { $gte: session.startsAt } }).sort({ startsAt: 1, _id: 1 });
};

// Room/times the active change refers to (the planned values before the first change), so
// "Moved from B12" keeps the original room after several moves and disappears when it is back.
const baselineOf = (activeChange, current, roomsById) => {
  let room = null;
  if (activeChange?.previousRoom?.id) {
    room = { id: activeChange.previousRoom.id, name: activeChange.previousRoom.name };
  } else if (current.room) {
    room = { id: current.room, name: roomsById.get(idString(current.room))?.name ?? null };
  }
  return {
    room,
    startsAt: activeChange?.previousStartsAt ?? current.startsAt,
    endsAt: activeChange?.previousEndsAt ?? current.endsAt,
  };
};

// ROOM / TIME change between the planned values and the new ones, or null when they are the same.
const deviationFrom = (baseline, next, now) => {
  const roomDiffers = idString(next.room) !== idString(baseline.room?.id ?? null);
  const timeDiffers =
    next.startsAt.getTime() !== new Date(baseline.startsAt).getTime() ||
    next.endsAt.getTime() !== new Date(baseline.endsAt).getTime();
  if (!roomDiffers && !timeDiffers) return null;
  const change = { kind: timeDiffers ? 'TIME' : 'ROOM', changedAt: now };
  if (roomDiffers && baseline.room) change.previousRoom = { id: baseline.room.id, name: baseline.room.name };
  if (timeDiffers) {
    change.previousStartsAt = baseline.startsAt;
    change.previousEndsAt = baseline.endsAt;
  }
  return change;
};

const plainChange = (change) => (change && change.kind ? (change.toObject ? change.toObject() : change) : null);

// PATCH /api/timetable/sessions/:id → 200 { items }
const updateSession = async (req, res) => {
  const session = await findSessionOr404(req.params.id);
  const body = req.body ?? {};
  const details = {};
  const scope = readScope(body.scope ?? req.query.scope, details);
  const provided = UPDATABLE_FIELDS.filter((field) => body[field] !== undefined);
  throwIfInvalid(details);
  if (provided.length === 0) throw new HttpError(400, 'NO_CHANGES', 'No changes provided');

  const values = await readSessionFields(body, details, { allowStatus: true });
  throwIfInvalid(details);

  // New times of the edited occurrence. Only startsAt → the session keeps its duration.
  const timeChange = values.startsAt !== undefined || values.endsAt !== undefined;
  const newStart = values.startsAt ?? session.startsAt;
  const newEnd =
    values.endsAt ??
    (values.startsAt !== undefined ? new Date(newStart.getTime() + (session.endsAt - session.startsAt)) : session.endsAt);
  if (timeChange) {
    const problem = timetableService.checkSessionTimes(newStart, newEnd);
    if (problem) throw validationError({ [values.endsAt !== undefined ? 'endsAt' : 'startsAt']: problem });
  }

  const targets = await scopeTargets(session, scope);
  const plans = targets.map((target) => {
    let { startsAt, endsAt } = target;
    if (timeChange) {
      ({ startsAt, endsAt } = sameId(target._id, session._id)
        ? { startsAt: newStart, endsAt: newEnd }
        : timetableService.shiftOccurrence(target.startsAt, session.startsAt, newStart, newEnd));
    }
    const next = {
      subject: values.subject ?? target.subject,
      teacher: values.teacher ?? target.teacher,
      groups: values.groups ?? target.groups,
      room: values.room !== undefined ? values.room : target.room,
      startsAt,
      endsAt,
      type: values.type ?? target.type,
      notes: values.notes ?? target.notes,
      status: values.status ?? target.status,
    };
    const kinds = {
      room: !sameId(next.room, target.room),
      time: startsAt.getTime() !== target.startsAt.getTime() || endsAt.getTime() !== target.endsAt.getTime(),
      status: next.status !== target.status,
    };
    const other = {
      subject: !sameId(next.subject, target.subject),
      teacher: !sameId(next.teacher, target.teacher),
      groups: !sameIds(next.groups, target.groups),
      type: next.type !== target.type,
      notes: next.notes !== target.notes,
    };
    const changed = kinds.room || kinds.time || kinds.status || Object.values(other).some(Boolean);
    return { target, next, kinds, other, changed };
  });

  for (const { next } of plans) {
    const problem = timetableService.checkSessionTimes(next.startsAt, next.endsAt);
    if (problem) {
      throw validationError({ startsAt: `${problem} (occurrence of ${time.formatLocalDate(next.startsAt)})` });
    }
  }

  const changedPlans = plans.filter((plan) => plan.changed);
  if (changedPlans.length > 0) {
    // Conflicts: occurrences that stay / become SCHEDULED with a new slot, room, teacher or groups.
    const candidates = changedPlans
      .filter(
        ({ next, kinds, other }) =>
          next.status === 'SCHEDULED' && (kinds.room || kinds.time || kinds.status || other.teacher || other.groups)
      )
      .map(({ target, next }) => ({ key: String(target._id), ...next }));
    const conflicts = await timetableService.findConflicts(candidates, { excludeIds: targets.map((t) => t._id) });
    if (conflicts.length > 0) throw timetableService.conflictError(conflicts);
  }

  const roomIds = new Set();
  plans.forEach(({ target, next }) => {
    if (target.room) roomIds.add(idString(target.room));
    if (next.room) roomIds.add(idString(next.room));
  });
  const rooms = await Room.find({ _id: { $in: [...roomIds] } })
    .select('name building')
    .lean();
  const roomsById = new Map(rooms.map((room) => [String(room._id), room]));

  const now = new Date();
  const notificationChanges = [];
  for (const { target, next, kinds, changed } of changedPlans) {
    const before = {
      startsAt: target.startsAt,
      endsAt: target.endsAt,
      room: target.room ? roomsById.get(idString(target.room)) ?? null : null,
      status: target.status,
      groups: [...target.groups],
      teacher: target.teacher,
    };
    const activeChange = plainChange(target.status === 'CANCELLED' ? target.changeBeforeCancel : target.change);
    const baseline = baselineOf(activeChange, target, roomsById);
    const slotChanged = kinds.room || kinds.time;

    target.set(next);
    if (kinds.status && next.status === 'CANCELLED') {
      target.changeBeforeCancel = slotChanged ? deviationFrom(baseline, next, now) : activeChange;
      target.change = { kind: 'CANCELLED', changedAt: now };
    } else if (kinds.status) {
      target.change = slotChanged ? deviationFrom(baseline, next, now) : activeChange;
      target.changeBeforeCancel = null;
    } else if (slotChanged) {
      const deviation = deviationFrom(baseline, next, now);
      if (next.status === 'CANCELLED') target.changeBeforeCancel = deviation;
      else target.change = deviation;
    }
    if (changed) target.sequence = (target.sequence || 0) + 1;
    await target.save();

    notificationChanges.push({
      sessionId: target._id,
      seriesId: target.seriesId,
      kinds,
      before,
      after: {
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        room: next.room ? roomsById.get(idString(next.room)) ?? null : null,
        status: next.status,
        groups: [...next.groups],
        teacher: next.teacher,
      },
    });
  }

  const items = await timetableService.findSessionsByIds(targets.map((target) => target._id));
  if (changedPlans.length > 0) {
    const edited = items.find((item) => sameId(item._id, session._id)) || items[0];
    let notification = null;
    try {
      notification = await timetableService.notifyTimetableChanges({
        changes: notificationChanges,
        subjectName: edited.subject?.name ?? null,
        now,
      });
    } catch (error) {
      console.error('[timetable] Could not send the change notifications:', error.message);
    }

    const cancelled = values.status === 'CANCELLED' && changedPlans.some(({ kinds }) => kinds.status);
    const restored = values.status === 'SCHEDULED' && changedPlans.some(({ kinds }) => kinds.status);
    const fields = new Set();
    changedPlans.forEach(({ kinds, other }) => {
      if (kinds.room) fields.add('room');
      if (kinds.time) fields.add('time');
      if (kinds.status) fields.add('status');
      Object.entries(other).forEach(([field, value]) => value && fields.add(field));
    });
    const count = changedPlans.length;
    await auditService.record(req, {
      action: cancelled ? 'timetable.session.cancel' : 'timetable.session.update',
      targetType: 'ClassSession',
      targetId: session._id,
      summary: `${cancelled ? 'Cancelled' : restored ? 'Restored' : 'Updated'} ${describeSession(edited)}${
        count > 1 ? ` and ${count - 1} following session(s)` : ''
      }${!cancelled && !restored ? ` (${[...fields].join(', ')})` : ''}`,
      metadata: {
        scope,
        count,
        seriesId: session.seriesId ? String(session.seriesId) : null,
        sessionIds: limitIds(changedPlans.map(({ target }) => target._id)),
        changes: [...fields],
        values: Object.fromEntries(
          Object.entries(values).map(([field, value]) => [field, Array.isArray(value) ? value.map(String) : value])
        ),
        restored,
        notification,
      },
    });
  }

  res.status(200).json({ items: items.map(serializeSession) });
};

// ---------- Delete ----------

// DELETE /api/timetable/sessions/:id?scope=occurrence|series → 204 (no notification).
const deleteSession = async (req, res) => {
  const session = await findSessionOr404(req.params.id);
  const details = {};
  const scope = readScope(req.query.scope ?? req.body?.scope, details);
  throwIfInvalid(details);

  const targets = await scopeTargets(session, scope);
  const ids = targets.map((target) => target._id);
  const [edited] = await timetableService.findSessionsByIds([session._id]);
  await ClassSession.deleteMany({ _id: { $in: ids } });

  await auditService.record(req, {
    action: 'timetable.session.delete',
    targetType: 'ClassSession',
    targetId: session._id,
    summary: `Deleted ${describeSession(edited)}${ids.length > 1 ? ` and ${ids.length - 1} following session(s)` : ''}`,
    metadata: {
      scope,
      count: ids.length,
      seriesId: session.seriesId ? String(session.seriesId) : null,
      sessionIds: limitIds(ids),
      subject: edited.subject?.code ?? null,
      groups: edited.groups.map((group) => group.name),
      startsAt: edited.startsAt,
      status: edited.status,
    },
  });

  res.status(204).end();
};

// ---------- CSV import ----------

const readDryRun = (value) => {
  if (!isPresent(value)) return false;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  throw validationError({ dryRun: 'dryRun must be true or false' });
};

// POST /api/timetable/import (multipart: file, dryRun) → 200 { dryRun, created, rows } or 422 IMPORT_INVALID
const importSessions = async (req, res) => {
  const dryRun = readDryRun(req.body?.dryRun ?? req.query.dryRun);
  if (!req.file) throw validationError({ file: 'A CSV file is required' });

  const report = await analyzeImport(req.file.buffer);
  if (report.errors.length > 0 || report.conflicts.length > 0) {
    throw new HttpError(422, 'IMPORT_INVALID', 'The file has problems: nothing was imported', {
      errors: report.errors,
      conflicts: report.conflicts,
      rows: report.rows,
      ...(report.truncated ? { truncated: true } : {}),
    });
  }
  if (dryRun) {
    res.status(200).json({ dryRun: true, created: 0, rows: report.rows });
    return;
  }

  const docs = report.docs.map((doc) => ({ ...doc, createdBy: req.user._id }));
  try {
    await ClassSession.insertMany(docs, { ordered: true });
  } catch (error) {
    // All-or-nothing: remove what was inserted before the failure.
    await ClassSession.deleteMany({ _id: { $in: docs.map((doc) => doc._id) } }).catch(() => {});
    throw error;
  }

  await auditService.record(req, {
    action: 'timetable.import',
    targetType: 'ClassSession',
    targetId: null,
    summary: `Imported ${docs.length} session(s) from ${req.file.originalname}`,
    metadata: {
      filename: req.file.originalname,
      size: req.file.size,
      rows: report.rows,
      created: docs.length,
      sessionIds: limitIds(docs.map((doc) => doc._id)),
    },
  });

  res.status(200).json({ dryRun: false, created: docs.length, rows: report.rows });
};

// ---------- Calendar export ----------

const newCalendarToken = () => crypto.randomBytes(24).toString('base64url');
const feedUrl = (token) => `${publicApiUrl()}/api/timetable/ics/${token}.ics`;

const readCalendarToken = async (userId) => {
  const user = await User.findById(userId).select('+calendarToken').setOptions({ populateGroup: false }).lean();
  return user?.calendarToken ?? null;
};

// GET /api/timetable/me/calendar-link → { url } (the token is created on the first call).
const getCalendarLink = async (req, res) => {
  let token = await readCalendarToken(req.user._id);
  if (!token) {
    // Conditional update: two concurrent first calls end up with the same token.
    await User.updateOne(
      { _id: req.user._id, calendarToken: { $not: { $type: 'string' } } },
      { $set: { calendarToken: newCalendarToken() } }
    );
    token = await readCalendarToken(req.user._id);
  }
  res.status(200).json({ url: feedUrl(token) });
};

// POST /api/timetable/me/calendar-link/reset → { url } with a new token (the old URL stops working).
const resetCalendarLink = async (req, res) => {
  const token = newCalendarToken();
  await User.updateOne({ _id: req.user._id }, { $set: { calendarToken: token } });
  await auditService.record(req, {
    action: 'timetable.calendar_link.reset',
    targetType: 'User',
    targetId: req.user._id,
    summary: `Reset the calendar link of ${req.user.email}`,
  });
  res.status(200).json({ url: feedUrl(token) });
};

// Sessions of the feed: from 30 days ago to 120 days ahead.
const feedSessions = async (user) => {
  const { filter } = timetableService.personalFilter(user);
  if (!filter) return [];
  const now = new Date();
  const from = time.startOfLocalDay(new Date(now.getTime() - timetableService.FEED_PAST_DAYS * time.DAY_MS));
  const to = time.addLocalDays(now, timetableService.FEED_FUTURE_DAYS);
  return timetableService.findSessions(filter, from, to);
};

const sendCalendar = async (res, user, disposition) => {
  const calendar = icsService.buildCalendar(await feedSessions(user), { locale: user.locale });
  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `${disposition}; filename="campuslink-timetable.ics"`,
    'Cache-Control': 'private, no-cache',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  res.status(200).send(calendar);
};

// GET /api/timetable/ics/:token.ics (no auth) → text/calendar, or 404 RESOURCE_NOT_FOUND.
const getCalendarFeed = async (req, res) => {
  const { token } = req.params;
  if (!CALENDAR_TOKEN_RE.test(String(token || ''))) throw notFound('Calendar');
  const user = await User.findOne({ calendarToken: token });
  if (!user) throw notFound('Calendar');
  await sendCalendar(res, user, 'inline');
};

// GET /api/timetable/me/calendar.ics (auth) → the same calendar as a download, without a token.
const downloadMyCalendar = async (req, res) => {
  await sendCalendar(res, req.user, 'attachment');
};

module.exports = {
  getMyTimetable,
  browseTimetable,
  getMyGroups,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  importSessions,
  getCalendarLink,
  resetCalendarLink,
  getCalendarFeed,
  downloadMyCalendar,
};
