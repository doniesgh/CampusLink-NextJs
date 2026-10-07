const mongoose = require('mongoose');
const { ROLES } = require('./userModel');
const { idOf, isPopulated, refSummary } = require('../utils/serialize');

const Schema = mongoose.Schema;

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED'];
const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 10000;
const MAX_ATTACHMENTS = 5;

// A file attached to an announcement. The file itself lives in service/storageService.js under `key`
// (never returned by the API); `filename` is the original name, used for downloads.
const attachmentSchema = new Schema(
  {
    key: { type: String, required: true },
    filename: { type: String, required: true, trim: true, maxlength: 255 },
    size: { type: Number, required: true, min: 0 },
    mimeType: { type: String, required: true },
  },
  { _id: true }
);

/*
 * Audience (contract section 7): a user receives the announcement when
 *   (roles empty OR role ∈ roles) AND (programs empty OR group.program ∈ programs)
 *   AND (levels empty OR group.level ∈ levels) AND (groups empty OR group ∈ groups).
 * Field names `audience.programs` / `audience.groups` are read by the academic module (409 IN_USE).
 */
const audienceSchema = new Schema(
  {
    roles: { type: [{ type: String, enum: ROLES }], default: [] },
    programs: { type: [{ type: Schema.Types.ObjectId, ref: 'Program' }], default: [] },
    levels: { type: [{ type: Number, min: 1, max: 5 }], default: [] },
    groups: { type: [{ type: Schema.Types.ObjectId, ref: 'Group' }], default: [] },
  },
  { _id: false }
);

const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: TITLE_MAX_LENGTH },
    // Plain text: clients keep the line breaks and never render HTML.
    body: { type: String, required: true, maxlength: BODY_MAX_LENGTH },
    priority: { type: String, enum: PRIORITIES, default: 'NORMAL' },
    audience: { type: audienceSchema, default: () => ({}) },
    attachments: { type: [attachmentSchema], default: [] },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Copy of the author's name and role, used when the account no longer exists.
    authorSnapshot: {
      firstname: { type: String, default: '' },
      lastname: { type: String, default: '' },
      role: { type: String, default: null },
    },
    status: { type: String, enum: STATUSES, default: 'DRAFT' },
    // Planned publication date (SCHEDULED; kept on a draft so the form can show it).
    publishAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    // Number of users matching the audience, snapshotted when the announcement is published.
    recipients: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      // { id, title, body, priority,
      //   audience: { roles, programs: [{ id, name, code }], levels, groups: [{ id, name }] },
      //   attachments: [{ id, filename, size, mimeType }], author: { id, firstname, lastname, role },
      //   status, publishAt, publishedAt, createdAt, updatedAt }
      // The controllers add `read` (recipient views) and `stats` (author / admin views).
      transform: (doc, ret) => ({
        id: String(ret._id),
        title: ret.title,
        body: ret.body,
        priority: ret.priority,
        audience: {
          roles: [...(doc.audience?.roles ?? [])],
          programs: (doc.audience?.programs ?? []).map((program) => refSummary(program, ['name', 'code'])),
          levels: [...(doc.audience?.levels ?? [])],
          groups: (doc.audience?.groups ?? []).map((group) => refSummary(group, ['name'])),
        },
        attachments: (doc.attachments ?? []).map((file) => ({
          id: String(file._id),
          filename: file.filename,
          size: file.size,
          mimeType: file.mimeType,
        })),
        author: summarizeAuthor(doc),
        status: ret.status,
        publishAt: ret.publishAt ?? null,
        publishedAt: ret.publishedAt ?? null,
        createdAt: ret.createdAt,
        updatedAt: ret.updatedAt,
      }),
    },
  }
);

// { id, firstname, lastname, role } from the populated author, or from the snapshot
// (when the account was deleted, populate leaves null: the id comes from doc.populated()).
function summarizeAuthor(doc) {
  const author = doc.author;
  const id = idOf(author) ?? (typeof doc.populated === 'function' ? idOf(doc.populated('author')) : null);
  if (!id) return null;
  if (isPopulated(author)) {
    return { id, firstname: author.firstname, lastname: author.lastname, role: author.role };
  }
  const snapshot = doc.authorSnapshot ?? {};
  return { id, firstname: snapshot.firstname ?? '', lastname: snapshot.lastname ?? '', role: snapshot.role ?? null };
}

// Recipient feed (newest publication first).
announcementSchema.index({ status: 1, publishedAt: -1, _id: -1 });
// Scheduler: due SCHEDULED announcements.
announcementSchema.index({ status: 1, publishAt: 1 });
// Management list of an author.
announcementSchema.index({ author: 1, createdAt: -1 });
// References checked before deleting a program / group (409 IN_USE).
announcementSchema.index({ 'audience.programs': 1 });
announcementSchema.index({ 'audience.groups': 1 });

// How the API populates an announcement for its JSON shape.
const ANNOUNCEMENT_POPULATE = [
  { path: 'author', select: 'firstname lastname role' },
  { path: 'audience.programs', select: 'name code' },
  { path: 'audience.groups', select: 'name' },
];

const Announcement = mongoose.model('Announcement', announcementSchema);

module.exports = Announcement;
module.exports.PRIORITIES = PRIORITIES;
module.exports.STATUSES = STATUSES;
module.exports.TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
module.exports.BODY_MAX_LENGTH = BODY_MAX_LENGTH;
module.exports.MAX_ATTACHMENTS = MAX_ATTACHMENTS;
module.exports.ANNOUNCEMENT_POPULATE = ANNOUNCEMENT_POPULATE;
