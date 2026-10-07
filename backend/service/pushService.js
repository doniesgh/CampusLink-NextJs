const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const PushSubscription = require('../models/pushSubscriptionModel');
const { envString } = require('../utils/env');
const { isAllowedPushEndpoint } = require('../utils/pushEndpoint');

const PUSH_TTL_SECONDS = 24 * 60 * 60;
const PUSH_TIMEOUT_MS = 10000;
const SEND_CONCURRENCY = 10;
const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 1000;
const URGENCIES = ['very-low', 'low', 'normal', 'high'];

const getVapidConfig = () => {
  const publicKey = envString('VAPID_PUBLIC_KEY');
  const privateKey = envString('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: envString('VAPID_SUBJECT', 'mailto:admin@campuslink.local') };
};

// True when web push can really be sent (VAPID keys set).
const isConfigured = () => getVapidConfig() !== null;

// VAPID public key given to browsers (applicationServerKey), or null when push is disabled.
const getPublicKey = () => getVapidConfig()?.publicKey ?? null;

const outboxFile = () => envString('PUSH_OUTBOX_FILE');

let warnedDisabled = false;
let warnedFcm = false;

// PUSH_OUTBOX_FILE (tests): one JSON line per push instead of sending it.
const appendToOutbox = async (entry) => {
  try {
    const file = path.resolve(outboxFile());
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error('[push] Could not write to PUSH_OUTBOX_FILE:', error.message);
  }
};

const truncate = (value, max) => {
  const text = value === undefined || value === null ? '' : String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Push payload of the contract: { title, body, link, tag, data }.
const buildPayload = ({ title, body, link = null, tag = null, data = {} } = {}) => ({
  title: truncate(title, TITLE_MAX_LENGTH),
  body: truncate(body, BODY_MAX_LENGTH),
  link: link || null,
  tag: tag || null,
  data: data && typeof data === 'object' ? data : {},
});

// Sends one payload to one subscription. Never throws.
// Returns 'sent' | 'outbox' | 'removed' | 'skipped' | 'failed'.
const sendToSubscription = async (subscription, payload) => {
  const message = buildPayload(payload);

  try {
    // Never contact an endpoint that is not a browser push service (SSRF), even one stored before this check
    // existed or written to the database by hand: such a subscription can never be delivered, so it is deleted.
    if (subscription.type !== 'fcm' && !isAllowedPushEndpoint(subscription.endpoint)) {
      await PushSubscription.deleteOne({ _id: subscription._id }).catch(() => {});
      console.warn(`[push] Subscription ${subscription._id} does not point to a browser push service: deleted.`);
      return 'removed';
    }

    if (outboxFile()) {
      await appendToOutbox({
        userId: String(subscription.user),
        subscriptionId: String(subscription._id),
        type: subscription.type,
        endpoint: subscription.type === 'web' ? subscription.endpoint : null,
        payload: message,
        sentAt: new Date().toISOString(),
      });
      return 'outbox';
    }

    if (subscription.type === 'fcm') {
      // Mobile push (Firebase Cloud Messaging) is not implemented in phase 1.
      if (!warnedFcm) {
        console.log('[push] FCM subscriptions are stored but FCM sending is not implemented yet: skipped.');
        warnedFcm = true;
      }
      return 'skipped';
    }

    const vapid = getVapidConfig();
    if (!vapid) {
      if (!warnedDisabled) {
        console.log('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set: web push is disabled.');
        warnedDisabled = true;
      }
      return 'skipped';
    }

    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys?.p256dh, auth: subscription.keys?.auth } },
      JSON.stringify(message),
      {
        vapidDetails: vapid,
        TTL: PUSH_TTL_SECONDS,
        timeout: PUSH_TIMEOUT_MS,
        // Optional payload.urgency ('very-low' | 'low' | 'normal' | 'high'); not part of the payload sent.
        urgency: URGENCIES.includes(payload?.urgency) ? payload.urgency : 'normal',
      }
    );
    PushSubscription.updateOne({ _id: subscription._id }, { $set: { lastSuccessAt: new Date() } }).catch(() => {});
    return 'sent';
  } catch (error) {
    // 404 / 410: the subscription expired or was revoked by the user.
    if (error && (error.statusCode === 404 || error.statusCode === 410)) {
      await PushSubscription.deleteOne({ _id: subscription._id }).catch(() => {});
      return 'removed';
    }
    console.error(
      `[push] Could not send to subscription ${subscription._id}: ${error?.statusCode ?? ''} ${error?.message ?? error}`
    );
    return 'failed';
  }
};

// Runs `worker` over `items` with at most `limit` promises at a time.
const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

const emptyReport = () => ({ sent: 0, outbox: 0, removed: 0, skipped: 0, failed: 0 });

/**
 * Sends a push to every subscription of the given users. Never throws.
 * @param {Array<{ userId: string|ObjectId, payload: { title, body, link?, tag?, data? } }>} messages
 *        one entry per user (each user gets the payload rendered in their own locale)
 * @returns {Promise<{ sent, outbox, removed, skipped, failed }>}
 */
const sendToUsers = async (messages) => {
  const report = emptyReport();
  try {
    if (!messages || messages.length === 0) return report;
    if (!outboxFile() && !isConfigured()) {
      // Nothing can be delivered: avoid loading subscriptions (FCM is not implemented yet).
      report.skipped = messages.length;
      return report;
    }

    const payloadByUser = new Map(messages.map(({ userId, payload }) => [String(userId), payload]));
    const subscriptions = await PushSubscription.find({ user: { $in: [...payloadByUser.keys()] } }).lean();

    const outcomes = await mapWithConcurrency(subscriptions, SEND_CONCURRENCY, (subscription) =>
      sendToSubscription(subscription, payloadByUser.get(String(subscription.user)))
    );
    outcomes.forEach((outcome) => {
      report[outcome] += 1;
    });
  } catch (error) {
    console.error('[push] Could not send push notifications:', error.message);
  }
  return report;
};

// Sends the same payload to every subscription of one user. Never throws.
const sendToUser = (userId, payload) => sendToUsers([{ userId, payload }]);

module.exports = {
  isConfigured,
  getPublicKey,
  buildPayload,
  sendToSubscription,
  sendToUsers,
  sendToUser,
};
