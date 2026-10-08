const MarketDocument = require('../models/marketDocumentModel');
const MarketReview = require('../models/marketReviewModel');
const MarketReport = require('../models/marketReportModel');
const Subject = require('../models/subjectModel');
const { isAcademicYear } = require('../models/groupModel');
const HttpError = require('../utils/httpError');
const {
  assertObjectId,
  parsePagination,
  throwIfInvalid,
  validationError,
  readString,
  readInteger,
  readEnum,
  readObjectId,
} = require('../utils/validation');
const { envNumber } = require('../utils/env');
const { currentAcademicYear } = require('../utils/time');
const { createUpload, FILE_TYPES } = require('../middleware/upload');
const auditService = require('../service/auditService');
const storageService = require('../service/storageService');
const walletService = require('../service/walletService');
const market = require('../service/marketplaceService');

/*
 * /api/marketplace (Module 3, phase 3 contract section 3). Every route needs a signed-in user (routes/marketplace.js);
 * uploads are for STUDENT, TEACHER and ADMIN, moderation for ADMINs. Business rules live in
 * service/marketplaceService.js (documents, reviews, reports) and service/walletService.js (tokens, purchases).
 */

const {
  TYPES,
  STATUSES,
  TITLE_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  PROFESSOR_MAX_LENGTH,
  REASON_MIN_LENGTH,
  REASON_MAX_LENGTH,
  MIN_PRICE,
  MAX_PRICE,
  MIN_LEVEL,
  MAX_LEVEL,
} = MarketDocument;
const SORTS = ['recent', 'rating', 'popular', 'relevance', 'oldest'];
const Q_MAX_LENGTH = 200;

// PDF, images, DOCX and PPTX (the announcement attachment types without XLSX and TXT); MIME type, extension and
// content (magic bytes) must match.
const MARKET_FILE_TYPES = Object.fromEntries(
  Object.entries(FILE_TYPES.ATTACHMENTS).filter(([, extensions]) => !extensions.some((ext) => ['.xlsx', '.txt'].includes(ext)))
);
const ALLOWED_EXTENSIONS = [...new Set(Object.values(MARKET_FILE_TYPES).flat())];

// Multipart: one `file` (≤ MAX_UPLOAD_MB) + a `data` field holding the JSON fields.
const uploadFile = createUpload({ field: 'file', maxCount: 1, types: MARKET_FILE_TYPES });

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---------- Request parsing ----------

const readBody = (req) => {
  if (req.body === undefined || req.body === null) return {};
  if (!isPlainObject(req.body)) throw validationError({ body: 'The request body must be a JSON object' });
  return req.body;
};

// Upload body: multipart `data` (JSON string) or, without it, the multipart text fields; JSON bodies as they are.
const readUploadInput = (req) => {
  if (!req.is('multipart/form-data')) return readBody(req);
  const { data, ...fields } = req.body ?? {};
  if (data === undefined) return fields;
  if (typeof data !== 'string') throw validationError({ data: 'data must be a JSON string' });
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'The data field is not valid JSON');
  }
  if (!isPlainObject(parsed)) throw validationError({ data: 'data must be a JSON object' });
  return parsed;
};

// Plain text with line breaks kept (CRLF normalized to LF), trimmed, with length bounds.
const readText = (value, field, details, { min, max }) => {
  if (value === undefined || value === null) {
    details[field] = `${field} is required`;
    return undefined;
  }
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value;
  return readString(text, field, details, { min, max });
};

// One line: whitespace runs become one space.
const readLine = (value, field, details, bounds) =>
  readText(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, field, details, bounds);

// Optional one-line text: null when absent or empty.
const readOptionalLine = (value, field, details, max) => {
  if (value === undefined || value === null) return null;
  const text = readLine(value, field, details, { min: 0, max });
  return text ? text : null;
};

// Optional text (reasons, notes, comments): null when absent or empty.
const readOptionalText = (value, field, details, max) => {
  if (value === undefined || value === null) return null;
  const text = readText(value, field, details, { min: 0, max });
  return text ? text : null;
};

const readSubject = async (value, details) => {
  const id = readObjectId(value, 'subject', details);
  if (!id) return undefined;
  if (!(await Subject.exists({ _id: id }))) {
    details.subject = 'subject does not exist';
    return undefined;
  }
  return id;
};

const readLevel = (value, details) => {
  if (value === null || value === '') return null;
  return readInteger(value, 'level', details, { min: MIN_LEVEL, max: MAX_LEVEL });
};

const readAcademicYear = (value, details) => {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !isAcademicYear(value.trim())) {
    details.academicYear = 'academicYear must look like "2026-2027"';
    return undefined;
  }
  return value.trim();
};

