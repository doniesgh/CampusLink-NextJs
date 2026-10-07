// Error with an HTTP status and a stable machine-readable code.
// Clients (web and mobile) should switch on `code`, not on the message text.
class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = HttpError;
