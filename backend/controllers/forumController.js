const ForumQuestion = require('../models/forumQuestionModel');
const ForumAnswer = require('../models/forumAnswerModel');
const ForumReport = require('../models/forumReportModel');
const Subject = require('../models/subjectModel');
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
} = require('../utils/validation');
const auditService = require('../service/auditService');
const forum = require('../service/forumService');

/*
 * /api/forum (Module 4, phase 2 contract section 2). Every route needs a signed-in user (routes/forum.js);
 * moderation routes are for ADMINs. Business rules live in service/forumService.js.
 */

const {
  STATUSES,
  TITLE_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  BODY_MIN_LENGTH,
  BODY_MAX_LENGTH,
  CHAPTER_MAX_LENGTH,
  MAX_TAGS,
  TAG_MIN_LENGTH,
  TAG_MAX_LENGTH,
  TAG_PATTERN,
  MIN_LEVEL,
  MAX_LEVEL,
  HIDDEN_REASON_MAX_LENGTH,
} = ForumQuestion;
const SORTS = ['recent', 'votes', 'unanswered', 'activity', 'relevance'];
const Q_MAX_LENGTH = 200;
const LEADERBOARD_DEFAULT = 10;
const LEADERBOARD_MAX = 50;
const TAGS_DEFAULT = 20;
const TAGS_MAX = 50;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---------- Request parsing ----------

