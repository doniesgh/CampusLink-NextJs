const mongoose = require('mongoose');
const { idOf } = require('../utils/serialize');
const { summarizeAuthor, HIDDEN_REASON_MAX_LENGTH } = require('./forumQuestionModel');

const Schema = mongoose.Schema;

// Module 4 (help forum), phase 2 contract section 2.
const BODY_MIN_LENGTH = 2;
const BODY_MAX_LENGTH = 10000;
// clientRequestId of the offline outbox (any UUID version), stored lowercase.
const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const answerSchema = new Schema(
  {
    question: { type: Schema.Types.ObjectId, ref: 'ForumQuestion', required: true },
    // Subject of the question when the answer was posted: reputation points of the answer go to this subject.
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    // Plain text: line breaks are kept, clients never render HTML.
    body: { type: String, required: true, minlength: BODY_MIN_LENGTH, maxlength: BODY_MAX_LENGTH },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorSnapshot: {
      firstname: { type: String, default: '' },
      lastname: { type: String, default: '' },
      role: { type: String, default: null },
    },
    // Written by a TEACHER.
    certified: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    // Idempotency key of the offline outbox: the same author + id returns the first answer.
    clientRequestId: { type: String, default: undefined, match: CLIENT_REQUEST_ID_PATTERN },
    hidden: { type: Boolean, default: false },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    hiddenReason: { type: String, trim: true, maxlength: HIDDEN_REASON_MAX_LENGTH, default: null },
    // Set while the answer is being deleted (it is invisible and can no longer be accepted, hidden or voted on).
    deleting: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      // Public shape without the viewer fields (the API adds `accepted` and `myVote`, see forumService).
      transform: (doc) => serializeAnswer(doc),
    },
  }
);

// Answers of a question (oldest first) and answers of an author (profiles, analytics).
answerSchema.index({ question: 1, createdAt: 1 });
answerSchema.index({ author: 1, createdAt: -1 });
// Offline replays: one answer per author and clientRequestId.
answerSchema.index(
  { author: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } }
);

const ANSWER_POPULATE = [{ path: 'author', select: 'firstname lastname role' }];

/**
 * Answer JSON (contract section 2): { id, questionId, body, author: { id, firstname, lastname, role }, certified,
 * accepted, score, myVote, hidden, hiddenAt, hiddenReason, createdAt, editedAt }.
 * `viewer` = { acceptedAnswerId, myVote }. Hidden answers are only served to ADMINs and their author.
 */
function serializeAnswer(doc, viewer = {}) {
  const hidden = Boolean(doc.hidden);
  return {
    id: String(doc._id),
    questionId: idOf(doc.question),
    body: doc.body,
    author: summarizeAuthor(doc),
    certified: Boolean(doc.certified),
    accepted: viewer.acceptedAnswerId ? String(viewer.acceptedAnswerId) === String(doc._id) : false,
    score: doc.score ?? 0,
    myVote: viewer.myVote ?? 0,
    hidden,
    hiddenAt: hidden ? doc.hiddenAt ?? null : null,
    hiddenReason: hidden ? doc.hiddenReason ?? null : null,
    createdAt: doc.createdAt,
    editedAt: doc.editedAt ?? null,
  };
}

const ForumAnswer = mongoose.model('ForumAnswer', answerSchema);

module.exports = ForumAnswer;
module.exports.BODY_MIN_LENGTH = BODY_MIN_LENGTH;
module.exports.BODY_MAX_LENGTH = BODY_MAX_LENGTH;
module.exports.CLIENT_REQUEST_ID_PATTERN = CLIENT_REQUEST_ID_PATTERN;
module.exports.ANSWER_POPULATE = ANSWER_POPULATE;
module.exports.serializeAnswer = serializeAnswer;
