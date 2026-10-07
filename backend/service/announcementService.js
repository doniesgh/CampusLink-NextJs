const mongoose = require('mongoose');
const Announcement = require('../models/announcementModel');
const AnnouncementRead = require('../models/announcementReadModel');
const Notification = require('../models/notificationModel');
const HttpError = require('../utils/httpError');
const audienceService = require('./audienceService');
const auditService = require('./auditService');
const storageService = require('./storageService');
const scheduler = require('./scheduler');
const { notifyUsers, notifyUsersInBackground } = require('./notificationService');
const { idOf } = require('../utils/serialize');
const time = require('../utils/time');

/*
 * Business rules of Module 7 (announcements), contract section 7: visibility, teacher restrictions,
 * publication (manual or scheduled, claimed atomically), notification fan-out and statistics.
 * HTTP parsing lives in controllers/announcementController.js.
 */

const { ANNOUNCEMENT_POPULATE } = Announcement;

const NOTIFICATION_EXCERPT_LENGTH = 160;
// Scheduled announcements published per scheduler run (the next run continues).
const MAX_PUBLISH_PER_RUN = 50;
// Longest readsByDay series (days); older days are left out.
const MAX_STATS_DAYS = 400;

// Title prefixes of ANNOUNCEMENT notifications, per recipient locale.
const PRIORITY_PREFIXES = {
  fr: { URGENT: '[Urgent]', HIGH: '[Important]' },
  en: { URGENT: '[Urgent]', HIGH: '[Important]' },
};
const PUSH_URGENCY = { URGENT: 'high', HIGH: 'high', NORMAL: 'normal', LOW: 'low' };

const forbidden = () => new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
const audienceNotAllowed = (message, details) => new HttpError(403, 'AUDIENCE_NOT_ALLOWED', message, details);
const invalidState = (message, details) => new HttpError(409, 'INVALID_STATE', message, details);

const sameId = (a, b) => {
  const left = idOf(a);
  return left !== null && left === idOf(b);
};

// ---------- Visibility ----------

const isAdmin = (user) => user?.role === 'ADMIN';
const isAuthor = (user, announcement) => Boolean(user) && sameId(announcement.author, user);

// Author or admin: may edit, publish, delete and see the statistics.
const canManage = (user, announcement) => isAdmin(user) || isAuthor(user, announcement);

// The user receives this announcement (it is published and the user matches its audience).
const isRecipient = (user, announcement) =>
  announcement.status === 'PUBLISHED' && audienceService.userMatchesAudience(user, announcement.audience);

// Visible to recipients (when published), the author and admins.
const canView = (user, announcement) => canManage(user, announcement) || isRecipient(user, announcement);

/**
 * MongoDB filter of the PUBLISHED announcements a user receives (same rule as
 * audienceService.userMatchesAudience, evaluated by the database for the feed).
 */
const feedFilter = (user) => {
  const isEmpty = (path) => ({ [`${path}.0`]: { $exists: false } });
  const emptyOr = (path, value) =>
    value === null || value === undefined ? isEmpty(path) : { $or: [isEmpty(path), { [path]: value }] };

  const group = user.group && typeof user.group === 'object' && user.group._id ? user.group : null;
  const groupId = group ? group._id : null;
  const programId = group && group.program ? new mongoose.Types.ObjectId(idOf(group.program)) : null;
  const level = group && Number.isInteger(group.level) ? group.level : null;

  return {
    status: 'PUBLISHED',
    $and: [
      emptyOr('audience.roles', user.role),
      emptyOr('audience.groups', groupId),
      emptyOr('audience.programs', programId),
      emptyOr('audience.levels', level),
    ],
  };
};

// ---------- Teacher restrictions ----------

