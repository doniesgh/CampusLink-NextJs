const mongoose = require('mongoose');

// Helpers for the JSON shapes of the contract: string `id`, no `_id` / `__v`, ISO dates.

// String id of an ObjectId, a (populated) document, a lean object or an id string; null otherwise.
const idOf = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id !== undefined) return String(value._id);
  return null;
};

// True when `value` is a populated reference (a document or a lean object), not just an id.
const isPopulated = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !(value instanceof mongoose.Types.ObjectId) &&
  value._id !== undefined;

// { id, ...picked fields } of a populated reference; { id } when it is not populated; null when empty.
const refSummary = (value, fields = []) => {
  const id = idOf(value);
  if (!id) return null;
  const summary = { id };
  if (isPopulated(value)) {
    fields.forEach((field) => {
      summary[field] = value[field] === undefined ? null : value[field];
    });
  }
  return summary;
};

const toIso = (date) => (date instanceof Date ? date.toISOString() : date ?? null);

// Default toJSON transform: `_id` → `id`, drops `__v` and the listed fields.
const cleanTransform =
  (hidden = []) =>
  (doc, ret) => {
    const { _id, __v, ...rest } = ret;
    hidden.forEach((field) => delete rest[field]);
    return { id: String(_id), ...rest };
  };

module.exports = { idOf, isPopulated, refSummary, toIso, cleanTransform };
