const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, '../logs/operations.log');

// Ensure logs directory exists
if (!fs.existsSync(path.dirname(logFilePath))) {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
}

const LOGGED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const SENSITIVE_KEYS = ['password', 'currentpassword', 'newpassword', 'otp', 'token', 'refreshtoken', 'accesstoken'];
const MAX_BODY_LENGTH = 2000;

// Deep copy of the body with every secret replaced, so nothing sensitive reaches the log file.
const redact = (value, depth = 0) => {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const copy = {};
  Object.entries(value).forEach(([key, item]) => {
    copy[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? '[REDACTED]' : redact(item, depth + 1);
  });
  return copy;
};

// Audit log of state-changing requests, written once the response is sent
// so the entry includes the status code and the authenticated user (if any).
const logger = (req, res, next) => {
  if (!LOGGED_METHODS.includes(req.method)) {
    return next();
  }

  const startedAt = new Date();

  res.on('finish', () => {
    let body = req.body === undefined ? '' : JSON.stringify(redact(req.body));
    if (body.length > MAX_BODY_LENGTH) body = `${body.slice(0, MAX_BODY_LENGTH)}...`;

    const userId = req.user ? String(req.user._id) : '-';
    const ip = req.ip || req.socket?.remoteAddress || '-';
    const logEntry = `${startedAt.toISOString()} - ${req.method} ${req.originalUrl} ${res.statusCode} - user: ${userId} - ip: ${ip} - Body: ${body}\n`;

    fs.appendFile(logFilePath, logEntry, (err) => {
      if (err) {
        console.error('Logging error:', err);
      }
    });
  });

  next();
};

module.exports = logger;
module.exports.redact = redact;
