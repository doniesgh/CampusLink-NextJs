const mongoose = require('mongoose');
const ClassSession = require('../models/classSessionModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const time = require('../utils/time');
const { envNumber } = require('../utils/env');
const { notifyUsersInBackground } = require('./notificationService');

/*
 * Timetable business logic shared by the controller, the CSV import, the ICS feed and the seed:
 * range parsing (campus timezone), session queries, weekly occurrences, conflict detection and
 * TIMETABLE_CHANGE notifications (contract section 6).
 */

const { MAX_DURATION_MS, SESSION_POPULATE } = ClassSession;
const DAY_MS = time.DAY_MS;
const MAX_RANGE_DAYS = 62;
const DEFAULT_RANGE_DAYS = 7;
const MAX_SERIES_OCCURRENCES = 26;
// ICS feed window (contract: from 30 days ago to 120 days ahead).
const FEED_PAST_DAYS = 30;
const FEED_FUTURE_DAYS = 120;

// ---------- Instants and ranges (campus timezone) ----------

const DATE_ONLY_RE = /^(\d{4}-\d{2}-\d{2})$/;
const LOCAL_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/**
 * Parses an instant sent by a client. Accepted forms:
 *  - ISO 8601 with "Z" or an offset ("2026-10-08T09:30:00.000Z", "2026-10-08T10:30+01:00");
 *  - campus wall-clock time without offset ("2026-10-08T10:30", APP_TIMEZONE);
 *  - a date alone ("2026-10-08" = 00:00 that day in APP_TIMEZONE) when `allowDateOnly`.
 * Returns a Date, or null when the value is not one of these.
 */
const parseInstant = (value, { allowDateOnly = true } = {}) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (allowDateOnly && DATE_ONLY_RE.test(text)) return time.parseLocalDateTime(text, '00:00');
  const local = LOCAL_DATE_TIME_RE.exec(text);
  if (local) {
    const [, date, hour, minute, second = '0'] = local;
    const parts = time.parseDateOnly(date);
    if (!parts || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    return time.zonedTimeToUtc({ ...parts, hour: Number(hour), minute: Number(minute), second: Number(second) });
  }
  if (!ISO_WITH_OFFSET_RE.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isPresent = (value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');

/**
 * ?from=&to= of the timetable reads. Defaults to the current week (Monday 00:00 → next Monday
 * 00:00, APP_TIMEZONE). Only `from` → 7 days from it; only `to` → the 7 days before it.
 * `to` is exclusive. 400 VALIDATION_ERROR (details.from / details.to), 400 RANGE_TOO_LARGE (> 62 days).
 */
const parseRange = (query = {}, { now = new Date(), maxDays = MAX_RANGE_DAYS } = {}) => {
  const details = {};
  let from;
  let to;
  if (isPresent(query.from)) {
    from = parseInstant(query.from);
    if (!from) details.from = 'from must be a date (YYYY-MM-DD) or an ISO 8601 date-time';
  }
  if (isPresent(query.to)) {
    to = parseInstant(query.to);
    if (!to) details.to = 'to must be a date (YYYY-MM-DD) or an ISO 8601 date-time';
  }
  if (Object.keys(details).length > 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', details);

  if (!from && !to) {
    from = time.startOfLocalWeek(now);
    to = time.addLocalDays(from, DEFAULT_RANGE_DAYS);
  } else if (!to) {
    to = new Date(from.getTime() + DEFAULT_RANGE_DAYS * DAY_MS);
  } else if (!from) {
    from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  }

  if (to <= from) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', { to: 'to must be after from' });
  }
  // One hour of tolerance for a daylight saving time change inside the range.
  if (to.getTime() - from.getTime() > maxDays * DAY_MS + 60 * 60 * 1000) {
    throw new HttpError(400, 'RANGE_TOO_LARGE', `The range must not exceed ${maxDays} days`, { maxDays });
  }
  return { from, to };
};

// Sessions overlapping [from, to). Sessions last at most 8 hours, so the startsAt bound keeps the
// query on the { <field>: 1, startsAt: 1 } indexes.
const overlapFilter = (from, to) => ({
  startsAt: { $gt: new Date(from.getTime() - MAX_DURATION_MS), $lt: to },
  endsAt: { $gt: from },
});

// Populated sessions (lean) matching `filter` and overlapping [from, to), sorted by start.
const findSessions = (filter, from, to) =>
  ClassSession.find({ ...filter, ...overlapFilter(from, to) })
    .sort({ startsAt: 1, endsAt: 1, _id: 1 })
    .populate(SESSION_POPULATE)
    .lean();

const findSessionsByIds = (ids) =>
  ClassSession.find({ _id: { $in: ids } })
    .sort({ startsAt: 1, endsAt: 1, _id: 1 })
    .populate(SESSION_POPULATE)
    .lean();

/**
 * Filter of a user's own timetable: STUDENT → their group's sessions, TEACHER → the sessions they
 * teach. Returns { filter } or { hint } ('NO_GROUP' for a student without a group, null otherwise)
 * when the user has no timetable.
 */
const personalFilter = (user) => {
  if (!user) return { filter: null, hint: null };
  if (user.role === 'STUDENT') {
    const groupId = user.group?._id ?? user.group ?? null;
    if (!groupId) return { filter: null, hint: 'NO_GROUP' };
    return { filter: { groups: new mongoose.Types.ObjectId(String(groupId)) } };
  }
  if (user.role === 'TEACHER') return { filter: { teacher: user._id } };
  return { filter: null, hint: null };
};

/**
 * ClassSession filter of what makes a teacher "teach" a group: their SCHEDULED sessions (cancelled ones do
 * not count) of the current academic year (1 September → 31 August, APP_TIMEZONE).
 * Same rule as announcementService.taughtGroupIds.
 */
const taughtSessionsFilter = (teacherId, now = new Date()) => {
  const { start, end } = time.academicYearBounds(now);
  return { teacher: teacherId, status: 'SCHEDULED', startsAt: { $gte: start, $lt: end } };
};

// Ids of the groups a teacher teaches (taughtSessionsFilter).
const taughtGroupIds = async (teacherId, { now = new Date() } = {}) => {
  const id = teacherId?._id ?? teacherId;
  if (!id || !mongoose.isObjectIdOrHexString(String(id))) return [];
  return ClassSession.distinct('groups', taughtSessionsFilter(new mongoose.Types.ObjectId(String(id)), now));
};

// ---------- Session times ----------

// Problem with a session's times (English message), or null when they are valid:
// endsAt > startsAt, same calendar day in APP_TIMEZONE, at most 8 hours.
const checkSessionTimes = (startsAt, endsAt) => {
  if (!(endsAt > startsAt)) return 'endsAt must be after startsAt';
  if (!time.isSameLocalDay(startsAt, new Date(endsAt.getTime() - 1))) {
    return 'A session must start and end on the same day';
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS) return 'A session lasts at most 8 hours';
  return null;
};

// Wall-clock parts (campus timezone) of an instant: { date: 'YYYY-MM-DD', hour, minute, second }.
const localParts = (date) => {
  const p = time.getZonedParts(date);
  return { date: time.formatLocalDate(date), hour: p.hour, minute: p.minute, second: p.second };
};

// Instant of a wall-clock time (campus timezone) on a 'YYYY-MM-DD' day.
const atLocalTime = (dateString, { hour, minute, second = 0 }) => {
  const parts = time.parseDateOnly(dateString);
  return time.zonedTimeToUtc({ ...parts, hour, minute, second });
};

// Calendar days between two 'YYYY-MM-DD' strings (b - a).
const daysBetween = (a, b) => {
  const pa = time.parseDateOnly(a);
  const pb = time.parseDateOnly(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY_MS);
};

/**
 * Weekly occurrences [{ startsAt, endsAt }]: same weekday and wall-clock time (DST-safe) every week
 * from the first session's day until `untilDate` ('YYYY-MM-DD', inclusive).
 * Returns null when `untilDate` is before the first day, or more than `max` occurrences would be created.
 */
const weeklyOccurrences = (startsAt, endsAt, untilDate, { max = MAX_SERIES_OCCURRENCES } = {}) => {
  const start = localParts(startsAt);
  const end = localParts(endsAt);
  const weeks = Math.floor(daysBetween(start.date, untilDate) / 7);
  if (weeks < 0) return { error: 'BEFORE_START' };
  if (weeks + 1 > max) return { error: 'TOO_MANY' };
  const occurrences = [];
  for (let week = 0; week <= weeks; week += 1) {
    const day = time.addDaysToDateString(start.date, week * 7);
    occurrences.push({ startsAt: atLocalTime(day, start), endsAt: atLocalTime(day, end) });
  }
  return { occurrences };
};

/**
 * New times of an occurrence when the edited occurrence of a series moves from
 * (oldStart) to (newStart, newEnd): same day shift and the new wall-clock times.
 */
const shiftOccurrence = (occurrenceStart, editedOldStart, newStart, newEnd) => {
  const dayShift = daysBetween(time.formatLocalDate(editedOldStart), time.formatLocalDate(newStart));
  const day = time.addDaysToDateString(time.formatLocalDate(occurrenceStart), dayShift);
  return { startsAt: atLocalTime(day, localParts(newStart)), endsAt: atLocalTime(day, localParts(newEnd)) };
};

// ---------- Conflicts ----------

const idString = (value) => (value === null || value === undefined ? null : String(value?._id ?? value));
const overlaps = (a, b) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

// Resource keys of a session for each conflict reason.
const resourceKeys = (session) => {
  const keys = [];
  const room = idString(session.room);
  if (room) keys.push(['ROOM', `r:${room}`]);
  const teacher = idString(session.teacher);
  if (teacher) keys.push(['TEACHER', `t:${teacher}`]);
  (session.groups || []).forEach((group) => keys.push(['GROUP', `g:${idString(group)}`]));
  return keys;
};

/**
 * Existing SCHEDULED sessions that overlap a candidate and share its room, teacher or a group.
 * @param {Array<{ key, startsAt, endsAt, room, teacher, groups }>} candidates  sessions about to be
 *        written as SCHEDULED (ids or populated refs)
 * @param {{ excludeIds?: Array }} [options]  sessions being rewritten by the same operation
 * @returns {Promise<Array<{ key, session, reason }>>}  one entry per (candidate, session, reason);
 *          `session` is lean with `subject` populated (name code)
 */
const findConflicts = async (candidates, { excludeIds = [] } = {}) => {
  if (candidates.length === 0) return [];
  const rooms = new Set();
  const teachers = new Set();
  const groups = new Set();
  let minStart = candidates[0].startsAt;
  let maxEnd = candidates[0].endsAt;
  candidates.forEach((candidate) => {
    if (idString(candidate.room)) rooms.add(idString(candidate.room));
    if (idString(candidate.teacher)) teachers.add(idString(candidate.teacher));
    (candidate.groups || []).forEach((group) => groups.add(idString(group)));
    if (candidate.startsAt < minStart) minStart = candidate.startsAt;
    if (candidate.endsAt > maxEnd) maxEnd = candidate.endsAt;
  });

  const toIds = (set) => [...set].map((id) => new mongoose.Types.ObjectId(id));
  const or = [];
  if (rooms.size > 0) or.push({ room: { $in: toIds(rooms) } });
  if (teachers.size > 0) or.push({ teacher: { $in: toIds(teachers) } });
  if (groups.size > 0) or.push({ groups: { $in: toIds(groups) } });
  if (or.length === 0) return [];

  const existing = await ClassSession.find({
    status: 'SCHEDULED',
    _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(idString(id))) },
    ...overlapFilter(minStart, maxEnd),
    $or: or,
  })
    .select('subject teacher groups room startsAt endsAt')
    .populate({ path: 'subject', select: 'name code' })
    .lean();

  const byResource = new Map();
  existing.forEach((session) => {
    resourceKeys(session).forEach(([, key]) => {
      if (!byResource.has(key)) byResource.set(key, []);
      byResource.get(key).push(session);
    });
  });

  const conflicts = [];
  const seen = new Set();
  candidates.forEach((candidate) => {
    resourceKeys(candidate).forEach(([reason, key]) => {
      (byResource.get(key) || []).forEach((session) => {
        if (!overlaps(candidate, session)) return;
        const id = `${candidate.key}|${session._id}|${reason}`;
        if (seen.has(id)) return;
        seen.add(id);
        conflicts.push({ key: candidate.key, session, reason });
      });
    });
  });
  return conflicts;
};

/**
 * Conflicts between candidates of the same operation (CSV import rows).
 * @returns {Array<{ key, otherKey, reason }>}  key = the later candidate, otherKey = the earlier one
 */
const findInternalConflicts = (candidates) => {
  const buckets = new Map();
  candidates.forEach((candidate, index) => {
    resourceKeys(candidate).forEach(([reason, key]) => {
      if (!buckets.has(key)) buckets.set(key, { reason, items: [] });
      buckets.get(key).items.push({ candidate, index });
    });
  });
  const conflicts = [];
  const seen = new Set();
  buckets.forEach(({ reason, items }) => {
    items.sort((a, b) => a.candidate.startsAt - b.candidate.startsAt || a.index - b.index);
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length && items[j].candidate.startsAt < items[i].candidate.endsAt; j += 1) {
        const [first, second] = items[i].index < items[j].index ? [items[i], items[j]] : [items[j], items[i]];
        const id = `${first.candidate.key}|${second.candidate.key}|${reason}`;
        if (!seen.has(id) && overlaps(first.candidate, second.candidate)) {
          seen.add(id);
          conflicts.push({ key: second.candidate.key, otherKey: first.candidate.key, reason });
        }
      }
    }
  });
  return conflicts;
};