const readBody = (req) => {
  if (req.body === undefined || req.body === null) return {};
  if (!isPlainObject(req.body)) throw validationError({ body: 'The request body must be a JSON object' });
  return req.body;
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

// Titles are one line: any whitespace run becomes one space.
const readTitle = (value, details) =>
  readText(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, 'title', details, {
    min: TITLE_MIN_LENGTH,
    max: TITLE_MAX_LENGTH,
  });

// Up to 5 tags, lowercased, spaces turned into "-", 2 to 30 characters, de-duplicated.
const readTags = (value, details) => {
  if (value === null) return [];
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    details.tags = 'tags must be an array of strings';
    return undefined;
  }
  if (value.length > MAX_TAGS) {
    details.tags = `tags accepts at most ${MAX_TAGS} items`;
    return undefined;
  }
  const tags = [];
  for (const raw of value) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (tag.length < TAG_MIN_LENGTH || tag.length > TAG_MAX_LENGTH) {
      details.tags = `Each tag must be ${TAG_MIN_LENGTH} to ${TAG_MAX_LENGTH} characters`;
      return undefined;
    }
    if (!TAG_PATTERN.test(tag)) {
      details.tags = 'Tags may only contain letters, digits and + # . _ -';
      return undefined;
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
};

const readLevel = (value, details) => {
  if (value === null || value === '') return null;
  return readInteger(value, 'level', details, { min: MIN_LEVEL, max: MAX_LEVEL });
};

const readChapter = (value, details) => {
  if (value === null) return null;
  const chapter = readString(value, 'chapter', details, { min: 0, max: CHAPTER_MAX_LENGTH });
  return chapter === '' ? null : chapter;
};

// An existing Subject id (400 VALIDATION_ERROR otherwise).
const readSubject = async (value, details) => {
  const id = readObjectId(value, 'subject', details);
  if (!id) return undefined;
  if (!(await Subject.exists({ _id: id }))) {
    details.subject = 'subject does not exist';
    return undefined;
  }
  return id;
};

// Optional short text (reason of a hide, note of a resolution): null when absent or empty.
const readOptionalText = (value, field, details, max) => {
  if (value === undefined || value === null) return null;
  const text = readString(value, field, details, { min: 0, max });
  return text ? text : null;
};

/**
 * Question fields of a create / update body (every invalid field reported at once, 400 VALIDATION_ERROR).
 * Only the fields present are returned.
 */
const parseQuestionInput = async (input, { create }) => {
  const values = {};
  const details = {};
  const has = (field) => input[field] !== undefined;

  if (has('title')) values.title = readTitle(input.title, details);
  else if (create) details.title = 'title is required';
  if (has('body')) values.body = readText(input.body, 'body', details, { min: BODY_MIN_LENGTH, max: BODY_MAX_LENGTH });
  else if (create) details.body = 'body is required';
  if (has('subject')) values.subject = await readSubject(input.subject, details);
  else if (create) details.subject = 'subject is required';
  if (has('chapter')) values.chapter = readChapter(input.chapter, details);
  if (has('level')) values.level = readLevel(input.level, details);
  if (has('tags')) values.tags = readTags(input.tags, details);
  if (!create && has('status')) values.status = readEnum(input.status, STATUSES, 'status', details);

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

const readVoteValue = (body) => {
  const { value } = body;
  if (value !== 1 && value !== -1) throw validationError({ value: 'value must be 1 or -1' });
  return value;
};

const readReason = (body) => {
  const details = {};
  const reason = readText(body.reason, 'reason', details, {
    min: ForumReport.REASON_MIN_LENGTH,
    max: ForumReport.REASON_MAX_LENGTH,
  });
  throwIfInvalid(details);
  return reason;
};

const readLimit = (value, fallback, max) => {
  if (value === undefined) return fallback;
  const details = {};
  const limit = readInteger(value, 'limit', details, { min: 1, max });
  throwIfInvalid(details);
  return limit;
};

// ---------- Audit ----------

const shortTitle = (title) => forum.excerpt(title, 80);

const auditModeration = (req, action, targetType, target, question, extra = {}) => {
  const isQuestion = targetType === 'QUESTION';
  const verbs = { 'forum.hide': 'Hid', 'forum.unhide': 'Unhid', 'forum.delete': 'Deleted' };
  const what = isQuestion ? `question "${shortTitle(question.title)}"` : `an answer to "${shortTitle(question.title)}"`;
  return auditService.record(req, {
    action,
    targetType: isQuestion ? 'ForumQuestion' : 'ForumAnswer',
    targetId: target._id,
    summary: `${verbs[action]} ${what}`,
    metadata: { questionId: String(question._id), authorId: String(target.author), ...extra },
  });
};

// ---------- Questions ----------

// GET /api/forum/questions?q&subject&level&tag&status&sort&page&limit → { items, total, page, limit }
const listQuestions = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const q = queryValue(req.query.q, 'q', details, { max: Q_MAX_LENGTH });
  const subjectValue = queryValue(req.query.subject, 'subject', details);
  const subject = subjectValue ? readObjectId(subjectValue, 'subject', details) : undefined;
  const levelValue = queryValue(req.query.level, 'level', details);
  const level = levelValue ? readInteger(levelValue, 'level', details, { min: MIN_LEVEL, max: MAX_LEVEL }) : undefined;
  const tagValue = queryValue(req.query.tag, 'tag', details, { max: TAG_MAX_LENGTH });
  const tag = tagValue ? tagValue.toLowerCase() : undefined;
  const statusValue = queryValue(req.query.status, 'status', details);
  const status = statusValue ? readEnum(statusValue, STATUSES, 'status', details) : undefined;
  const sortValue = queryValue(req.query.sort, 'sort', details);
  const sort = sortValue ? readEnum(sortValue.toLowerCase(), SORTS, 'sort', details, { upper: false }) : undefined;
  throwIfInvalid(details);

  const { items, total } = await forum.listQuestions(req.user, { q, subject, level, tag, status, sort, skip, limit });
  res.status(200).json({ items, total, page, limit });
};

// GET /api/forum/questions/similar?title= → up to 5 [{ id, title, answerCount, hasAcceptedAnswer }]
const similarQuestions = async (req, res) => {
  const details = {};
  const title = queryValue(req.query.title, 'title', details, { max: TITLE_MAX_LENGTH });
  throwIfInvalid(details);
  res.status(200).json(title ? await forum.similarQuestions(req.user, title) : []);
};

// GET /api/forum/tags?subject&limit → [{ tag, count }] (most used first)
const listTags = async (req, res) => {
  const details = {};
  const subjectValue = queryValue(req.query.subject, 'subject', details);
  const subject = subjectValue ? readObjectId(subjectValue, 'subject', details) : undefined;
  throwIfInvalid(details);
  const limit = readLimit(req.query.limit, TAGS_DEFAULT, TAGS_MAX);
  res.status(200).json(await forum.popularTags(req.user, { subject, limit }));
};

// POST /api/forum/questions { title, body, subject, chapter?, level?, tags? } → 201 Question
const createQuestion = async (req, res) => {
  const values = await parseQuestionInput(readBody(req), { create: true });
  res.status(201).json(await forum.createQuestion(req.user, values));
};

// GET /api/forum/questions/:id → { question, answers } (counts the view once per user and day)
const getQuestion = async (req, res) => {
  assertObjectId(req.params.id);
  res.status(200).json(await forum.getQuestion(req.user, req.params.id));
};

// PATCH /api/forum/questions/:id → 200 Question (content: author; status: author or ADMIN)
const updateQuestion = async (req, res) => {
  assertObjectId(req.params.id);
  const values = await parseQuestionInput(readBody(req), { create: false });
  if (Object.keys(values).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No changes provided');
  const { question } = await forum.updateQuestion(req.user, req.params.id, values);
  res.status(200).json(question);
};

// DELETE /api/forum/questions/:id → 204 (author or ADMIN, only without answers)
const deleteQuestion = async (req, res) => {
  assertObjectId(req.params.id);
  const deleted = await forum.deleteQuestion(req.user, req.params.id);
  await auditModeration(req, 'forum.delete', 'QUESTION', deleted, deleted, {
    byAuthor: String(deleted.author) === String(req.user._id),
  });
  res.status(204).end();
};

// ---------- Answers ----------

// POST /api/forum/questions/:id/answers { body, clientRequestId? } → 201 Answer, or 200 with the first answer
// when the same author replays the same clientRequestId.
const createAnswer = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const body = readText(input.body, 'body', details, {
    min: ForumAnswer.BODY_MIN_LENGTH,
    max: ForumAnswer.BODY_MAX_LENGTH,
  });
  let clientRequestId;
  if (input.clientRequestId !== undefined && input.clientRequestId !== null) {
    const value = typeof input.clientRequestId === 'string' ? input.clientRequestId.trim().toLowerCase() : null;
    if (!value || !ForumAnswer.CLIENT_REQUEST_ID_PATTERN.test(value)) {
      details.clientRequestId = 'clientRequestId must be a UUID';
    } else {
      clientRequestId = value;
    }
  }
  throwIfInvalid(details);

  const { answer, created } = await forum.createAnswer(req.user, req.params.id, { body, clientRequestId });
  res.status(created ? 201 : 200).json(answer);
};

// PATCH /api/forum/answers/:id { body } → 200 Answer (author only)
const updateAnswer = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  if (input.body === undefined) throw new HttpError(400, 'NO_CHANGES', 'No changes provided');
  const details = {};
  const body = readText(input.body, 'body', details, {
    min: ForumAnswer.BODY_MIN_LENGTH,
    max: ForumAnswer.BODY_MAX_LENGTH,
  });
  throwIfInvalid(details);
  res.status(200).json(await forum.updateAnswer(req.user, req.params.id, { body }));
};

