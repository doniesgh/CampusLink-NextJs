const path = require('path');
const multer = require('multer');
const HttpError = require('../utils/httpError');
const { envNumber } = require('../utils/env');

/*
 * Multipart upload middleware factory (multer, files kept in memory, then saved with
 * service/storageService.js by the controller). Non-multipart requests (JSON) pass through untouched,
 * so one route can accept both.
 *
 *   const { createUpload, FILE_TYPES } = require('../middleware/upload');
 *   router.post('/', requireAuth, createUpload({ field: 'attachments', maxCount: 5 }), handler);
 *   // handler: req.files = [{ originalname, mimetype, size, buffer }], req.body = the text fields
 *
 * Errors: 413 FILE_TOO_LARGE, 415 UNSUPPORTED_FILE_TYPE, 400 TOO_MANY_FILES,
 * 400 VALIDATION_ERROR (unexpected file field, too many / too large text fields).
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// { mimeType: [allowed extensions] }. A file must match both its MIME type and its extension.
const FILE_TYPES = {
  // Announcement attachments: pdf, png, jpg, webp, docx, xlsx, pptx, txt.
  ATTACHMENTS: {
    'application/pdf': ['.pdf'],
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/webp': ['.webp'],
    [DOCX]: ['.docx'],
    [XLSX]: ['.xlsx'],
    [PPTX]: ['.pptx'],
    'text/plain': ['.txt'],
  },
  // CSV imports. Browsers and OSes report CSV files with many different MIME types.
  CSV: {
    'text/csv': ['.csv'],
    'application/csv': ['.csv'],
    'text/x-csv': ['.csv'],
    'application/vnd.ms-excel': ['.csv'],
    'text/plain': ['.csv', '.txt'],
    'application/octet-stream': ['.csv'],
  },
};

// Magic bytes of binary formats: a file claiming one of these types must start with them.
const startsWith = (buffer, bytes, offset = 0) => bytes.every((byte, index) => buffer[offset + index] === byte);
const SIGNATURES = {
  'application/pdf': (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]), // %PDF
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/webp': (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  [DOCX]: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]), // ZIP
  [XLSX]: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  [PPTX]: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
};
// Text formats must not contain NUL bytes (rejects binaries renamed to .txt / .csv).
const looksLikeText = (buffer) => !buffer.subarray(0, 8192).includes(0);

const contentMatchesType = (file) => {
  const check = SIGNATURES[file.mimetype];
  if (check) return file.buffer.length > 0 && check(file.buffer);
  return looksLikeText(file.buffer);
};

const maxUploadMb = () => envNumber('MAX_UPLOAD_MB', 10);

/**
 * @param {object} [options]
 * @param {string} [options.field='file']   name of the file field
 * @param {number} [options.maxCount=1]     max number of files (more → 400 TOO_MANY_FILES)
 * @param {object} [options.types=FILE_TYPES.ATTACHMENTS]  { mimeType: [extensions] }
 * @param {number} [options.maxFileSizeMb]  per file, default MAX_UPLOAD_MB (10)
 * @param {boolean} [options.checkContent=true]  verify magic bytes / text content
 * @returns {import('express').RequestHandler}  sets req.files (array, possibly empty) and req.file (first file)
 */
const createUpload = ({
  field = 'file',
  maxCount = 1,
  types = FILE_TYPES.ATTACHMENTS,
  maxFileSizeMb,
  checkContent = true,
} = {}) => {
  const fileFilter = (req, file, callback) => {
    const allowed = types[String(file.mimetype || '').toLowerCase()];
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (!allowed || !allowed.includes(ext)) {
      return callback(
        new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'This file type is not supported', {
          field: file.fieldname,
          filename: file.originalname,
          allowedExtensions: [...new Set(Object.values(types).flat())],
        })
      );
    }
    return callback(null, true);
  };

  return (req, res, next) => {
    const sizeMb = maxFileSizeMb ?? maxUploadMb();
    const maxBytes = Math.floor(sizeMb * 1024 * 1024);
    const handler = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxBytes, files: maxCount, fields: 50, fieldSize: 1024 * 1024, parts: maxCount + 50 },
      fileFilter,
    }).array(field, maxCount);

    handler(req, res, (error) => {
      if (error) {
        if (error instanceof HttpError) return next(error);
        if (error instanceof multer.MulterError) {
          switch (error.code) {
            case 'LIMIT_FILE_SIZE':
              return next(
                new HttpError(413, 'FILE_TOO_LARGE', `Files must be at most ${sizeMb} MB`, {
                  field: error.field,
                  maxBytes,
                })
              );
            case 'LIMIT_FILE_COUNT':
              return next(new HttpError(400, 'TOO_MANY_FILES', `At most ${maxCount} file(s) allowed`, { maxCount }));
            case 'LIMIT_UNEXPECTED_FILE':
              if (error.field === field) {
                return next(new HttpError(400, 'TOO_MANY_FILES', `At most ${maxCount} file(s) allowed`, { maxCount }));
              }
              return next(
                new HttpError(400, 'VALIDATION_ERROR', 'Unexpected file field', { [error.field || 'file']: 'Unexpected file' })
              );
            default:
              return next(new HttpError(400, 'VALIDATION_ERROR', 'Invalid multipart body', { multipart: error.message }));
          }
        }
        // Malformed multipart bodies (busboy errors).
        return next(new HttpError(400, 'VALIDATION_ERROR', 'Invalid multipart body', { multipart: error.message }));
      }

      req.files = Array.isArray(req.files) ? req.files : [];
      if (checkContent) {
        const invalid = req.files.find((file) => !contentMatchesType(file));
        if (invalid) {
          return next(
            new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'The file content does not match its type', {
              field: invalid.fieldname,
              filename: invalid.originalname,
            })
          );
        }
      }
      [req.file] = req.files;
      return next();
    });
  };
};

module.exports = { createUpload, FILE_TYPES };
