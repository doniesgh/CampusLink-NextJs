const mongoose = require('mongoose');
const { idOf, isPopulated } = require('../utils/serialize');
const { isAcademicYear } = require('./groupModel');

const Schema = mongoose.Schema;

// Module 3 (notes marketplace), phase 3 contract section 3: a document shared or sold for fictitious tokens.
const TYPES = ['COURSE_NOTES', 'SUMMARY', 'EXERCISES', 'EXAM_PREP', 'SLIDES', 'OTHER'];
const STATUSES = ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'UNPUBLISHED'];
const TITLE_MIN_LENGTH = 3;
const TITLE_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 3000;
const PROFESSOR_MAX_LENGTH = 100;
const REASON_MIN_LENGTH = 3;
const REASON_MAX_LENGTH = 500;
const MIN_PRICE = 0;
const MAX_PRICE = 50;
const MIN_LEVEL = 1;
const MAX_LEVEL = 5;

const isInteger = (value) => Number.isInteger(value);

const fileSchema = new Schema(
  {
    // Storage key (service/storageService.js). Never serialized: downloads go through the API.
    key: { type: String, required: true },
    filename: { type: String, required: true, trim: true, maxlength: 255 },
    size: { type: Number, required: true, min: 0 },
    mimeType: { type: String, required: true },
  },
  { _id: false }
);

const authorSnapshotSchema = new Schema(
  {
    firstname: { type: String, default: '' },
    lastname: { type: String, default: '' },
  },
  { _id: false }
);

const documentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: TITLE_MIN_LENGTH, maxlength: TITLE_MAX_LENGTH },
    // Plain text, line breaks kept: clients never render HTML.
    description: { type: String, trim: true, maxlength: DESCRIPTION_MAX_LENGTH, default: '' },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    level: {
      type: Number,
      min: MIN_LEVEL,
      max: MAX_LEVEL,
      default: null,
      validate: { validator: (value) => value === null || isInteger(value), message: 'level must be an integer' },
    },
    academicYear: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator: (value) => value === null || isAcademicYear(value),
        message: 'Academic year must look like "2026-2027"',
      },
    },
    professor: { type: String, trim: true, maxlength: PROFESSOR_MAX_LENGTH, default: null },
    type: { type: String, enum: TYPES, default: 'COURSE_NOTES' },
    file: { type: fileSchema, required: true },
    // Tokens; 0 = free.
    price: {
      type: Number,
      required: true,
      min: MIN_PRICE,
      max: MAX_PRICE,
      validate: { validator: isInteger, message: 'price must be an integer' },
    },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Name of the author when the document was uploaded (shown if the account is deleted later).
    authorSnapshot: { type: authorSnapshotSchema, default: () => ({}) },
    status: { type: String, enum: STATUSES, default: 'PENDING_REVIEW' },
    // Reason of the last rejection or unpublication (shown to the author); null otherwise.
    rejectionReason: { type: String, trim: true, maxlength: REASON_MAX_LENGTH, default: null },
    // Last time the document entered the review queue (upload or resubmission).
    submittedAt: { type: Date, default: Date.now },
    // Set when the admins were told about this document (notifications are coalesced per author).
    reviewNotifiedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // First publication (kept when an unpublished document is published again): "recent" sort.
    publishedAt: { type: Date, default: null },
    unpublishedAt: { type: Date, default: null },
    // Reviews: average (2 decimals) kept in sync atomically with the sum and the count.
    rating: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    // Distinct users (not the author) who downloaded the published document at least once.
    downloads: { type: Number, default: 0 },
    // Paid purchases completed (internal).
    sales: { type: Number, default: 0 },
    // Purchases being processed (internal): a document is only deleted when none is in flight.
    purchasesInFlight: { type: Number, default: 0 },
    // Set while the author deletes the document (a purchase never starts on it).
    deleting: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      // Public shape without the viewer fields (the API adds them, see service/marketplaceService.js).
      transform: (doc) => serializeDocument(doc),
    },
  }
);