// Contract shape of a conflict: { sessionId, startsAt, endsAt, reason } (+ subject for display).
const describeConflict = ({ session, reason }) => ({
  sessionId: String(session._id),
  startsAt: session.startsAt,
  endsAt: session.endsAt,
  reason,
  subject: session.subject
    ? { id: String(session.subject._id), name: session.subject.name, code: session.subject.code }
    : null,
});

// 409 SESSION_CONFLICT with details.conflicts (sorted by start).
const conflictError = (conflicts) => {
  const list = conflicts.map(describeConflict).sort((a, b) => a.startsAt - b.startsAt);
  return new HttpError(409, 'SESSION_CONFLICT', 'This session conflicts with another session', { conflicts: list });
};

// ---------- Change notifications ----------

const notifyHorizonDays = () => envNumber('NOTIFY_HORIZON_DAYS', 14);

// True when the session starts in the future and within NOTIFY_HORIZON_DAYS.
const isWithinNotifyHorizon = (startsAt, now = new Date()) =>
  startsAt > now && startsAt.getTime() <= now.getTime() + notifyHorizonDays() * DAY_MS;

const dateFormatters = new Map();
const formatDay = (date, locale) => {
  const timeZone = time.getAppTimezone();
  const key = `${locale}|${timeZone}`;
  if (!dateFormatters.has(key)) {
    dateFormatters.set(
      key,
      new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone,
      })
    );
  }
  return dateFormatters.get(key).format(date);
};
const hm = (date) => time.formatLocalTime(date);

