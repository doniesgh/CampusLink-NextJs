const mongoose = require('mongoose');
const ForumQuestion = require('../models/forumQuestionModel');
const ForumAnswer = require('../models/forumAnswerModel');
const ForumVote = require('../models/forumVoteModel');
const ForumProfile = require('../models/forumProfileModel');
const ForumFollow = require('../models/forumFollowModel');
const ForumView = require('../models/forumViewModel');
const ForumReport = require('../models/forumReportModel');
const Subject = require('../models/subjectModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const { notFound } = require('../utils/validation');
const { idOf, isPopulated } = require('../utils/serialize');
const { notifyUsersInBackground } = require('./notificationService');
const time = require('../utils/time');

/*
 * Business rules of Module 4 (help forum), phase 2 contract section 2: visibility and moderation, votes,
 * accepted answers, reputation and badges (incremental), follows and FORUM notifications, view counting,
 * idempotent answers (clientRequestId), reports, profiles and leaderboard.
 * HTTP parsing lives in controllers/forumController.js. Functions take the signed-in user (req.user).
 */

const { QUESTION_POPULATE, serializeQuestion, summarizeSubject, summarizeAuthor } = ForumQuestion;
const { ANSWER_POPULATE, serializeAnswer } = ForumAnswer;

// Reputation (contract section 2).
const POINTS = {
  QUESTION_UPVOTE: 5,
  ANSWER_UPVOTE: 10,
  DOWNVOTE: -2,
  ACCEPTED_ANSWER: 15,
  ACCEPTER: 2,
};
// Badge thresholds.
const BADGE_RULES = {
  FIRST_ANSWER: 1, // answers
  ACTIVE_CONTRIBUTOR: 10, // answers
  HELPFUL: 5, // accepted answers
  SUBJECT_EXPERT: 50, // points in one subject
};
const BADGE_LABELS = {
  fr: {
    FIRST_ANSWER: () => 'Première réponse',
    ACTIVE_CONTRIBUTOR: () => 'Contributeur actif',
    HELPFUL: () => 'Aide précieuse',
    SUBJECT_EXPERT: (subject) => (subject ? `Expert en ${subject}` : 'Expert'),
  },
  en: {
    FIRST_ANSWER: () => 'First answer',
    ACTIVE_CONTRIBUTOR: () => 'Active contributor',
    HELPFUL: () => 'Helpful',
    SUBJECT_EXPERT: (subject) => (subject ? `${subject} expert` : 'Subject expert'),
  },
};
// Retries of the optimistic loops (accepted answer, concurrent first votes).
const MAX_RETRIES = 5;
const NOTIFICATION_EXCERPT_LENGTH = 140;
const REPORT_EXCERPT_LENGTH = 200;
const SIMILAR_LIMIT = 5;
const SIMILAR_MAX_WORDS = 12;

// Words ignored by the similar-question search (French and English, without diacritics).
const STOP_WORDS = new Set(
  (
    'le la les un une des de du d l et ou en au aux a ce ces cet cette ca c pour par sur sous dans avec sans est ' +
    'sont etre ai as avons avez ont comment quoi quel quelle quels quelles qui que qu quand pourquoi ou je j tu ' +
    'il elle on nous vous ils elles me te se mon ma mes ton ta tes son sa ses notre votre leur leurs pas ne n plus ' +
    'moins tres faire fait faut peut peux veux dois entre comme mais donc car si y bien aide aider svp merci ' +
    'probleme question besoin quelqu quelque chose ' +
    'the an of to in on for with without is are was were be been how what which who whom why when where do does ' +
    'did can could should would i you he she we they it its this that these those my your our their from by as ' +
    'at or and not no vs about into need help please problem issue question'
  ).split(/\s+/)
);

const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, 'FORBIDDEN', message);
const invalidState = (message, details) => new HttpError(409, 'INVALID_STATE', message, details);
const isDuplicateKey = (error) => error?.code === 11000;
const toObjectId = (value) => (value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value)));
const isObjectIdHex = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);

const sameId = (a, b) => {
  const left = idOf(a);
  return left !== null && left === idOf(b);
};

// Single line, at most `max` characters.
const excerpt = (text, max) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const userSummary = (user) =>
  isPopulated(user) ? { id: String(user._id), firstname: user.firstname, lastname: user.lastname, role: user.role } : null;

// ---------- Visibility ----------

const isAdmin = (user) => user?.role === 'ADMIN';
const isAuthor = (user, doc) => Boolean(user) && sameId(doc.author, user);

// Hidden content is visible only to ADMINs and its author.
const canSeeQuestion = (user, question) => !question.hidden || isAdmin(user) || isAuthor(user, question);
const canSeeAnswer = (user, answer) => !answer.deleting && (!answer.hidden || isAdmin(user) || isAuthor(user, answer));

// MongoDB filters of the same rules.
const questionVisibility = (user) => (isAdmin(user) ? {} : { $or: [{ hidden: false }, { author: user._id }] });
const answerVisibility = (user) =>
  isAdmin(user)
    ? { deleting: { $ne: true } }
    : { deleting: { $ne: true }, $or: [{ hidden: false }, { author: user._id }] };

const findVisibleQuestion = async (user, id, { populate = false } = {}) => {
  const query = ForumQuestion.findById(id);
  if (populate) query.populate(QUESTION_POPULATE);
  const question = await query.lean();
  if (!question || !canSeeQuestion(user, question)) throw notFound('Question');
  return question;
};

// The answer and its question, both visible to the user (else 404 RESOURCE_NOT_FOUND).
const findVisibleAnswer = async (user, id) => {
  const answer = await ForumAnswer.findById(id).lean();
  if (!answer || !canSeeAnswer(user, answer)) throw notFound('Answer');
  const question = await ForumQuestion.findById(answer.question).lean();
  if (!question || !canSeeQuestion(user, question)) throw notFound('Answer');
  return { answer, question };
};

// ---------- Serialization with the viewer fields ----------

const myVotes = async (user, targetType, ids) => {
  if (ids.length === 0) return new Map();
  const votes = await ForumVote.find({ user: user._id, targetType, target: { $in: ids } })
    .select('target value')
    .lean();
  return new Map(votes.map((vote) => [String(vote.target), vote.value]));
};

const followedQuestions = async (user, ids) => {
  if (ids.length === 0) return new Set();
  const follows = await ForumFollow.find({ user: user._id, question: { $in: ids } })
    .select('question')
    .lean();
  return new Set(follows.map((follow) => String(follow.question)));
};