// Ids (strings) of the groups a teacher teaches, read from the timetable module (ClassSession): groups of
// their SCHEDULED sessions of the current academic year (1 September → 31 August, APP_TIMEZONE), the same
// rule as timetableService.taughtSessionsFilter. Empty when the timetable module is not installed.
const taughtGroupIds = async (user, { now = new Date() } = {}) => {
  const ClassSession = mongoose.models.ClassSession;
  if (!ClassSession || !user?._id) return new Set();
  const { start, end } = time.academicYearBounds(now);
  const ids = await ClassSession.distinct('groups', {
    teacher: user._id,
    status: 'SCHEDULED',
    startsAt: { $gte: start, $lt: end },
  });
  return new Set(ids.map((id) => String(id)));
};

/**
 * Checks that `user` may address `audience` (contract section 7). ADMIN: any audience.
 * TEACHER: a non-empty `groups` list made of groups they teach and `roles` empty or ["STUDENT"],
 * else 403 AUDIENCE_NOT_ALLOWED (details.reason: ROLES_NOT_ALLOWED | GROUPS_REQUIRED | GROUP_NOT_TAUGHT).
 * Other roles: 403 FORBIDDEN.
 */
const assertAudienceAllowed = async (user, audience = {}) => {
  if (isAdmin(user)) return;
  if (user?.role !== 'TEACHER') throw forbidden();

  const roles = [...(audience.roles ?? [])];
  if (roles.length > 0 && !(roles.length === 1 && roles[0] === 'STUDENT')) {
    throw audienceNotAllowed('Teachers can only address students', {
      reason: 'ROLES_NOT_ALLOWED',
      allowedRoles: ['STUDENT'],
    });
  }

  const groups = (audience.groups ?? []).map((group) => idOf(group));
  if (groups.length === 0) {
    throw audienceNotAllowed('Choose at least one of the groups you teach', { reason: 'GROUPS_REQUIRED' });
  }

  const taught = await taughtGroupIds(user);
  const notTaught = groups.filter((id) => !taught.has(id));
  if (notTaught.length > 0) {
    throw audienceNotAllowed('You can only address the groups you teach', {
      reason: 'GROUP_NOT_TAUGHT',
      groups: notTaught,
    });
  }
};

// ---------- Audience helpers ----------

// Plain { roles, programs: [id], levels, groups: [id] } (ids as strings), e.g. for the audit log.
const audienceIds = (audience = {}) => ({
  roles: [...(audience.roles ?? [])],
  programs: (audience.programs ?? []).map((program) => idOf(program)),
  levels: [...(audience.levels ?? [])].map(Number),
  groups: (audience.groups ?? []).map((group) => idOf(group)),
});

// True when two audiences select the same users by the same criteria (order does not matter).
const sameAudience = (a, b) => {
  const left = audienceIds(a);
  const right = audienceIds(b);
  return ['roles', 'programs', 'levels', 'groups'].every((key) => {
    const x = [...new Set(left[key].map(String))].sort();
    const y = [...new Set(right[key].map(String))].sort();
    return x.length === y.length && x.every((value, index) => value === y[index]);
  });
};

// ---------- Statistics ----------

const round = (value) => Math.round(value * 10000) / 10000;

const buildStats = (recipients, reads) => ({
  recipients,
  reads,
  readRate: recipients > 0 ? Math.min(1, round(reads / recipients)) : 0,
});

