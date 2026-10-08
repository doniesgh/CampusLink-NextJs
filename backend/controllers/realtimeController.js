const realtime = require('../service/realtime');
const HttpError = require('../utils/httpError');

/*
 * /api/realtime (phase 3 contract section 1). The Socket.IO server itself lives in service/realtime.js.
 */

// GET /api/realtime/ticket (auth) → { ticket, url, expiresIn }: a single-use ticket (60 s) for the Socket.IO
// handshake of the web app ({ auth: { ticket } }). Never cached.
// The ticket carries the caller's login session (`sid`): the socket opened with it is closed when that session ends.
// An access token whose session has already ended (logout, password change, ...) gets 401 INVALID_TOKEN.
const getTicket = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.sessionId && !(await realtime.isSessionActive(req.user._id, req.sessionId))) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Session expired, please log in again');
  }
  res.status(200).json(realtime.issueTicket(req.user, req.sessionId));
};

module.exports = { getTicket };
