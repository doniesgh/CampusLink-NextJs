const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { finished } = require('stream/promises');
const mongoose = require('mongoose');
const HttpError = require('../utils/httpError');
const { envString } = require('../utils/env');

/*
 * File storage. Files are addressed by a generated `key` such as "announcements/2026/10/3f2a...e1.pdf": the
 * original name is never used as the stored name (store it in your own model for downloads). Keep only the key
 * in the database. Two drivers, chosen by STORAGE_DRIVER (read at call time), with the same API and behaviour:
 *  - "disk" (default): files on the local disk under STORAGE_DIR (default "uploads", relative to backend/).
 *  - "gridfs": files in MongoDB GridFS (bucket "uploads" of the mongoose connection, collections uploads.files /
 *    uploads.chunks), the key as the GridFS filename. For hosts without a persistent disk (Render free tier).
 */

const BACKEND_DIR = path.resolve(__dirname, '..');
const FOLDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}(\/[0-9]{4}\/[0-9]{2})?\/[a-f0-9]{32}(\.[a-z0-9]{1,10})?$/;
const GRIDFS_BUCKET = 'uploads';

const getStorageRoot = () => path.resolve(BACKEND_DIR, envString('STORAGE_DIR', 'uploads'));

const invalidKey = () => new HttpError(400, 'VALIDATION_ERROR', 'Invalid file key');
const fileNotFound = () => new HttpError(404, 'RESOURCE_NOT_FOUND', 'File not found');
// Same error as writeFile with the "wx" flag: a key is written once and never replaced.
const alreadyStored = (key) =>
  Object.assign(new Error(`storageService.save: "${key}" already exists`), { code: 'EEXIST' });

const checkKey = (key) => {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw invalidKey();
  return key;
};

// Absolute path of a key, refusing anything that could leave the storage root.
const resolveKey = (key) => {
  checkKey(key);
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

// ---------- Disk driver ----------

const diskDriver = {
  async write(key, buffer) {
    const absolute = resolveKey(key);
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, buffer, { flag: 'wx' });
  },

  // { size } of a stored file, or null when it does not exist.
  async find(key) {
    try {
      const info = await fs.promises.stat(resolveKey(key));
      return info.isFile() ? { size: info.size } : null;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  },

  open(key) {
    return fs.createReadStream(resolveKey(key));
  },

  // Stops a read stream that will not be consumed to the end (closes the file descriptor).
  release(readStream) {
    readStream.destroy();
  },

  async remove(key) {
    try {
      await fs.promises.unlink(resolveKey(key));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  },
};

// ---------- GridFS driver ----------

let gridfsState = null; // { db, bucket, files, chunks, indexes: Promise } for the current connection

// Bucket of the mongoose connection; the indexes are created once per connection, before the first operation.
const gridfs = async () => {
  const { db } = mongoose.connection;
  if (!db) throw new Error('storageService: MongoDB is not connected (STORAGE_DRIVER=gridfs)');
  if (gridfsState?.db !== db) {
    const files = db.collection(`${GRIDFS_BUCKET}.files`);
    const chunks = db.collection(`${GRIDFS_BUCKET}.chunks`);
    const state = { db, files, chunks, bucket: new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET }) };
    // Unique filename: fast lookups by key and "write once" (a second file with the same key is refused).
    // The chunks index is the one GridFS needs to read a file in order.
    state.indexes = Promise.all([
      files.createIndex({ filename: 1 }, { unique: true }),
      chunks.createIndex({ files_id: 1, n: 1 }, { unique: true }),
    ]).catch((error) => {
      if (gridfsState === state) gridfsState = null; // try again on the next call
      throw error;
    });
    gridfsState = state;
  }
  const state = gridfsState;
  await state.indexes;
  return state;
};

