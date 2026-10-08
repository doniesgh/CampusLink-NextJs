const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 4 (help forum): a +1 / -1 vote of a user on a question or an answer (at most one per user and target).
const TARGET_TYPES = ['QUESTION', 'ANSWER'];
const VALUES = [1, -1];

const voteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    target: { type: Schema.Types.ObjectId, required: true },
    // Author of the target (receives the reputation) and subject the points go to, copied when voting so that
    // removing the vote later reverses exactly what was given.
    targetAuthor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    // 1 or -1 (0 only for an instant, while a removed vote is being deleted).
    value: { type: Number, enum: [...VALUES, 0], required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => ({
        id: String(ret._id),
        targetType: ret.targetType,
        targetId: String(ret.target),
        value: ret.value,
        createdAt: ret.createdAt,
        updatedAt: ret.updatedAt,
      }),
    },
  }
);

voteSchema.index({ user: 1, targetType: 1, target: 1 }, { unique: true });
// Votes of a target (deletion) and votes received by an author (profile recomputation).
voteSchema.index({ targetType: 1, target: 1 });
voteSchema.index({ targetAuthor: 1 });

const ForumVote = mongoose.model('ForumVote', voteSchema);

module.exports = ForumVote;
module.exports.TARGET_TYPES = TARGET_TYPES;
module.exports.VALUES = VALUES;
