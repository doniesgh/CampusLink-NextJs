const mongoose = require('mongoose');
const { idOf, isPopulated } = require('../utils/serialize');

const Schema = mongoose.Schema;

// Module 4 (help forum), phase 2 contract section 2.
const STATUSES = ['OPEN', 'CLOSED'];
const TITLE_MIN_LENGTH = 10;
const TITLE_MAX_LENGTH = 200;
const BODY_MIN_LENGTH = 20;
const BODY_MAX_LENGTH = 10000;
const CHAPTER_MAX_LENGTH = 100;
const MAX_TAGS = 5;
const TAG_MIN_LENGTH = 2;
const TAG_MAX_LENGTH = 30;
const MIN_LEVEL = 1;
const MAX_LEVEL = 5;
const HIDDEN_REASON_MAX_LENGTH = 500;
// Lowercase letters (any script), digits and + # . _ - (e.g. "sql", "c++", "c#", "node.js"); starts with a letter or digit.
const TAG_PATTERN = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N}+#._-]*$/u;

const authorSnapshotSchema = new Schema(
  {
    firstname: { type: String, default: '' },
    lastname: { type: String, default: '' },
    role: { type: String, default: null },
  },
  { _id: false }
);

const questionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: TITLE_MIN_LENGTH, maxlength: TITLE_MAX_LENGTH },
    // Plain text: line breaks are kept, clients never render HTML.
    body: { type: String, required: true, minlength: BODY_MIN_LENGTH, maxlength: BODY_MAX_LENGTH },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    chapter: { type: String, trim: true, maxlength: CHAPTER_MAX_LENGTH, default: null },
    level: {
      type: Number,
      min: MIN_LEVEL,
      max: MAX_LEVEL,
      default: null,
      validate: { validator: (value) => value === null || Number.isInteger(value), message: 'level must be an integer' },
    },
    tags: {
      type: [{ type: String, lowercase: true, trim: true, minlength: TAG_MIN_LENGTH, maxlength: TAG_MAX_LENGTH }],
      default: [],
      validate: { validator: (tags) => tags.length <= MAX_TAGS, message: `At most ${MAX_TAGS} tags` },
    },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Copy of the author's name and role, used when the account no longer exists.
    authorSnapshot: { type: authorSnapshotSchema, default: () => ({}) },
    // Sum of the votes (+1 / -1).
    score: { type: Number, default: 0 },
    // Answers that are not hidden (shown to everyone).
    answerCount: { type: Number, default: 0 },
    // Every answer, hidden ones included: a question with answers cannot be deleted. Incremented before an answer
    // is created (a reservation), so a concurrent delete never leaves orphan answers.
    answersTotal: { type: Number, default: 0 },
    acceptedAnswer: { type: Schema.Types.ObjectId, ref: 'ForumAnswer', default: null },
    acceptedAt: { type: Date, default: null },
    // A non-hidden answer written by a TEACHER exists.
    hasCertifiedAnswer: { type: Boolean, default: false },
    // Distinct users per campus day (ForumView).
    viewCount: { type: Number, default: 0 },
    status: { type: String, enum: STATUSES, default: 'OPEN' },
    // Moderation: hidden content is visible only to ADMINs and its author.
    hidden: { type: Boolean, default: false },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    hiddenReason: { type: String, trim: true, maxlength: HIDDEN_REASON_MAX_LENGTH, default: null },
    // New answer, accepted answer change or edit.
    lastActivityAt: { type: Date, default: Date.now },
    editedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      // Public shape without the viewer fields (the API adds `following` and `myVote`, see forumService).
      transform: (doc, ret) => serializeQuestion(doc),
    },
  }
);

// Full-text search (contract: title 5, tags 3, body 1). No language: no stemming and no stop words, so French
// and English content behave the same way (matching ignores case and diacritics).
questionSchema.index(
  { title: 'text', tags: 'text', body: 'text' },
  { weights: { title: 5, tags: 3, body: 1 }, default_language: 'none', name: 'forum_question_text' }
);
questionSchema.index({ hidden: 1, createdAt: -1 });
questionSchema.index({ subject: 1, createdAt: -1 });
questionSchema.index({ tags: 1 });
questionSchema.index({ author: 1, createdAt: -1 });
questionSchema.index({ lastActivityAt: -1 });
questionSchema.index({ score: -1, createdAt: -1 });
questionSchema.index({ acceptedAnswer: 1 });