// Map(announcementId → number of reads).
const readCounts = async (ids) => {
  if (ids.length === 0) return new Map();
  const rows = await AnnouncementRead.aggregate([
    { $match: { announcement: { $in: ids } } },
    { $group: { _id: '$announcement', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map(({ _id, count }) => [String(_id), count]));
};

/**
 * Map(announcementId → { recipients, reads, readRate }).
 * PUBLISHED: recipients snapshotted at publish time. DRAFT / SCHEDULED: users currently matching
 * the audience (what publishing now would reach), no reads.
 */
const statsFor = async (announcements) => {
  const published = announcements.filter((item) => item.status === 'PUBLISHED');
  const counts = await readCounts(published.map((item) => item._id));
  const result = new Map();
  await Promise.all(
    announcements.map(async (item) => {
      const id = String(item._id);
      if (item.status === 'PUBLISHED') {
        result.set(id, buildStats(item.recipients ?? 0, counts.get(id) ?? 0));
      } else {
        result.set(id, buildStats(await audienceService.countAudience(item.audience), 0));
      }
    })
  );
  return result;
};

/**
 * { recipients, reads, readRate, readsByDay: [{ date: 'YYYY-MM-DD', count }] }.
 * readsByDay lists every day (campus timezone) from the publication day to today, zeros included
 * (at most the last MAX_STATS_DAYS days). Empty for an announcement that is not published.
 */
const detailedStats = async (announcement) => {
  const stats = (await statsFor([announcement])).get(String(announcement._id));
  if (announcement.status !== 'PUBLISHED' || !announcement.publishedAt) return { ...stats, readsByDay: [] };

  const timezone = time.getAppTimezone();
  const rows = await AnnouncementRead.aggregate([
    { $match: { announcement: announcement._id } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$readAt', timezone } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const counts = new Map(rows.map(({ _id, count }) => [_id, count]));

  const today = time.formatLocalDate(new Date(), timezone);
  const lastRead = rows.length > 0 ? rows[rows.length - 1]._id : today;
  const end = lastRead > today ? lastRead : today;
  let start = time.formatLocalDate(announcement.publishedAt, timezone);
  const earliest = time.addDaysToDateString(end, -(MAX_STATS_DAYS - 1));
  if (start < earliest) start = earliest;

  const readsByDay = [];
  for (let day = start; day && day <= end; day = time.addDaysToDateString(day, 1)) {
    readsByDay.push({ date: day, count: counts.get(day) ?? 0 });
  }
  return { ...stats, readsByDay };
};

// Records that a recipient read the announcement (idempotent: the first readAt is kept).
const markRead = async (announcement, user) => {
  try {
    await AnnouncementRead.updateOne(
      { announcement: announcement._id, user: user._id },
      { $setOnInsert: { readAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    // Two simultaneous first reads: the unique index rejected the second upsert.
    if (error?.code !== 11000) throw error;
  }
};

// ---------- Publication ----------

const excerpt = (text, max = NOTIFICATION_EXCERPT_LENGTH) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

// Notification builder of an announcement: "[Urgent] <title>" / "[Important] <title>" in the recipient's language.
const notificationBuilder = (announcement) => {
  const id = String(announcement._id);
  const { priority, title } = announcement;
  const body = excerpt(announcement.body);
  return (locale) => {
    const prefix = (PRIORITY_PREFIXES[locale] ?? PRIORITY_PREFIXES.en)[priority];
    return {
      type: 'ANNOUNCEMENT',
      title: prefix ? `${prefix} ${title}` : title,
      body,
      link: `/dashboard/announcements/${id}`,
      data: { announcementId: id, priority },
      tag: `announcement-${id}`,
      urgency: PUSH_URGENCY[priority] ?? 'normal',
    };
  };
};

const shortTitle = (title) => {
  const text = String(title ?? '');
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};

/**
 * Finishes the publication of an announcement whose status just became PUBLISHED (atomically):
 * snapshots the recipients, records "announcement.publish" and notifies the recipients (except the
 * author) with an ANNOUNCEMENT notification + push. The notifications are sent in the background
 * (background: true, HTTP requests) or awaited (scheduler).
 * @returns {Promise<number>} the number of recipients
 */
const completePublication = async (announcement, { req = null, trigger = 'manual', background = true } = {}) => {
  const recipientIds = await audienceService.resolveAudienceUserIds(announcement.audience);
  announcement.recipients = recipientIds.length;
  await Announcement.updateOne({ _id: announcement._id }, { $set: { recipients: recipientIds.length } });

  await auditService.record(req, {
    action: 'announcement.publish',
    targetType: 'Announcement',
    targetId: announcement._id,
    summary: `Published announcement "${shortTitle(announcement.title)}" to ${recipientIds.length} recipient(s)`,
    metadata: {
      trigger,
      priority: announcement.priority,
      recipients: recipientIds.length,
      audience: audienceIds(announcement.audience),
      ...(trigger === 'scheduler' ? { author: idOf(announcement.author), publishAt: announcement.publishAt } : {}),
    },
  });

  // The author does not get a notification about their own announcement.
  const notified = recipientIds.filter((id) => !sameId(id, announcement.author));
  if (notified.length > 0) {
    const build = notificationBuilder(announcement);
    if (background) notifyUsersInBackground(notified, build);
    else await notifyUsers(notified, build);
  }
  return recipientIds.length;
};

/**
 * DRAFT / SCHEDULED → PUBLISHED now, claimed atomically (409 INVALID_STATE when it is already published,
 * e.g. by the scheduler at the same time). Returns the updated document (not populated).
 */
const publishNow = async (announcement, { req = null } = {}) => {
  const claimed = await Announcement.findOneAndUpdate(
    { _id: announcement._id, status: { $in: ['DRAFT', 'SCHEDULED'] } },
    { $set: { status: 'PUBLISHED', publishedAt: new Date(), publishAt: null } },
    { returnDocument: 'after' }
  );
  if (!claimed) throw invalidState('This announcement is already published');
  await completePublication(claimed, { req, trigger: 'manual', background: true });
  return claimed;
};

/**
 * Scheduler job: publishes the SCHEDULED announcements whose publishAt is due. Each one is claimed with
 * findOneAndUpdate, so two backend instances never publish (and notify) the same announcement twice.
 * @returns {Promise<number>} how many were published
 */
const publishDueAnnouncements = async () => {
  let published = 0;
  for (let i = 0; i < MAX_PUBLISH_PER_RUN; i += 1) {
    const now = new Date();
    const claimed = await Announcement.findOneAndUpdate(
      { status: 'SCHEDULED', publishAt: { $lte: now } },
      { $set: { status: 'PUBLISHED', publishedAt: now } },
      { sort: { publishAt: 1, _id: 1 }, returnDocument: 'after' }
    );
    if (!claimed) break;
    published += 1;
    try {
      await completePublication(claimed, { trigger: 'scheduler', background: false });
    } catch (error) {
      console.error(`[announcements] Could not finish publishing ${claimed._id}:`, error.message);
    }
  }
  if (published > 0) console.log(`[announcements] Published ${published} scheduled announcement(s).`);
  return published;
};

const publishJob = scheduler.registerJob(
  'announcements.publish-due',
  scheduler.defaultIntervalMs(),
  publishDueAnnouncements
);

// ---------- Deletion ----------

// Deletes the announcement, its reads, its files and the notifications pointing to it.
const deleteAnnouncement = async (announcement) => {
  const id = announcement._id;
  await Announcement.deleteOne({ _id: id });
  await AnnouncementRead.deleteMany({ announcement: id });
  await Notification.deleteMany({ type: 'ANNOUNCEMENT', 'data.announcementId': String(id) });
  await removeFiles((announcement.attachments ?? []).map((file) => file.key));
};

// Removes stored files, logging (not throwing) failures.
const removeFiles = async (keys) => {
  await Promise.all(
    keys.map((key) =>
      storageService.remove(key).catch((error) => {
        console.error(`[announcements] Could not delete file ${key}:`, error.message);
      })
    )
  );
};

module.exports = {
  ANNOUNCEMENT_POPULATE,
  isAdmin,
  isAuthor,
  canManage,
  canView,
  isRecipient,
  feedFilter,
  taughtGroupIds,
  assertAudienceAllowed,
  audienceIds,
  sameAudience,
  buildStats,
  statsFor,
  detailedStats,
  markRead,
  notificationBuilder,
  completePublication,
  publishNow,
  publishDueAnnouncements,
  publishJob,
  deleteAnnouncement,
  removeFiles,
  shortTitle,
  forbidden,
  invalidState,
};
