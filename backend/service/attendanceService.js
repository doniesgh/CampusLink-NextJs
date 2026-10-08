const mongoose = require('mongoose');
const ClassSession = require('../models/classSessionModel');
const User = require('../models/userModel');
const Group = require('../models/groupModel');
const Subject = require('../models/subjectModel');
const AttendanceRecord = require('../models/attendanceRecordModel');
const AttendanceAlert = require('../models/attendanceAlertModel');
const time = require('../utils/time');
const { envNumber } = require('../utils/env');
const scheduler = require('./scheduler');
const { notifyUsersInBackground } = require('./notificationService');

/*
 * Attendance business logic (Module 9, phase 2 contract section 3.1): roll-call window, rosters, absence rates
 * per student and subject, absence alerts (WARNING / CRITICAL, once per level) and their ATTENDANCE
 * notifications, plus the "attendance.evaluate-alerts" scheduler job.
 *
 * Absence rate of a student in a subject = unexcused ABSENT hours / hours of the held sessions of that subject
 * for the student's group. A held session is SCHEDULED and already ended; LATE counts as present, EXCUSED is
 * not counted as absent. Only the academic year of the student's group counts.
 */

const { DAY_MS } = time;
const MINUTE_MS = 60 * 1000;
// A teacher may take the roll call from 15 minutes before the start until 7 days after the end.
const OPENS_BEFORE_START_MS = 15 * MINUTE_MS;
const CLOSES_AFTER_END_MS = 7 * DAY_MS;
const DEFAULT_WARNING_RATE = 0.1;
const DEFAULT_ALERT_RATE = 0.2;
const LEVELS = ['OK', 'WARNING', 'CRITICAL'];
const ALERT_JOB_BATCH = 500;
const NAME_SORT_COLLATION = { locale: 'fr', strength: 1 };

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value?._id ?? value));
const idString = (value) => (value === null || value === undefined ? null : String(value?._id ?? value));

// ---------- Thresholds and levels ----------

// { warning, critical } from ABSENCE_WARNING_RATE / ABSENCE_ALERT_RATE (rates between 0 and 1).
const thresholds = () => ({
  warning: Math.min(envNumber('ABSENCE_WARNING_RATE', DEFAULT_WARNING_RATE), 1),
  critical: Math.min(envNumber('ABSENCE_ALERT_RATE', DEFAULT_ALERT_RATE), 1),
});

// 'OK' | 'WARNING' | 'CRITICAL' of an absence rate.
const levelOf = (rate, limits = thresholds()) => {
  if (rate >= limits.critical) return 'CRITICAL';
  if (rate >= limits.warning) return 'WARNING';
  return 'OK';
};

// Alert levels reached by a rate, lowest first (['WARNING'], ['WARNING', 'CRITICAL'] or []).
const levelsReached = (rate, limits = thresholds()) => {
  const levels = [];
  if (rate >= limits.warning || rate >= limits.critical) levels.push('WARNING');
  if (rate >= limits.critical) levels.push('CRITICAL');
  return levels;
};

const roundHours = (minutes) => Math.round((minutes / 60) * 100) / 100;
const roundRate = (rate) => Math.round(rate * 10000) / 10000;
const rateOf = (absentMinutes, heldMinutes) => (heldMinutes > 0 ? Math.min(absentMinutes / heldMinutes, 1) : 0);

// ---------- Roll-call window ----------

// { opensAt, closesAt } of a teacher's roll call for a session.
const editWindow = (session) => ({
  opensAt: new Date(new Date(session.startsAt).getTime() - OPENS_BEFORE_START_MS),
  closesAt: new Date(new Date(session.endsAt).getTime() + CLOSES_AFTER_END_MS),
});

const isSessionTeacher = (user, session) => user?.role === 'TEACHER' && idString(session.teacher) === idString(user._id);

// May `user` read the roll call of `session`? Its teacher or an ADMIN.
const canReadRollCall = (user, session) => user?.role === 'ADMIN' || isSessionTeacher(user, session);