const QUESTION_POPULATE = [
  { path: 'subject', select: 'name code color' },
  { path: 'author', select: 'firstname lastname role' },
];

// { id, name, code, color } of a populated subject; null when the subject no longer exists.
function summarizeSubject(subject) {
  if (!isPopulated(subject)) return null;
  return { id: String(subject._id), name: subject.name, code: subject.code, color: subject.color };
}

// { id, firstname, lastname, role } from the populated author, or from the snapshot when the account is gone.
function summarizeAuthor(doc) {
  const author = doc.author;
  const id = idOf(author) ?? (typeof doc.populated === 'function' ? idOf(doc.populated('author')) : null);
  if (!id) return null;
  if (isPopulated(author)) {
    return { id, firstname: author.firstname, lastname: author.lastname, role: author.role };
  }
  const snapshot = doc.authorSnapshot ?? {};
  return { id, firstname: snapshot.firstname ?? '', lastname: snapshot.lastname ?? '', role: snapshot.role ?? null };
}

/**
 * Question JSON (contract section 2) of a document or a lean object (subject and author populated):
 * { id, title, body, subject: { id, name, code, color }, chapter, level, tags, author: { id, firstname, lastname, role },
 *   score, answerCount, acceptedAnswerId, hasCertifiedAnswer, following, myVote, viewCount, status, hidden,
 *   hiddenAt, hiddenReason, createdAt, lastActivityAt, editedAt }
 * `viewer` = { following, myVote }. Hidden questions are only served to ADMINs and their author (with the notice fields).
 */
function serializeQuestion(doc, viewer = {}) {
  const hidden = Boolean(doc.hidden);
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    subject: summarizeSubject(doc.subject),
    chapter: doc.chapter ?? null,
    level: doc.level ?? null,
    tags: [...(doc.tags ?? [])],
    author: summarizeAuthor(doc),
    score: doc.score ?? 0,
    answerCount: Math.max(0, doc.answerCount ?? 0),
    acceptedAnswerId: idOf(doc.acceptedAnswer),
    hasCertifiedAnswer: Boolean(doc.hasCertifiedAnswer),
    following: Boolean(viewer.following),
    myVote: viewer.myVote ?? 0,
    viewCount: doc.viewCount ?? 0,
    status: doc.status,
    hidden,
    hiddenAt: hidden ? doc.hiddenAt ?? null : null,
    hiddenReason: hidden ? doc.hiddenReason ?? null : null,
    createdAt: doc.createdAt,
    lastActivityAt: doc.lastActivityAt ?? doc.createdAt,
    editedAt: doc.editedAt ?? null,
  };
}

const ForumQuestion = mongoose.model('ForumQuestion', questionSchema);

module.exports = ForumQuestion;
module.exports.STATUSES = STATUSES;
module.exports.TITLE_MIN_LENGTH = TITLE_MIN_LENGTH;
module.exports.TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
module.exports.BODY_MIN_LENGTH = BODY_MIN_LENGTH;
module.exports.BODY_MAX_LENGTH = BODY_MAX_LENGTH;
module.exports.CHAPTER_MAX_LENGTH = CHAPTER_MAX_LENGTH;
module.exports.MAX_TAGS = MAX_TAGS;
module.exports.TAG_MIN_LENGTH = TAG_MIN_LENGTH;
module.exports.TAG_MAX_LENGTH = TAG_MAX_LENGTH;
module.exports.TAG_PATTERN = TAG_PATTERN;
module.exports.MIN_LEVEL = MIN_LEVEL;
module.exports.MAX_LEVEL = MAX_LEVEL;
module.exports.HIDDEN_REASON_MAX_LENGTH = HIDDEN_REASON_MAX_LENGTH;
module.exports.QUESTION_POPULATE = QUESTION_POPULATE;
module.exports.serializeQuestion = serializeQuestion;
module.exports.summarizeSubject = summarizeSubject;
module.exports.summarizeAuthor = summarizeAuthor;
