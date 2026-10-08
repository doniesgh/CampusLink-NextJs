const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 2 (carpooling), phase 3 contract section 2: a passenger's seat request on a trip.
// PENDING → ACCEPTED | DECLINED (driver) | CANCELLED (passenger, or the trip was cancelled) | EXPIRED (the trip
// left while the request was still pending). ACCEPTED → CANCELLED (passenger, before the departure).
const STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'];
const ACTIVE_STATUSES = ['PENDING', 'ACCEPTED'];
const CANCELLED_BY = ['PASSENGER', 'TRIP'];
const MIN_SEATS = 1;
const MAX_SEATS = 3;
const MESSAGE_MAX_LENGTH = 300;
// Requests (any status) one passenger may send for the same trip.
const MAX_REQUESTS_PER_TRIP = 3;

const tripRequestSchema = new Schema(
  {
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    passenger: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    passengerSnapshot: {
      firstname: { type: String, default: '' },
      lastname: { type: String, default: '' },
    },
    seats: { type: Number, required: true, min: MIN_SEATS, max: MAX_SEATS },
    // Plain text for the driver (clients never render HTML).
    message: { type: String, trim: true, maxlength: MESSAGE_MAX_LENGTH, default: '' },
    // Optional note of the driver when declining.
    responseMessage: { type: String, trim: true, maxlength: MESSAGE_MAX_LENGTH, default: '' },
    status: { type: String, enum: STATUSES, default: 'PENDING' },
    // true while PENDING or ACCEPTED: one active request per (trip, passenger), enforced by a unique index.
    active: { type: Boolean, default: true },
    decidedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: [...CANCELLED_BY, null], default: null },
    source: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: { transform: (doc) => serializeTripRequest(doc) },
  }
);

tripRequestSchema.index({ trip: 1, passenger: 1 }, { unique: true, partialFilterExpression: { active: true } });
tripRequestSchema.index({ trip: 1, status: 1, createdAt: 1 });
tripRequestSchema.index({ passenger: 1, status: 1, createdAt: -1 });

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

/**
 * TripRequest JSON: { id, tripId, passenger: { id, firstname, lastname, rating, ratingCount }, seats, message,
 * responseMessage, status, createdAt, decidedAt, cancelledAt, cancelledBy }.
 * `extra` = { passengerName: { firstname, lastname }, passengerRating: { rating, ratingCount } } (optional).
 */
function serializeTripRequest(doc, extra = {}) {
  const populated =
    doc.passenger && typeof doc.passenger === 'object' && doc.passenger.firstname !== undefined ? doc.passenger : null;
  const passenger = extra.passengerName ?? populated;
  return {
    id: String(doc._id),
    tripId: idOf(doc.trip),
    passenger: {
      id: idOf(doc.passenger),
      firstname: passenger?.firstname ?? doc.passengerSnapshot?.firstname ?? '',
      lastname: passenger?.lastname ?? doc.passengerSnapshot?.lastname ?? '',
      rating: extra.passengerRating?.rating ?? null,
      ratingCount: extra.passengerRating?.ratingCount ?? 0,
    },
    seats: doc.seats,
    message: doc.message || '',
    responseMessage: doc.responseMessage || '',
    status: doc.status,
    createdAt: doc.createdAt,
    decidedAt: doc.decidedAt ?? null,
    cancelledAt: doc.cancelledAt ?? null,
    cancelledBy: doc.cancelledBy ?? null,
  };
}

const TripRequest = mongoose.model('TripRequest', tripRequestSchema);

module.exports = TripRequest;
module.exports.STATUSES = STATUSES;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
module.exports.MIN_SEATS = MIN_SEATS;
module.exports.MAX_SEATS = MAX_SEATS;
module.exports.MESSAGE_MAX_LENGTH = MESSAGE_MAX_LENGTH;
module.exports.MAX_REQUESTS_PER_TRIP = MAX_REQUESTS_PER_TRIP;
module.exports.serializeTripRequest = serializeTripRequest;