// DELETE /api/forum/answers/:id → 204 (author or ADMIN, unless accepted)
const deleteAnswer = async (req, res) => {
  assertObjectId(req.params.id);
  const { answer, question } = await forum.deleteAnswer(req.user, req.params.id);
  await auditModeration(req, 'forum.delete', 'ANSWER', answer, question, {
    byAuthor: String(answer.author) === String(req.user._id),
  });
  res.status(204).end();
};

// POST /api/forum/questions/:id/accept { answerId } (answerId null removes the acceptance) → { question, answers }
const acceptAnswer = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  let answerId = null;
  if (input.answerId === undefined) throw validationError({ answerId: 'answerId is required' });
  if (input.answerId !== null) {
    const details = {};
    answerId = readObjectId(input.answerId, 'answerId', details);
    throwIfInvalid(details);
  }
  res.status(200).json(await forum.acceptAnswer(req.user, req.params.id, answerId));
};

// ---------- Votes, follow ----------

// POST /api/forum/{questions|answers}/:id/vote { value: 1 | -1 } → { score, myVote }
const voteOn = (targetType) => async (req, res) => {
  assertObjectId(req.params.id);
  const value = readVoteValue(readBody(req));
  res.status(200).json(await forum.castVote(req.user, targetType, req.params.id, value));
};

