const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// "User X has read announcement Y" (at most one per user and announcement).
// Read statistics of an announcement count these documents.
const announcementReadSchema = new Schema(
  {
    announcement: { type: Schema.Types.ObjectId, ref: 'Announcement', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    readAt: { type: Date, default: Date.now },
  },
  {
    toJSON: {
      transform: (doc, ret) => ({
        id: String(ret._id),
        announcement: String(ret.announcement),
        user: String(ret.user),
        readAt: ret.readAt,
      }),
    },
  }
);

// One read per user and announcement; also serves the read counts and readsByDay of an announcement.
announcementReadSchema.index({ announcement: 1, user: 1 }, { unique: true });
// Read flags of a user's feed (and the "unread only" filter).
announcementReadSchema.index({ user: 1, announcement: 1 });

const AnnouncementRead = mongoose.model('AnnouncementRead', announcementReadSchema);

module.exports = AnnouncementRead;
