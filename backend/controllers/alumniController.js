const AlumniProfile = require('../models/alumniProfileModel');
const MentoringRequest = require('../models/mentoringRequestModel');
const AlumniPost = require('../models/alumniPostModel');
const Program = require('../models/programModel');
const HttpError = require('../utils/httpError');
const {
  assertObjectId,
  parsePagination,
  throwIfInvalid,
  validationError,
  readString,
  readInteger,
  readEnum,
  readObjectId,
  readBoolean,
} = require('../utils/validation');
const time = require('../utils/time');
const auditService = require('../service/auditService');
const alumni = require('../service/alumniService');

/*
 * /api/alumni (Module 6, phase 3 contract section 4). Every route needs a signed-in user (routes/alumni.js); roles are
 * checked there. Business rules live in service/alumniService.js; this file parses requests and writes the audit log.
 */

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const Q_MAX_LENGTH = 100;

// ---------- Request parsing ----------

const readBody = (req) => {
  if (req.body === undefined || req.body === null) return {};
  if (!isPlainObject(req.body)) throw validationError({ body: 'The request body must be a JSON object' });
  return req.body;
};

const oneLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ') : value);

// Optional one-line text: null, undefined or "" → null; whitespace runs become one space.
const readOptionalLine = (value, field, details, max) => {
  if (value === null || value === '') return null;
  const text = readString(oneLine(value), field, details, { min: 0, max });
  return text === undefined ? undefined : text || null;
};

// Required one-line text with length bounds.
const readLine = (value, field, details, { min, max }) => {
  if (value === undefined || value === null) {
    details[field] = `${field} is required`;
    return undefined;
  }
  return readString(oneLine(value), field, details, { min, max });
};

// Plain text with line breaks kept (CRLF normalized to LF), trimmed, with length bounds.
const readText = (value, field, details, { min, max }) => {
  if (value === undefined || value === null) {
    details[field] = `${field} is required`;
    return undefined;
  }
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value;
  return readString(text, field, details, { min, max });
};

// Optional multi-line text: null, undefined or "" → null.
const readOptionalText = (value, field, details, max) => {
  if (value === undefined || value === null || value === '') return null;
  const text = readText(value, field, details, { min: 0, max });
  return text === undefined ? undefined : text || null;
};

// Array of one-line strings (null → []), each `min`..`max` characters, at most `maxItems`, de-duplicated ignoring
// case and diacritics (the first spelling is kept).
const readLabelList = (value, field, details, { maxItems, min, max }) => {
  if (value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    details[field] = `${field} must be an array of strings`;
    return undefined;
  }
  const list = [];
  const keys = new Set();
  for (const raw of value) {
    const label = oneLine(raw).trim();
    if (label.length < min || label.length > max) {
      details[field] = `Each item of ${field} must be ${min} to ${max} characters`;
      return undefined;
    }
    const key = AlumniProfile.normalizeKey(label);
    if (!keys.has(key)) {
      keys.add(key);
      list.push(label);
    }
  }
  if (list.length > maxItems) {
    details[field] = `${field} accepts at most ${maxItems} items`;
    return undefined;
  }
  return list;
};

/**
 * https:// URL (no credentials, at most `max` characters), normalized by the URL parser; null / "" → null.
 * `hosts`: allowed host names (subdomains included), e.g. ['linkedin.com'].
 */
const readHttpsUrl = (value, field, details, { max, hosts = null }) => {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    details[field] = `${field} must be a string`;
    return undefined;
  }
  const text = value.trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    details[field] = `${field} must be an https:// URL`;
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (hosts && !hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    details[field] = `${field} must be a ${hosts.join(' or ')} URL`;
    return undefined;
  }
  const normalized = url.href;
  if (normalized.length > max) {
    details[field] = `${field} must be at most ${max} characters`;
    return undefined;
  }
  return normalized;
};

const maxPromotion = () => time.getZonedParts(new Date()).year + 1;

const readPromotion = (value, details) => {
  if (value === null || value === '') return null;
  return readInteger(value, 'promotion', details, { min: AlumniProfile.PROMOTION_MIN, max: maxPromotion() });
};

// An existing Program id, or null.
const readProgram = async (value, details) => {
  if (value === null || value === '') return null;
  const id = readObjectId(value, 'program', details);
  if (!id) return undefined;
  if (!(await Program.exists({ _id: id }))) {
    details.program = 'program does not exist';
    return undefined;
  }
  return id;
};