const gridfsDriver = {
  async write(key, buffer, { mimeType, filename }) {
    checkKey(key);
    const { bucket, chunks } = await gridfs();
    const upload = bucket.openUploadStream(key, { metadata: { mimeType, originalName: filename } });
    try {
      upload.end(buffer);
      await finished(upload);
    } catch (error) {
      // The files document is written last: remove the chunks of an upload that did not complete.
      await chunks.deleteMany({ files_id: upload.id }).catch(() => {});
      if (error?.code === 11000) throw alreadyStored(key);
      throw error;
    }
  },

  // { size, id, bucket } of a stored file, or null when it does not exist.
  async find(key) {
    checkKey(key);
    const { files, bucket } = await gridfs();
    const doc = await files.findOne({ filename: key }, { projection: { length: 1 } });
    return doc ? { size: doc.length, id: doc._id, bucket } : null;
  },

  // Opened by id (the document find() returned): a removed file gives an ENOENT error on the stream.
  open(key, info) {
    return info.bucket.openDownloadStream(info.id);
  },

  // Stops a download that will not be consumed to the end and closes its cursor on the server.
  release(readStream) {
    readStream.abort().catch(() => {});
  },

  async remove(key) {
    checkKey(key);
    const { files, chunks } = await gridfs();
    const ids = (await files.find({ filename: key }, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id);
    if (ids.length === 0) return;
    // Files document first (the file disappears at once), then its chunks.
    await files.deleteMany({ _id: { $in: ids } });
    await chunks.deleteMany({ files_id: { $in: ids } });
  },
};

const DRIVERS = { disk: diskDriver, gridfs: gridfsDriver };

// STORAGE_DRIVER: "disk" (default) or "gridfs". Anything else is a configuration error.
const getDriver = () => {
  const name = envString('STORAGE_DRIVER', 'disk').toLowerCase();
  if (!Object.hasOwn(DRIVERS, name)) {
    throw new Error(`Unknown STORAGE_DRIVER "${name}" (expected "disk" or "gridfs")`);
  }
  return DRIVERS[name];
};

// ---------- API ----------

/**
 * Saves a file and returns its descriptor.
 * @param {{ buffer: Buffer, originalName?: string, mimeType?: string, folder?: string }} file
 *        folder: lowercase letters/digits/dashes, e.g. "announcements"
 * @returns {Promise<{ key: string, filename: string, size: number, mimeType: string }>}
 */
const save = async ({ buffer, originalName, mimeType = 'application/octet-stream', folder = 'files' }) => {
  if (!Buffer.isBuffer(buffer)) throw new Error('storageService.save: buffer is required');
  if (!FOLDER_PATTERN.test(folder)) throw new Error(`storageService.save: invalid folder "${folder}"`);
  const driver = getDriver();

  const now = new Date();
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const key = `${folder}/${month}/${crypto.randomBytes(16).toString('hex')}${safeExtension(originalName)}`;
  const filename = safeDisplayName(originalName);

  await driver.write(key, buffer, { mimeType, filename });

  return { key, filename, size: buffer.length, mimeType };
};

// { size } of a stored file, or null when it does not exist.
const stat = async (key) => {
  const info = await getDriver().find(key);
  return info ? { size: info.size } : null;
};

// Readable stream of a stored file. Throws 404 RESOURCE_NOT_FOUND when it does not exist.
const stream = async (key) => {
  const driver = getDriver();
  const info = await driver.find(key);
  if (!info) throw fileNotFound();
  return driver.open(key, info);
};

// Deletes a stored file. Missing files are ignored (idempotent). Never throws for a missing file.
const remove = async (key) => {
  await getDriver().remove(key);
};

// Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266 / RFC 5987).
const contentDisposition = (filename, disposition = 'attachment') => {
  const name = safeDisplayName(filename);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

const DOWNLOAD_HEADERS = ['Content-Type', 'Content-Length', 'Content-Disposition'];

/**
 * Streams a stored file as the HTTP response (download). Throws 404 RESOURCE_NOT_FOUND before
 * writing anything when the file is missing, so the error handler can answer in JSON.
 * @param {import('express').Response} res
 * @param {string} key
 * @param {{ filename: string, mimeType?: string, disposition?: 'attachment'|'inline' }} options
 */
const sendFile = async (res, key, { filename, mimeType = 'application/octet-stream', disposition = 'attachment' }) => {
  const driver = getDriver();
  const info = await driver.find(key);
  if (!info) throw fileNotFound();

  res.status(200);
  res.set({
    'Content-Type': mimeType,
    'Content-Length': String(info.size),
    'Content-Disposition': contentDisposition(filename, disposition),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  // HEAD (Express answers it with the GET route): the headers only, the file is not read.
  if (res.req?.method === 'HEAD') {
    res.end();
    return;
  }
  // The client left during the lookup: its 'close' event is already gone, open nothing.
  if (res.destroyed) return;

  await new Promise((resolve, reject) => {
    const readStream = driver.open(key, info);
    readStream.on('error', (error) => {
      if (!res.headersSent && error.code === 'ENOENT') {
        // Removed between the lookup and the read: nothing was sent yet, answer 404 in JSON.
        DOWNLOAD_HEADERS.forEach((name) => res.removeHeader(name));
        reject(fileNotFound());
        return;
      }
      res.destroy(error);
      reject(error);
    });
    // Sent, or closed early by the client: stop reading what nobody will receive.
    res.on('close', () => {
      if (!readStream.readableEnded) driver.release(readStream);
      resolve();
    });
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
