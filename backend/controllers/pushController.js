const PushSubscription = require('../models/pushSubscriptionModel');
const HttpError = require('../utils/httpError');
const { throwIfInvalid } = require('../utils/validation');
const pushService = require('../service/pushService');
const { MAX_ENDPOINT_LENGTH, isAllowedPushEndpoint } = require('../utils/pushEndpoint');

const MAX_KEY_LENGTH = 256;
const MAX_TOKEN_LENGTH = 4096;

const isNonEmptyString = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

// GET /api/push/vapid-public-key (no auth) → { publicKey }, or 503 PUSH_DISABLED.
const getVapidPublicKey = async (req, res) => {
  const publicKey = pushService.getPublicKey();
  if (!publicKey) {
    throw new HttpError(503, 'PUSH_DISABLED', 'Push notifications are not configured on this server');
  }
  res.status(200).json({ publicKey });
};

// "web" | "fcm" (case-insensitive); inferred from the fields when `type` is absent.
const subscriptionType = (body) => {
  if (typeof body.type === 'string') return body.type.trim().toLowerCase();
  return body.token !== undefined && body.endpoint === undefined ? 'fcm' : 'web';
};

// Validates the body of POST /api/push/subscriptions. Returns { filter, values }.
const parseSubscription = (body) => {
  const type = subscriptionType(body);
  const details = {};

  if (type === 'web') {
    // Only the https URL of a browser push service (the backend POSTs to it: no internal or third-party hosts).
    if (!isAllowedPushEndpoint(body.endpoint)) {
      details.endpoint = 'endpoint must be the https URL of a browser push service';
    }
    if (!isNonEmptyString(body.keys?.p256dh, MAX_KEY_LENGTH)) details['keys.p256dh'] = 'keys.p256dh is required';
    if (!isNonEmptyString(body.keys?.auth, MAX_KEY_LENGTH)) details['keys.auth'] = 'keys.auth is required';
    throwIfInvalid(details);
    return {
      filter: { endpoint: body.endpoint },
      values: { type, endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } },
    };
  }

  if (type === 'fcm') {
    if (!isNonEmptyString(body.token, MAX_TOKEN_LENGTH)) details.token = 'token is required';
    throwIfInvalid(details);
    return { filter: { token: body.token }, values: { type, token: body.token } };
  }

  throwIfInvalid({ type: 'type must be "web" or "fcm"' });
  return null;
};

// POST /api/push/subscriptions [auth] → 201 { id }. Upsert by endpoint / token, re-assigned to the current user.
const subscribe = async (req, res) => {
  const { filter, values } = parseSubscription(req.body ?? {});
  const update = {
    $set: { ...values, user: req.user._id, userAgent: String(req.get('user-agent') || '').slice(0, 512) },
  };
  const options = { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true };

  let subscription;
  try {
    subscription = await PushSubscription.findOneAndUpdate(filter, update, options);
  } catch (error) {
    // Two parallel upserts of the same endpoint: the second one hits the unique index, retry once.
    if (error?.code !== 11000) throw error;
    subscription = await PushSubscription.findOneAndUpdate(filter, update, options);
  }

  res.status(201).json({ id: String(subscription._id) });
};

// DELETE /api/push/subscriptions [auth] body { endpoint } or { token } → 204 (idempotent).
const unsubscribe = async (req, res) => {
  const { endpoint, token } = req.body ?? {};
  if (isNonEmptyString(endpoint, MAX_ENDPOINT_LENGTH)) {
    await PushSubscription.deleteOne({ endpoint, user: req.user._id });
  } else if (isNonEmptyString(token, MAX_TOKEN_LENGTH)) {
    await PushSubscription.deleteOne({ token, user: req.user._id });
  } else {
    throw new HttpError(400, 'MISSING_FIELDS', 'endpoint or token is required', { fields: ['endpoint', 'token'] });
  }
  res.status(204).end();
};

module.exports = { getVapidPublicKey, subscribe, unsubscribe };