const readPrice = (value, field, details) => readInteger(value, field, details, { min: MIN_PRICE, max: MAX_PRICE });

/**
 * Document fields of an upload / edit (every invalid field reported at once, 400 VALIDATION_ERROR).
 * Only the fields present are returned; on create, defaults are applied (type COURSE_NOTES, price 0, current year).
 * Unknown fields are ignored (no mass assignment of status, author, rating, downloads...).
 */
const parseDocumentInput = async (input, { create }) => {
  const values = {};
  const details = {};
  const has = (field) => input[field] !== undefined;

  if (has('title')) values.title = readLine(input.title, 'title', details, { min: TITLE_MIN_LENGTH, max: TITLE_MAX_LENGTH });
  else if (create) details.title = 'title is required';
  if (has('description')) {
    values.description = readOptionalText(input.description, 'description', details, DESCRIPTION_MAX_LENGTH) ?? '';
  }
  if (has('subject')) values.subject = await readSubject(input.subject, details);
  else if (create) details.subject = 'subject is required';
  if (has('level')) values.level = readLevel(input.level, details);
  if (has('academicYear')) values.academicYear = readAcademicYear(input.academicYear, details);
  else if (create) values.academicYear = currentAcademicYear();
  if (has('professor')) values.professor = readOptionalLine(input.professor, 'professor', details, PROFESSOR_MAX_LENGTH);
  if (has('type')) values.type = readEnum(input.type, TYPES, 'type', details);
  else if (create) values.type = 'COURSE_NOTES';
  if (has('price')) values.price = readPrice(input.price, 'price', details);
  else if (create) values.price = 0;

  throwIfInvalid(details);
  return values;
};

// Single query-string value (repeated parameters are refused), trimmed; undefined when absent or empty.
const queryValue = (value, field, details, { max = 100 } = {}) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    details[field] = `${field} must be a single value`;
    return undefined;
  }
  const text = value.trim();
  if (text.length > max) {
    details[field] = `${field} must be at most ${max} characters`;
    return undefined;
  }
  return text || undefined;
};

// "true" / "false" only.
const queryBoolean = (value, field, details) => {
  const text = queryValue(value, field, details);
  if (text === undefined) return undefined;
  if (text === 'true') return true;
  if (text === 'false') return false;
  details[field] = `${field} must be true or false`;
  return undefined;
};

// Comma-separated statuses.
const queryStatuses = (value, details) => {
  const text = queryValue(value, 'status', details, { max: 200 });
  if (!text) return undefined;
  const statuses = [];
  for (const item of text.split(',')) {
    const status = readEnum(item, STATUSES, 'status', details);
    if (!status) return undefined;
    if (!statuses.includes(status)) statuses.push(status);
  }
  return statuses;
};

// ---------- Audit ----------

const shortTitle = (title) => market.excerpt(title, 80);

const auditModeration = (req, action, doc, summary, metadata = {}) =>
  auditService.record(req, {
    action,
    targetType: 'MarketDocument',
    targetId: doc._id,
    summary,
    metadata: { authorId: String(doc.author), title: doc.title, price: doc.price, ...metadata },
  });

// ---------- Configuration and wallet ----------

// GET /api/marketplace/config → limits for the forms (prices, file types, starting tokens).
const getConfig = (req, res) => {
  res.status(200).json({
    startingTokens: walletService.startingTokens(),
    minPrice: MIN_PRICE,
    maxPrice: MAX_PRICE,
    maxUploadMb: envNumber('MAX_UPLOAD_MB', 10),
    allowedExtensions: ALLOWED_EXTENSIONS,
    allowedMimeTypes: Object.keys(MARKET_FILE_TYPES),
    types: TYPES,
    statuses: STATUSES,
  });
};

// GET /api/marketplace/wallet?page&limit → { balance, transactions, total, page, limit }
const getWallet = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { balance, transactions, total } = await walletService.getWallet(req.user._id, { skip, limit });
  res.status(200).json({ balance, transactions, total, page, limit });
};

// ---------- Documents ----------