// Fields of PUT /me (only those present; unknown fields such as user, consentAt or updatedAt are ignored).
const parseProfileInput = async (input) => {
  const values = {};
  const details = {};
  const has = (field) => input[field] !== undefined;
  const M = AlumniProfile;

  if (has('program')) values.program = await readProgram(input.program, details);
  if (has('promotion')) values.promotion = readPromotion(input.promotion, details);
  if (has('headline')) values.headline = readOptionalLine(input.headline, 'headline', details, M.HEADLINE_MAX_LENGTH);
  if (has('bio')) values.bio = readOptionalText(input.bio, 'bio', details, M.BIO_MAX_LENGTH);
  if (has('skills')) {
    values.skills = readLabelList(input.skills, 'skills', details, { maxItems: M.MAX_SKILLS, min: 1, max: M.SKILL_MAX_LENGTH });
  }
  if (has('company')) values.company = readOptionalLine(input.company, 'company', details, M.COMPANY_MAX_LENGTH);
  if (has('jobTitle')) values.jobTitle = readOptionalLine(input.jobTitle, 'jobTitle', details, M.JOB_TITLE_MAX_LENGTH);
  if (has('sector')) values.sector = readOptionalLine(input.sector, 'sector', details, M.SECTOR_MAX_LENGTH);
  if (has('city')) values.city = readOptionalLine(input.city, 'city', details, M.CITY_MAX_LENGTH);
  if (has('linkedinUrl')) {
    values.linkedinUrl = readHttpsUrl(input.linkedinUrl, 'linkedinUrl', details, {
      max: M.LINKEDIN_URL_MAX_LENGTH,
      hosts: ['linkedin.com'],
    });
  }
  if (has('mentoringAvailable')) values.mentoringAvailable = readBoolean(input.mentoringAvailable, 'mentoringAvailable', details);
  if (has('mentoringTopics')) {
    values.mentoringTopics = readLabelList(input.mentoringTopics, 'mentoringTopics', details, {
      maxItems: M.MAX_MENTORING_TOPICS,
      min: M.MENTORING_TOPIC_MIN_LENGTH,
      max: M.MENTORING_TOPIC_MAX_LENGTH,
    });
  }
  if (has('visibility')) values.visibility = readEnum(input.visibility, M.VISIBILITIES, 'visibility', details);
  if (has('consent')) values.consent = readBoolean(input.consent, 'consent', details);

  throwIfInvalid(details);
  return values;
};

// Single query-string value (repeated parameters are refused), trimmed; undefined when absent or empty.
const queryValue = (value, field, details, { max = 100 } = {}) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    details[field] = `${field} must be a single value`;
    return undefined;
  }
  const text = value.trim();
  if (text.length > max) {
    details[field] = `${field} must be at most ${max} characters`;
    return undefined;
  }
  return text || undefined;
};

// "true" / "false" (also 1 / 0); undefined when absent.
const queryBoolean = (value, field, details) => {
  const text = queryValue(value, field, details);
  if (text === undefined) return undefined;
  const lower = text.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  details[field] = `${field} must be true or false`;
  return undefined;
};

// ---------- Profiles ----------

// GET /api/alumni/me (ALUMNI) → AlumniProfile (`id: null` until the profile is saved once)
const getMyProfile = async (req, res) => {
  res.status(200).json(await alumni.getMyProfile(req.user));
};

// PUT /api/alumni/me (ALUMNI) { program, promotion, headline, bio, skills, company, jobTitle, sector, city,
// linkedinUrl, mentoringAvailable, mentoringTopics, visibility, consent } → 200 AlumniProfile
const updateMyProfile = async (req, res) => {
  const values = await parseProfileInput(readBody(req));
  if (Object.keys(values).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No changes provided');
  res.status(200).json(await alumni.updateMyProfile(req.user, values));
};

// GET /api/alumni?q&program&promotion&sector&skill&mentoring&sort&page&limit → { items, total, page, limit }
const listDirectory = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const q = queryValue(req.query.q, 'q', details, { max: Q_MAX_LENGTH });
  const programValue = queryValue(req.query.program, 'program', details);
  const program = programValue ? readObjectId(programValue, 'program', details) : undefined;
  const promotionValue = queryValue(req.query.promotion, 'promotion', details);
  const promotion = promotionValue
    ? readInteger(promotionValue, 'promotion', details, { min: AlumniProfile.PROMOTION_MIN, max: maxPromotion() })
    : undefined;
  const sector = queryValue(req.query.sector, 'sector', details, { max: AlumniProfile.SECTOR_MAX_LENGTH });
  const skill = queryValue(req.query.skill, 'skill', details, { max: AlumniProfile.SKILL_MAX_LENGTH });
  const mentoring = queryBoolean(req.query.mentoring, 'mentoring', details);
  const sortValue = queryValue(req.query.sort, 'sort', details);
  const sort = sortValue ? readEnum(sortValue.toLowerCase(), alumni.SORTS, 'sort', details, { upper: false }) : undefined;
  throwIfInvalid(details);

  const { items, total } = await alumni.listDirectory(req.user, {
    q,
    program,
    promotion,
    sector,
    skill,
    mentoring,
    sort,
    skip,
    limit,
  });
  res.status(200).json({ items, total, page, limit });
};

