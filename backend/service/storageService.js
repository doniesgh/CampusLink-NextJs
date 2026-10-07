const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HttpError = require('../utils/httpError');
const { envString } = require('../utils/env');

/*
 * File storage on the local disk, under STORAGE_DIR (default "uploads", relative to backend/).
 * Files are addressed by a generated `key` such as "announcements/2026/10/3f2a...e1.pdf":
 * the original name is never used on disk (store it in your own model for downloads).
 * Keep only the key in the database, so another backend (S3...) can replace this one later.
 */

const BACKEND_DIR = path.resolve(__dirname, '..');
const FOLDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}(\/[0-9]{4}\/[0-9]{2})?\/[a-f0-9]{32}(\.[a-z0-9]{1,10})?$/;

const getStorageRoot = () => path.resolve(BACKEND_DIR, envString('STORAGE_DIR', 'uploads'));

const invalidKey = () => new HttpError(400, 'VALIDATION_ERROR', 'Invalid file key');
const fileNotFound = () => new HttpError(404, 'RESOURCE_NOT_FOUND', 'File not found');

// Absolute path of a key, refusing anything that could leave the storage root.
const resolveKey = (key) => {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw invalidKey();
  const root = getStorageRoot();
  const absolute = path.resolve(root, ...key.split('/'));
  if (!absolute.startsWith(root + path.sep)) throw invalidKey();
  return absolute;
};

// Lower-case extension of the original name (letters/digits only), or ''.
const safeExtension = (originalName) => {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
};

// Original file name cleaned for display / Content-Disposition (no path, no control characters).
const safeDisplayName = (originalName, fallback = 'file') => {
  const base = path.basename(String(originalName || '').replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?\\/]/g, '_').trim().slice(0, 200);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
};

/**
 * Saves a file and returns its descriptor.
 * @param {{ buffer: Buffer, originalName?: string, mimeType?: string, folder?: string }} file
 *        folder: lowercase letters/digits/dashes, e.g. "announcements"
 * @returns {Promise<{ key: string, filename: string, size: number, mimeType: string }>}
 */
const save = async ({ buffer, originalName, mimeType = 'application/octet-stream', folder = 'files' }) => {
  if (!Buffer.isBuffer(buffer)) throw new Error('storageService.save: buffer is required');
  if (!FOLDER_PATTERN.test(folder)) throw new Error(`storageService.save: invalid folder "${folder}"`);

  const now = new Date();
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const key = `${folder}/${month}/${crypto.randomBytes(16).toString('hex')}${safeExtension(originalName)}`;
  const absolute = resolveKey(key);

  await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
  await fs.promises.writeFile(absolute, buffer, { flag: 'wx' });

  return { key, filename: safeDisplayName(originalName), size: buffer.length, mimeType };
};

// { size } of a stored file, or null when it does not exist.
const stat = async (key) => {
  try {
    const info = await fs.promises.stat(resolveKey(key));
    return info.isFile() ? { size: info.size } : null;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

// Readable stream of a stored file. Throws 404 RESOURCE_NOT_FOUND when it does not exist.
const stream = async (key) => {
  const info = await stat(key);
  if (!info) throw fileNotFound();
  return fs.createReadStream(resolveKey(key));
};

// Deletes a stored file. Missing files are ignored (idempotent). Never throws for a missing file.
const remove = async (key) => {
  try {
    await fs.promises.unlink(resolveKey(key));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

// Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266 / RFC 5987).
const contentDisposition = (filename, disposition = 'attachment') => {
  const name = safeDisplayName(filename);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

/**
 * Streams a stored file as the HTTP response (download). Throws 404 RESOURCE_NOT_FOUND before
 * writing anything when the file is missing, so the error handler can answer in JSON.
 * @param {import('express').Response} res
 * @param {string} key
 * @param {{ filename: string, mimeType?: string, disposition?: 'attachment'|'inline' }} options
 */
const sendFile = async (res, key, { filename, mimeType = 'application/octet-stream', disposition = 'attachment' }) => {
  const info = await stat(key);
  if (!info) throw fileNotFound();

  res.status(200);
  res.set({
    'Content-Type': mimeType,
    'Content-Length': String(info.size),
    'Content-Disposition': contentDisposition(filename, disposition),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });

  await new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(resolveKey(key));
    readStream.on('error', (error) => {
      res.destroy(error);
      reject(error);
    });
    res.on('close', resolve);
    readStream.pipe(res);
  });
};

module.exports = {
  getStorageRoot,
  save,
  stat,
  stream,
  remove,
  sendFile,
  contentDisposition,
  safeDisplayName,
};
