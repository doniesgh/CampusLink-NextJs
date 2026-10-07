const mongoose = require('mongoose');
const Notification = require('../models/notificationModel');
const User = require('../models/userModel');
const pushService = require('./pushService');
const { normalizeLocale, DEFAULT_LOCALE } = require('../utils/validation');

const { NOTIFICATION_TYPES, TITLE_MAX_LENGTH, BODY_MAX_LENGTH } = Notification;
const BATCH_SIZE = 500;

const truncate = (value, max) => {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Validates and normalizes what buildMessage returned.
const normalizeMessage = (message) => {
  if (!message || typeof message !== 'object') throw new Error('buildMessage must return an object');
  if (!NOTIFICATION_TYPES.includes(message.type)) {
    throw new Error(`Notification type must be one of ${NOTIFICATION_TYPES.join(', ')}`);
  }
  const title = truncate(message.title, TITLE_MAX_LENGTH);
  if (!title) throw new Error('Notification title is required');
  return {
    type: message.type,
    title,
    body: truncate(message.body, BODY_MAX_LENGTH),
    link: message.link ? String(message.link) : null,
    // JSON round trip: ObjectIds become strings, Dates ISO strings.
    data: message.data && typeof message.data === 'object' ? JSON.parse(JSON.stringify(message.data)) : {},
    tag: message.tag ? String(message.tag) : null,
    urgency: message.urgency,
  };
};

const uniqueObjectIds = (userIds) => {
  const seen = new Set();
  const ids = [];
  (Array.isArray(userIds) ? userIds : [userIds]).forEach((value) => {
    const id = value && typeof value === 'object' && value._id ? value._id : value;
    const key = String(id);
    if (!seen.has(key) && mongoose.isObjectIdOrHexString(id)) {
      seen.add(key);
      ids.push(new mongoose.Types.ObjectId(key));
    }
  });
  return ids;
};

const addReport = (target, source) => {
  Object.entries(source).forEach(([key, value]) => {
    target[key] = (target[key] || 0) + value;
  });
};

/**
 * Creates an in-app notification for each user (rendered in the user's locale), in batches,
 * then sends a push to each user's subscriptions. Never throws and never rejects (errors are logged
 * and reported in the result), so it is safe to call without awaiting it.
 *
 * @param {Array<string|ObjectId|{_id}>} userIds  recipients (duplicates and unknown users are ignored)
 * @param {(locale: 'fr'|'en', user: { _id, locale }) => ({ type, title, body, link, data, tag?, urgency? })} buildMessage
 *        called once per locale (or once per user when it declares the second `user` parameter);
 *        may be async. French texts use "tu".
 * @param {{ push?: boolean }} [options]  push: false creates in-app notifications only
 * @returns {Promise<{ notified: number, push: { sent, outbox, removed, skipped, failed }, error?: string }>}
 */
const notifyUsers = async (userIds, buildMessage, { push = true } = {}) => {
  const report = { notified: 0, push: { sent: 0, outbox: 0, removed: 0, skipped: 0, failed: 0 } };

  try {
    if (typeof buildMessage !== 'function') throw new Error('buildMessage must be a function');
    const ids = uniqueObjectIds(userIds);
    const perUser = buildMessage.length >= 2;
    const byLocale = new Map();

    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      const batch = ids.slice(start, start + BATCH_SIZE);
      const users = await User.find({ _id: { $in: batch } })
        .select('locale')
        .setOptions({ populateGroup: false })
        .lean();

      const messages = [];
      for (const user of users) {
        const locale = normalizeLocale(user.locale) || DEFAULT_LOCALE;
        let message = perUser ? null : byLocale.get(locale);
        if (!message) {
          message = normalizeMessage(await buildMessage(locale, user));
          if (!perUser) byLocale.set(locale, message);
        }
        messages.push({ user, message });
      }
      if (messages.length === 0) continue;

      const docs = await Notification.insertMany(
        messages.map(({ user, message }) => ({
          user: user._id,
          type: message.type,
          title: message.title,
          body: message.body,
          link: message.link,
          data: message.data,
        }))
      );
      report.notified += docs.length;

      if (push) {
        const pushes = docs.map((doc, index) => {
          const { message } = messages[index];
          return {
            userId: doc.user,
            payload: {
              title: doc.title,
              body: doc.body,
              link: doc.link,
              tag: message.tag || `${doc.type.toLowerCase()}-${doc._id}`,
              data: { ...doc.data, notificationId: String(doc._id), type: doc.type },
              urgency: message.urgency,
            },
          };
        });
        addReport(report.push, await pushService.sendToUsers(pushes));
      }
    }
  } catch (error) {
    console.error('[notifications] Could not notify users:', error.message);
    report.error = error.message;
  }

  return report;
};

// Same as notifyUsers, started on the next tick: the caller's response is not delayed.
const notifyUsersInBackground = (userIds, buildMessage, options) => {
  setImmediate(() => {
    notifyUsers(userIds, buildMessage, options).catch(() => {});
  });
};

module.exports = { notifyUsers, notifyUsersInBackground, normalizeMessage };
