const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// One document per active session (web browser or mobile device).
// Only the SHA-256 hash of the token is stored, never the token itself.
// A refresh rewrites the document in place (new hash, new expiry), so the session keeps its
// document and its sessionId for its whole life.
const refreshTokenSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    // Stable random id of the login session, kept across refreshes. Sent in access tokens as the
    // "sid" claim and stored on the push subscriptions registered by this session.
    // Sessions opened before this field existed get one on their next refresh.
    sessionId: {
      type: String,
      index: true,
    },
    userAgent: String,
    // TTL index: MongoDB deletes the document once this date has passed.
    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
