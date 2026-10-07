const HttpError = require('../utils/httpError');
const { getBearerToken, authenticateToken } = require('./requireAuth');

// Sets req.user (and req.sessionId) when a valid access token is sent; otherwise continues anonymously.
const optionalAuth = async (req, res, next) => {
  const token = getBearerToken(req);

  if (token) {
    try {
      const { user, sessionId } = await authenticateToken(token);
      req.user = user;
      req.sessionId = sessionId;
    } catch (error) {
      // Auth is optional: ignore invalid or expired tokens, but not database failures.
      if (!(error instanceof HttpError)) throw error;
    }
  }

  next();
};

module.exports = optionalAuth;