// May `user` change the roll call now? ADMIN any time, the session's teacher inside the window; never for a
// cancelled session.
const canEditRollCall = (user, session, now = new Date()) => {
  if (session.status === 'CANCELLED') return false;
  if (user?.role === 'ADMIN') return true;
  if (!isSessionTeacher(user, session)) return false;
  const { opensAt, closesAt } = editWindow(session);
  return now >= opensAt && now <= closesAt;
};

// ---------- Rosters ----------

// Students (role STUDENT) of the given groups, sorted by name; `group` populated (public shape).
const findStudentsOfGroups = (groupIds, { select = 'firstname lastname group' } = {}) =>
  User.find({ role: 'STUDENT', group: { $in: groupIds.map(toObjectId) } })
    .select(select)
    .collation(NAME_SORT_COLLATION)
    .sort({ lastname: 1, firstname: 1, _id: 1 });

// Number of students per group id (string) for the given groups.
const countStudentsByGroup = async (groupIds) => {
  if (groupIds.length === 0) return new Map();
  const rows = await User.aggregate([
    { $match: { role: 'STUDENT', group: { $in: groupIds.map(toObjectId) } } },
    { $group: { _id: '$group', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

// ---------- Absence rates ----------

// Bounds of an academic year "YYYY-YYYY" (1 September → 1 September, campus timezone); the current academic
// year when the value is not one.
const yearBounds = (academicYear, now = new Date()) => {
  const match = /^(\d{4})-(\d{4})$/.exec(String(academicYear ?? ''));
  if (!match) return time.academicYearBounds(now);
  const startYear = Number(match[1]);
  return {
    start: time.zonedTimeToUtc({ year: startYear, month: 9, day: 1 }),
    end: time.zonedTimeToUtc({ year: startYear + 1, month: 9, day: 1 }),
  };
};

const emptyFigures = () => ({ heldMinutes: 0, absentMinutes: 0, excusedMinutes: 0, lateCount: 0, sessions: 0 });

/**
 * Attendance figures of students of ONE group: held sessions of the group (SCHEDULED, ended before `now`,
 * inside the group's academic year and [from, to) when given, optionally limited to `subjectIds`) and the
 * students' records for them.
 * Returns { subjects: Map<subjectId, heldMinutes>, students: Map<studentId, { totals, bySubject: Map } > }
 * where figures = { heldMinutes, absentMinutes, excusedMinutes, lateCount, sessions }.
 */
const computeGroupFigures = async ({ group, studentIds, subjectIds = null, from = null, to = null, now = new Date() }) => {
  const bounds = yearBounds(group?.academicYear, now);
  const start = from && from > bounds.start ? from : bounds.start;
  const end = to && to < bounds.end ? to : bounds.end;
  const result = { subjects: new Map(), students: new Map() };
  studentIds.forEach((id) => result.students.set(String(id), { totals: emptyFigures(), bySubject: new Map() }));
  if (!group || end <= start) return result;

  const filter = {
    groups: toObjectId(group),
    status: 'SCHEDULED',
    startsAt: { $gte: start, $lt: end },
    endsAt: { $lte: now },
  };
  if (subjectIds) filter.subject = { $in: subjectIds.map(toObjectId) };
  const sessions = await ClassSession.find(filter).select('subject startsAt endsAt').lean();
  if (sessions.length === 0) return result;

  const sessionById = new Map();
  sessions.forEach((session) => {
    const minutes = Math.max(0, Math.round((session.endsAt - session.startsAt) / MINUTE_MS));
    const subjectId = String(session.subject);
    sessionById.set(String(session._id), { subjectId, minutes });
    result.subjects.set(subjectId, (result.subjects.get(subjectId) || 0) + minutes);
  });

  // Every student of the group shares the held hours of each subject.
  result.students.forEach((entry) => {
    result.subjects.forEach((minutes, subjectId) => {
      entry.bySubject.set(subjectId, { ...emptyFigures(), heldMinutes: minutes });
      entry.totals.heldMinutes += minutes;
    });
    sessions.forEach((session) => {
      entry.bySubject.get(String(session.subject)).sessions += 1;
      entry.totals.sessions += 1;
    });
  });

  if (studentIds.length > 0) {
    const records = await AttendanceRecord.find({
      session: { $in: sessions.map((session) => session._id) },
      student: { $in: studentIds.map(toObjectId) },
      status: { $in: ['ABSENT', 'EXCUSED', 'LATE'] },
    })
      .select('session student status')
      .lean();
    records.forEach((record) => {
      const entry = result.students.get(String(record.student));
      const session = sessionById.get(String(record.session));
      if (!entry || !session) return;
      const figures = entry.bySubject.get(session.subjectId);
      if (record.status === 'ABSENT') {
        figures.absentMinutes += session.minutes;
        entry.totals.absentMinutes += session.minutes;
      } else if (record.status === 'EXCUSED') {
        figures.excusedMinutes += session.minutes;
        entry.totals.excusedMinutes += session.minutes;
      } else if (record.status === 'LATE') {
        figures.lateCount += 1;
        entry.totals.lateCount += 1;
      }
    });
  }
  return result;
};

// Subject summaries { id, name, code, color } by id (string).
const loadSubjects = async (subjectIds) => {
  const ids = [...new Set([...subjectIds].map(String))];
  if (ids.length === 0) return new Map();
  const subjects = await Subject.find({ _id: { $in: ids.map(toObjectId) } }).select('name code color').lean();
  return new Map(
    subjects.map((subject) => [
      String(subject._id),
      { id: String(subject._id), name: subject.name, code: subject.code, color: subject.color },
    ])
  );
};

const byName = (a, b) => String(a.subject?.name ?? '').localeCompare(String(b.subject?.name ?? ''), 'fr');

// JSON of one figures object: { heldHours, absentHours, excusedHours, lateCount, rate, level }.
const describeFigures = (figures, limits) => {
  const rate = rateOf(figures.absentMinutes, figures.heldMinutes);
  return {
    heldHours: roundHours(figures.heldMinutes),
    absentHours: roundHours(figures.absentMinutes),
    excusedHours: roundHours(figures.excusedMinutes),
    lateCount: figures.lateCount,
    rate: roundRate(rate),
    level: levelOf(rate, limits),
  };
};

/**
 * Attendance summary of one student entry of computeGroupFigures:
 * { overallRate, heldHours, absentHours, excusedHours, lateCount, level, worstLevel,
 *   bySubject: [{ subject, heldHours, absentHours, excusedHours, lateCount, rate, level }] } (rates = absence rates).
 * `level` is the level of the overall rate; `worstLevel` the highest level of the subjects (alerts are per subject).
 */
const describeStudent = (entry, subjects, limits = thresholds()) => {
  const totals = describeFigures(entry?.totals ?? emptyFigures(), limits);
  const bySubject = [];
  (entry?.bySubject ?? new Map()).forEach((figures, subjectId) => {
    bySubject.push({ subject: subjects.get(subjectId) ?? { id: subjectId }, ...describeFigures(figures, limits) });
  });
  bySubject.sort(byName);
  const worstLevel = bySubject.reduce(
    (worst, { level }) => (LEVELS.indexOf(level) > LEVELS.indexOf(worst) ? level : worst),
    totals.level
  );
  return {
    overallRate: totals.rate,
    heldHours: totals.heldHours,
    absentHours: totals.absentHours,
    excusedHours: totals.excusedHours,
    lateCount: totals.lateCount,
    level: totals.level,
    worstLevel,
    bySubject,
  };
};

// The group document ({ _id, academicYear }) of a student, or null.
const groupOfStudent = async (student) => {
  const group = student?.group;
  if (!group) return null;
  if (group.academicYear !== undefined) return group;
  return Group.findById(idString(group)).select('name academicYear').lean();
};

/**
 * Attendance summary of one student (describeStudent shape), for the held sessions of their current group.
 * Options: from / to (Date) narrow the range inside the academic year; subjectIds limits the subjects.
 */
const studentAttendance = async (student, { from = null, to = null, subjectIds = null, now = new Date() } = {}) => {
  const limits = thresholds();
  const group = await groupOfStudent(student);
  if (!group) return describeStudent(null, new Map(), limits);
  const figures = await computeGroupFigures({ group, studentIds: [student._id], subjectIds, from, to, now });
  const subjects = await loadSubjects(figures.subjects.keys());
  return describeStudent(figures.students.get(String(student._id)), subjects, limits);
};

// ---------- Alerts ----------

const percentFormatters = new Map();
const formatPercent = (rate, locale) => {
  const key = locale === 'en' ? 'en-US' : 'fr-FR';
  if (!percentFormatters.has(key)) {
    percentFormatters.set(key, new Intl.NumberFormat(key, { style: 'percent', maximumFractionDigits: 0 }));
  }
  return percentFormatters.get(key).format(rate);
};

/**
 * Localized ATTENDANCE notification of a new alert (French uses "tu"). Exported for tests.
 * alert = { level, rate, subject: { id, name } }
 */
const buildAlertMessage = (alert, locale, limits = thresholds()) => {
  const fr = locale !== 'en';
  const subjectName = alert.subject?.name || (fr ? 'une matière' : 'a subject');
  const rate = formatPercent(alert.rate, locale);
  const critical = alert.level === 'CRITICAL';
  const threshold = formatPercent(critical ? limits.critical : limits.warning, locale);
  const message = critical
    ? {
        title: fr ? `Alerte absences : ${subjectName}` : `Absence alert: ${subjectName}`,
        body: fr
          ? `Ton taux d'absences non justifiées en ${subjectName} atteint ${rate} (seuil d'alerte : ${threshold}). Contacte vite l'administration pour faire le point.`
          : `Your unexcused absence rate in ${subjectName} has reached ${rate} (alert threshold: ${threshold}). Please contact the administration soon.`,
      }
    : {
        title: fr ? `Attention à tes absences en ${subjectName}` : `Watch your absences in ${subjectName}`,
        body: fr
          ? `Ton taux d'absences non justifiées en ${subjectName} atteint ${rate} (seuil d'avertissement : ${threshold}). Pense à venir en cours ou à faire justifier tes absences.`
          : `Your unexcused absence rate in ${subjectName} has reached ${rate} (warning threshold: ${threshold}). Make sure to attend class or have your absences excused.`,
      };
  return {
    type: 'ATTENDANCE',
    ...message,
    link: '/dashboard/analytics',
    data: { subjectId: alert.subject?.id ?? null, level: alert.level, rate: alert.rate },
    tag: `attendance-${alert.subject?.id ?? 'subject'}`,
    urgency: critical ? 'high' : 'normal',
  };
};

// Creates the alert (student, subject, level) once. Resolves to true when this call created it: the unique
// index makes concurrent evaluations race-free (only one of them creates it and notifies).
const createAlertOnce = async ({ student, subject, level, rate, group, source }) => {
  try {
    const result = await AttendanceAlert.updateOne(
      { student: toObjectId(student), subject: toObjectId(subject), level },
      { $setOnInsert: { rate: roundRate(rate), group: group ? toObjectId(group) : null, source } },
      { upsert: true }
    );
    return result.upsertedCount > 0;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

/**
 * Checks the absence rates of students and creates the missing alerts (at most one per student, subject and
 * level). For each (student, subject) that gets new alerts, the student receives one ATTENDANCE notification
 * for the highest new level (in the background), unless `notify` is false (seed).
 * Students without a group or not STUDENT are ignored. Returns the created alerts
 * [{ student, subject, level, rate }].
 */
const evaluateAlerts = async ({ studentIds, subjectIds = null, notify = true, source = 'MANUAL', now = new Date() }) => {
  const ids = [...new Set((studentIds ?? []).map(idString).filter((id) => mongoose.isObjectIdOrHexString(id)))];
  if (ids.length === 0) return [];
  const limits = thresholds();
  const students = await User.find({ _id: { $in: ids.map(toObjectId) }, role: 'STUDENT', group: { $ne: null } })
    .select('group')
    .setOptions({ populateGroup: false })
    .lean();

  const byGroup = new Map();
  students.forEach((student) => {
    const key = String(student.group);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(student._id);
  });
  const groups = await Group.find({ _id: { $in: [...byGroup.keys()].map(toObjectId) } })
    .select('academicYear')
    .lean();

  const created = [];
  const toNotify = [];
  for (const group of groups) {
    const members = byGroup.get(String(group._id)) ?? [];
    const figures = await computeGroupFigures({ group, studentIds: members, subjectIds, now });
    for (const [studentId, entry] of figures.students) {
      for (const [subjectId, subjectFigures] of entry.bySubject) {
        const rate = rateOf(subjectFigures.absentMinutes, subjectFigures.heldMinutes);
        const newLevels = [];
        for (const level of levelsReached(rate, limits)) {
          if (await createAlertOnce({ student: studentId, subject: subjectId, level, rate, group: group._id, source })) {
            newLevels.push(level);
            created.push({ student: studentId, subject: subjectId, level, rate: roundRate(rate) });
          }
        }
        if (newLevels.length > 0) toNotify.push({ studentId, subjectId, level: newLevels.at(-1), rate: roundRate(rate) });
      }
    }
  }

  if (notify && toNotify.length > 0) {
    const subjects = await loadSubjects(toNotify.map(({ subjectId }) => subjectId));
    toNotify.forEach(({ studentId, subjectId, level, rate }) => {
      const subject = subjects.get(subjectId) ?? { id: subjectId };
      notifyUsersInBackground([studentId], (locale) => buildAlertMessage({ level, rate, subject }, locale, limits));
    });
  }
  return created;
};

/**
 * Scheduler job: ABSENT marks taken before their session ended carry `alertCheckAt` (the session end). Once
 * that time has passed, the student's alerts for the session's subject are evaluated and the mark is cleared.
 * Moved sessions are postponed to their new end; cancelled or deleted ones are just cleared. Idempotent
 * (alerts are unique), so several backend instances may run it at once.
 */
const runAlertChecks = async (now = new Date()) => {
  const due = await AttendanceRecord.find({ alertCheckAt: { $ne: null, $lte: now } })
    .select('session student alertCheckAt')
    .sort({ alertCheckAt: 1 })
    .limit(ALERT_JOB_BATCH)
    .lean();
  if (due.length === 0) return { checked: 0, alerts: 0 };

  const sessionIds = [...new Set(due.map((record) => String(record.session)))];
  const sessions = await ClassSession.find({ _id: { $in: sessionIds.map(toObjectId) } })
    .select('subject endsAt status')
    .lean();
  const sessionById = new Map(sessions.map((session) => [String(session._id), session]));

  const pairs = new Map(); // subjectId → Set(studentId)
  const updates = [];
  due.forEach((record) => {
    const session = sessionById.get(String(record.session));
    const filter = { _id: record._id, alertCheckAt: record.alertCheckAt };
    if (session && session.status === 'SCHEDULED' && session.endsAt > now) {
      updates.push({ updateOne: { filter, update: { $set: { alertCheckAt: session.endsAt } } } });
      return;
    }
    updates.push({ updateOne: { filter, update: { $set: { alertCheckAt: null } } } });
    if (session && session.status === 'SCHEDULED') {
      const key = String(session.subject);
      if (!pairs.has(key)) pairs.set(key, new Set());
      pairs.get(key).add(String(record.student));
    }
  });

  let alerts = 0;
  for (const [subjectId, students] of pairs) {
    alerts += (await evaluateAlerts({ studentIds: [...students], subjectIds: [subjectId], now })).length;
  }
  // Only cleared / postponed when unchanged since read (a roll call may have set a new check time meanwhile).
  if (updates.length > 0) await AttendanceRecord.bulkWrite(updates, { ordered: false });
  return { checked: due.length, alerts };
};

scheduler.registerJob('attendance.evaluate-alerts', scheduler.defaultIntervalMs(), () => runAlertChecks());

module.exports = {
  LEVELS,
  OPENS_BEFORE_START_MS,
  CLOSES_AFTER_END_MS,
  thresholds,
  levelOf,
  levelsReached,
  roundHours,
  roundRate,
  rateOf,
  editWindow,
  isSessionTeacher,
  canReadRollCall,
  canEditRollCall,
  findStudentsOfGroups,
  countStudentsByGroup,
  yearBounds,
  computeGroupFigures,
  loadSubjects,
  describeStudent,
  groupOfStudent,
  studentAttendance,
  formatPercent,
  buildAlertMessage,
  evaluateAlerts,
  runAlertChecks,
};
