const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const NOTIFICATION_TYPES = ['TIMETABLE_CHANGE', 'ANNOUNCEMENT', 'SYSTEM'];
const RETENTION_DAYS = 90;
const TITLE_MAX_LENGTH = 300;
const BODY_MAX_LENGTH = 2000;

// In-app notification of one user. Title and body are rendered in the recipient's locale
// when the notification is created (see service/notificationService.js).
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      required: true,
      enum: { values: NOTIFICATION_TYPES, message: `Type must be one of ${NOTIFICATION_TYPES.join(', ')}` },
    },
    title: { type: String, required: true, trim: true, maxlength: TITLE_MAX_LENGTH },
    body: { type: String, trim: true, maxlength: BODY_MAX_LENGTH, default: '' },
    // Relative web path, e.g. "/dashboard/announcements/<id>".
    link: { type: String, default: null },
    data: { type: Schema.Types.Mixed, default: () => ({}) },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
    toJSON: {
      // { id, type, title, body, link, data, readAt, createdAt }
      transform: (doc, ret) => ({
        id: String(ret._id),
        type: ret.type,
        title: ret.title,
        body: ret.body || '',
        link: ret.link ?? null,
        data: ret.data ?? {},
        readAt: ret.readAt ?? null,
        createdAt: ret.createdAt,
      }),
    },
  }
);

// Feed (newest first) and unread counts of a user.
notificationSchema.index({ user: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ user: 1, readAt: 1 });
// TTL: MongoDB deletes notifications 90 days after their creation.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.RETENTION_DAYS = RETENTION_DAYS;
module.exports.TITLE_MAX_LENGTH = TITLE_MAX_LENGTH;
module.exports.BODY_MAX_LENGTH = BODY_MAX_LENGTH;
