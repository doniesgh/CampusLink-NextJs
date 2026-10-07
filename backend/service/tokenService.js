const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/refreshTokenModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');

// Read lazily so the values always come from the environment loaded by dotenv.
const accessTokenTtl = () => process.env.JWT_ACCESS_TTL || '15m';
const refreshTokenTtlMs = () => (Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const signAccessToken = (user) =>
  jwt.sign({ role: user.role }, process.env.JWT_SECRET, {
    subject: String(user._id),
    expiresIn: accessTokenTtl(),
    algorithm: 'HS256',
  });

// Throws HttpError(401) with code TOKEN_EXPIRED when the client should call /api/auth/refresh.
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new HttpError(401, 'TOKEN_EXPIRED', 'Access token expired');
    }
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid access token');
  }
};

// Returns the body sent to clients after a successful login, signup or refresh.
const issueTokens = async (user, req) => {
  const refreshToken = crypto.randomBytes(48).toString('hex');

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 512),
    expiresAt: new Date(Date.now() + refreshTokenTtlMs()),
  });

  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken,
  };
};

// Refresh tokens are single-use: each refresh deletes the old token and issues a new pair.
const rotateRefreshToken = async (refreshToken, req) => {
  if (!refreshToken) {
    throw new HttpError(400, 'MISSING_FIELDS', 'refreshToken is required', { fields: ['refreshToken'] });
  }

  const stored = await RefreshToken.findOneAndDelete({ tokenHash: hashToken(refreshToken) });
  if (!stored || stored.expiresAt < new Date()) {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please log in again');
  }

  const user = await User.findById(stored.user);
  if (!user) {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please log in again');
  }

  return issueTokens(user, req);
};

const revokeRefreshToken = (refreshToken) => RefreshToken.deleteOne({ tokenHash: hashToken(refreshToken) });

const revokeAllRefreshTokens = (userId) => RefreshToken.deleteMany({ user: userId });

module.exports = {
  hashToken,
  signAccessToken,
  verifyAccessToken,
  issueTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
};