// GET /api/marketplace/documents?q&subject&level&type&professor&academicYear&free&sort&mine&purchased&status&author
const listDocuments = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const { query } = req;
  const q = queryValue(query.q, 'q', details, { max: Q_MAX_LENGTH });
  const subjectValue = queryValue(query.subject, 'subject', details);
  const subject = subjectValue ? readObjectId(subjectValue, 'subject', details) : undefined;
  const levelValue = queryValue(query.level, 'level', details);
  const level = levelValue ? readInteger(levelValue, 'level', details, { min: MIN_LEVEL, max: MAX_LEVEL }) : undefined;
  const typeValue = queryValue(query.type, 'type', details);
  const type = typeValue ? readEnum(typeValue, TYPES, 'type', details) : undefined;
  const professor = queryValue(query.professor, 'professor', details, { max: PROFESSOR_MAX_LENGTH });
  const yearValue = queryValue(query.academicYear, 'academicYear', details);
  const academicYear = yearValue ? readAcademicYear(yearValue, details) : undefined;
  const free = queryBoolean(query.free, 'free', details);
  const sortValue = queryValue(query.sort, 'sort', details);
  const sort = sortValue ? readEnum(sortValue.toLowerCase(), SORTS, 'sort', details, { upper: false }) : undefined;
  const mine = queryBoolean(query.mine, 'mine', details);
  const purchased = queryBoolean(query.purchased, 'purchased', details);
  const statuses = queryStatuses(query.status, details);
  const authorValue = queryValue(query.author, 'author', details);
  const author = authorValue ? readObjectId(authorValue, 'author', details) : undefined;
  throwIfInvalid(details);

  const { items, total } = await market.listDocuments(req.user, {
    q,
    subject,
    level,
    type,
    professor,
    academicYear,
    free,
    sort,
    mine,
    purchased,
    statuses,
    author,
    skip,
    limit,
  });
  res.status(200).json({ items, total, page, limit });
};

// POST /api/marketplace/documents (multipart: data + file) → 201 Document (PENDING_REVIEW, PUBLISHED for ADMINs)
const createDocument = async (req, res) => {
  const values = await parseDocumentInput(readUploadInput(req), { create: true });
  if (!req.file) throw validationError({ file: 'file is required' });
  res.status(201).json(await market.createDocument(req.user, values, req.file));
};

// GET /api/marketplace/documents/:id → Document (+ purchased, mine, canDownload, canReview)
const getDocument = async (req, res) => {
  assertObjectId(req.params.id);
  res.status(200).json(await market.getDocument(req.user, req.params.id));
};

// PATCH /api/marketplace/documents/:id → 200 Document (author)
const updateDocument = async (req, res) => {
  assertObjectId(req.params.id);
  const values = await parseDocumentInput(readBody(req), { create: false });
  if (Object.keys(values).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No changes provided');
  res.status(200).json(await market.updateDocument(req.user, req.params.id, values));
};

// DELETE /api/marketplace/documents/:id → 204 (author, only when nobody bought it)
const deleteDocument = async (req, res) => {
  assertObjectId(req.params.id);
  await market.deleteDocument(req.user, req.params.id);
  res.status(204).end();
};

// GET /api/marketplace/documents/:id/file → the file (attachment); 404 when the user may not download it
const downloadFile = async (req, res) => {
  assertObjectId(req.params.id);
  // Express answers HEAD with the GET route: a HEAD request is checked like a download but not counted.
  const file = await market.prepareDownload(req.user, req.params.id, { record: req.method !== 'HEAD' });
  await storageService.sendFile(res, file.key, { filename: file.filename, mimeType: file.mimeType });
};

// POST /api/marketplace/documents/:id/purchase { expectedPrice? } → 201 { purchase, balance, document }
const purchaseDocument = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const expectedPrice =
    input.expectedPrice === undefined || input.expectedPrice === null
      ? undefined
      : readPrice(input.expectedPrice, 'expectedPrice', details);
  throwIfInvalid(details);
  res.status(201).json(await market.purchaseDocument(req.user, req.params.id, { expectedPrice }));
};

// ---------- Reviews ----------

// GET /api/marketplace/documents/:id/reviews?page&limit → { items, total, page, limit, myReview, canReview, distribution }
const listReviews = async (req, res) => {
  assertObjectId(req.params.id);
  const { page, limit, skip } = parsePagination(req.query);
  const result = await market.listReviews(req.user, req.params.id, { skip, limit });
  res.status(200).json({ ...result, page, limit });
};

// PUT /api/marketplace/documents/:id/review { rating, comment? } → 201 (created) / 200 (updated) Review
const saveReview = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  let rating;
  if (input.rating === undefined || input.rating === null) details.rating = 'rating is required';
  else rating = readInteger(input.rating, 'rating', details, { min: MarketReview.MIN_RATING, max: MarketReview.MAX_RATING });
  const comment = readOptionalText(input.comment, 'comment', details, MarketReview.COMMENT_MAX_LENGTH) ?? '';
  throwIfInvalid(details);
  const { review, created } = await market.saveReview(req.user, req.params.id, { rating, comment });
  res.status(created ? 201 : 200).json(review);
};

