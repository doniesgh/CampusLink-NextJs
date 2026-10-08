const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 2 (carpooling), phase 3 contract section 2: chat message of a trip (driver + accepted passengers).
const BODY_MIN_LENGTH = 1;
const BODY_MAX_LENGTH = 1000;
// Idempotency key of the client (any UUID version), stored lowercase.
const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const tripMessageSchema = new Schema(
  {
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderSnapshot: {
      firstname: { type: String, default: '' },
      lastname: { type: String, default: '' },
    },
    // Plain text, line breaks kept: clients never render HTML.
    body: { type: String, required: true, minlength: BODY_MIN_LENGTH, maxlength: BODY_MAX_LENGTH },
    clientRequestId: { type: String, default: undefined, match: CLIENT_REQUEST_ID_PATTERN },
    source: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { transform: (doc) => serializeTripMessage(doc) },
  }
);

// Conversation of a trip, newest first (cursor pagination).
tripMessageSchema.index({ trip: 1, createdAt: -1, _id: -1 });
// Replays: one message per sender and clientRequestId.
tripMessageSchema.index(
  { sender: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } }
);

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

/** TripMessage JSON: { id, tripId, sender: { id, firstname, lastname }, body, clientRequestId, createdAt }. */
function serializeTripMessage(doc) {
  return {
    id: String(doc._id),
    tripId: idOf(doc.trip),
    sender: {
      id: idOf(doc.sender),
      firstname: doc.senderSnapshot?.firstname ?? '',
      lastname: doc.senderSnapshot?.lastname ?? '',
    },
    body: doc.body,
    clientRequestId: doc.clientRequestId ?? null,
    createdAt: doc.createdAt,
  };
}

const TripMessage = mongoose.model('TripMessage', tripMessageSchema);

module.exports = TripMessage;
module.exports.BODY_MIN_LENGTH = BODY_MIN_LENGTH;
module.exports.BODY_MAX_LENGTH = BODY_MAX_LENGTH;
module.exports.CLIENT_REQUEST_ID_PATTERN = CLIENT_REQUEST_ID_PATTERN;
module.exports.serializeTripMessage = serializeTripMessage;
