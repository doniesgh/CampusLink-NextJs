const mongoose = require('mongoose');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const { verifyAccessToken } = require('../service/tokenService');

// Returns the token from "Authorization: Bearer <token>", or null when the header is absent or malformed.
const getBearerToken = (req) => {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization || '');
  return match ? match[1] : null;
};

// Verifies the access token and loads its user. Throws HttpError(401) on failure.
const authenticate = async (token) => {
  const payload = verifyAccessToken(token);

  if (!mongoose.isObjectIdOrHexString(payload.sub)) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid access token');
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid access token');
  }

  return user;
};

const requireAuth = async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  req.user = await authenticate(token);
  next();
};

// Use after requireAuth. The role is read from the database, so a role change applies immediately.
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      throw new HttpError(401, 'AUTH_REQUIRED', 'Authentication required');
    }
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
    next();
  };

module.exports = { requireAuth, requireRole, getBearerToken, authenticate };
