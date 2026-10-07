const mongoose = require('mongoose');
const Announcement = require('../models/announcementModel');
const AnnouncementRead = require('../models/announcementReadModel');
const HttpError = require('../utils/httpError');
const {
  assertObjectId,
  notFound,
  parsePagination,
  parseBooleanQuery,
  throwIfInvalid,
  validationError,
  readString,
  readEnum,
  readDate,
  readObjectIdList,
} = require('../utils/validation');
const audienceService = require('../service/audienceService');
const auditService = require('../service/auditService');
const storageService = require('../service/storageService');
const announcements = require('../service/announcementService');

/*
 * /api/announcements (Module 7, contract section 7).
 * Recipients: feed, detail, read, attachment download. Management (ADMIN, TEACHER): list with stats,
 * create (JSON or multipart "data" + "attachments"), update, publish, delete, stats, audience preview.
 */

const { PRIORITIES, STATUSES, TITLE_MAX_LENGTH, BODY_MAX_LENGTH, MAX_ATTACHMENTS, ANNOUNCEMENT_POPULATE } =
  Announcement;
const ACTIONS = ['draft', 'publish', 'schedule'];
const ACTION_STATUS = { draft: 'DRAFT', publish: 'PUBLISHED', schedule: 'SCHEDULED' };
const MIN_SCHEDULE_DELAY_MS = 60 * 1000;
const STORAGE_FOLDER = 'announcements';
const emptyAudience = () => ({ roles: [], programs: [], levels: [], groups: [] });

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';

// ---------- Request parsing ----------

// Multipart without a "data" field: text fields as they are, JSON-decoding audience / removeAttachments.
const multipartFields = (fields) => {
  const input = { ...fields };
  ['audience', 'removeAttachments'].forEach((field) => {
    if (typeof input[field] === 'string') {
      try {
        input[field] = JSON.parse(input[field]);
      } catch {
        // Left as a string: the validation reports it.
      }
    }
  });
  return input;
};

// The announcement fields: the JSON body, or the "data" field (JSON) of a multipart body.
const readPayload = (req) => {
  if (req.is('multipart/form-data')) {
    const fields = isPlainObject(req.body) ? { ...req.body } : {};
    if (fields.data === undefined) return multipartFields(fields);
    try {
      const parsed = JSON.parse(fields.data);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // Reported below.
    }
    throw validationError({ data: 'data must be a JSON object' });
  }
  if (req.body === undefined || req.body === null) return {};
  if (!isPlainObject(req.body)) throw validationError({ body: 'The request body must be a JSON object' });
  return req.body;
};

// Plain text with a length limit; line breaks are kept (CRLF normalized to LF).
const readText = (value, field, max, details) => {
  if (value === null) {
    details[field] = `${field} is required`;
    return undefined;
  }
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value;
  return readString(text, field, details, { min: 1, max });
};

/**
 * Validates the fields of a create / update body. Every invalid field is reported at once
 * (400 VALIDATION_ERROR). Returns { values, action, removeAttachments } with only the fields present.
 */
const parseInput = async (input, { create }) => {
  const values = {};
  const details = {};
  const has = (field) => input[field] !== undefined;

  ['title', 'body'].forEach((field) => {
    const max = field === 'title' ? TITLE_MAX_LENGTH : BODY_MAX_LENGTH;
    if (has(field)) values[field] = readText(input[field], field, max, details);
    else if (create) details[field] = `${field} is required`;
  });

  if (has('priority')) values.priority = readEnum(input.priority, PRIORITIES, 'priority', details);

  let action;
  if (has('action') && input.action !== null) {
    action = typeof input.action === 'string' ? input.action.trim().toLowerCase() : '';
    if (!ACTIONS.includes(action)) {
      details.action = `action must be one of ${ACTIONS.join(', ')}`;
      action = undefined;
    }
  }

  if (has('publishAt')) {
    values.publishAt =
      input.publishAt === null || input.publishAt === '' ? null : readDate(input.publishAt, 'publishAt', details);
  }

  if (has('audience')) {
    try {
      values.audience = await audienceService.parseAudience(input.audience);
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== 'VALIDATION_ERROR') throw error;
      Object.assign(details, error.details);
    }
  }

  let removeAttachments = [];
  if (!create && has('removeAttachments') && input.removeAttachments !== null) {
    const ids = readObjectIdList(input.removeAttachments, 'removeAttachments', details, { max: 50 });
    if (ids) removeAttachments = ids.map(String);
  }

  throwIfInvalid(details);
  return { values, action, removeAttachments };
};

