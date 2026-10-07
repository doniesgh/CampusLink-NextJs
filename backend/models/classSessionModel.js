const mongoose = require('mongoose');
const { idOf, isPopulated, refSummary } = require('../utils/serialize');

const Schema = mongoose.Schema;

const SESSION_TYPES = ['LECTURE', 'TUTORIAL', 'LAB', 'EXAM', 'OTHER'];
const SESSION_STATUSES = ['SCHEDULED', 'CANCELLED'];
const CHANGE_KINDS = ['ROOM', 'TIME', 'CANCELLED'];
// Where a session comes from (internal: the demo seed only replaces its own sessions).
const SESSION_SOURCES = ['MANUAL', 'IMPORT', 'SEED'];
const NOTES_MAX_LENGTH = 1000;
const MAX_GROUPS = 20;
// A session lasts at most 8 hours (contract section 6). Range queries rely on it: a session that
// overlaps [from, to) starts after `from - MAX_DURATION_MS`, so they can use the startsAt indexes.
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

// Last significant change of a session (room, time or cancellation), shown by the clients as
// "Moved from B12" / "Cancelled". Stored without _id.
const changeSchema = new Schema(
  {
    kind: { type: String, enum: CHANGE_KINDS, required: true },
    previousRoom: {
      type: new Schema({ id: { type: Schema.Types.ObjectId, ref: 'Room' }, name: String }, { _id: false }),
      default: undefined,
    },
    previousStartsAt: { type: Date, default: undefined },
    previousEndsAt: { type: Date, default: undefined },
    changedAt: { type: Date, required: true },
  },
  { _id: false }
);

// One class session (an occurrence). Weekly series share a seriesId.
const classSessionSchema = new Schema(
  {
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: [true, 'Subject is required'] },
    teacher: { type: Schema.Types.ObjectId, ref: 'User', required: [true, 'Teacher is required'] },
    groups: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Group' }],
      validate: {
        validator: (value) => Array.isArray(value) && value.length >= 1 && value.length <= MAX_GROUPS,
        message: `A session needs 1 to ${MAX_GROUPS} groups`,
      },
    },
    room: { type: Schema.Types.ObjectId, ref: 'Room', default: null },
    startsAt: { type: Date, required: [true, 'Start is required'] },
    endsAt: { type: Date, required: [true, 'End is required'] },
    type: {
      type: String,
      enum: { values: SESSION_TYPES, message: `Type must be one of ${SESSION_TYPES.join(', ')}` },
      default: 'LECTURE',
    },
    status: {
      type: String,
      enum: { values: SESSION_STATUSES, message: `Status must be one of ${SESSION_STATUSES.join(', ')}` },
      default: 'SCHEDULED',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [NOTES_MAX_LENGTH, `Notes must be at most ${NOTES_MAX_LENGTH} characters`],
      default: '',
    },
    seriesId: { type: Schema.Types.ObjectId, default: null },
    change: { type: changeSchema, default: null },
    // Internal (not serialized).
    // Change in place before a cancellation, put back when the session is restored.
    changeBeforeCancel: { type: changeSchema, default: null },
    // ICS SEQUENCE: incremented on every update so calendar apps replace the event.
    sequence: { type: Number, default: 0 },
    source: { type: String, enum: SESSION_SOURCES, default: 'MANUAL' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc) => serializeSession(doc),
    },
  }
);

// Range queries of the timetables (/me, browse, ICS) and conflict checks (same room / teacher /
// group in an overlapping time range) all start with an equality on one of these fields.
classSessionSchema.index({ groups: 1, startsAt: 1 });
classSessionSchema.index({ teacher: 1, startsAt: 1 });
classSessionSchema.index({ room: 1, startsAt: 1 });
// "This and following occurrences" of a series.
classSessionSchema.index({ seriesId: 1, startsAt: 1 });
// Academic structure "in use" checks (subject → sessions).
classSessionSchema.index({ subject: 1 });

const toDate = (value) => (value === undefined || value === null ? null : new Date(value));

const serializeChange = (change) => {
  if (!change || !change.kind) return null;
  const result = { kind: change.kind };
  if (change.previousRoom && change.previousRoom.id) {
    result.previousRoom = { id: String(change.previousRoom.id), name: change.previousRoom.name ?? null };
  }
  if (change.previousStartsAt) result.previousStartsAt = toDate(change.previousStartsAt);
  if (change.previousEndsAt) result.previousEndsAt = toDate(change.previousEndsAt);
  result.changedAt = toDate(change.changedAt);
  return result;
};

const serializeGroupRef = (group) => {
  const id = idOf(group);
  if (!id) return null;
  if (!isPopulated(group)) return { id };
  return {
    id,
    name: group.name,
    level: group.level,
    program: group.program ? refSummary(group.program, ['code']) : null,
  };
};

/**
 * Contract JSON of a session (document or lean object, populated with SESSION_POPULATE):
 * { id, subject: { id, name, code, color }, teacher: { id, firstname, lastname },
 *   groups: [{ id, name, level, program: { id, code } }], room: { id, name, building } | null,
 *   startsAt, endsAt, type, status, notes, seriesId | null, change | null, createdAt, updatedAt }
 */
const serializeSession = (session) => {
  const room = refSummary(session.room, ['name', 'building']);
  if (room && room.building === null) room.building = '';
  return {
    id: String(session._id),
    subject: refSummary(session.subject, ['name', 'code', 'color']),
    teacher: refSummary(session.teacher, ['firstname', 'lastname']),
    groups: (session.groups || []).map(serializeGroupRef).filter(Boolean),
    room,
    startsAt: toDate(session.startsAt),
    endsAt: toDate(session.endsAt),
    type: session.type,
    status: session.status,
    notes: session.notes || '',
    seriesId: session.seriesId ? String(session.seriesId) : null,
    change: serializeChange(session.change),
    createdAt: toDate(session.createdAt),
    updatedAt: toDate(session.updatedAt),
  };
};

// Populate options giving the contract shape. The teacher projection leaves out `group`, so the
// User find hook does not populate it.
const SESSION_POPULATE = [
  { path: 'subject', select: 'name code color' },
  { path: 'teacher', select: 'firstname lastname' },
  { path: 'groups', select: 'name level program', populate: { path: 'program', select: 'code' } },
  { path: 'room', select: 'name building' },
];

const ClassSession = mongoose.model('ClassSession', classSessionSchema);

module.exports = ClassSession;
module.exports.SESSION_TYPES = SESSION_TYPES;
module.exports.SESSION_STATUSES = SESSION_STATUSES;
module.exports.CHANGE_KINDS = CHANGE_KINDS;
module.exports.SESSION_SOURCES = SESSION_SOURCES;
module.exports.NOTES_MAX_LENGTH = NOTES_MAX_LENGTH;
module.exports.MAX_GROUPS = MAX_GROUPS;
module.exports.MAX_DURATION_MS = MAX_DURATION_MS;
module.exports.SESSION_POPULATE = SESSION_POPULATE;
module.exports.serializeSession = serializeSession;
