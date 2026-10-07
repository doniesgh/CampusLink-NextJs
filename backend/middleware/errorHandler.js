const mongoose = require('mongoose');
const HttpError = require('../utils/httpError');

// Converts a known error into [status, code, message, details?], or returns null.
const describeMongooseError = (err) => {
  if (err instanceof mongoose.Error.ValidationError) {
    const details = {};
    Object.entries(err.errors).forEach(([path, error]) => {
      details[path] = error instanceof mongoose.Error.CastError ? `Invalid value for ${path}` : error.message;
    });
    return [400, 'VALIDATION_ERROR', 'Invalid fields', details];
  }

  if (err instanceof mongoose.Error.CastError) {
    return [400, 'INVALID_ID', 'Invalid id'];
  }

  if (err?.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    if (fields.includes('email')) {
      return [409, 'EMAIL_TAKEN', 'An account with this email already exists'];
    }
    // Compound unique indexes list the scope first (e.g. { academicYear, name }): report the last field.
    const field = fields.at(-1);
    return [409, 'ALREADY_EXISTS', 'This value is already used', field ? { field } : undefined];
  }

  return null;
};

// Errors raised by express.json() (body-parser) and other http-errors.
const describeHttpParserError = (err) => {
  if (err?.type === 'entity.parse.failed') return [400, 'INVALID_JSON', 'Malformed JSON body'];
  if (err?.type === 'entity.too.large') return [413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'];
  if (err?.expose && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return [err.status, 'BAD_REQUEST', err.message || 'Bad request'];
  }
  return null;
};

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

  const known = describeMongooseError(err) || describeHttpParserError(err);
  if (known) {
    return send(res, ...known);
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  return send(res, 500, 'INTERNAL_ERROR', 'Internal server error');
};

module.exports = errorHandler;
