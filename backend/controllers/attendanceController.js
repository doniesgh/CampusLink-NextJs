const ClassSession = require('../models/classSessionModel');
const User = require('../models/userModel');
const AttendanceRecord = require('../models/attendanceRecordModel');
const AttendanceAlert = require('../models/attendanceAlertModel');
const HttpError = require('../utils/httpError');
const time = require('../utils/time');
const {
  assertObjectId,
  notFound,
  parsePagination,
  throwIfInvalid,
  validationError,
  readObjectId,
  readEnum,
  readString,
} = require('../utils/validation');
const auditService = require('../service/auditService');
const attendanceService = require('../service/attendanceService');
const timetableService = require('../service/timetableService');

/*
 * /api/attendance (Module 9, phase 2 contract section 3.1).
 * Roll call of a session (its teacher or ADMIN), a student's own records and summary, absence alerts (ADMIN),
 * and the list of sessions to take the roll call for (TEACHER / ADMIN).
 */

const { ATTENDANCE_STATUSES, NOTE_MAX_LENGTH, RECORD_POPULATE, serializeRecord } = AttendanceRecord;
const { ALERT_LEVELS, ALERT_POPULATE, serializeAlert } = AttendanceAlert;
const { serializeSession, SESSION_POPULATE } = ClassSession;
const MAX_RECORDS = 500;
const SESSIONS_DEFAULT_PAST_DAYS = 6;
const SESSIONS_MAX_RANGE_DAYS = 31;
const ME_MAX_RANGE_DAYS = 400;
const MAX_AUDITED_CHANGES = 100;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPresent = (value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
const emptyCounts = () => Object.fromEntries(ATTENDANCE_STATUSES.map((status) => [status, 0]));
const forbidden = (message = 'You do not have permission to perform this action', details) =>
  new HttpError(403, 'FORBIDDEN', message, details);

// ---------- Helpers ----------

// Populated session (lean) of the URL, or 400 INVALID_ID / 404 RESOURCE_NOT_FOUND.
const loadSession = async (id) => {
  assertObjectId(id);
  const session = await ClassSession.findById(id).populate(SESSION_POPULATE).lean();
  if (!session) throw notFound('Session');
  return session;
};

const groupIdsOf = (session) => (session.groups || []).map((group) => group._id ?? group);

// { session, editable, canExcuse, window, roster, summary } of a session for `user`.
const buildRollCall = async (session, user, now = new Date()) => {
  const [students, records] = await Promise.all([
    attendanceService.findStudentsOfGroups(groupIdsOf(session)).lean(),
    AttendanceRecord.find({ session: session._id }).select('student status note markedAt').lean(),
  ]);
  const recordByStudent = new Map(records.map((record) => [String(record.student), record]));
  const counts = emptyCounts();
  let marked = 0;
  const roster = students.map((student) => {
    const record = recordByStudent.get(String(student._id));
    if (record) {
      counts[record.status] += 1;
      marked += 1;
    }
    return {
      student: {
        id: String(student._id),
        firstname: student.firstname,
        lastname: student.lastname,
        group: student.group ? { id: String(student.group._id ?? student.group), name: student.group.name ?? null } : null,
      },
      status: record?.status ?? null,
      note: record?.note ?? '',
      markedAt: record?.markedAt ?? null,
    };
  });
  return {
    session: serializeSession(session),
    editable: attendanceService.canEditRollCall(user, session, now),
    canExcuse: user.role === 'ADMIN',
    window: attendanceService.editWindow(session),
    roster,
    summary: { students: roster.length, marked, counts },
  };
};

// { from, to } of a list: both absent → defaults; else timetableService.parseRange (400 VALIDATION_ERROR,
// 400 RANGE_TOO_LARGE).
const readRange = (query, defaults, maxDays) => {
  if (!isPresent(query.from) && !isPresent(query.to)) return defaults();
  return timetableService.parseRange(query, { maxDays });
};

// ---------- GET /sessions (TEACHER, ADMIN) ----------

/**
 * Sessions to take the roll call for: TEACHER → the sessions they teach (optional ?group=); ADMIN → every
 * session (optional ?group= / ?teacher=). Default range: the last 7 days including today (campus timezone), at most 31 days.
 * → { from, to, items: [{ session, rollCall: { students, marked, counts }, editable }] } sorted by start.
 */
const listSessions = async (req, res) => {
  const now = new Date();
  const { from, to } = readRange(
    req.query,
    () => {
      const today = time.startOfLocalDay(now);
      return { from: time.addLocalDays(today, -SESSIONS_DEFAULT_PAST_DAYS), to: time.addLocalDays(today, 1) };
    },
    SESSIONS_MAX_RANGE_DAYS
  );

  const filter = {};
  const details = {};
  if (isPresent(req.query.group)) filter.groups = readObjectId(req.query.group, 'group', details);
  if (req.user.role === 'TEACHER') filter.teacher = req.user._id;
  else if (isPresent(req.query.teacher)) filter.teacher = readObjectId(req.query.teacher, 'teacher', details);
  throwIfInvalid(details);

  const sessions = await timetableService.findSessions(filter, from, to);
  const allGroupIds = [...new Set(sessions.flatMap((session) => groupIdsOf(session).map(String)))];
  const [studentCounts, recordRows] = await Promise.all([
    attendanceService.countStudentsByGroup(allGroupIds),
    sessions.length > 0
      ? AttendanceRecord.aggregate([
          { $match: { session: { $in: sessions.map((session) => session._id) } } },
          { $group: { _id: { session: '$session', status: '$status' }, count: { $sum: 1 } } },
        ])
      : [],
  ]);
  const countsBySession = new Map();
  recordRows.forEach(({ _id, count }) => {
    const key = String(_id.session);
    if (!countsBySession.has(key)) countsBySession.set(key, emptyCounts());
    countsBySession.get(key)[_id.status] = count;
  });

  const items = sessions.map((session) => {
    const counts = countsBySession.get(String(session._id)) ?? emptyCounts();
    return {
      session: serializeSession(session),
      rollCall: {
        students: groupIdsOf(session).reduce((sum, id) => sum + (studentCounts.get(String(id)) || 0), 0),
        marked: Object.values(counts).reduce((sum, count) => sum + count, 0),
        counts,
      },
      editable: attendanceService.canEditRollCall(req.user, session, now),
    };
  });
  res.status(200).json({ from, to, items });
};

// ---------- GET /sessions/:sessionId ----------

const getRollCall = async (req, res) => {
  const session = await loadSession(req.params.sessionId);
  if (!attendanceService.canReadRollCall(req.user, session)) {
    throw forbidden('Only the teacher of this session or an administrator can see its roll call');
  }
  res.status(200).json(await buildRollCall(session, req.user));
};

// ---------- PUT /sessions/:sessionId ----------

// Validated entries [{ index, student: ObjectId, status: string | null, note: string | undefined }].
const parseRecords = (body) => {
  if (!isPlainObject(body)) throw validationError({ body: 'The request body must be a JSON object' });
  const { records } = body;
  if (!Array.isArray(records)) throw validationError({ records: 'records must be an array' });
  if (records.length === 0) throw validationError({ records: 'records must contain at least one item' });
  if (records.length > MAX_RECORDS) throw validationError({ records: `records accepts at most ${MAX_RECORDS} items` });

  const details = {};
  const seen = new Set();
  const entries = [];
  records.forEach((item, index) => {
    const field = `records.${index}`;
    if (!isPlainObject(item)) {
      details[field] = `${field} must be an object`;
      return;
    }
    const student = readObjectId(item.student, `${field}.student`, details);
    let status = null;
    if (item.status === undefined) details[`${field}.status`] = `${field}.status is required (a status or null)`;
    else if (item.status !== null) status = readEnum(item.status, ATTENDANCE_STATUSES, `${field}.status`, details);
    let note;
    if (item.note === null) note = '';
    else if (item.note !== undefined) {
      const text = typeof item.note === 'string' ? item.note.replace(/\r\n?/g, '\n') : item.note;
      note = readString(text, `${field}.note`, details, { max: NOTE_MAX_LENGTH });
    }
    if (student) {
      if (seen.has(String(student))) details[`${field}.student`] = 'This student appears more than once';
      seen.add(String(student));
    }
    entries.push({ index, student, status, note });
  });
  throwIfInvalid(details);
  return entries;
};

const describeSession = (session) => {
  const code = session.subject?.code ?? 'session';
  const groups = (session.groups || []).map((group) => group.name).filter(Boolean).join(', ');
  const when = `${time.formatLocalDate(session.startsAt)} ${time.formatLocalTime(session.startsAt)}`;
  return `${code}${groups ? ` (${groups})` : ''} on ${when}`;
};

/**
 * Upserts the listed students' marks (others are left as they are). `status: null` clears a mark; an omitted
 * `note` keeps the current one. TEACHER of the session inside its window, or ADMIN; only ADMIN may set or
 * change EXCUSED (a teacher may send EXCUSED unchanged: it is left as is). → 200 roll call + { changed }.
 */
const saveRollCall = async (req, res) => {
  const now = new Date();
  const session = await loadSession(req.params.sessionId);
  const isAdmin = req.user.role === 'ADMIN';
  if (!attendanceService.canReadRollCall(req.user, session)) {
    throw forbidden('Only the teacher of this session or an administrator can take its roll call');
  }
  if (session.status === 'CANCELLED') {
    throw new HttpError(409, 'INVALID_STATE', 'The roll call cannot be taken for a cancelled session');
  }
  if (!attendanceService.canEditRollCall(req.user, session, now)) {
    const window = attendanceService.editWindow(session);
    const early = now < window.opensAt;
    throw forbidden(
      early
        ? 'The roll call opens 15 minutes before the session starts'
        : 'The roll call closed 7 days after the end of the session',
      { reason: early ? 'ROLL_CALL_NOT_OPEN' : 'ROLL_CALL_CLOSED', ...window }
    );
  }

  const entries = parseRecords(req.body);
  const rosterIds = new Set(
    (await attendanceService.findStudentsOfGroups(groupIdsOf(session), { select: '_id' }).setOptions({ populateGroup: false }).lean()).map(
      (student) => String(student._id)
    )
  );
  const outside = {};
  entries.forEach(({ index, student }) => {
    if (!rosterIds.has(String(student))) outside[`records.${index}.student`] = 'This student is not in the roster of the session';
  });
  throwIfInvalid(outside);

  const existing = await AttendanceRecord.find({ session: session._id, student: { $in: entries.map((entry) => entry.student) } })
    .select('student status note')
    .lean();
  const existingByStudent = new Map(existing.map((record) => [String(record.student), record]));

  if (!isAdmin) {
    const blocked = entries.filter(({ student, status }) => {
      const previous = existingByStudent.get(String(student))?.status ?? null;
      return previous === 'EXCUSED' ? status !== 'EXCUSED' : status === 'EXCUSED';
    });
    if (blocked.length > 0) {
      throw forbidden('Only an administrator can set or remove an excused absence', {
        reason: 'EXCUSED_ADMIN_ONLY',
        students: blocked.map(({ student }) => String(student)),
      });
    }
  }

  const changes = [];
  entries.forEach(({ student, status, note }) => {
    const previous = existingByStudent.get(String(student));
    const previousStatus = previous?.status ?? null;
    const previousNote = previous?.note ?? '';
    if (!isAdmin && previousStatus === 'EXCUSED') return;
    const nextNote = status === null ? '' : note === undefined ? previousNote : note;
    if (status === previousStatus && nextNote === previousNote) return;
    changes.push({ student, from: previousStatus, to: status, note: nextNote });
  });

  const ended = new Date(session.endsAt) <= now;
  const skipped = new Set();
  if (changes.length > 0) {
    const ops = changes.map(({ student, to, note }) => {
      const filter = { session: session._id, student };
      // A teacher never overwrites an EXCUSED mark set meanwhile by an administrator (the upsert then fails
      // on the unique index and the change is skipped).
      if (!isAdmin) filter.status = { $ne: 'EXCUSED' };
      if (to === null) return { deleteOne: { filter } };
      return {
        updateOne: {
          filter,
          update: {
            $set: {
              status: to,
              note,
              markedBy: req.user._id,
              markedAt: now,
              alertCheckAt: to === 'ABSENT' && !ended ? new Date(session.endsAt) : null,
            },
          },
          upsert: true,
        },
      };
    });
    try {
      await AttendanceRecord.bulkWrite(ops, { ordered: false });
    } catch (error) {
      const writeErrors = [].concat(error?.writeErrors ?? []);
      if (writeErrors.length === 0 || writeErrors.some((writeError) => (writeError.code ?? writeError.err?.code) !== 11000)) {
        throw error;
      }
      writeErrors.forEach((writeError) => skipped.add(String(changes[writeError.index].student)));
    }
  }
  const applied = changes.filter(({ student }) => !skipped.has(String(student)));

  if (applied.length > 0) {
    await auditService.record(req, {
      action: 'attendance.update',
      targetType: 'ClassSession',
      targetId: session._id,
      summary: `Attendance of ${describeSession(session)}: ${applied.length} change(s)`,
      metadata: {
        sessionId: String(session._id),
        subject: session.subject?.code ?? null,
        startsAt: session.startsAt,
        changed: applied.length,
        changes: applied.slice(0, MAX_AUDITED_CHANGES).map(({ student, from, to }) => ({ student: String(student), from, to })),
      },
    });
    // Absences of a session that is over count at once (otherwise the scheduler job checks them at its end).
    const absent = applied.filter(({ to }) => to === 'ABSENT').map(({ student }) => student);
    if (ended && absent.length > 0) {
      await attendanceService.evaluateAlerts({ studentIds: absent, subjectIds: [session.subject._id ?? session.subject], now });
    }
  }

  res.status(200).json({ ...(await buildRollCall(session, req.user, now)), changed: applied.length });
};

// ---------- GET /me ----------

/**
 * Own records (sessions starting in [from, to), newest first) + per-subject summary of the same range.
 * Default range: the academic year of the student's group. Other roles get empty results.
 */
const getMine = async (req, res) => {
  const now = new Date();
  const user = req.user;
  const isStudent = user.role === 'STUDENT';
  const group = isStudent ? await attendanceService.groupOfStudent(user) : null;
  const bounds = attendanceService.yearBounds(group?.academicYear, now);

  const details = {};
  let from = bounds.start;
  let to = bounds.end;
  if (isPresent(req.query.from)) {
    from = timetableService.parseInstant(req.query.from);
    if (!from) details.from = 'from must be a date (YYYY-MM-DD) or an ISO 8601 date-time';
  }
  if (isPresent(req.query.to)) {
    to = timetableService.parseInstant(req.query.to);
    if (!to) details.to = 'to must be a date (YYYY-MM-DD) or an ISO 8601 date-time';
  }
  throwIfInvalid(details);
  if (to <= from) throw validationError({ to: 'to must be after from' });
  if (to - from > ME_MAX_RANGE_DAYS * time.DAY_MS) {
    throw new HttpError(400, 'RANGE_TOO_LARGE', `The range must not exceed ${ME_MAX_RANGE_DAYS} days`, {
      maxDays: ME_MAX_RANGE_DAYS,
    });
  }

  let items = [];
  if (isStudent) {
    const records = await AttendanceRecord.find({ student: user._id }).populate(RECORD_POPULATE).lean();
    items = records
      .filter((record) => record.session && record.session.startsAt >= from && record.session.startsAt < to)
      .sort((a, b) => b.session.startsAt - a.session.startsAt)
      .map(serializeRecord);
  }
  const summary = isStudent
    ? await attendanceService.studentAttendance(user, { from, to, now })
    : attendanceService.describeStudent(null, new Map());
  res.status(200).json({ from, to, thresholds: attendanceService.thresholds(), items, summary });
};

// ---------- GET /alerts (ADMIN) ----------

// ?group&level&subject&student&page&limit → { items, total, page, limit }, newest first.
const listAlerts = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const filter = {};
  if (isPresent(req.query.level)) filter.level = readEnum(req.query.level, ALERT_LEVELS, 'level', details);
  if (isPresent(req.query.subject)) filter.subject = readObjectId(req.query.subject, 'subject', details);
  const student = isPresent(req.query.student) ? readObjectId(req.query.student, 'student', details) : null;
  const group = isPresent(req.query.group) ? readObjectId(req.query.group, 'group', details) : null;
  throwIfInvalid(details);

  // Group = the student's current group.
  if (group) {
    const members = await User.find({ role: 'STUDENT', group }).distinct('_id');
    const ids = student ? members.filter((id) => String(id) === String(student)) : members;
    filter.student = { $in: ids };
  } else if (student) {
    filter.student = student;
  }

  const [total, alerts] = await Promise.all([
    AttendanceAlert.countDocuments(filter),
    AttendanceAlert.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate(ALERT_POPULATE)
      .lean(),
  ]);
  res.status(200).json({ items: alerts.map(serializeAlert), total, page, limit });
};

module.exports = {
  listSessions,
  getRollCall,
  saveRollCall,
  getMine,
  listAlerts,
};
