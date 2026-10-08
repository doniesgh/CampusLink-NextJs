const mongoose = require('mongoose');
const { idOf, isPopulated, refSummary } = require('../utils/serialize');

const Schema = mongoose.Schema;

const ASSESSMENT_TYPES = ['EXAM', 'QUIZ', 'PROJECT', 'LAB', 'OTHER'];
const TITLE_MAX_LENGTH = 200;
const DEFAULT_MAX_SCORE = 20;
const MAX_MAX_SCORE = 1000;
const DEFAULT_COEFFICIENT = 1;
const MAX_COEFFICIENT = 100;
const ASSESSMENT_SOURCES = ['MANUAL', 'SEED'];

// A graded assessment of a subject for one group (phase 2 contract section 3.2). Students only see it
// (and their grade) once it is published.
const assessmentSchema = new Schema(
  {
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: [true, 'Subject is required'] },
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: [true, 'Group is required'] },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [TITLE_MAX_LENGTH, `Title must be at most ${TITLE_MAX_LENGTH} characters`],
    },
    type: {
      type: String,
      required: [true, 'Type is required'],
      enum: { values: ASSESSMENT_TYPES, message: `Type must be one of ${ASSESSMENT_TYPES.join(', ')}` },
    },
    date: { type: Date, required: [true, 'Date is required'] },
    maxScore: {
      type: Number,
      default: DEFAULT_MAX_SCORE,
      min: [Number.MIN_VALUE, 'maxScore must be greater than 0'],
      max: [MAX_MAX_SCORE, `maxScore must be at most ${MAX_MAX_SCORE}`],
    },
    coefficient: {
      type: Number,
      default: DEFAULT_COEFFICIENT,
      min: [Number.MIN_VALUE, 'coefficient must be greater than 0'],
      max: [MAX_COEFFICIENT, `coefficient must be at most ${MAX_COEFFICIENT}`],
    },
    published: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Internal (not serialized): the demo seed only replaces its own assessments.
    source: { type: String, enum: ASSESSMENT_SOURCES, default: 'MANUAL' },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc) => serializeAssessment(doc),
    },
  }
);

// Lists per subject/group (newest first) and a group's published assessments (students).
assessmentSchema.index({ group: 1, subject: 1, date: -1 });
assessmentSchema.index({ subject: 1, date: -1 });

const summarizeGroupRef = (group) => {
  const id = idOf(group);
  if (!id) return null;
  if (!isPopulated(group)) return { id };
  return { id, name: group.name, level: group.level ?? null, academicYear: group.academicYear ?? null };
};

/**
 * Contract JSON: { id, subject: { id, name, code, color }, group: { id, name, level, academicYear }, title, type,
 *   date, maxScore, coefficient, published, publishedAt, createdBy: { id, firstname, lastname } | null,
 *   createdAt, updatedAt } (document or lean object populated with ASSESSMENT_POPULATE).
 */
const serializeAssessment = (assessment) => ({
  id: String(assessment._id),
  subject: refSummary(assessment.subject, ['name', 'code', 'color']),
  group: summarizeGroupRef(assessment.group),
  title: assessment.title,
  type: assessment.type,
  date: assessment.date ? new Date(assessment.date) : null,
  maxScore: assessment.maxScore ?? DEFAULT_MAX_SCORE,
  coefficient: assessment.coefficient ?? DEFAULT_COEFFICIENT,
  published: Boolean(assessment.published),
  publishedAt: assessment.publishedAt ? new Date(assessment.publishedAt) : null,
  createdBy: refSummary(assessment.createdBy, ['firstname', 'lastname']),
  createdAt: assessment.createdAt ? new Date(assessment.createdAt) : null,
  updatedAt: assessment.updatedAt ? new Date(assessment.updatedAt) : null,
});

const ASSESSMENT_POPULATE = [
  { path: 'subject', select: 'name code color' },
  { path: 'group', select: 'name level academicYear' },
  { path: 'createdBy', select: 'firstname lastname' },
];

const Assessment = mongoose.model('Assessment', assessmentSchema);

module.exports = Assessment;
module.exports.ASSESSMENT_TYPES = ASSESSMENT_TYPES;
module.exports.TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
module.exports.DEFAULT_MAX_SCORE = DEFAULT_MAX_SCORE;
module.exports.MAX_MAX_SCORE = MAX_MAX_SCORE;
module.exports.DEFAULT_COEFFICIENT = DEFAULT_COEFFICIENT;
module.exports.MAX_COEFFICIENT = MAX_COEFFICIENT;
module.exports.ASSESSMENT_POPULATE = ASSESSMENT_POPULATE;
module.exports.serializeAssessment = serializeAssessment;
