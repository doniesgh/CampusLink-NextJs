const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const SUBSCRIPTION_TYPES = ['web', 'fcm'];

// A device that receives push notifications for a user:
// - "web": a browser Push API subscription (endpoint + keys), sent with web-push (VAPID);
// - "fcm": a Firebase Cloud Messaging token of the future mobile app (stored, not sent in phase 1).
// The endpoint and the keys are secrets of the device: they are never returned by the API.
const pushSubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: SUBSCRIPTION_TYPES, required: true },
    endpoint: { type: String },
    keys: {
      p256dh: { type: String },
      auth: { type: String },
    },
    token: { type: String },
    userAgent: { type: String, default: '' },
    lastSuccessAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      // Only non-secret fields.
      transform: (doc, ret) => ({ id: String(ret._id), type: ret.type, createdAt: ret.createdAt }),
    },
  }
);

// One subscription per endpoint / token (re-assigned to the latest user who registers it).
pushSubscriptionSchema.index(
  { endpoint: 1 },
  { unique: true, partialFilterExpression: { endpoint: { $type: 'string' } } }
);
pushSubscriptionSchema.index({ token: 1 }, { unique: true, partialFilterExpression: { token: { $type: 'string' } } });

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

module.exports = PushSubscription;
module.exports.SUBSCRIPTION_TYPES = SUBSCRIPTION_TYPES;
