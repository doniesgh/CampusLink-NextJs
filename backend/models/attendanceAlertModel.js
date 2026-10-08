const mongoose = require('mongoose');
const { idOf, isPopulated, refSummary } = require('../utils/serialize');

const Schema = mongoose.Schema;

const ALERT_LEVELS = ['WARNING', 'CRITICAL'];
const ALERT_SOURCES = ['MANUAL', 'SEED'];

// Absence alert of a student in a subject (phase 2 contract section 3.1): created once per level when the
// unexcused absence rate reaches ABSENCE_WARNING_RATE (WARNING) or ABSENCE_ALERT_RATE (CRITICAL).
const attendanceAlertSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    level: {
      type: String,
      required: true,
      enum: { values: ALERT_LEVELS, message: `Level must be one of ${ALERT_LEVELS.join(', ')}` },
    },
    // Absence rate (0..1) when the alert was raised.
    rate: { type: Number, required: true, min: 0, max: 1 },
    // Group of the student when the alert was raised (internal: filters and the admin list).
    group: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    source: { type: String, enum: ALERT_SOURCES, default: 'MANUAL' },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: (doc) => serializeAlert(doc),
    },
  }
);

// At most one alert per student, subject and level; the unique index makes it race-free.
attendanceAlertSchema.index({ student: 1, subject: 1, level: 1 }, { unique: true });
// Admin list (newest first), by group and level.
attendanceAlertSchema.index({ createdAt: -1, _id: -1 });
attendanceAlertSchema.index({ group: 1, createdAt: -1 });

const summarizeStudent = (student) => {
  const summary = refSummary(student, ['firstname', 'lastname']);
  if (!summary) return null;
  if (isPopulated(student) && student.group !== undefined) {
    const group = student.group;
    summary.group = idOf(group) ? { id: idOf(group), name: isPopulated(group) ? group.name : null } : null;
  }
  return summary;
};

/**
 * JSON: { id, student: { id, firstname, lastname, group: { id, name } | null }, subject: { id, name, code, color },
 *   level, rate, createdAt } (document or lean object populated with ALERT_POPULATE).
 */
const serializeAlert = (alert) => ({
  id: String(alert._id),
  student: summarizeStudent(alert.student),
  subject: refSummary(alert.subject, ['name', 'code', 'color']),
  level: alert.level,
  rate: alert.rate,
  createdAt: alert.createdAt ? new Date(alert.createdAt) : null,
});

// The student projection keeps `group`, so the User find hook populates it (name used here).
const ALERT_POPULATE = [
  { path: 'student', select: 'firstname lastname group' },
  { path: 'subject', select: 'name code color' },
];

const AttendanceAlert = mongoose.model('AttendanceAlert', attendanceAlertSchema);

module.exports = AttendanceAlert;
module.exports.ALERT_LEVELS = ALERT_LEVELS;
module.exports.ALERT_SOURCES = ALERT_SOURCES;
module.exports.ALERT_POPULATE = ALERT_POPULATE;
module.exports.serializeAlert = serializeAlert;
