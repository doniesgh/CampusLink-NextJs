const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 4 (help forum): "user viewed question on day D" (campus timezone), so that viewCount grows at most once
// per user and day. The unique index makes concurrent views of the same user count once. Kept 2 days (TTL).
const RETENTION_SECONDS = 2 * 24 * 60 * 60;

const viewSchema = new Schema(
  {
    question: { type: Schema.Types.ObjectId, ref: 'ForumQuestion', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // "YYYY-MM-DD" in APP_TIMEZONE.
    day: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    toJSON: {
      transform: (doc, ret) => ({
        id: String(ret._id),
        question: String(ret.question),
        user: String(ret.user),
        day: ret.day,
        createdAt: ret.createdAt,
      }),
    },
  }
);

viewSchema.index({ question: 1, user: 1, day: 1 }, { unique: true });
viewSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

const ForumView = mongoose.model('ForumView', viewSchema);

module.exports = ForumView;