const roomLabel = (room) => (room && room.name ? room.name : '—');
const roomWithBuilding = (room) => (room.building ? `${room.name} (${room.building})` : room.name);

/**
 * Localized title/body of a TIMETABLE_CHANGE notification (French uses "tu").
 * summary = { kind: 'ROOM' | 'TIME' | 'CANCELLED' | 'RESTORED', subjectName, count,
 *             first: { before: { startsAt, endsAt, room }, after: { startsAt, endsAt, room } } }
 * (rooms are { name, building } or null). Exported for tests.
 */
const buildChangeText = (locale, { kind, subjectName, count, first }) => {
  const fr = locale !== 'en';
  const { before, after } = first;
  const subject = subjectName || (fr ? 'Cours' : 'Class');
  const prefix = fr ? `${subject} : ` : `${subject}: `;
  const day = formatDay(after.startsAt, locale);
  const many = count > 1;
  const sessionsFrom = fr ? `${count} séances à partir du ${day}` : `${count} classes from ${day}`;
  const roomSuffix = after.room ? (fr ? `, salle ${after.room.name}` : `, room ${after.room.name}`) : '';

  if (kind === 'CANCELLED') {
    if (many) {
      return {
        title: fr ? `${prefix}${count} séances annulées à partir du ${day}` : `${prefix}${count} classes cancelled from ${day}`,
        body: fr
          ? `Tes ${count} prochains cours de ${subject} à partir du ${day} n'auront pas lieu.`
          : `Your next ${count} ${subject} classes from ${day} will not take place.`,
      };
    }
    return {
      title: fr ? `${prefix}séance annulée (${day}, ${hm(after.startsAt)})` : `${prefix}class cancelled (${day}, ${hm(after.startsAt)})`,
      body: fr
        ? `Ton cours du ${day} à ${hm(after.startsAt)} n'aura pas lieu.`
        : `Your class on ${day} at ${hm(after.startsAt)} will not take place.`,
    };
  }

  if (kind === 'RESTORED') {
    if (many) {
      return {
        title: fr ? `${prefix}${count} séances rétablies à partir du ${day}` : `${prefix}${count} classes reinstated from ${day}`,
        body: fr
          ? `Bonne nouvelle : tes cours de ${subject} ont bien lieu à partir du ${day}.`
          : `Good news: your ${subject} classes are back on from ${day}.`,
      };
    }
    return {
      title: fr ? `${prefix}séance rétablie (${day}, ${hm(after.startsAt)})` : `${prefix}class reinstated (${day}, ${hm(after.startsAt)})`,
      body: fr
        ? `Bonne nouvelle : ton cours du ${day} a bien lieu, de ${hm(after.startsAt)} à ${hm(after.endsAt)}${roomSuffix}.`
        : `Good news: your class on ${day} is back on, ${hm(after.startsAt)}–${hm(after.endsAt)}${roomSuffix}.`,
    };
  }

  if (kind === 'TIME') {
    if (many) {
      return {
        title: fr
          ? `${prefix}nouvel horaire ${hm(after.startsAt)}–${hm(after.endsAt)} (${sessionsFrom})`
          : `${prefix}new time ${hm(after.startsAt)}–${hm(after.endsAt)} (${sessionsFrom})`,
        body: fr
          ? `À partir du ${day}, ton cours a lieu de ${hm(after.startsAt)} à ${hm(after.endsAt)}${roomSuffix}.`
          : `From ${day}, your class takes place ${hm(after.startsAt)}–${hm(after.endsAt)}${roomSuffix}.`,
      };
    }
    const sameDay = time.isSameLocalDay(before.startsAt, after.startsAt);
    const oldDay = formatDay(before.startsAt, locale);
    return {
      title: sameDay
        ? fr
          ? `${prefix}horaire changé ${hm(before.startsAt)} → ${hm(after.startsAt)} (${day})`
          : `${prefix}time changed ${hm(before.startsAt)} → ${hm(after.startsAt)} (${day})`
        : fr
          ? `${prefix}séance déplacée ${oldDay}, ${hm(before.startsAt)} → ${day}, ${hm(after.startsAt)}`
          : `${prefix}class moved ${oldDay}, ${hm(before.startsAt)} → ${day}, ${hm(after.startsAt)}`,
      body: fr
        ? `Ton cours a lieu le ${day} de ${hm(after.startsAt)} à ${hm(after.endsAt)}${roomSuffix}.`
        : `Your class now takes place on ${day}, ${hm(after.startsAt)}–${hm(after.endsAt)}${roomSuffix}.`,
    };
  }

  // ROOM
  const change = `${roomLabel(before.room)} → ${roomLabel(after.room)}`;
  const where = after.room
    ? fr
      ? `en salle ${roomWithBuilding(after.room)}`
      : `in room ${roomWithBuilding(after.room)}`
    : null;
  if (many) {
    return {
      title: fr ? `${prefix}salle changée ${change} (${sessionsFrom})` : `${prefix}room changed ${change} (${sessionsFrom})`,
      body: where
        ? fr
          ? `À partir du ${day}, ton cours a lieu ${where}.`
          : `From ${day}, your class takes place ${where}.`
        : fr
          ? `À partir du ${day}, ton cours n'a plus de salle attribuée pour le moment.`
          : `From ${day}, your class has no room assigned for now.`,
    };
  }
  return {
    title: fr
      ? `${prefix}salle changée ${change} (${day}, ${hm(after.startsAt)})`
      : `${prefix}room changed ${change} (${day}, ${hm(after.startsAt)})`,
    body: where
      ? fr
        ? `Ton cours du ${day} a lieu ${where}, de ${hm(after.startsAt)} à ${hm(after.endsAt)}.`
        : `Your class on ${day} takes place ${where}, ${hm(after.startsAt)}–${hm(after.endsAt)}.`
      : fr
        ? `Ton cours du ${day} n'a plus de salle attribuée pour le moment.`
        : `Your class on ${day} has no room assigned for now.`,
  };
};

