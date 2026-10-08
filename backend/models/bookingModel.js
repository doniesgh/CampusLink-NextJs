const mongoose = require('mongoose');
const { idOf, isPopulated } = require('../utils/serialize');

const Schema = mongoose.Schema;

// Room and equipment bookings (Module 5, phase 2 contract section 1.2).
const RESOURCE_TYPES = ['ROOM', 'EQUIPMENT'];
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'];
// Bookings that hold their resource (they block other bookings and count toward the student limit).
const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'];
const BOOKING_SOURCES = ['APP', 'SEED'];
const PURPOSE_MIN_LENGTH = 2;
const PURPOSE_MAX_LENGTH = 300;
const NOTE_MAX_LENGTH = 500;
// Longest booking (TEACHER / ADMIN). Range queries rely on it: a booking overlapping [from, to)
// starts after `from - MAX_DURATION_MS`, so they can use the startsAt indexes.
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

// Admin decision on a PENDING booking (approve / reject). The admin's name is snapshotted.
const decisionSchema = new Schema(
  {
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bySnapshot: { firstname: { type: String, default: '' }, lastname: { type: String, default: '' } },
    at: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: NOTE_MAX_LENGTH, default: '' },
  },
  { _id: false }
);

// Who cancelled the booking (internal; the JSON gives cancelledAt and cancelledBy: OWNER | ADMIN).
const cancellationSchema = new Schema(
  {
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, required: true },
    byOwner: { type: Boolean, default: true },
  },
  { _id: false }
);

const bookingSchema = new Schema(
  {
    resourceType: {
      type: String,
      required: [true, 'Resource type is required'],
      enum: { values: RESOURCE_TYPES, message: `Resource type must be one of ${RESOURCE_TYPES.join(', ')}` },
    },
    room: { type: Schema.Types.ObjectId, ref: 'Room', default: null },
    equipment: { type: Schema.Types.ObjectId, ref: 'Equipment', default: null },
    // Copy of the resource at booking time, used when it no longer exists.
    resourceSnapshot: {
      name: { type: String, default: '' },
      building: { type: String, default: '' },
      capacity: { type: Number, default: null },
      type: { type: String, default: null },
      category: { type: String, default: null },
    },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: [true, 'User is required'] },
    // Copy of the requester's name and role, used when the account no longer exists.
    userSnapshot: {
      firstname: { type: String, default: '' },
      lastname: { type: String, default: '' },
      role: { type: String, default: null },
    },
    purpose: {
      type: String,
      required: [true, 'Purpose is required'],
      trim: true,
      minlength: [PURPOSE_MIN_LENGTH, `Purpose must be at least ${PURPOSE_MIN_LENGTH} characters`],
      maxlength: [PURPOSE_MAX_LENGTH, `Purpose must be at most ${PURPOSE_MAX_LENGTH} characters`],
    },
    startsAt: { type: Date, required: [true, 'Start is required'] },
    endsAt: { type: Date, required: [true, 'End is required'] },
    status: {
      type: String,
      enum: { values: BOOKING_STATUSES, message: `Status must be one of ${BOOKING_STATUSES.join(', ')}` },
      default: 'PENDING',
    },
    decision: { type: decisionSchema, default: null },
    cancellation: { type: cancellationSchema, default: null },
    // Set atomically by the reminder job (one reminder per booking).
    reminderSentAt: { type: Date, default: null },
    // Internal (not serialized): when the admins were notified of this PENDING request. Admin notifications are
    // coalesced per requester (service/bookingService.js, notifyAdminsOfRequest).
    requestNotifiedAt: { type: Date, default: null },
    // Optimistic locking: every status change sends the version it read and increments it.
    version: { type: Number, default: 0 },
    // Internal: the demo seed only replaces its own bookings.
    source: { type: String, enum: BOOKING_SOURCES, default: 'APP' },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc) => serializeBooking(doc),
    },
  }
);

// Availability, conflicts and "in use" checks of a resource.
bookingSchema.index({ room: 1, startsAt: 1 });
bookingSchema.index({ equipment: 1, startsAt: 1 });
// My bookings and the student limit.
bookingSchema.index({ user: 1, startsAt: -1 });
// Admin lists (by status), statistics and the reminder job.
bookingSchema.index({ status: 1, startsAt: 1 });
bookingSchema.index({ status: 1, reminderSentAt: 1, startsAt: 1 });
// Coalescing of the admin notifications: a requester's latest notified request (only those documents are indexed).
bookingSchema.index(
  { user: 1, requestNotifiedAt: -1 },
  { partialFilterExpression: { requestNotifiedAt: { $type: 'date' } } }
);

