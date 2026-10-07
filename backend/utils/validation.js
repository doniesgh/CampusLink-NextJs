const mongoose = require('mongoose');
const HttpError = require('./httpError');
const { PASSWORD_MIN_LENGTH } = require('../models/userModel');

const isBlank = (value) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

// Throws 400 MISSING_FIELDS (details.fields) when a required field is absent or blank,
// then 400 VALIDATION_ERROR when a present field is not a string. Strings only: this also
// blocks query-operator injection such as { "email": { "$ne": null } }.
const requireFields = (body, fields) => {
  const missing = fields.filter((field) => isBlank(body[field]));
  if (missing.length > 0) {
    throw new HttpError(400, 'MISSING_FIELDS', `Missing required fields: ${missing.join(', ')}`, {
      fields: missing,
    });
  }

  const details = {};
  fields.forEach((field) => {
    if (typeof body[field] !== 'string') details[field] = `${field} must be a string`;
  });
  if (Object.keys(details).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', details);
  }
};

const normalizeEmail = (email) => String(email).trim().toLowerCase();

// Returns a { field: message } object, empty when the password is acceptable.
const checkPassword = (password, field = 'password') => {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { [field]: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  return {};
};

const throwIfInvalid = (details) => {
  if (Object.keys(details).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', details);
  }
};

const assertObjectId = (id) => {
  if (!mongoose.isObjectIdOrHexString(id)) {
    throw new HttpError(400, 'INVALID_ID', 'Invalid id');
  }
};

module.exports = {
  isBlank,
  requireFields,
  normalizeEmail,
  checkPassword,
  throwIfInvalid,
  assertObjectId,
};
