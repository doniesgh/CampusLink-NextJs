const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 4 (help forum): "user follows question" (FORUM notification for each new answer).
// Authors follow their own questions automatically.
const followSchema = new Schema(
  {
    question: { type: Schema.Types.ObjectId, ref: 'ForumQuestion', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    toJSON: {
      transform: (doc, ret) => ({
        id: String(ret._id),
        question: String(ret.question),
        user: String(ret.user),
        createdAt: ret.createdAt,
      }),
    },
  }
);

followSchema.index({ question: 1, user: 1 }, { unique: true });
followSchema.index({ user: 1, question: 1 });

const ForumFollow = mongoose.model('ForumFollow', followSchema);

module.exports = ForumFollow;
