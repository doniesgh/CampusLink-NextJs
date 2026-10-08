const mongoose = require('mongoose');
const { refSummary } = require('../utils/serialize');

const Schema = mongoose.Schema;

const COMMENT_MAX_LENGTH = 500;

// Grade of one student for one assessment (phase 2 contract section 3.2). `score` is between 0 and the
// assessment's maxScore (checked by the controller), or null when the student has no score (e.g. absent).
const gradeSchema = new Schema(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    score: { type: Number, default: null, min: [0, 'score must be at least 0'] },
    comment: {
      type: String,
      trim: true,
      maxlength: [COMMENT_MAX_LENGTH, `Comment must be at most ${COMMENT_MAX_LENGTH} characters`],
      default: '',
    },
    gradedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    gradedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      // { id, assessment, student: { id, firstname, lastname }, score, comment, gradedAt }
      transform: (doc, ret) => ({
        id: String(ret._id),
        assessment: String(doc.assessment?._id ?? doc.assessment),
        student: refSummary(doc.student, ['firstname', 'lastname']),
        score: ret.score ?? null,
        comment: ret.comment || '',
        gradedAt: ret.gradedAt ?? null,
      }),
    },
  }
);

// One grade per student and assessment (also the grade sheet of an assessment).
gradeSchema.index({ assessment: 1, student: 1 }, { unique: true });
// A student's grades.
gradeSchema.index({ student: 1, assessment: 1 });

const Grade = mongoose.model('Grade', gradeSchema);

module.exports = Grade;
module.exports.COMMENT_MAX_LENGTH = COMMENT_MAX_LENGTH;
