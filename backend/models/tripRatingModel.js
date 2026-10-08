const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 2 (carpooling), phase 3 contract section 2: after a trip, each participant (driver and accepted
// passengers) rates each other participant once. A user's carpool rating is the average of the ratings received.
const MIN_SCORE = 1;
const MAX_SCORE = 5;
const COMMENT_MAX_LENGTH = 300;
const ROLES = ['DRIVER', 'PASSENGER'];

const tripRatingSchema = new Schema(
  {
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    rater: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ratee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    raterRole: { type: String, enum: ROLES, required: true },
    rateeRole: { type: String, enum: ROLES, required: true },
    score: {
      type: Number,
      required: true,
      min: MIN_SCORE,
      max: MAX_SCORE,
      validate: { validator: Number.isInteger, message: 'score must be an integer' },
    },
    // Plain text (clients never render HTML).
    comment: { type: String, trim: true, maxlength: COMMENT_MAX_LENGTH, default: '' },
    source: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { transform: (doc) => serializeTripRating(doc) },
  }
);

// Once per trip, rater and ratee (concurrent duplicates fail on this index).
tripRatingSchema.index({ trip: 1, rater: 1, ratee: 1 }, { unique: true });
// Average of a user's ratings.
tripRatingSchema.index({ ratee: 1, createdAt: -1 });

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

/** TripRating JSON: { id, tripId, raterId, rateeId, raterRole, rateeRole, score, comment, createdAt }. */
function serializeTripRating(doc) {
  return {
    id: String(doc._id),
    tripId: idOf(doc.trip),
    raterId: idOf(doc.rater),
    rateeId: idOf(doc.ratee),
    raterRole: doc.raterRole,
    rateeRole: doc.rateeRole,
    score: doc.score,
    comment: doc.comment || '',
    createdAt: doc.createdAt,
  };
}

const TripRating = mongoose.model('TripRating', tripRatingSchema);

module.exports = TripRating;
module.exports.MIN_SCORE = MIN_SCORE;
module.exports.MAX_SCORE = MAX_SCORE;
module.exports.COMMENT_MAX_LENGTH = COMMENT_MAX_LENGTH;
module.exports.ROLES = ROLES;
module.exports.serializeTripRating = serializeTripRating;