// A scheduled announcement needs publishAt ≥ now + 1 min.
const checkSchedule = (publishAt) => {
  if (!publishAt) throwIfInvalid({ publishAt: 'publishAt is required to schedule an announcement' });
  if (publishAt.getTime() < Date.now() + MIN_SCHEDULE_DELAY_MS) {
    throwIfInvalid({ publishAt: 'publishAt must be at least 1 minute in the future' });
  }
};

const samePublishAt = (a, b) => (a ? a.getTime() : null) === (b ? new Date(b).getTime() : null);

// "?priority=HIGH" or "?priority=HIGH,URGENT" (also repeated parameters).
const parseListQuery = (value, allowed, field) => {
  const items = [].concat(value).flatMap((item) => String(item).split(','));
  const result = [...new Set(items.map((item) => item.trim().toUpperCase()).filter(Boolean))];
  if (result.length === 0 || result.some((item) => !allowed.includes(item))) {
    throwIfInvalid({ [field]: `${field} must be one of ${allowed.join(', ')}` });
  }
  return result;
};

// ---------- Files ----------

// Browsers send UTF-8 file names that multer decodes as latin1 ("Ã©" instead of "é"): re-decode them.
const decodeFilename = (name) => {
  const value = String(name ?? '');
  if (!/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('�') ? value : decoded;
};

// Saves the uploaded files (req.files of the upload middleware). On failure nothing is left on disk.
const saveFiles = async (files) => {
  const saved = [];
  try {
    for (const file of files) {
      const stored = await storageService.save({
        buffer: file.buffer,
        originalName: decodeFilename(file.originalname),
        mimeType: String(file.mimetype || 'application/octet-stream').toLowerCase(),
        folder: STORAGE_FOLDER,
      });
      saved.push({ _id: new mongoose.Types.ObjectId(), ...stored });
    }
  } catch (error) {
    await announcements.removeFiles(saved.map((file) => file.key));
    throw error;
  }
  return saved;
};

const tooManyFiles = () =>
  new HttpError(400, 'TOO_MANY_FILES', `At most ${MAX_ATTACHMENTS} file(s) allowed`, { maxCount: MAX_ATTACHMENTS });

// ---------- Loading and serializing ----------

const findAnnouncement = async (id, { populate = true } = {}) => {
  assertObjectId(id);
  const query = Announcement.findById(id);
  if (populate) query.populate(ANNOUNCEMENT_POPULATE);
  const announcement = await query;
  if (!announcement) throw notFound('Announcement');
  return announcement;
};

// Visible to recipients (published), the author and admins; 404 RESOURCE_NOT_FOUND otherwise.
const findVisible = async (req, options) => {
  const announcement = await findAnnouncement(req.params.id, options);
  if (!announcements.canView(req.user, announcement)) throw notFound('Announcement');
  return announcement;
};

// Author or admin. Someone who can only read it gets 403 FORBIDDEN, anyone else 404.
const findManageable = async (req, options) => {
  const announcement = await findAnnouncement(req.params.id, options);
  if (!announcements.canManage(req.user, announcement)) {
    if (announcements.canView(req.user, announcement)) throw announcements.forbidden();
    throw notFound('Announcement');
  }
  return announcement;
};

const toJson = (announcement, extra = {}) => ({ ...announcement.toJSON(), ...extra });

// Management view: each announcement with its stats.
const withStats = async (list) => {
  const stats = await announcements.statsFor(list);
  return list.map((item) => toJson(item, { stats: stats.get(String(item._id)) }));
};

const scheduleSummary = ({ title, publishAt }) =>
  `Scheduled announcement "${announcements.shortTitle(title)}" for ${publishAt.toISOString()}`;

const auditDetails = (announcement) => ({
  title: announcement.title,
  priority: announcement.priority,
  status: announcement.status,
  audience: announcements.audienceIds(announcement.audience),
  attachments: (announcement.attachments ?? []).length,
});

// ---------- Recipient endpoints ----------

// GET /api/announcements?page&limit&unread=true&priority= → { items, total, page, limit, unreadCount }
const listFeed = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const base = announcements.feedFilter(req.user);
  const filter = { ...base };
  if (present(req.query.priority)) {
    filter.priority = { $in: parseListQuery(req.query.priority, PRIORITIES, 'priority') };
  }

  const readIds = await AnnouncementRead.distinct('announcement', { user: req.user._id });
  if (parseBooleanQuery(req.query.unread)) filter._id = { $nin: readIds };

  const [items, total, unreadCount] = await Promise.all([
    Announcement.find(filter)
      .sort({ publishedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate(ANNOUNCEMENT_POPULATE),
    Announcement.countDocuments(filter),
    Announcement.countDocuments({ ...base, _id: { $nin: readIds } }),
  ]);

  const readSet = new Set(readIds.map(String));
  res.status(200).json({
    items: items.map((item) => toJson(item, { read: readSet.has(String(item._id)) })),
    total,
    page,
    limit,
    unreadCount,
  });
};

// GET /api/announcements/:id → announcement (+ read for recipients, + stats for the author / admins)
const getAnnouncement = async (req, res) => {
  const announcement = await findVisible(req);
  const extra = {};
  if (announcements.isRecipient(req.user, announcement)) {
    extra.read = Boolean(await AnnouncementRead.exists({ announcement: announcement._id, user: req.user._id }));
  }
  if (announcements.canManage(req.user, announcement)) {
    extra.stats = (await announcements.statsFor([announcement])).get(String(announcement._id));
  }
  res.status(200).json(toJson(announcement, extra));
};

// POST /api/announcements/:id/read → 204 (idempotent). Only recipients' reads are recorded: the author
// or an admin outside the audience gets 204 without a read being stored.
const markRead = async (req, res) => {
  const announcement = await findVisible(req, { populate: false });
  if (announcements.isRecipient(req.user, announcement)) await announcements.markRead(announcement, req.user);
  res.status(204).end();
};

// GET /api/announcements/:id/attachments/:attachmentId → file (Content-Disposition: attachment)
const downloadAttachment = async (req, res) => {
  assertObjectId(req.params.id);
  assertObjectId(req.params.attachmentId);
  const announcement = await findVisible(req, { populate: false });
  const file = announcement.attachments.id(req.params.attachmentId);
  if (!file) throw notFound('Attachment');
  await storageService.sendFile(res, file.key, { filename: file.filename, mimeType: file.mimeType });
};

// ---------- Management endpoints (ADMIN, TEACHER) ----------

// GET /api/announcements/manage?status&page&limit → own announcements (ADMIN: all) with stats
const listManaged = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = announcements.isAdmin(req.user) ? {} : { author: req.user._id };
  if (present(req.query.status)) filter.status = { $in: parseListQuery(req.query.status, STATUSES, 'status') };

  const [items, total] = await Promise.all([
    Announcement.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate(ANNOUNCEMENT_POPULATE),
    Announcement.countDocuments(filter),
  ]);

  res.status(200).json({ items: await withStats(items), total, page, limit });
};

// POST /api/announcements (JSON, or multipart "data" + "attachments") → 201 announcement with stats
const createAnnouncement = async (req, res) => {
  const { values, action = 'draft' } = await parseInput(readPayload(req), { create: true });
  const status = ACTION_STATUS[action];
  const audience = values.audience ?? emptyAudience();
  let publishAt = values.publishAt ?? null;
  if (status === 'SCHEDULED') checkSchedule(publishAt);
  if (status === 'PUBLISHED') publishAt = null;

  await announcements.assertAudienceAllowed(req.user, audience);

  const files = await saveFiles(req.files ?? []);
  let announcement;
  try {
    announcement = await Announcement.create({
      title: values.title,
      body: values.body,
      priority: values.priority ?? 'NORMAL',
      audience,
      attachments: files,
      author: req.user._id,
      authorSnapshot: { firstname: req.user.firstname, lastname: req.user.lastname, role: req.user.role },
      status,
      publishAt,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
    });
  } catch (error) {
    await announcements.removeFiles(files.map((file) => file.key));
    throw error;
  }

  await auditService.record(req, {
    action: 'announcement.create',
    targetType: 'Announcement',
    targetId: announcement._id,
    summary: `Created announcement "${announcements.shortTitle(announcement.title)}" (${status})`,
    metadata: auditDetails(announcement),
  });
  if (status === 'SCHEDULED') {
    await auditService.record(req, {
      action: 'announcement.schedule',
      targetType: 'Announcement',
      targetId: announcement._id,
      summary: scheduleSummary(announcement),
      metadata: { publishAt },
    });
  }
  if (status === 'PUBLISHED') await announcements.completePublication(announcement, { req });

  await announcement.populate(ANNOUNCEMENT_POPULATE);
  const [json] = await withStats([announcement]);
  res.status(201).json(json);
};

// PATCH /api/announcements/:id — DRAFT / SCHEDULED: any field (+ action, removeAttachments, new attachments);
// PUBLISHED: only title, body and priority (no new notification), anything else → 409 INVALID_STATE.
const updateAnnouncement = async (req, res) => {
  const announcement = await findManageable(req);
  const { values, action, removeAttachments } = await parseInput(readPayload(req), { create: false });
  const uploads = req.files ?? [];

  if (Object.keys(values).length === 0 && !action && removeAttachments.length === 0 && uploads.length === 0) {
    throw new HttpError(400, 'NO_CHANGES', 'No changes provided');
  }

  const previousStatus = announcement.status;
  const audienceChanged =
    values.audience !== undefined && !announcements.sameAudience(values.audience, announcement.audience);
  const publishAtChanged = values.publishAt !== undefined && !samePublishAt(values.publishAt, announcement.publishAt);

  if (previousStatus === 'PUBLISHED') {
    const locked = [];
    if (audienceChanged) locked.push('audience');
    if (action !== undefined) locked.push('action');
    if (publishAtChanged) locked.push('publishAt');
    if (removeAttachments.length > 0 || uploads.length > 0) locked.push('attachments');
    if (locked.length > 0) {
      throw announcements.invalidState('A published announcement can only change its title, body and priority', {
        fields: locked,
      });
    }
  }

  const status = action ? ACTION_STATUS[action] : previousStatus;
  const reschedules = status === 'SCHEDULED' && (action === 'schedule' || values.publishAt !== undefined);
  if (previousStatus !== 'PUBLISHED' && reschedules) {
    checkSchedule(values.publishAt !== undefined ? values.publishAt : announcement.publishAt);
  }

  const unknown = removeAttachments.filter((id) => !announcement.attachments.id(id));
  if (unknown.length > 0) throwIfInvalid({ removeAttachments: 'removeAttachments contains an unknown attachment' });
  const kept = announcement.attachments.filter((file) => !removeAttachments.includes(String(file._id)));
  const removed = announcement.attachments.filter((file) => removeAttachments.includes(String(file._id)));
  if (kept.length + uploads.length > MAX_ATTACHMENTS) throw tooManyFiles();

  const goesLive = status !== previousStatus && (status === 'PUBLISHED' || status === 'SCHEDULED');
  if (!announcements.isAdmin(req.user) && (audienceChanged || goesLive)) {
    await announcements.assertAudienceAllowed(req.user, values.audience ?? announcement.audience);
  }

  // Fields to write.
  const set = {};
  ['title', 'body', 'priority'].forEach((field) => {
    if (values[field] !== undefined && values[field] !== announcement[field]) set[field] = values[field];
  });
  if (previousStatus !== 'PUBLISHED') {
    if (audienceChanged) set.audience = values.audience;
    if (status === 'PUBLISHED') {
      Object.assign(set, { status: 'PUBLISHED', publishedAt: new Date(), publishAt: null });
    } else {
      if (status !== previousStatus) set.status = status;
      if (publishAtChanged) set.publishAt = values.publishAt;
    }
  }

  const files = await saveFiles(uploads);
  if (removed.length > 0 || files.length > 0) {
    set.attachments = [...kept.map((file) => file.toObject()), ...files];
  }

  if (Object.keys(set).length === 0) {
    const [json] = await withStats([announcement]);
    res.status(200).json(json);
    return;
  }

  let updated;
  try {
    // Only if nobody (another request, the scheduler) changed it since it was read.
    updated = await Announcement.findOneAndUpdate(
      { _id: announcement._id, status: previousStatus, updatedAt: announcement.updatedAt },
      { $set: set },
      { returnDocument: 'after', runValidators: true }
    );
  } catch (error) {
    await announcements.removeFiles(files.map((file) => file.key));
    throw error;
  }
  if (!updated) {
    await announcements.removeFiles(files.map((file) => file.key));
    throw announcements.invalidState('This announcement was changed in the meantime: reload it and try again');
  }
  await announcements.removeFiles(removed.map((file) => file.key));

  // Publishing and (re)scheduling have their own audit actions; "announcement.update" lists the other changes.
  const scheduled = updated.status === 'SCHEDULED' && (previousStatus !== 'SCHEDULED' || publishAtChanged);
  const changes = Object.keys(set).filter(
    (field) =>
      !['status', 'publishedAt'].includes(field) &&
      !(field === 'publishAt' && (set.status === 'PUBLISHED' || scheduled))
  );
  if (set.status === 'DRAFT') changes.push('status');
  if (changes.length > 0) {
    await auditService.record(req, {
      action: 'announcement.update',
      targetType: 'Announcement',
      targetId: updated._id,
      summary: `Updated announcement "${announcements.shortTitle(updated.title)}" (${changes.join(', ')})`,
      metadata: {
        changes,
        ...(set.status ? { statusChange: { from: previousStatus, to: set.status } } : {}),
        ...(removed.length > 0 ? { removedAttachments: removed.map((file) => file.filename) } : {}),
        ...(files.length > 0 ? { addedAttachments: files.map((file) => file.filename) } : {}),
        ...auditDetails(updated),
      },
    });
  }
  if (scheduled) {
    await auditService.record(req, {
      action: 'announcement.schedule',
      targetType: 'Announcement',
      targetId: updated._id,
      summary: scheduleSummary(updated),
      metadata: { publishAt: updated.publishAt, previousStatus },
    });
  }
  if (updated.status === 'PUBLISHED' && previousStatus !== 'PUBLISHED') {
    await announcements.completePublication(updated, { req });
  }

  await updated.populate(ANNOUNCEMENT_POPULATE);
  const [json] = await withStats([updated]);
  res.status(200).json(json);
};

// POST /api/announcements/:id/publish → DRAFT / SCHEDULED → PUBLISHED now (else 409 INVALID_STATE)
const publishAnnouncement = async (req, res) => {
  const announcement = await findManageable(req);
  if (announcement.status === 'PUBLISHED') throw announcements.invalidState('This announcement is already published');
  if (!announcements.isAdmin(req.user)) await announcements.assertAudienceAllowed(req.user, announcement.audience);

  const published = await announcements.publishNow(announcement, { req });
  await published.populate(ANNOUNCEMENT_POPULATE);
  const [json] = await withStats([published]);
  res.status(200).json(json);
};

// DELETE /api/announcements/:id → 204 (author or admin); deletes its files and reads
const deleteAnnouncement = async (req, res) => {
  const announcement = await findManageable(req);
  await announcements.deleteAnnouncement(announcement);

  await auditService.record(req, {
    action: 'announcement.delete',
    targetType: 'Announcement',
    targetId: announcement._id,
    summary: `Deleted announcement "${announcements.shortTitle(announcement.title)}"`,
    metadata: auditDetails(announcement),
  });

  res.status(204).end();
};

// GET /api/announcements/:id/stats → { recipients, reads, readRate, readsByDay: [{ date, count }] }
const getStats = async (req, res) => {
  const announcement = await findManageable(req, { populate: false });
  res.status(200).json(await announcements.detailedStats(announcement));
};

// POST /api/announcements/audience-preview { audience } → { recipients } (same teacher restrictions)
const previewAudience = async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const audience = await audienceService.parseAudience(body.audience);
  await announcements.assertAudienceAllowed(req.user, audience);
  res.status(200).json({ recipients: await audienceService.countAudience(audience) });
};

module.exports = {
  listFeed,
  getAnnouncement,
  markRead,
  downloadAttachment,
  listManaged,
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  deleteAnnouncement,
  getStats,
  previewAudience,
};
