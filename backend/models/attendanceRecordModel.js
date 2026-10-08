const mongoose = require('mongoose');
const { refSummary } = require('../utils/serialize');

const Schema = mongoose.Schema;

const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const NOTE_MAX_LENGTH = 500;
// Where a record comes from (internal: the demo seed only replaces its own records).
const RECORD_SOURCES = ['MANUAL', 'SEED'];

// Attendance of one student at one class session (Module 9, phase 2 contract section 3.1).
// At most one record per (session, student). No record = not marked yet.
const attendanceRecordSchema = new Schema(
  {
    session: { type: Schema.Types.ObjectId, ref: 'ClassSession', required: [true, 'Session is required'] },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: [true, 'Student is required'] },
    status: {
      type: String,
      required: [true, 'Status is required'],
      enum: { values: ATTENDANCE_STATUSES, message: `Status must be one of ${ATTENDANCE_STATUSES.join(', ')}` },
    },
    note: {
      type: String,
      trim: true,
      maxlength: [NOTE_MAX_LENGTH, `Note must be at most ${NOTE_MAX_LENGTH} characters`],
      default: '',
    },
    markedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    markedAt: { type: Date, default: null },
    // Internal (not serialized). An ABSENT mark taken before the session ended only counts once the
    // session is over: the "attendance.evaluate-alerts" job checks the absence alerts at that time.
    alertCheckAt: { type: Date, default: null },
    source: { type: String, enum: RECORD_SOURCES, default: 'MANUAL' },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc) => serializeRecord(doc),
    },
  }
);

// One record per student and session (also the roll call of a session).
attendanceRecordSchema.index({ session: 1, student: 1 }, { unique: true });
// A student's records (attendance summary, analytics).
attendanceRecordSchema.index({ student: 1, session: 1 });
// Pending alert checks (scheduler job).
attendanceRecordSchema.index(
  { alertCheckAt: 1 },
  { partialFilterExpression: { alertCheckAt: { $type: 'date' } } }
);

const toDate = (value) => (value === undefined || value === null ? null : new Date(value));

const serializeSessionRef = (session) => {
  const summary = refSummary(session, ['startsAt', 'endsAt', 'type', 'status']);
  if (!summary) return null;
  if (session && session.subject !== undefined) {
    summary.subject = refSummary(session.subject, ['name', 'code', 'color']);
  }
  return summary;
};

/**
 * Contract JSON: { id, session: { id, startsAt, endsAt, type, status, subject: { id, name, code, color } },
 *   student: { id, firstname, lastname }, status, note, markedBy: { id, firstname, lastname } | null,
 *   markedAt } (document or lean object populated with RECORD_POPULATE).
 */
const serializeRecord = (record) => ({
  id: String(record._id),
  session: serializeSessionRef(record.session),
  student: refSummary(record.student, ['firstname', 'lastname']),
  status: record.status,
  note: record.note || '',
  markedBy: refSummary(record.markedBy, ['firstname', 'lastname']),
  markedAt: toDate(record.markedAt),
});

// Populate options giving the contract shape. User projections leave out `group` (no group populate).
const RECORD_POPULATE = [
  {
    path: 'session',
    select: 'startsAt endsAt type status subject',
    populate: { path: 'subject', select: 'name code color' },
  },
  { path: 'student', select: 'firstname lastname' },
  { path: 'markedBy', select: 'firstname lastname' },
];

const AttendanceRecord = mongoose.model('AttendanceRecord', attendanceRecordSchema);

module.exports = AttendanceRecord;
module.exports.ATTENDANCE_STATUSES = ATTENDANCE_STATUSES;
module.exports.NOTE_MAX_LENGTH = NOTE_MAX_LENGTH;
module.exports.RECORD_SOURCES = RECORD_SOURCES;
module.exports.RECORD_POPULATE = RECORD_POPULATE;
module.exports.serializeRecord = serializeRecord;