/**
 * Sends one TIMETABLE_CHANGE notification (in-app + push) per user for an operation, in the
 * background. `changes` lists every occurrence touched by the operation:
 *   { sessionId, seriesId, kinds: { room, time, status }, before: { startsAt, endsAt, room, status,
 *     groups, teacher }, after: { ... } }   (rooms populated { _id, name, building } or null)
 * Only occurrences with a room / time / status change that start in the future and within
 * NOTIFY_HORIZON_DAYS (before or after the change) count. Recipients: students of the old and new
 * groups, old and new teachers. The notifications are created after this resolves (background).
 * Returns { kind, occurrences, recipients } (counts), or null when no occurrence qualifies.
 */
const notifyTimetableChanges = async ({ changes, subjectName, now = new Date() }) => {
  const relevant = changes.filter(({ kinds, before, after }) => {
    if (kinds.status) return isWithinNotifyHorizon(after.startsAt, now) || isWithinNotifyHorizon(before.startsAt, now);
    if (after.status !== 'SCHEDULED') return false;
    if (!kinds.room && !kinds.time) return false;
    return isWithinNotifyHorizon(after.startsAt, now) || isWithinNotifyHorizon(before.startsAt, now);
  });
  if (relevant.length === 0) return null;

  relevant.sort((a, b) => a.after.startsAt - b.after.startsAt);
  // One kind per operation: cancellation / restoration first, then time, then room.
  let ofKind = relevant.filter((change) => change.kinds.status);
  let kind;
  if (ofKind.length > 0) {
    kind = ofKind[0].after.status === 'CANCELLED' ? 'CANCELLED' : 'RESTORED';
  } else {
    ofKind = relevant.filter((change) => change.kinds.time);
    kind = ofKind.length > 0 ? 'TIME' : 'ROOM';
    if (kind === 'ROOM') ofKind = relevant;
  }
  const lead = ofKind[0];

  const groupIds = new Set();
  const teacherIds = new Set();
  relevant.forEach(({ before, after }) => {
    [...(before.groups || []), ...(after.groups || [])].forEach((group) => groupIds.add(idString(group)));
    [before.teacher, after.teacher].forEach((teacher) => teacher && teacherIds.add(idString(teacher)));
  });
  const students = await User.find({
    role: 'STUDENT',
    group: { $in: [...groupIds].map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('_id')
    .setOptions({ populateGroup: false })
    .lean();
  const teachers = await User.find({
    _id: { $in: [...teacherIds].map((id) => new mongoose.Types.ObjectId(id)) },
    role: 'TEACHER',
  })
    .select('_id')
    .setOptions({ populateGroup: false })
    .lean();
  const recipients = [...students, ...teachers].map((user) => user._id);
  if (recipients.length === 0) return { kind, occurrences: ofKind.length, recipients: 0 };

  const summary = { kind, subjectName, count: ofKind.length, first: lead };
  const date = time.formatLocalDate(lead.after.startsAt);
  const soon = lead.after.startsAt.getTime() - now.getTime() <= 2 * DAY_MS;
  notifyUsersInBackground(recipients, (locale) => ({
    type: 'TIMETABLE_CHANGE',
    ...buildChangeText(locale, summary),
    link: `/dashboard/timetable?date=${date}`,
    data: {
      kind,
      sessionId: String(lead.sessionId),
      seriesId: lead.seriesId ? String(lead.seriesId) : null,
      count: ofKind.length,
      date,
    },
    tag: ofKind.length > 1 && lead.seriesId ? `timetable-series-${lead.seriesId}` : `timetable-${lead.sessionId}`,
    urgency: soon ? 'high' : 'normal',
  }));
  return { kind, occurrences: ofKind.length, recipients: recipients.length };
};

module.exports = {
  MAX_RANGE_DAYS,
  MAX_SERIES_OCCURRENCES,
  FEED_PAST_DAYS,
  FEED_FUTURE_DAYS,
  parseInstant,
  parseRange,
  overlapFilter,
  findSessions,
  findSessionsByIds,
  personalFilter,
  taughtSessionsFilter,
  taughtGroupIds,
  checkSessionTimes,
  localParts,
  atLocalTime,
  weeklyOccurrences,
  shiftOccurrence,
  findConflicts,
  findInternalConflicts,
  describeConflict,
  conflictError,
  notifyHorizonDays,
  isWithinNotifyHorizon,
  formatDay,
  buildChangeText,
  notifyTimetableChanges,
};