const toDate = (value) => (value === undefined || value === null ? null : new Date(value));

// Id of a reference even when populate found nothing (deleted document): doc.populated(path).
const refId = (doc, path, value) =>
  idOf(value) ?? (typeof doc.populated === 'function' ? idOf(doc.populated(path)) : null);

const serializeRoom = (doc) => {
  const id = refId(doc, 'room', doc.room);
  if (!id) return null;
  const source = isPopulated(doc.room) ? doc.room : doc.resourceSnapshot ?? {};
  return {
    id,
    name: source.name ?? '',
    building: source.building || '',
    capacity: source.capacity ?? null,
    type: source.type ?? null,
  };
};

const serializeEquipmentRef = (doc) => {
  const id = refId(doc, 'equipment', doc.equipment);
  if (!id) return null;
  const source = isPopulated(doc.equipment) ? doc.equipment : doc.resourceSnapshot ?? {};
  return { id, name: source.name ?? '', category: source.category ?? null };
};

const serializeUser = (doc) => {
  const id = refId(doc, 'user', doc.user);
  if (!id) return null;
  const source = isPopulated(doc.user) ? doc.user : doc.userSnapshot ?? {};
  return { id, firstname: source.firstname ?? '', lastname: source.lastname ?? '', role: source.role ?? null };
};

const serializeDecision = (doc) => {
  const decision = doc.decision;
  if (!decision || !decision.at) return null;
  const by = decision.by;
  const id = idOf(by) ?? (typeof doc.populated === 'function' ? idOf(doc.populated('decision.by')) : null);
  const source = isPopulated(by) ? by : decision.bySnapshot ?? {};
  return {
    by: id ? { id, firstname: source.firstname ?? '', lastname: source.lastname ?? '' } : null,
    at: toDate(decision.at),
    note: decision.note || '',
  };
};

/**
 * Contract JSON of a booking (document populated with BOOKING_POPULATE, or not):
 * { id, resourceType, room: { id, name, building, capacity, type } | null, equipment: { id, name, category } | null,
 *   user: { id, firstname, lastname, role }, purpose, startsAt, endsAt, status,
 *   decision: { by: { id, firstname, lastname }, at, note } | null, version, createdAt, updatedAt }
 * plus cancelledAt / cancelledBy ("OWNER" | "ADMIN") for cancelled bookings (null otherwise).
 */
const serializeBooking = (doc) => ({
  id: String(doc._id),
  resourceType: doc.resourceType,
  room: doc.resourceType === 'ROOM' ? serializeRoom(doc) : null,
  equipment: doc.resourceType === 'EQUIPMENT' ? serializeEquipmentRef(doc) : null,
  user: serializeUser(doc),
  purpose: doc.purpose,
  startsAt: toDate(doc.startsAt),
  endsAt: toDate(doc.endsAt),
  status: doc.status,
  decision: serializeDecision(doc),
  cancelledAt: doc.status === 'CANCELLED' && doc.cancellation ? toDate(doc.cancellation.at) : null,
  cancelledBy:
    doc.status === 'CANCELLED' && doc.cancellation ? (doc.cancellation.byOwner === false ? 'ADMIN' : 'OWNER') : null,
  version: doc.version ?? 0,
  createdAt: toDate(doc.createdAt),
  updatedAt: toDate(doc.updatedAt),
});

// Populate options giving the contract shape. The user projections leave out `group`, so the User
// find hook does not populate it.
const BOOKING_POPULATE = [
  { path: 'room', select: 'name building capacity type' },
  { path: 'equipment', select: 'name category' },
  { path: 'user', select: 'firstname lastname role' },
  { path: 'decision.by', select: 'firstname lastname' },
];

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
module.exports.RESOURCE_TYPES = RESOURCE_TYPES;
module.exports.BOOKING_STATUSES = BOOKING_STATUSES;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
module.exports.BOOKING_SOURCES = BOOKING_SOURCES;
module.exports.PURPOSE_MIN_LENGTH = PURPOSE_MIN_LENGTH;
module.exports.PURPOSE_MAX_LENGTH = PURPOSE_MAX_LENGTH;
module.exports.NOTE_MAX_LENGTH = NOTE_MAX_LENGTH;
module.exports.MAX_DURATION_MS = MAX_DURATION_MS;
module.exports.BOOKING_POPULATE = BOOKING_POPULATE;
module.exports.serializeBooking = serializeBooking;