// GET /api/alumni/facets → { total, mentoringAvailable, programs, promotions, sectors, skills } of the directory
const getFacets = async (req, res) => {
  res.status(200).json(await alumni.directoryFacets());
};

// GET /api/alumni/:id (profile id or the alumni's user id) → AlumniProfile + myRequest
const getProfile = async (req, res) => {
  assertObjectId(req.params.id);
  res.status(200).json(await alumni.getProfile(req.user, req.params.id));
};

// ADMIN GET /api/alumni/admin/profiles?q&visibility&mentoring&page&limit → { items: [AlumniProfile + listed], ... }
const adminListProfiles = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const q = queryValue(req.query.q, 'q', details, { max: Q_MAX_LENGTH });
  const visibilityValue = queryValue(req.query.visibility, 'visibility', details);
  const visibility = visibilityValue
    ? readEnum(visibilityValue, AlumniProfile.VISIBILITIES, 'visibility', details)
    : undefined;
  const mentoring = queryBoolean(req.query.mentoring, 'mentoring', details);
  throwIfInvalid(details);
  const { items, total } = await alumni.adminListProfiles({ q, visibility, mentoring, skip, limit });
  res.status(200).json({ items, total, page, limit });
};

// ---------- GDPR ----------

// GET /api/alumni/me/export (ALUMNI) → JSON file of everything this module stores about the caller. Audited.
const exportMyData = async (req, res) => {
  const { data, counts } = await alumni.exportMyData(req.user);
  await auditService.record(req, {
    action: 'alumni.export',
    targetType: 'User',
    targetId: req.user._id,
    summary: `Exported own alumni data (${counts.profile ? 'profile' : 'no profile'}, ${counts.posts} posts, ${
      counts.asMentor + counts.asMentee
    } mentoring requests)`,
    metadata: counts,
  });
  const date = time.formatLocalDate(new Date());
  res.set('Cache-Control', 'no-store');
  res.set('Content-Disposition', `attachment; filename="campuslink-alumni-data-${date}.json"`);
  res.status(200).json(data);
};

// DELETE /api/alumni/me (ALUMNI) → 204: profile and posts deleted, mentoring history anonymized. Audited.
const eraseMyData = async (req, res) => {
  const result = await alumni.eraseUserData(req.user._id);
  await auditService.record(req, {
    action: 'alumni.erase',
    targetType: 'User',
    targetId: req.user._id,
    summary: `Erased own alumni data (${result.profile ? 'profile' : 'no profile'}, ${result.posts} posts deleted, ${
      result.mentoringAsMentor + result.mentoringAsMentee
    } mentoring requests anonymized)`,
    metadata: result,
  });
  res.status(204).end();
};

// ---------- Mentoring ----------

// POST /api/alumni/:id/mentoring (STUDENT) { topic, message } → 201 MentoringRequest
const createMentoringRequest = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const topic = readLine(input.topic, 'topic', details, {
    min: MentoringRequest.TOPIC_MIN_LENGTH,
    max: MentoringRequest.TOPIC_MAX_LENGTH,
  });
  const message = readText(input.message, 'message', details, {
    min: MentoringRequest.MESSAGE_MIN_LENGTH,
    max: MentoringRequest.MESSAGE_MAX_LENGTH,
  });
  throwIfInvalid(details);
  res.status(201).json(await alumni.createMentoringRequest(req.user, req.params.id, { topic, message }));
};

// GET /api/alumni/mentoring?role=mentor|mentee&status=PENDING[,ACCEPTED]&page&limit
// → { items, total, page, limit, role, pendingCount }
const listMentoring = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const roleValue = queryValue(req.query.role, 'role', details);
  const role = roleValue ? readEnum(roleValue.toLowerCase(), ['mentor', 'mentee'], 'role', details, { upper: false }) : undefined;
  const statusValue = queryValue(req.query.status, 'status', details);
  let statuses;
  if (statusValue) {
    statuses = [];
    for (const item of statusValue.split(',')) {
      const status = readEnum(item, MentoringRequest.STATUSES, 'status', details);
      if (status === undefined) break;
      if (!statuses.includes(status)) statuses.push(status);
    }
  }
  throwIfInvalid(details);
  const result = await alumni.listMentoring(req.user, { role, statuses, skip, limit });
  res.status(200).json({ items: result.items, total: result.total, page, limit, role: result.role, pendingCount: result.pendingCount });
};

// GET /api/alumni/mentoring/:id → MentoringRequest (participants, ADMIN)
const getMentoringRequest = async (req, res) => {
  assertObjectId(req.params.id);
  res.status(200).json(await alumni.getMentoringRequest(req.user, req.params.id));
};