// Full-text search on title (5), professor (3) and description (1). No language: no stemming nor stop words, so
// French and English behave the same (matching ignores case and diacritics).
documentSchema.index(
  { title: 'text', professor: 'text', description: 'text' },
  { weights: { title: 5, professor: 3, description: 1 }, default_language: 'none', name: 'market_document_text' }
);
documentSchema.index({ status: 1, publishedAt: -1 });
documentSchema.index({ status: 1, downloads: -1 });
documentSchema.index({ status: 1, rating: -1, ratingCount: -1 });
documentSchema.index({ status: 1, submittedAt: 1 });
documentSchema.index({ subject: 1, status: 1 });
documentSchema.index({ author: 1, createdAt: -1 });

// A deleted account keeps its id (the names then come from the snapshot).
const keepMissingId = (found, id) => found ?? { _id: id, firstname: null, lastname: null };

const DOCUMENT_POPULATE = [
  { path: 'subject', select: 'name code color' },
  { path: 'author', select: 'firstname lastname', transform: keepMissingId },
];

// { id, name, code, color } of a populated subject; null when the subject no longer exists.
function summarizeSubject(subject) {
  if (!isPopulated(subject)) return null;
  return { id: String(subject._id), name: subject.name, code: subject.code, color: subject.color };
}

// { id, firstname, lastname } from the populated author, or from the snapshot when the account is gone.
function summarizeAuthor(doc) {
  const { author } = doc;
  const id = idOf(author) ?? (typeof doc.populated === 'function' ? idOf(doc.populated('author')) : null);
  if (!id) return null;
  const snapshot = doc.authorSnapshot ?? {};
  const source = isPopulated(author) ? author : {};
  return {
    id,
    firstname: source.firstname ?? snapshot.firstname ?? '',
    lastname: source.lastname ?? snapshot.lastname ?? '',
  };
}

/**
 * MarketDocument JSON (contract section 3) of a document or a lean object (subject and author populated):
 * { id, title, description, subject, level, academicYear, professor, type, file: { filename, size, mimeType },
 *   price, author: { id, firstname, lastname }, status, rejectionReason, rating, ratingCount, downloads,
 *   publishedAt, createdAt, updatedAt } (+ viewer fields `purchased`, `mine`, `canDownload`, `canReview`).
 * The storage key, the moderation internals and the counters used for concurrency are never sent.
 */
function serializeDocument(doc, viewer = null) {
  const json = {
    id: String(doc._id),
    title: doc.title,
    description: doc.description ?? '',
    subject: summarizeSubject(doc.subject),
    level: doc.level ?? null,
    academicYear: doc.academicYear ?? null,
    professor: doc.professor ?? null,
    type: doc.type,
    file: doc.file ? { filename: doc.file.filename, size: doc.file.size, mimeType: doc.file.mimeType } : null,
    price: doc.price,
    author: summarizeAuthor(doc),
    status: doc.status,
    rejectionReason: doc.status === 'REJECTED' || doc.status === 'UNPUBLISHED' ? doc.rejectionReason ?? null : null,
    rating: doc.rating ?? 0,
    ratingCount: doc.ratingCount ?? 0,
    downloads: doc.downloads ?? 0,
    publishedAt: doc.publishedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (viewer) Object.assign(json, viewer);
  return json;
}

const MarketDocument = mongoose.model('MarketDocument', documentSchema);

module.exports = MarketDocument;
module.exports.TYPES = TYPES;
module.exports.STATUSES = STATUSES;
module.exports.TITLE_MIN_LENGTH = TITLE_MIN_LENGTH;
module.exports.TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
module.exports.DESCRIPTION_MAX_LENGTH = DESCRIPTION_MAX_LENGTH;
module.exports.PROFESSOR_MAX_LENGTH = PROFESSOR_MAX_LENGTH;
module.exports.REASON_MIN_LENGTH = REASON_MIN_LENGTH;
module.exports.REASON_MAX_LENGTH = REASON_MAX_LENGTH;
module.exports.MIN_PRICE = MIN_PRICE;
module.exports.MAX_PRICE = MAX_PRICE;
module.exports.MIN_LEVEL = MIN_LEVEL;
module.exports.MAX_LEVEL = MAX_LEVEL;
module.exports.DOCUMENT_POPULATE = DOCUMENT_POPULATE;
module.exports.keepMissingId = keepMissingId;
module.exports.serializeDocument = serializeDocument;
module.exports.summarizeSubject = summarizeSubject;
module.exports.summarizeAuthor = summarizeAuthor;