// POST / DELETE /api/forum/questions/:id/follow → { following }
const followQuestion = async (req, res) => {
  assertObjectId(req.params.id);
  res.status(200).json(await forum.followQuestion(req.user, req.params.id));
};

const unfollowQuestion = async (req, res) => {
  assertObjectId(req.params.id);
  res.status(200).json(await forum.unfollowQuestion(req.user, req.params.id));
};

// ---------- Moderation ----------

// POST /api/forum/{questions|answers}/:id/report { reason } → 201 report (200 with the open report of the same user)
const reportOn = (targetType) => async (req, res) => {
  assertObjectId(req.params.id);
  const reason = readReason(readBody(req));
  const { report, created } = await forum.reportContent(req.user, targetType, req.params.id, reason);
  res.status(created ? 201 : 200).json(report);
};

// ADMIN POST /api/forum/{questions|answers}/:id/hide { reason? } | unhide → 200 Question / Answer
const setHidden = (targetType, hidden) => async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const reason = hidden ? readOptionalText(input.reason, 'reason', details, HIDDEN_REASON_MAX_LENGTH) : null;
  throwIfInvalid(details);

  const result = await forum.setHidden(req.user, targetType, req.params.id, hidden, reason);
  if (result.changed) {
    await auditModeration(req, hidden ? 'forum.hide' : 'forum.unhide', targetType, result.target, result.question, {
      ...(reason ? { reason } : {}),
    });
  }
  res.status(200).json(result.content);
};

// ADMIN GET /api/forum/reports?status&page&limit → { items, total, page, limit, openCount }
const listReports = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const statusValue = queryValue(req.query.status, 'status', details);
  const status = statusValue ? readEnum(statusValue, ForumReport.STATUSES, 'status', details) : undefined;
  throwIfInvalid(details);
  const { items, total, openCount } = await forum.listReports({ status, skip, limit });
  res.status(200).json({ items, total, page, limit, openCount });
};

// ADMIN POST /api/forum/reports/:id/resolve { note? } → 200 report (409 INVALID_STATE when already resolved)
const resolveReport = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const note = readOptionalText(input.note, 'note', details, ForumReport.NOTE_MAX_LENGTH);
  throwIfInvalid(details);
  res.status(200).json(await forum.resolveReport(req.user, req.params.id, note));
};

// ---------- Profiles ----------

// GET /api/forum/profiles/me and /profiles/:userId → ForumProfile
const getMyProfile = async (req, res) => {
  res.status(200).json(await forum.getProfile(req.user._id));
};

const getProfile = async (req, res) => {
  assertObjectId(req.params.userId);
  const self = String(req.params.userId) === String(req.user._id);
  res.status(200).json(await forum.getProfile(req.params.userId, { requireActivity: !self }));
};

// GET /api/forum/leaderboard?subject&limit → { academicYear, subject, items: [{ rank, user, reputation, badges }] }
const getLeaderboard = async (req, res) => {
  const details = {};
  const subjectValue = queryValue(req.query.subject, 'subject', details);
  const subject = subjectValue ? readObjectId(subjectValue, 'subject', details) : undefined;
  throwIfInvalid(details);
  const limit = readLimit(req.query.limit, LEADERBOARD_DEFAULT, LEADERBOARD_MAX);
  res.status(200).json(await forum.leaderboard({ subject, limit }));
};

module.exports = {
  listQuestions,
  similarQuestions,
  listTags,
  createQuestion,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  createAnswer,
  updateAnswer,
  deleteAnswer,
  acceptAnswer,
  voteQuestion: voteOn('QUESTION'),
  voteAnswer: voteOn('ANSWER'),
  followQuestion,
  unfollowQuestion,
  reportQuestion: reportOn('QUESTION'),
  reportAnswer: reportOn('ANSWER'),
  hideQuestion: setHidden('QUESTION', true),
  unhideQuestion: setHidden('QUESTION', false),
  hideAnswer: setHidden('ANSWER', true),
  unhideAnswer: setHidden('ANSWER', false),
  listReports,
  resolveReport,
  getMyProfile,
  getProfile,
  getLeaderboard,
};
