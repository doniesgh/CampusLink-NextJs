const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// One document per active session (web browser or mobile device).
// Only the SHA-256 hash of the token is stored, never the token itself.
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
