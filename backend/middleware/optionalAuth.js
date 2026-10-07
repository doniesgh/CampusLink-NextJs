const HttpError = require('../utils/httpError');
const { getBearerToken, authenticate } = require('./requireAuth');

// Sets req.user when a valid access token is sent; otherwise continues anonymously.
const optionalAuth = async (req, res, next) => {
  const token = getBearerToken(req);

  if (token) {
    try {
      req.user = await authenticate(token);
    } catch (error) {
      // Auth is optional: ignore invalid or expired tokens, but not database failures.
      if (!(error instanceof HttpError)) throw error;
    }
  }

  next();
};

module.exports = optionalAuth;
