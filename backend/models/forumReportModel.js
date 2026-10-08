const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 4 (help forum): a user's report of a question or an answer, handled by ADMINs.
const TARGET_TYPES = ['QUESTION', 'ANSWER'];
const STATUSES = ['OPEN', 'RESOLVED'];
// HIDDEN: the content was hidden (by the hide action or before the report was resolved); NO_ACTION: dismissed.
const OUTCOMES = ['HIDDEN', 'NO_ACTION'];
const REASON_MIN_LENGTH = 5;
const REASON_MAX_LENGTH = 500;
const NOTE_MAX_LENGTH = 500;

const reportSchema = new Schema(
  {
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    target: { type: Schema.Types.ObjectId, required: true },
    // The question itself, or the question of the reported answer (links of the moderation queue).
    question: { type: Schema.Types.ObjectId, ref: 'ForumQuestion', required: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, minlength: REASON_MIN_LENGTH, maxlength: REASON_MAX_LENGTH },
    status: { type: String, enum: STATUSES, default: 'OPEN' },
    outcome: { type: String, enum: [...OUTCOMES, null], default: null },
    note: { type: String, trim: true, maxlength: NOTE_MAX_LENGTH, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      // What the reporter gets back; ADMINs get the detailed shape built by forumService.
      transform: (doc, ret) => ({
        id: String(ret._id),
        targetType: ret.targetType,
        targetId: String(ret.target),
        questionId: String(ret.question),
        reason: ret.reason,
        status: ret.status,
        createdAt: ret.createdAt,
      }),
    },
  }
);

// Moderation queue (by status, newest first) and the reports of a target.
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, target: 1, status: 1 });
reportSchema.index({ question: 1 });
// One open report per user and target (reporting again returns it).
reportSchema.index(
  { reporter: 1, targetType: 1, target: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } }
);

const ForumReport = mongoose.model('ForumReport', reportSchema);

module.exports = ForumReport;
module.exports.TARGET_TYPES = TARGET_TYPES;
module.exports.STATUSES = STATUSES;
module.exports.OUTCOMES = OUTCOMES;
module.exports.REASON_MIN_LENGTH = REASON_MIN_LENGTH;
module.exports.REASON_MAX_LENGTH = REASON_MAX_LENGTH;
module.exports.NOTE_MAX_LENGTH = NOTE_MAX_LENGTH;
