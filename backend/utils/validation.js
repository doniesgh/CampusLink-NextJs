const mongoose = require('mongoose');
const HttpError = require('./httpError');

// Kept here (and re-exported by userModel) so this file does not depend on a model.
const PASSWORD_MIN_LENGTH = 8;
const LOCALES = ['fr', 'en'];
const DEFAULT_LOCALE = 'fr';
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

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

const validationError = (details, message = 'Invalid fields') =>
  new HttpError(400, 'VALIDATION_ERROR', message, details);

const throwIfInvalid = (details) => {
  if (Object.keys(details).length > 0) {
    throw validationError(details);
  }
};

const isObjectId = (value) =>
  value instanceof mongoose.Types.ObjectId || (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value));

// For ids in the URL path: 400 INVALID_ID.
const assertObjectId = (id) => {
  if (!mongoose.isObjectIdOrHexString(id)) {
    throw new HttpError(400, 'INVALID_ID', 'Invalid id');
  }
};

// 404 RESOURCE_NOT_FOUND, the generic phase-1 "not found" error.
const notFound = (resource = 'Resource') => new HttpError(404, 'RESOURCE_NOT_FOUND', `${resource} not found`);

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPositiveInt = (value, fallback) => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

// ?page=1&limit=20 (limit capped at 100). Invalid values fall back to the defaults.
const parsePagination = (query = {}, { defaultLimit = DEFAULT_PAGE_LIMIT, maxLimit = MAX_PAGE_LIMIT } = {}) => {
  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(toPositiveInt(query.limit, defaultLimit), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

// Query-string boolean: "true" / "1" / "yes" are true; anything else (or absent) is false.
const parseBooleanQuery = (value) =>
  value === true || ['true', '1', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());

// 'fr' / 'en' (case-insensitive), or null when the value is not a supported locale.
const normalizeLocale = (value) => {
  if (typeof value !== 'string') return null;
  const locale = value.trim().toLowerCase();
  return LOCALES.includes(locale) ? locale : null;
};

// The helpers below collect problems in a `details` object ({ field: message }) instead of
// throwing, so a controller can report every invalid field at once with throwIfInvalid(details).

// Returns an ObjectId, or undefined (and sets details[field]) when the value is not a valid id.
const readObjectId = (value, field, details) => {
  if (typeof value === 'string' && mongoose.isObjectIdOrHexString(value.trim())) {
    return new mongoose.Types.ObjectId(value.trim());
  }
  if (value instanceof mongoose.Types.ObjectId) return value;
  details[field] = `${field} must be a valid id`;
  return undefined;
};

// Returns a de-duplicated array of ObjectIds. Accepts an array of id strings (or one id string).
const readObjectIdList = (value, field, details, { max = 500 } = {}) => {
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list)) {
    details[field] = `${field} must be an array of ids`;
    return undefined;
  }
  if (list.length > max) {
    details[field] = `${field} accepts at most ${max} items`;
    return undefined;
  }
  const ids = [];
  const seen = new Set();
  for (const item of list) {
    const id = readObjectId(item, field, details);
    if (!id) {
      details[field] = `${field} must be an array of ids`;
      return undefined;
    }
    if (!seen.has(String(id))) {
      seen.add(String(id));
      ids.push(id);
    }
  }
  return ids;
};

// Trimmed string with length bounds. Returns undefined (and sets details[field]) when invalid.
const readString = (value, field, details, { min = 0, max = 1000, trim = true } = {}) => {
  if (typeof value !== 'string') {
    details[field] = `${field} must be a string`;
    return undefined;
  }
  const result = trim ? value.trim() : value;
  if (result.length < min) {
    details[field] = min <= 1 ? `${field} is required` : `${field} must be at least ${min} characters`;
    return undefined;
  }
  if (result.length > max) {
    details[field] = `${field} must be at most ${max} characters`;
    return undefined;
  }
  return result;
};

// Integer (numbers or numeric strings) within [min, max].
const readInteger = (value, field, details, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
    details[field] = `${field} must be an integer between ${min} and ${max}`;
    return undefined;
  }
  return number;
};

// One of the allowed values (strings are trimmed and upper-cased unless { upper: false }).
const readEnum = (value, allowed, field, details, { upper = true } = {}) => {
  if (typeof value !== 'string') {
    details[field] = `${field} must be one of ${allowed.join(', ')}`;
    return undefined;
  }
  const normalized = upper ? value.trim().toUpperCase() : value.trim();
  if (!allowed.includes(normalized)) {
    details[field] = `${field} must be one of ${allowed.join(', ')}`;
    return undefined;
  }
  return normalized;
};

// ISO 8601 date/time (string or Date). Returns a Date, or undefined (and sets details[field]).
const readDate = (value, field, details) => {
  const date = value instanceof Date ? value : typeof value === 'string' && value.trim() ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    details[field] = `${field} must be a valid ISO 8601 date`;
    return undefined;
  }
  return date;
};

const readBoolean = (value, field, details) => {
  if (typeof value !== 'boolean') {
    details[field] = `${field} must be a boolean`;
    return undefined;
  }
  return value;
};

module.exports = {
  PASSWORD_MIN_LENGTH,
  LOCALES,
  DEFAULT_LOCALE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  isBlank,
  requireFields,
  normalizeEmail,
  checkPassword,
  validationError,
  throwIfInvalid,
  isObjectId,
  assertObjectId,
  notFound,
  escapeRegex,
  toPositiveInt,
  parsePagination,
  parseBooleanQuery,
  normalizeLocale,
  readObjectId,
  readObjectIdList,
  readString,
  readInteger,
  readEnum,
  readDate,
  readBoolean,
};