// Question JSON list (subject and author populated) with `following` and `myVote` of the user.
const presentQuestions = async (user, questions) => {
  const ids = questions.map((question) => question._id);
  const [votes, follows] = await Promise.all([myVotes(user, 'QUESTION', ids), followedQuestions(user, ids)]);
  return questions.map((question) =>
    serializeQuestion(question, {
      following: follows.has(String(question._id)),
      myVote: votes.get(String(question._id)) ?? 0,
    })
  );
};

const presentQuestion = async (user, question) => (await presentQuestions(user, [question]))[0];

// Answer JSON list: accepted answer first, then by score, then oldest first.
const presentAnswers = async (user, question, answers) => {
  const votes = await myVotes(
    user,
    'ANSWER',
    answers.map((answer) => answer._id)
  );
  const acceptedId = idOf(question.acceptedAnswer);
  const sorted = [...answers].sort((a, b) => {
    const acceptedA = String(a._id) === acceptedId ? 1 : 0;
    const acceptedB = String(b._id) === acceptedId ? 1 : 0;
    if (acceptedA !== acceptedB) return acceptedB - acceptedA;
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  return sorted.map((answer) =>
    serializeAnswer(answer, { acceptedAnswerId: acceptedId, myVote: votes.get(String(answer._id)) ?? 0 })
  );
};

const presentAnswer = async (user, question, answer) => (await presentAnswers(user, question, [answer]))[0];

const loadPopulatedQuestion = async (id) => {
  const question = await ForumQuestion.findById(id).populate(QUESTION_POPULATE).lean();
  if (!question) throw notFound('Question');
  return question;
};

const loadPopulatedAnswer = async (id) => {
  const answer = await ForumAnswer.findById(id).populate(ANSWER_POPULATE).lean();
  if (!answer) throw notFound('Answer');
  return answer;
};

// { question, answers } as the user sees them (no view counted).
const questionDetail = async (user, questionId) => {
  const [question, answers] = await Promise.all([
    loadPopulatedQuestion(questionId),
    ForumAnswer.find({ question: questionId, ...answerVisibility(user) })
      .populate(ANSWER_POPULATE)
      .lean(),
  ]);
  if (!canSeeQuestion(user, question)) throw notFound('Question');
  return { question: await presentQuestion(user, question), answers: await presentAnswers(user, question, answers) };
};

// ---------- Reputation and badges ----------

const votePoints = (targetType, value) => {
  if (value === 1) return targetType === 'ANSWER' ? POINTS.ANSWER_UPVOTE : POINTS.QUESTION_UPVOTE;
  if (value === -1) return POINTS.DOWNVOTE;
  return 0;
};

// Creates the user's profile when missing (concurrent creations are fine: unique index on `user`).
const ensureProfile = async (userId) => {
  try {
    await ForumProfile.updateOne(
      { user: userId },
      { $setOnInsert: { 'season.year': time.currentAcademicYear() } },
      { upsert: true }
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
};

const badgeLabel = (locale, code, subjectName) => (BADGE_LABELS[locale] ?? BADGE_LABELS.en)[code](subjectName);

// One FORUM notification per new badge, in the recipient's locale.
const notifyBadges = async (userId, badges) => {
  const subjectIds = badges.filter((badge) => badge.subject).map((badge) => toObjectId(badge.subject));
  const subjects = subjectIds.length > 0 ? await Subject.find({ _id: { $in: subjectIds } }).select('name').lean() : [];
  const names = new Map(subjects.map((subject) => [String(subject._id), subject.name]));
  badges.forEach((badge) => {
    const subjectName = badge.subject ? names.get(String(badge.subject)) ?? '' : '';
    notifyUsersInBackground([userId], (locale) => {
      const label = badgeLabel(locale, badge.code, subjectName);
      const fr = locale === 'fr';
      return {
        type: 'FORUM',
        title: fr ? `Nouveau badge : ${label}` : `New badge: ${label}`,
        body: fr
          ? `Bravo ! Tu as obtenu le badge « ${label} » sur le forum.`
          : `Congratulations! You earned the "${label}" badge on the forum.`,
        link: `/dashboard/forum/profile/${userId}`,
        data: { kind: 'BADGE', badge: badge.code, subjectId: badge.subject ? String(badge.subject) : null },
        tag: `forum-badge-${badge.code}-${badge.subject ?? 'all'}`,
      };
    });
  });
};

// Badges the counters of a profile entitle to.
const earnedBadges = (profile) => {
  const badges = [];
  if ((profile.answers ?? 0) >= BADGE_RULES.FIRST_ANSWER) badges.push({ code: 'FIRST_ANSWER', subject: null });
  if ((profile.answers ?? 0) >= BADGE_RULES.ACTIVE_CONTRIBUTOR) badges.push({ code: 'ACTIVE_CONTRIBUTOR', subject: null });
  if ((profile.acceptedAnswers ?? 0) >= BADGE_RULES.HELPFUL) badges.push({ code: 'HELPFUL', subject: null });
  Object.entries(profile.bySubject ?? {}).forEach(([subject, points]) => {
    if (isObjectIdHex(subject) && points >= BADGE_RULES.SUBJECT_EXPERT) badges.push({ code: 'SUBJECT_EXPERT', subject });
  });
  return badges;
};

/**
 * Awards the badges the user has earned and does not hold yet (each one atomically, so it is awarded and notified
 * once even under concurrent requests). Badges are kept when the counters go down later.
 * @returns {Promise<Array<{ code, subject }>>} the new badges
 */
const awardBadges = async (userId, { notify = true, awardedAt = new Date() } = {}) => {
  const profile = await ForumProfile.findOne({ user: userId }).lean();
  if (!profile) return [];
  const owned = new Set((profile.badges ?? []).map((badge) => `${badge.code}:${badge.subject ? String(badge.subject) : ''}`));
  const awarded = [];
  for (const badge of earnedBadges(profile)) {
    if (owned.has(`${badge.code}:${badge.subject ?? ''}`)) continue;
    const subject = badge.subject ? toObjectId(badge.subject) : null;
    const result = await ForumProfile.updateOne(
      { user: profile.user, badges: { $not: { $elemMatch: { code: badge.code, subject } } } },
      { $push: { badges: { code: badge.code, subject, awardedAt } } }
    );
    if (result.modifiedCount === 1) awarded.push(badge);
  }
  if (notify && awarded.length > 0) await notifyBadges(profile.user, awarded);
  return awarded;
};

/**
 * Applies a reputation event / counter change to a profile ($inc, so concurrent events add up).
 * `points` go to `points`, `bySubject.<subject>` and the current academic year (`season`, reset at the first
 * event of a new year). The API shows max(0, points): reputation is never below 0.
 */
const changeProfile = async (
  userId,
  { points = 0, subject = null, questions = 0, answers = 0, acceptedAnswers = 0, answersInSubject = 0 } = {},
  { notify = true } = {}
) => {
  if (!userId || (!points && !questions && !answers && !acceptedAnswers && !answersInSubject)) return;
  const user = toObjectId(idOf(userId));
  await ensureProfile(user);

  const subjectId = subject ? idOf(subject) : null;
  const inc = {};
  if (points) {
    const year = time.currentAcademicYear();
    await ForumProfile.updateOne(
      { user, 'season.year': { $ne: year } },
      { $set: { 'season.year': year, 'season.points': 0, 'season.bySubject': {} } }
    );
    inc.points = points;
    inc['season.points'] = points;
    if (subjectId) {
      inc[`bySubject.${subjectId}`] = points;
      inc[`season.bySubject.${subjectId}`] = points;
    }
  }
  if (questions) inc.questions = questions;
  if (answers) inc.answers = answers;
  if (acceptedAnswers) inc.acceptedAnswers = acceptedAnswers;
  if (answersInSubject && subjectId) inc[`answersBySubject.${subjectId}`] = answersInSubject;
  if (Object.keys(inc).length === 0) return;

  await ForumProfile.updateOne({ user }, { $inc: inc });
  if (points > 0 || answers > 0 || acceptedAnswers > 0) await awardBadges(user, { notify });
};

// Reverses the reputation given by these votes (their target is being deleted).
const reverseVotes = async (votes) => {
  const totals = new Map();
  votes.forEach((vote) => {
    const key = `${vote.targetAuthor}:${vote.subject ?? ''}`;
    const entry = totals.get(key) ?? { author: vote.targetAuthor, subject: vote.subject ?? null, points: 0 };
    entry.points -= votePoints(vote.targetType, vote.value);
    totals.set(key, entry);
  });
  for (const { author, subject, points } of totals.values()) {
    await changeProfile(author, { points, subject });
  }
};

/**
 * Recomputes a profile from the stored data (questions, answers, votes received, accepted answers), keeping its
 * badges. Same rules as the incremental updates; used by the demo seed (and for maintenance).
 */
const recomputeProfile = async (userId) => {
  const user = toObjectId(idOf(userId));
  const year = time.currentAcademicYear();
  const { start, end } = time.academicYearBounds();
  const inSeason = (date) => date instanceof Date && date >= start && date < end;
  const result = {
    points: 0,
    questions: 0,
    answers: 0,
    acceptedAnswers: 0,
    bySubject: {},
    answersBySubject: {},
    season: { year, points: 0, bySubject: {} },
  };
  const add = (points, subject, date) => {
    if (!points) return;
    const subjectId = subject ? String(subject) : null;
    result.points += points;
    if (subjectId) result.bySubject[subjectId] = (result.bySubject[subjectId] ?? 0) + points;
    if (inSeason(date)) {
      result.season.points += points;
      if (subjectId) result.season.bySubject[subjectId] = (result.season.bySubject[subjectId] ?? 0) + points;
    }
  };

  const [questionCount, answers, votes, ownQuestions] = await Promise.all([
    ForumQuestion.countDocuments({ author: user }),
    ForumAnswer.find({ author: user, deleting: { $ne: true } }).select('subject').lean(),
    ForumVote.find({ targetAuthor: user }).lean(),
    ForumQuestion.find({ author: user, acceptedAnswer: { $ne: null } }).select('acceptedAnswer acceptedAt').lean(),
  ]);
  result.questions = questionCount;
  result.answers = answers.length;
  answers.forEach((answer) => {
    const subjectId = String(answer.subject);
    result.answersBySubject[subjectId] = (result.answersBySubject[subjectId] ?? 0) + 1;
  });
  votes.forEach((vote) => add(votePoints(vote.targetType, vote.value), vote.subject, vote.updatedAt ?? vote.createdAt));

  // Answers of the user accepted on other users' questions.
  const answerSubjects = new Map(answers.map((answer) => [String(answer._id), answer.subject]));
  if (answers.length > 0) {
    const accepted = await ForumQuestion.find({
      acceptedAnswer: { $in: answers.map((answer) => answer._id) },
      author: { $ne: user },
    })
      .select('acceptedAnswer acceptedAt')
      .lean();
    accepted.forEach((question) => {
      result.acceptedAnswers += 1;
      add(POINTS.ACCEPTED_ANSWER, answerSubjects.get(String(question.acceptedAnswer)), question.acceptedAt);
    });
  }

  // The user accepted another user's answer on their own question.
  if (ownQuestions.length > 0) {
    const acceptedAnswers = await ForumAnswer.find({ _id: { $in: ownQuestions.map((q) => q.acceptedAnswer) } })
      .select('author subject')
      .lean();
    const byId = new Map(acceptedAnswers.map((answer) => [String(answer._id), answer]));
    ownQuestions.forEach((question) => {
      const answer = byId.get(String(question.acceptedAnswer));
      if (answer && !sameId(answer.author, user)) add(POINTS.ACCEPTER, answer.subject, question.acceptedAt);
    });
  }

  await ensureProfile(user);
  await ForumProfile.updateOne({ user }, { $set: result });
  return result;
};

// ---------- Questions ----------

const LIST_SORTS = {
  recent: { createdAt: -1, _id: -1 },
  votes: { score: -1, createdAt: -1, _id: -1 },
  activity: { lastActivityAt: -1, _id: -1 },
  unanswered: { createdAt: -1, _id: -1 },
};

/**
 * Paginated question list. `q` uses the text index (title 5, tags 3, body 1); without an explicit sort, results
 * are ordered by relevance. sort=unanswered keeps the questions without (visible) answers, newest first.
 */
const listQuestions = async (user, { q, subject, level, tag, status, sort, skip, limit }) => {
  const filter = { ...questionVisibility(user) };
  if (q) filter.$text = { $search: q };
  if (subject) filter.subject = subject;
  if (level) filter.level = level;
  if (tag) filter.tags = tag;
  if (status) filter.status = status;
  const order = sort ?? (q ? 'relevance' : 'recent');
  if (order === 'unanswered') filter.answerCount = { $lte: 0 };
  const sortSpec =
    order === 'relevance'
      ? q
        ? { relevance: { $meta: 'textScore' }, createdAt: -1, _id: -1 }
        : LIST_SORTS.recent
      : LIST_SORTS[order];

  const [items, total] = await Promise.all([
    ForumQuestion.find(filter).sort(sortSpec).skip(skip).limit(limit).populate(QUESTION_POPULATE).lean(),
    ForumQuestion.countDocuments(filter),
  ]);
  return { items: await presentQuestions(user, items), total };
};

// Significant words of a title for the similar-question search.
const significantWords = (title) => {
  const words = String(title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}+#]+/u)
    .map((word) => word.replace(/^[+#]+/, ''))
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, SIMILAR_MAX_WORDS);
};

// Up to 5 visible questions whose text matches the significant words of `title`, best match first.
const similarQuestions = async (user, title) => {
  const words = significantWords(title);
  if (words.length === 0) return [];
  const visibility = questionVisibility(user);
  const items = await ForumQuestion.aggregate([
    { $match: { $text: { $search: words.join(' ') }, ...visibility } },
    { $addFields: { relevance: { $meta: 'textScore' } } },
    { $sort: { relevance: -1, score: -1, createdAt: -1 } },
    { $limit: SIMILAR_LIMIT },
    { $project: { title: 1, answerCount: 1, acceptedAnswer: 1 } },
  ]);
  return items.map((item) => ({
    id: String(item._id),
    title: item.title,
    answerCount: Math.max(0, item.answerCount ?? 0),
    hasAcceptedAnswer: Boolean(item.acceptedAnswer),
  }));
};

// Most used tags of the visible questions (optionally of one subject): [{ tag, count }].
const popularTags = async (user, { subject, limit }) => {
  const match = { ...questionVisibility(user) };
  if (subject) match.subject = toObjectId(subject);
  const rows = await ForumQuestion.aggregate([
    { $match: match },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({ tag: row._id, count: row.count }));
};

const followQuestionInternal = async (questionId, userId) => {
  try {
    await ForumFollow.updateOne(
      { question: questionId, user: userId },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
};

// Creates a question; its author follows it.
const createQuestion = async (user, values) => {
  const now = new Date();
  const question = await ForumQuestion.create({
    title: values.title,
    body: values.body,
    subject: values.subject,
    chapter: values.chapter ?? null,
    level: values.level ?? null,
    tags: values.tags ?? [],
    author: user._id,
    authorSnapshot: { firstname: user.firstname, lastname: user.lastname, role: user.role },
    lastActivityAt: now,
  });
  await followQuestionInternal(question._id, user._id);
  await changeProfile(user._id, { questions: 1 });
  return presentQuestion(user, await loadPopulatedQuestion(question._id));
};

// "Viewed today" (campus day) once per user: true when this call counted a new view.
const registerView = async (user, question) => {
  try {
    const result = await ForumView.updateOne(
      { question: question._id, user: user._id, day: time.formatLocalDate(new Date()) },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    if (result.upsertedCount > 0) {
      await ForumQuestion.updateOne({ _id: question._id }, { $inc: { viewCount: 1 } });
      return true;
    }
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  return false;
};

// GET /questions/:id → { question, answers }, counting the view once per user and day.
const getQuestion = async (user, questionId) => {
  const question = await findVisibleQuestion(user, questionId);
  await registerView(user, question);
  return questionDetail(user, question._id);
};

const sameTags = (a = [], b = []) => a.length === b.length && a.every((tag, index) => tag === b[index]);

/**
 * PATCH /questions/:id. Content fields (title, body, subject, chapter, level, tags): the author only.
 * status (OPEN | CLOSED): the author or an ADMIN.
 */
const updateQuestion = async (user, questionId, values) => {
  const question = await findVisibleQuestion(user, questionId);
  const contentFields = ['title', 'body', 'subject', 'chapter', 'level', 'tags'].filter(
    (field) => values[field] !== undefined
  );
  if (contentFields.length > 0 && !isAuthor(user, question)) {
    throw forbidden('Only the author can edit this question');
  }
  if (values.status !== undefined && !isAuthor(user, question) && !isAdmin(user)) {
    throw forbidden('Only the author or an administrator can close or reopen this question');
  }

  const set = {};
  contentFields.forEach((field) => {
    const before = question[field];
    const after = values[field];
    const changed =
      field === 'tags'
        ? !sameTags(before, after)
        : field === 'subject'
          ? !sameId(before, after)
          : (before ?? null) !== (after ?? null);
    if (changed) set[field] = after;
  });
  const now = new Date();
  if (Object.keys(set).length > 0) {
    set.editedAt = now;
    set.lastActivityAt = now;
  }
  if (values.status !== undefined && values.status !== question.status) set.status = values.status;

  if (Object.keys(set).length > 0) {
    await ForumQuestion.updateOne({ _id: question._id }, { $set: set }, { runValidators: true });
  }
  return { question: await presentQuestion(user, await loadPopulatedQuestion(question._id)), changes: Object.keys(set) };
};

/**
 * DELETE /questions/:id: the author or an ADMIN, while the question has no answers (409 INVALID_STATE).
 * Reverses the reputation of its votes and removes its votes, follows, views and reports.
 * @returns the deleted question (lean)
 */
const deleteQuestion = async (user, questionId) => {
  const question = await findVisibleQuestion(user, questionId);
  if (!isAuthor(user, question) && !isAdmin(user)) throw forbidden();
  const deleted = await ForumQuestion.findOneAndDelete({ _id: question._id, answersTotal: { $lte: 0 } }).lean();
  if (!deleted) {
    if (await ForumQuestion.exists({ _id: question._id })) {
      throw invalidState('A question that has answers cannot be deleted');
    }
    throw notFound('Question');
  }
  const votes = await ForumVote.find({ targetType: 'QUESTION', target: deleted._id }).lean();
  await reverseVotes(votes);
  await Promise.all([
    ForumVote.deleteMany({ targetType: 'QUESTION', target: deleted._id }),
    ForumFollow.deleteMany({ question: deleted._id }),
    ForumView.deleteMany({ question: deleted._id }),
    ForumReport.deleteMany({ question: deleted._id }),
  ]);
  await changeProfile(deleted.author, { questions: -1 });
  return deleted;
};

// ---------- Answers ----------

const answerLink = (questionId, answerId) => `/dashboard/forum/${questionId}#answer-${answerId}`;

// FORUM notification to the followers of the question (except the answerer), in their locale.
const notifyNewAnswer = async (question, answer, author) => {
  const followers = await ForumFollow.distinct('user', { question: question._id, user: { $ne: author._id } });
  if (followers.length === 0) return;
  const name = `${author.firstname} ${author.lastname}`.trim();
  const title = excerpt(question.title, 120);
  const text = excerpt(answer.body, NOTIFICATION_EXCERPT_LENGTH);
  notifyUsersInBackground(followers, (locale) => {
    const fr = locale === 'fr';
    const certified = answer.certified ? (fr ? ' (réponse certifiée)' : ' (certified answer)') : '';
    return {
      type: 'FORUM',
      title: fr ? `Nouvelle réponse : « ${title} »` : `New answer: "${title}"`,
      body: fr ? `${name} a répondu${certified} : ${text}` : `${name} answered${certified}: ${text}`,
      link: answerLink(question._id, answer._id),
      data: { kind: 'NEW_ANSWER', questionId: String(question._id), answerId: String(answer._id) },
      tag: `forum-question-${question._id}`,
    };
  });
};

// The answer author is told that their answer was accepted.
const notifyAccepted = (question, answer) => {
  const title = excerpt(question.title, 120);
  notifyUsersInBackground([answer.author], (locale) => {
    const fr = locale === 'fr';
    return {
      type: 'FORUM',
      title: fr ? 'Ta réponse a été acceptée' : 'Your answer was accepted',
      body: fr
        ? `« ${title} » : +${POINTS.ACCEPTED_ANSWER} points de réputation.`
        : `"${title}": +${POINTS.ACCEPTED_ANSWER} reputation points.`,
      link: answerLink(question._id, answer._id),
      data: { kind: 'ANSWER_ACCEPTED', questionId: String(question._id), answerId: String(answer._id) },
      tag: `forum-accepted-${answer._id}`,
    };
  });
};

const clientRequestConflict = () =>
  new HttpError(409, 'ALREADY_EXISTS', 'This clientRequestId was already used for another question', {
    field: 'clientRequestId',
  });

// Answer of `author` with this clientRequestId (replay of the offline outbox), or null.
const findReplay = async (user, questionId, clientRequestId) => {
  const existing = await ForumAnswer.findOne({ author: user._id, clientRequestId, deleting: { $ne: true } }).lean();
  if (!existing) return null;
  if (!sameId(existing.question, questionId)) throw clientRequestConflict();
  return existing;
};

/**
 * POST /questions/:id/answers. With a clientRequestId, the same author + id returns the first answer
 * ({ created: false }) instead of creating a duplicate, even for concurrent replays (unique index).
 * @returns {{ answer: object (JSON), created: boolean }}
 */
const createAnswer = async (user, questionId, { body, clientRequestId }) => {
  const question = await findVisibleQuestion(user, questionId);

  if (clientRequestId) {
    const existing = await findReplay(user, question._id, clientRequestId);
    if (existing) return { answer: await presentAnswer(user, question, await loadPopulatedAnswer(existing._id)), created: false };
  }
  if (question.hidden) throw invalidState('This question is hidden: it cannot receive answers');
  if (question.status !== 'OPEN') throw invalidState('This question is closed: it cannot receive answers');

  // Reservation: a question with answers cannot be deleted, so a concurrent delete fails instead of leaving orphans.
  const reserved = await ForumQuestion.findOneAndUpdate(
    { _id: question._id, hidden: false, status: 'OPEN' },
    { $inc: { answersTotal: 1 } },
    { returnDocument: 'after' }
  ).lean();
  if (!reserved) {
    const current = await ForumQuestion.findById(question._id).lean();
    if (!current) throw notFound('Question');
    throw invalidState('This question can no longer receive answers');
  }

  let answer;
  try {
    answer = await ForumAnswer.create({
      question: question._id,
      subject: reserved.subject,
      body,
      author: user._id,
      authorSnapshot: { firstname: user.firstname, lastname: user.lastname, role: user.role },
      certified: user.role === 'TEACHER',
      ...(clientRequestId ? { clientRequestId } : {}),
    });
  } catch (error) {
    await ForumQuestion.updateOne({ _id: question._id }, { $inc: { answersTotal: -1 } });
    if (isDuplicateKey(error) && clientRequestId) {
      const existing = await findReplay(user, question._id, clientRequestId);
      if (existing) {
        return { answer: await presentAnswer(user, question, await loadPopulatedAnswer(existing._id)), created: false };
      }
    }
    throw error;
  }

  const set = { lastActivityAt: answer.createdAt };
  if (answer.certified) set.hasCertifiedAnswer = true;
  await ForumQuestion.updateOne({ _id: question._id }, { $inc: { answerCount: 1 }, $set: set });
  await changeProfile(user._id, { answers: 1, answersInSubject: 1, subject: answer.subject });
  await notifyNewAnswer(reserved, answer, user);

  return { answer: await presentAnswer(user, reserved, await loadPopulatedAnswer(answer._id)), created: true };
};

// PATCH /answers/:id { body }: the author only.
const updateAnswer = async (user, answerId, { body }) => {
  const { answer, question } = await findVisibleAnswer(user, answerId);
  if (!isAuthor(user, answer)) throw forbidden('Only the author can edit this answer');
  if (body !== answer.body) {
    await ForumAnswer.updateOne(
      { _id: answer._id, deleting: { $ne: true } },
      { $set: { body, editedAt: new Date() } },
      { runValidators: true }
    );
  }
  return presentAnswer(user, question, await loadPopulatedAnswer(answer._id));
};

// hasCertifiedAnswer = a non-hidden TEACHER answer exists.
const refreshCertified = async (questionId) => {
  const has = await ForumAnswer.exists({
    question: questionId,
    certified: true,
    hidden: false,
    deleting: { $ne: true },
  });
  await ForumQuestion.updateOne({ _id: questionId }, { $set: { hasCertifiedAnswer: Boolean(has) } });
};

/**
 * DELETE /answers/:id: the author or an ADMIN, unless the answer is accepted (409 INVALID_STATE).
 * The answer is first marked `deleting` (invisible, cannot be accepted any more), then the question counters are
 * decremented only if it is not the accepted answer, then it is removed with its votes and reports.
 * @returns {{ answer, question }} (lean)
 */
const deleteAnswer = async (user, answerId) => {
  const { answer, question } = await findVisibleAnswer(user, answerId);
  if (!isAuthor(user, answer) && !isAdmin(user)) throw forbidden();
  if (sameId(question.acceptedAnswer, answer._id)) throw invalidState('An accepted answer cannot be deleted');

  const locked = await ForumAnswer.findOneAndUpdate(
    { _id: answer._id, deleting: { $ne: true } },
    { $set: { deleting: true } },
    { returnDocument: 'after' }
  ).lean();
  if (!locked) throw notFound('Answer');

  const updated = await ForumQuestion.findOneAndUpdate(
    { _id: locked.question, acceptedAnswer: { $ne: locked._id } },
    { $inc: { answersTotal: -1, answerCount: locked.hidden ? 0 : -1 } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated && (await ForumQuestion.exists({ _id: locked.question }))) {
    await ForumAnswer.updateOne({ _id: locked._id }, { $set: { deleting: false } });
    throw invalidState('An accepted answer cannot be deleted');
  }

  await ForumAnswer.deleteOne({ _id: locked._id });
  if (updated && locked.certified && !locked.hidden) await refreshCertified(locked.question);
  const votes = await ForumVote.find({ targetType: 'ANSWER', target: locked._id }).lean();
  await reverseVotes(votes);
  await Promise.all([
    ForumVote.deleteMany({ targetType: 'ANSWER', target: locked._id }),
    ForumReport.deleteMany({ targetType: 'ANSWER', target: locked._id }),
  ]);
  await changeProfile(locked.author, { answers: -1, answersInSubject: -1, subject: locked.subject });
  return { answer: locked, question };
};

// Reputation of an accepted-answer change (no points for accepting one's own answer).
const applyAcceptReputation = async (question, previous, next) => {
  const fromOther = (answer) => Boolean(answer) && !sameId(answer.author, question.author);
  if (fromOther(previous)) {
    await changeProfile(previous.author, {
      points: -POINTS.ACCEPTED_ANSWER,
      acceptedAnswers: -1,
      subject: previous.subject,
    });
  }
  if (fromOther(next)) {
    await changeProfile(next.author, { points: POINTS.ACCEPTED_ANSWER, acceptedAnswers: 1, subject: next.subject });
  }
  const accepterDelta = (fromOther(next) ? POINTS.ACCEPTER : 0) - (fromOther(previous) ? POINTS.ACCEPTER : 0);
  if (accepterDelta !== 0) {
    await changeProfile(question.author, {
      points: accepterDelta,
      subject: (accepterDelta > 0 ? next : previous).subject,
    });
  }
};

/**
 * POST /questions/:id/accept { answerId }: the question author accepts an answer, changes it, or removes the
 * acceptance (answerId null). Compare-and-set on the question, so concurrent changes never give points twice.
 * @returns {{ question, answers }} the updated detail
 */
const acceptAnswer = async (user, questionId, answerId) => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const question = await findVisibleQuestion(user, questionId);
    if (!isAuthor(user, question)) throw forbidden('Only the author of the question can accept an answer');
    const previousId = question.acceptedAnswer ?? null;
    if ((previousId === null && answerId === null) || (answerId !== null && sameId(previousId, answerId))) {
      return questionDetail(user, question._id);
    }

    let next = null;
    if (answerId !== null) {
      next = await ForumAnswer.findOne({ _id: answerId, question: question._id }).lean();
      if (!next || !canSeeAnswer(user, next)) throw notFound('Answer');
      if (next.hidden) throw invalidState('A hidden answer cannot be accepted');
    }

    const now = new Date();
    const updated = await ForumQuestion.findOneAndUpdate(
      { _id: question._id, acceptedAnswer: previousId },
      { $set: { acceptedAnswer: next ? next._id : null, acceptedAt: next ? now : null, lastActivityAt: now } },
      { returnDocument: 'after' }
    ).lean();
    if (!updated) continue;

    // The answer may have been deleted in the meantime: undo.
    if (next && !(await ForumAnswer.exists({ _id: next._id, deleting: { $ne: true } }))) {
      await ForumQuestion.updateOne(
        { _id: question._id, acceptedAnswer: next._id },
        { $set: { acceptedAnswer: previousId, acceptedAt: question.acceptedAt ?? null } }
      );
      throw notFound('Answer');
    }

    const previous = previousId ? await ForumAnswer.findById(previousId).lean() : null;
    await applyAcceptReputation(question, previous, next);
    if (next && !sameId(next.author, question.author)) notifyAccepted(question, next);
    return questionDetail(user, question._id);
  }
  throw invalidState('The accepted answer changed in the meantime: reload and try again');
};

// ---------- Votes ----------

/**
 * POST /{questions|answers}/:id/vote { value }: +1 / -1; voting again with the same value removes the vote.
 * No vote on one's own content (403 FORBIDDEN) nor on hidden content (409 INVALID_STATE).
 * The toggle is one atomic upsert (update pipeline returning the previous state): concurrent votes of the same user
 * are applied one after the other, and the score / reputation deltas follow each of them exactly.
 * @returns {{ score, myVote }}
 */
const castVote = async (user, targetType, targetId, value) => {
  let target;
  let question;
  if (targetType === 'QUESTION') {
    target = await findVisibleQuestion(user, targetId);
    question = target;
  } else {
    ({ answer: target, question } = await findVisibleAnswer(user, targetId));
  }
  if (isAuthor(user, target)) throw forbidden('You cannot vote on your own content');
  if (target.hidden || question.hidden) throw invalidState('Hidden content cannot be voted on');
  const Model = targetType === 'QUESTION' ? ForumQuestion : ForumAnswer;

  const filter = { user: user._id, targetType, target: target._id };
  // Same value again → 0 (removed, the document is deleted below); otherwise the new value. Author and subject are
  // kept from the first vote, so a later removal reverses exactly what was given.
  const toggle = [
    {
      $set: {
        value: { $cond: [{ $eq: [{ $ifNull: ['$value', 0] }, value] }, 0, value] },
        targetAuthor: { $ifNull: ['$targetAuthor', toObjectId(idOf(target.author))] },
        subject: { $ifNull: ['$subject', target.subject ? toObjectId(idOf(target.subject)) : null] },
        createdAt: { $ifNull: ['$createdAt', '$$NOW'] },
        updatedAt: '$$NOW',
      },
    },
  ];
  let before = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      before = await ForumVote.findOneAndUpdate(filter, toggle, {
        upsert: true,
        returnDocument: 'before',
        updatePipeline: true,
        timestamps: false,
      }).lean();
      break;
    } catch (error) {
      // Two first votes at the same time: the upsert that lost retries on the document the other one created.
      if (!isDuplicateKey(error) || attempt >= MAX_RETRIES) throw error;
    }
  }
  const previous = before?.value ?? 0;
  const next = previous === value ? 0 : value;
  if (next === 0) await ForumVote.deleteOne({ ...filter, value: 0 });

  const updated = await Model.findOneAndUpdate(
    { _id: target._id },
    { $inc: { score: next - previous } },
    { returnDocument: 'after' }
  )
    .select('score')
    .lean();
  await changeProfile(before?.targetAuthor ?? target.author, {
    points: votePoints(targetType, next) - votePoints(targetType, previous),
    subject: before ? before.subject : target.subject,
  });
  return { score: updated ? updated.score : (target.score ?? 0) + next - previous, myVote: next };
};

// ---------- Follow ----------

const followQuestion = async (user, questionId) => {
  const question = await findVisibleQuestion(user, questionId);
  await followQuestionInternal(question._id, user._id);
  return { following: true };
};

const unfollowQuestion = async (user, questionId) => {
  const question = await findVisibleQuestion(user, questionId);
  await ForumFollow.deleteOne({ question: question._id, user: user._id });
  return { following: false };
};

// ---------- Moderation ----------

/**
 * POST /{questions|answers}/:id/report { reason }: any user who can see the content. One open report per user and
 * target: reporting again returns the open report ({ created: false }).
 */
const reportContent = async (user, targetType, targetId, reason) => {
  let target;
  let questionId;
  if (targetType === 'QUESTION') {
    target = await findVisibleQuestion(user, targetId);
    questionId = target._id;
  } else {
    const found = await findVisibleAnswer(user, targetId);
    target = found.answer;
    questionId = found.question._id;
  }
  const filter = { reporter: user._id, targetType, target: target._id, status: 'OPEN' };
  const existing = await ForumReport.findOne(filter);
  if (existing) return { report: existing, created: false };
  try {
    const report = await ForumReport.create({ ...filter, question: questionId, reason });
    return { report, created: true };
  } catch (error) {
    if (isDuplicateKey(error)) {
      const again = await ForumReport.findOne(filter);
      if (again) return { report: again, created: false };
    }
    throw error;
  }
};

/**
 * ADMIN hide / unhide of a question or an answer. Idempotent ({ changed: false } when nothing changed).
 * Hiding resolves the open reports of the content (outcome HIDDEN).
 * @returns {{ content (JSON), changed, question (lean), target (lean) }}
 */
const setHidden = async (admin, targetType, targetId, hidden, reason = null) => {
  const Model = targetType === 'QUESTION' ? ForumQuestion : ForumAnswer;
  const now = new Date();
  const set = hidden
    ? { hidden: true, hiddenAt: now, hiddenBy: admin._id, hiddenReason: reason || null }
    : { hidden: false, hiddenAt: null, hiddenBy: null, hiddenReason: null };
  const filter = { _id: targetId, hidden: !hidden };
  if (targetType === 'ANSWER') filter.deleting = { $ne: true };

  let target = await Model.findOneAndUpdate(filter, { $set: set }, { returnDocument: 'after' }).lean();
  let changed = true;
  if (!target) {
    target = await Model.findById(targetId).lean();
    if (!target || target.deleting) throw notFound(targetType === 'QUESTION' ? 'Question' : 'Answer');
    changed = false;
  }

  if (changed && targetType === 'ANSWER') {
    await ForumQuestion.updateOne({ _id: target.question }, { $inc: { answerCount: hidden ? -1 : 1 } });
    if (target.certified) await refreshCertified(target.question);
  }
  if (changed && hidden) {
    await ForumReport.updateMany(
      { targetType, target: target._id, status: 'OPEN' },
      { $set: { status: 'RESOLVED', outcome: 'HIDDEN', resolvedAt: now, resolvedBy: admin._id } }
    );
  }

  if (targetType === 'QUESTION') {
    return { content: await presentQuestion(admin, await loadPopulatedQuestion(target._id)), changed, question: target, target };
  }
  const question = await ForumQuestion.findById(target.question).lean();
  if (!question) throw notFound('Answer');
  return { content: await presentAnswer(admin, question, await loadPopulatedAnswer(target._id)), changed, question, target };
};

const REPORT_POPULATE = [
  { path: 'reporter', select: 'firstname lastname role' },
  { path: 'resolvedBy', select: 'firstname lastname role' },
];

// Detailed report JSON for ADMINs (content excerpt, author, reporter, resolution).
const presentReports = async (reports) => {
  const questionIds = [...new Set(reports.map((report) => String(report.question)))].map(toObjectId);
  const answerIds = reports.filter((report) => report.targetType === 'ANSWER').map((report) => report.target);
  const [questions, answers] = await Promise.all([
    questionIds.length > 0
      ? ForumQuestion.find({ _id: { $in: questionIds } })
          .select('title body author authorSnapshot hidden')
          .populate({ path: 'author', select: 'firstname lastname role' })
          .lean()
      : [],
    answerIds.length > 0
      ? ForumAnswer.find({ _id: { $in: answerIds }, deleting: { $ne: true } })
          .select('body author authorSnapshot hidden question')
          .populate({ path: 'author', select: 'firstname lastname role' })
          .lean()
      : [],
  ]);
  const questionById = new Map(questions.map((question) => [String(question._id), question]));
  const answerById = new Map(answers.map((answer) => [String(answer._id), answer]));

  return reports.map((report) => {
    const question = questionById.get(String(report.question)) ?? null;
    const content = report.targetType === 'QUESTION' ? question : answerById.get(String(report.target)) ?? null;
    return {
      id: String(report._id),
      targetType: report.targetType,
      targetId: String(report.target),
      questionId: String(report.question),
      reason: report.reason,
      status: report.status,
      outcome: report.outcome ?? null,
      note: report.note ?? null,
      reporter: userSummary(report.reporter),
      target: content
        ? {
            title: question ? question.title : null,
            excerpt: excerpt(content.body, REPORT_EXCERPT_LENGTH),
            author: summarizeAuthor(content),
            hidden: Boolean(content.hidden),
          }
        : null,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt ?? null,
      resolvedBy: userSummary(report.resolvedBy),
    };
  });
};

// ADMIN GET /reports?status → { items, total, openCount }
const listReports = async ({ status, skip, limit }) => {
  const filter = status ? { status } : {};
  const [reports, total, openCount] = await Promise.all([
    ForumReport.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate(REPORT_POPULATE).lean(),
    ForumReport.countDocuments(filter),
    ForumReport.countDocuments({ status: 'OPEN' }),
  ]);
  return { items: await presentReports(reports), total, openCount };
};

// ADMIN POST /reports/:id/resolve { note? }: OPEN → RESOLVED (outcome HIDDEN when the content is hidden, else
// NO_ACTION); already resolved → 409 INVALID_STATE.
const resolveReport = async (admin, reportId, note = null) => {
  const report = await ForumReport.findById(reportId).lean();
  if (!report) throw notFound('Report');
  if (report.status !== 'OPEN') throw invalidState('This report is already resolved');
  const Model = report.targetType === 'QUESTION' ? ForumQuestion : ForumAnswer;
  const target = await Model.findById(report.target).select('hidden').lean();
  const updated = await ForumReport.findOneAndUpdate(
    { _id: report._id, status: 'OPEN' },
    {
      $set: {
        status: 'RESOLVED',
        outcome: target?.hidden ? 'HIDDEN' : 'NO_ACTION',
        note: note || null,
        resolvedAt: new Date(),
        resolvedBy: admin._id,
      },
    },
    { returnDocument: 'after' }
  )
    .populate(REPORT_POPULATE)
    .lean();
  if (!updated) throw invalidState('This report is already resolved');
  return (await presentReports([updated]))[0];
};

// ---------- Profiles and leaderboard ----------

const clampMap = (map) =>
  Object.fromEntries(Object.entries(map ?? {}).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));

/**
 * ForumProfile JSON: { user: { id, firstname, lastname, role }, reputation, questions, answers, acceptedAnswers,
 * bySubject: { <subjectId>: points }, subjects: [{ subject, points, answers }], badges: [{ code, subject?, awardedAt }],
 * season: { academicYear, reputation } }. A user without forum activity gets zeros.
 */
const getProfile = async (userId, { requireActivity = false } = {}) => {
  const user = await User.findById(userId).select('firstname lastname role').lean();
  if (!user) throw notFound('User');
  const profileDoc = await ForumProfile.findOne({ user: user._id }).lean();
  // Other people's profiles only exist for forum participants: an id alone must not reveal who an account is.
  if (requireActivity && !profileDoc) throw notFound('User');
  const profile = profileDoc ?? {};

  const points = clampMap(profile.bySubject);
  const answers = clampMap(profile.answersBySubject);
  const badgeSubjects = (profile.badges ?? []).filter((badge) => badge.subject).map((badge) => String(badge.subject));
  const subjectIds = [...new Set([...Object.keys(points), ...Object.keys(answers), ...badgeSubjects])].filter(isObjectIdHex);
  const subjects =
    subjectIds.length > 0
      ? await Subject.find({ _id: { $in: subjectIds.map(toObjectId) } }).select('name code color').lean()
      : [];
  const subjectById = new Map(subjects.map((subject) => [String(subject._id), summarizeSubject(subject)]));

  const year = time.currentAcademicYear();
  const season = profile.season?.year === year ? profile.season : null;

  return {
    user: { id: String(user._id), firstname: user.firstname, lastname: user.lastname, role: user.role },
    reputation: Math.max(0, profile.points ?? 0),
    questions: Math.max(0, profile.questions ?? 0),
    answers: Math.max(0, profile.answers ?? 0),
    acceptedAnswers: Math.max(0, profile.acceptedAnswers ?? 0),
    bySubject: points,
    subjects: subjectIds
      .filter((id) => subjectById.has(id))
      .map((id) => ({ subject: subjectById.get(id), points: points[id] ?? 0, answers: answers[id] ?? 0 }))
      .filter((entry) => entry.points > 0 || entry.answers > 0)
      .sort((a, b) => b.points - a.points || b.answers - a.answers || a.subject.name.localeCompare(b.subject.name)),
    badges: [...(profile.badges ?? [])]
      .sort((a, b) => new Date(a.awardedAt) - new Date(b.awardedAt))
      .map((badge) => ({
        code: badge.code,
        ...(badge.subject ? { subject: subjectById.get(String(badge.subject)) ?? { id: String(badge.subject) } } : {}),
        awardedAt: badge.awardedAt,
      })),
    season: { academicYear: year, reputation: Math.max(0, season?.points ?? 0) },
  };
};

/**
 * GET /leaderboard?subject&limit: top reputation earned during the current academic year (overall, or in one
 * subject). Ties share a rank. → { academicYear, subject, items: [{ rank, user, reputation, badges }] }
 */
const leaderboard = async ({ subject, limit }) => {
  const year = time.currentAcademicYear();
  let subjectSummary = null;
  if (subject) {
    const doc = await Subject.findById(subject).select('name code color').lean();
    if (!doc) throw notFound('Subject');
    subjectSummary = summarizeSubject(doc);
  }
  const field = subject ? `season.bySubject.${String(subject)}` : 'season.points';
  const profiles = await ForumProfile.find({ 'season.year': year, [field]: { $gt: 0 } })
    .sort({ [field]: -1, updatedAt: 1, _id: 1 })
    .limit(limit + 20)
    .populate({ path: 'user', select: 'firstname lastname role' })
    .lean();

  const valueOf = (profile) => (subject ? profile.season?.bySubject?.[String(subject)] : profile.season?.points) ?? 0;
  const items = [];
  profiles
    .filter((profile) => isPopulated(profile.user))
    .slice(0, limit)
    .forEach((profile, index) => {
      const reputation = valueOf(profile);
      const previous = items[index - 1];
      items.push({
        rank: previous && previous.reputation === reputation ? previous.rank : index + 1,
        user: userSummary(profile.user),
        reputation,
        badges: (profile.badges ?? []).length,
      });
    });
  return { academicYear: year, subject: subjectSummary, items };
};

module.exports = {
  POINTS,
  BADGE_RULES,
  isAdmin,
  isAuthor,
  canSeeQuestion,
  canSeeAnswer,
  questionVisibility,
  answerVisibility,
  findVisibleQuestion,
  findVisibleAnswer,
  presentQuestions,
  presentAnswers,
  questionDetail,
  votePoints,
  changeProfile,
  awardBadges,
  recomputeProfile,
  listQuestions,
  significantWords,
  similarQuestions,
  popularTags,
  createQuestion,
  getQuestion,
  registerView,
  updateQuestion,
  deleteQuestion,
  createAnswer,
  updateAnswer,
  deleteAnswer,
  acceptAnswer,
  castVote,
  followQuestion,
  unfollowQuestion,
  reportContent,
  setHidden,
  listReports,
  resolveReport,
  getProfile,
  leaderboard,
  excerpt,
};
