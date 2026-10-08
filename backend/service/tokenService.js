const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/refreshTokenModel');
const PushSubscription = require('../models/pushSubscriptionModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');

// Read lazily so the values always come from the environment loaded by dotenv.
const accessTokenTtl = () => process.env.JWT_ACCESS_TTL || '15m';
const refreshTokenTtlMs = () => (Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const newRefreshToken = () => crypto.randomBytes(48).toString('hex');

// Stable random id of a login session (see models/refreshTokenModel.js).
const newSessionId = () => crypto.randomBytes(16).toString('base64url');

const userAgentOf = (req) => String(req?.headers?.['user-agent'] || '').slice(0, 512);

const invalidRefreshToken = () => new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please log in again');

// Access token: sub = user id, role, and sid = session id (absent from tokens issued before sessions had ids).
const signAccessToken = (user, sessionId = null) =>
  jwt.sign(sessionId ? { role: user.role, sid: sessionId } : { role: user.role }, process.env.JWT_SECRET, {
    subject: String(user._id),
    expiresIn: accessTokenTtl(),
    algorithm: 'HS256',
  });

// Throws HttpError(401) with code TOKEN_EXPIRED when the client should call /api/auth/refresh.
const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // Access tokens carry no audience: refuse any audience-scoped JWT (e.g. a real-time ticket).
    if (payload.aud !== undefined) throw new Error('audience-scoped token');
    return payload;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new HttpError(401, 'TOKEN_EXPIRED', 'Access token expired');
    }
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid access token');
  }
};

// Returns the body sent to clients after a successful login, signup or OTP check: a new session.
const issueTokens = async (user, req) => {
  const refreshToken = newRefreshToken();
  const sessionId = newSessionId();

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    sessionId,
    userAgent: userAgentOf(req),
    expiresAt: new Date(Date.now() + refreshTokenTtlMs()),
  });

  return {
    user,
    accessToken: signAccessToken(user, sessionId),
    refreshToken,
  };
};

// Refresh tokens are single-use: each refresh replaces the token hash of the session atomically and
// issues a new pair. The session (document and sessionId) stays the same.
const rotateRefreshToken = async (refreshToken, req) => {
  if (!refreshToken) {
    throw new HttpError(400, 'MISSING_FIELDS', 'refreshToken is required', { fields: ['refreshToken'] });
  }

  const nextToken = newRefreshToken();
  const now = Date.now();
  const stored = await RefreshToken.findOneAndUpdate(
    { tokenHash: hashToken(refreshToken), expiresAt: { $gt: new Date(now) } },
    {
      $set: {
        tokenHash: hashToken(nextToken),
        userAgent: userAgentOf(req),
        expiresAt: new Date(now + refreshTokenTtlMs()),
      },
    },
    { returnDocument: 'after' }
  );
  if (!stored) {
    throw invalidRefreshToken();
  }

  const user = await User.findById(stored.user);
  if (!user) {
    await RefreshToken.deleteOne({ _id: stored._id });
    throw invalidRefreshToken();
  }

  let { sessionId } = stored;
  if (!sessionId) {
    // Session opened before sessions had ids: it gets one now and keeps it from then on.
    // Only the holder of the new token hash gets here, so nobody else writes this field.
    sessionId = newSessionId();
    await RefreshToken.updateOne({ _id: stored._id }, { $set: { sessionId } });
  }

  return {
    user,
    accessToken: signAccessToken(user, sessionId),
    refreshToken: nextToken,
  };
};

// Closes the real-time (Socket.IO) connections of ended sessions: every one of the user's, or with
// { sessionId } only those of that session. Loaded lazily; a no-op without a Socket.IO server (scripts).
// Never throws.
const closeRealtimeConnections = (userId, options) => require('./realtime').disconnectUser(userId, options);

// Ends one session (logout): deletes its refresh token and the push subscriptions it registered, and closes
// the real-time connections it opened. Resolves to the deleted session document, or null when the token is unknown.
const revokeRefreshToken = async (refreshToken) => {
  const stored = await RefreshToken.findOneAndDelete({ tokenHash: hashToken(refreshToken) });
  if (stored?.sessionId) {
    await PushSubscription.deleteMany({ user: stored.user, sessionId: stored.sessionId });
    await closeRealtimeConnections(stored.user, { sessionId: stored.sessionId });
  }
  return stored;
};

// Ends every session of a user (password change or reset, admin password change, account deletion):
// refresh tokens, every push subscription and every real-time connection of the user.
const revokeAllRefreshTokens = async (userId) => {
  await Promise.all([RefreshToken.deleteMany({ user: userId }), PushSubscription.deleteMany({ user: userId })]);
  await closeRealtimeConnections(userId);
};

module.exports = {
  hashToken,
  newSessionId,
  signAccessToken,
  verifyAccessToken,
  issueTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
};
