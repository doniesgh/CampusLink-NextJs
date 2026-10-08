const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 4 (help forum): reputation, counters and badges of a user (contract section 2).
const BADGE_CODES = ['FIRST_ANSWER', 'ACTIVE_CONTRIBUTOR', 'HELPFUL', 'SUBJECT_EXPERT'];

const badgeSchema = new Schema(
  {
    code: { type: String, enum: BADGE_CODES, required: true },
    // SUBJECT_EXPERT only.
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    awardedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/*
 * Points are updated incrementally ($inc) by forumService. `points` is the raw sum of every reputation event and
 * may go below 0: the API shows `reputation = max(0, points)`, so reputation is never below 0 and removing a vote
 * always reverses exactly what the vote gave (no reputation farming by toggling a downvote on a 0-point user).
 * The same rule applies to `bySubject` ({ <subjectId>: points }) and to `season` (points earned during the
 * academic year `season.year`, reset at the first event of a new year; used by the leaderboard).
 */
const profileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    points: { type: Number, default: 0 },
    questions: { type: Number, default: 0 },
    answers: { type: Number, default: 0 },
    // Accepted answers on other users' questions.
    acceptedAnswers: { type: Number, default: 0 },
    bySubject: { type: Schema.Types.Mixed, default: () => ({}) },
    answersBySubject: { type: Schema.Types.Mixed, default: () => ({}) },
    season: {
      year: { type: String, default: null },
      points: { type: Number, default: 0 },
      bySubject: { type: Schema.Types.Mixed, default: () => ({}) },
    },
    badges: { type: [badgeSchema], default: [] },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      transform: (doc, ret) => ({
        id: String(ret._id),
        user: String(ret.user),
        reputation: Math.max(0, ret.points ?? 0),
        questions: Math.max(0, ret.questions ?? 0),
        answers: Math.max(0, ret.answers ?? 0),
        acceptedAnswers: Math.max(0, ret.acceptedAnswers ?? 0),
        bySubject: Object.fromEntries(
          Object.entries(ret.bySubject ?? {}).map(([subject, points]) => [subject, Math.max(0, points)])
        ),
        badges: (ret.badges ?? []).map((badge) => ({
          code: badge.code,
          ...(badge.subject ? { subject: String(badge.subject) } : {}),
          awardedAt: badge.awardedAt,
        })),
      }),
    },
  }
);

// Leaderboards: all-time and current academic year.
profileSchema.index({ points: -1 });
profileSchema.index({ 'season.year': 1, 'season.points': -1 });

const ForumProfile = mongoose.model('ForumProfile', profileSchema);

module.exports = ForumProfile;
module.exports.BADGE_CODES = BADGE_CODES;