const readReply = (req) => {
  const input = readBody(req);
  const details = {};
  const reply = readOptionalText(input.reply, 'reply', details, MentoringRequest.REPLY_MAX_LENGTH);
  throwIfInvalid(details);
  return reply;
};

// POST /api/alumni/mentoring/:id/accept | decline (mentor) { reply? } → 200 MentoringRequest
const respond = (decision) => async (req, res) => {
  assertObjectId(req.params.id);
  const reply = readReply(req);
  res.status(200).json(await alumni.respondToRequest(req.user, req.params.id, decision, reply));
};

// POST /api/alumni/mentoring/:id/close (mentor or mentee) → 200 MentoringRequest
const closeRequest = async (req, res) => {
  assertObjectId(req.params.id);
  res.status(200).json(await alumni.closeRequest(req.user, req.params.id));
};

// ---------- News wall ----------

// GET /api/alumni/posts?type&author&hidden&page&limit → { items, total, page, limit }
const listPosts = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const typeValue = queryValue(req.query.type, 'type', details);
  const type = typeValue ? readEnum(typeValue, AlumniPost.TYPES, 'type', details) : undefined;
  const authorValue = queryValue(req.query.author, 'author', details);
  let author;
  if (authorValue) author = authorValue === 'me' ? req.user._id : readObjectId(authorValue, 'author', details);
  const hidden = queryBoolean(req.query.hidden, 'hidden', details);
  throwIfInvalid(details);
  const { items, total } = await alumni.listPosts(req.user, { type, author, hidden, skip, limit });
  res.status(200).json({ items, total, page, limit });
};

// POST /api/alumni/posts (ALUMNI) { type, body, link? } → 201 AlumniPost
const createPost = async (req, res) => {
  const input = readBody(req);
  const details = {};
  let type;
  if (input.type === undefined || input.type === null) details.type = 'type is required';
  else type = readEnum(input.type, AlumniPost.TYPES, 'type', details);
  const body = readText(input.body, 'body', details, { min: AlumniPost.BODY_MIN_LENGTH, max: AlumniPost.BODY_MAX_LENGTH });
  const link = input.link === undefined ? null : readHttpsUrl(input.link, 'link', details, { max: AlumniPost.LINK_MAX_LENGTH });
  throwIfInvalid(details);
  res.status(201).json(await alumni.createPost(req.user, { type, body, link }));
};

const authorName = (post) => {
  const source = post.author && typeof post.author === 'object' && post.author.firstname !== undefined ? post.author : post.authorSnapshot;
  return `${source?.firstname ?? ''} ${source?.lastname ?? ''}`.trim() || 'a deleted account';
};

// DELETE /api/alumni/posts/:id (author or ADMIN) → 204. Audited when an ADMIN deletes someone else's post.
const deletePost = async (req, res) => {
  assertObjectId(req.params.id);
  const { post, byAdmin } = await alumni.deletePost(req.user, req.params.id);
  if (byAdmin) {
    await auditService.record(req, {
      action: 'alumni.post.delete',
      targetType: 'AlumniPost',
      targetId: post._id,
      summary: `Deleted an alumni post by ${authorName(post)}: "${alumni.excerpt(post.body, 80)}"`,
      metadata: { authorId: String(post.author), type: post.type, hidden: Boolean(post.hidden) },
    });
  }
  res.status(204).end();
};

// ADMIN POST /api/alumni/posts/:id/hide { reason? } | unhide → 200 AlumniPost (idempotent, audited once)
const setHidden = (hidden) => async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const reason = hidden ? readOptionalText(input.reason, 'reason', details, AlumniPost.HIDDEN_REASON_MAX_LENGTH) : null;
  throwIfInvalid(details);
  const { post, doc, changed } = await alumni.setPostHidden(req.user, req.params.id, hidden, reason);
  if (changed) {
    await auditService.record(req, {
      action: hidden ? 'alumni.post.hide' : 'alumni.post.unhide',
      targetType: 'AlumniPost',
      targetId: doc._id,
      summary: `${hidden ? 'Hid' : 'Unhid'} an alumni post by ${authorName(doc)}: "${alumni.excerpt(doc.body, 80)}"`,
      metadata: { authorId: String(doc.author?._id ?? doc.author), type: doc.type, ...(reason ? { reason } : {}) },
    });
  }
  res.status(200).json(post);
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  listDirectory,
  getFacets,
  getProfile,
  adminListProfiles,
  exportMyData,
  eraseMyData,
  createMentoringRequest,
  listMentoring,
  getMentoringRequest,
  acceptRequest: respond('accept'),
  declineRequest: respond('decline'),
  closeRequest,
  listPosts,
  createPost,
  deletePost,
  hidePost: setHidden(true),
  unhidePost: setHidden(false),
};
