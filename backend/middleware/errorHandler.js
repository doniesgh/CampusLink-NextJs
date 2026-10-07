const mongoose = require('mongoose');
const HttpError = require('../utils/httpError');

const send = (res, status, code, message, details) => {
  const body = { error: message, code };
  if (details !== undefined) body.details = details;
  res.status(status).json(body);
};

// Last middleware: turns every error into { error, code, details? } without leaking stack traces.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof HttpError) {
    return send(res, err.status, err.code, err.message, err.details);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = {};
    Object.entries(err.errors).forEach(([path, error]) => {
      details[path] =
        error instanceof mongoose.Error.CastError ? `Invalid value for ${path}` : error.message;
    });
    return send(res, 400, 'VALIDATION_ERROR', 'Invalid fields', details);
  }

  if (err instanceof mongoose.Error.CastError) {
    return send(res, 400, 'INVALID_ID', 'Invalid id');
  }

  if (err && err.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    if (fields.includes('email')) {
      return send(res, 409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    return send(res, 409, 'CONFLICT', 'Duplicate value');
  }

  // Errors raised by express.json() (body-parser).
  if (err && err.type === 'entity.parse.failed') {
    return send(res, 400, 'INVALID_JSON', 'Malformed JSON body');
  }
  if (err && err.type === 'entity.too.large') {
    return send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (err && err.expose && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return send(res, err.status, 'BAD_REQUEST', err.message || 'Bad request');
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  return send(res, 500, 'INTERNAL_ERROR', 'Internal server error');
};

module.exports = errorHandler;