// DELETE /api/marketplace/documents/:id/review → 204 (own review)
const deleteOwnReview = async (req, res) => {
  assertObjectId(req.params.id);
  await market.deleteOwnReview(req.user, req.params.id);
  res.status(204).end();
};

// ADMIN DELETE /api/marketplace/reviews/:id → 204 (audited marketplace.review.delete)
const deleteReview = async (req, res) => {
  assertObjectId(req.params.id);
  const removed = await market.deleteReview(req.user, req.params.id);
  await auditService.record(req, {
    action: 'marketplace.review.delete',
    targetType: 'MarketReview',
    targetId: removed._id,
    summary: `Deleted a ${removed.rating}-star review of a marketplace document`,
    metadata: { documentId: String(removed.document), authorId: String(removed.author), rating: removed.rating },
  });
  res.status(204).end();
};

// ---------- Reports and moderation ----------

// POST /api/marketplace/documents/:id/report { reason } → 201 report (200 with the user's open report)
const reportDocument = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const reason = readText(input.reason, 'reason', details, {
    min: MarketReport.REASON_MIN_LENGTH,
    max: MarketReport.REASON_MAX_LENGTH,
  });
  throwIfInvalid(details);
  const { report, created } = await market.reportDocument(req.user, req.params.id, reason);
  res.status(created ? 201 : 200).json(report);
};

// ADMIN POST /api/marketplace/documents/:id/approve → 200 Document (PUBLISHED)
const approveDocument = async (req, res) => {
  assertObjectId(req.params.id);
  const { previous, document } = await market.approveDocument(req.user, req.params.id);
  const again = previous.status === 'UNPUBLISHED';
  await auditModeration(
    req,
    'marketplace.approve',
    previous,
    `${again ? 'Published again' : 'Approved'} document "${shortTitle(previous.title)}"`,
    { previousStatus: previous.status }
  );
  res.status(200).json(document);
};

// ADMIN POST /api/marketplace/documents/:id/reject { reason } → 200 Document (REJECTED)
const rejectDocument = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const reason = readText(input.reason, 'reason', details, { min: REASON_MIN_LENGTH, max: REASON_MAX_LENGTH });
  throwIfInvalid(details);
  const { previous, document } = await market.rejectDocument(req.user, req.params.id, reason);
  await auditModeration(req, 'marketplace.reject', previous, `Rejected document "${shortTitle(previous.title)}"`, {
    reason,
  });
  res.status(200).json(document);
};

// ADMIN POST /api/marketplace/documents/:id/unpublish { reason? } → 200 Document (UNPUBLISHED)
const unpublishDocument = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const reason = readOptionalText(input.reason, 'reason', details, REASON_MAX_LENGTH);
  throwIfInvalid(details);
  const { previous, document, resolvedReports } = await market.unpublishDocument(req.user, req.params.id, reason);
  await auditModeration(req, 'marketplace.unpublish', previous, `Unpublished document "${shortTitle(previous.title)}"`, {
    ...(reason ? { reason } : {}),
    resolvedReports,
  });
  res.status(200).json(document);
};

// ADMIN GET /api/marketplace/reports?status&page&limit → { items, total, page, limit, openCount }
const listReports = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const details = {};
  const statusValue = queryValue(req.query.status, 'status', details);
  const status = statusValue ? readEnum(statusValue, MarketReport.STATUSES, 'status', details) : undefined;
  throwIfInvalid(details);
  const { items, total, openCount } = await market.listReports({ status, skip, limit });
  res.status(200).json({ items, total, page, limit, openCount });
};

// ADMIN POST /api/marketplace/reports/:id/resolve { note? } → 200 report (409 INVALID_STATE when already resolved)
const resolveReport = async (req, res) => {
  assertObjectId(req.params.id);
  const input = readBody(req);
  const details = {};
  const note = readOptionalText(input.note, 'note', details, MarketReport.NOTE_MAX_LENGTH);
  throwIfInvalid(details);
  res.status(200).json(await market.resolveReport(req.user, req.params.id, note));
};

module.exports = {
  MARKET_FILE_TYPES,
  uploadFile,
  getConfig,
  getWallet,
  listDocuments,
  createDocument,
  getDocument,
  updateDocument,
  deleteDocument,
  downloadFile,
  purchaseDocument,
  listReviews,
  saveReview,
  deleteOwnReview,
  deleteReview,
  reportDocument,
  approveDocument,
  rejectDocument,
  unpublishDocument,
  listReports,
  resolveReport,
};
