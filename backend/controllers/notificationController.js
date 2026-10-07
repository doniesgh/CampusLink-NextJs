const Notification = require('../models/notificationModel');
const { assertObjectId, notFound, parsePagination, parseBooleanQuery } = require('../utils/validation');

// GET /api/notifications?unread=true&page&limit → { items, total, page, limit, unreadCount }, newest first.
const listNotifications = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const unreadFilter = { user: req.user._id, readAt: null };
  const filter = parseBooleanQuery(req.query.unread) ? unreadFilter : { user: req.user._id };

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments(unreadFilter),
  ]);

  res.status(200).json({ items, total, page, limit, unreadCount });
};

// GET /api/notifications/unread-count → { count }
const unreadCount = async (req, res) => {
  const count = await Notification.countDocuments({ user: req.user._id, readAt: null });
  res.status(200).json({ count });
};

// POST /api/notifications/:id/read → 200 notification (idempotent: the first readAt is kept).
const markRead = async (req, res) => {
  assertObjectId(req.params.id);
  const filter = { _id: req.params.id, user: req.user._id };

  const notification =
    (await Notification.findOneAndUpdate(
      { ...filter, readAt: null },
      { $set: { readAt: new Date() } },
      { returnDocument: 'after' }
    )) || (await Notification.findOne(filter));
  if (!notification) throw notFound('Notification');

  res.status(200).json(notification);
};

// POST /api/notifications/read-all → { updated }
const markAllRead = async (req, res) => {
  const result = await Notification.updateMany(
    { user: req.user._id, readAt: null },
    { $set: { readAt: new Date() } }
  );
  res.status(200).json({ updated: result.modifiedCount });
};

module.exports = { listNotifications, unreadCount, markRead, markAllRead };
