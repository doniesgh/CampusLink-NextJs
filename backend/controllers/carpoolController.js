const Trip = require('../models/tripModel');
const TripRequest = require('../models/tripRequestModel');
const TripMessage = require('../models/tripMessageModel');
const TripRating = require('../models/tripRatingModel');
const HttpError = require('../utils/httpError');
const {
  parsePagination,
  throwIfInvalid,
  validationError,
  readString,
  readInteger,
  readEnum,
  readBoolean,
} = require('../utils/validation');
const { parseInstant } = require('../service/timetableService');
const auditService = require('../service/auditService');
const carpool = require('../service/carpoolService');

/*
 * /api/carpool (Module 2, phase 3 contract section 2). Every route needs a signed-in user (routes/carpool.js);
 * roles are checked by the routes, ownership and business rules by service/carpoolService.js.
 */

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (input, field) => input[field] !== undefined;

// ---------- Request parsing ----------

const readBody = (req) => {
  if (req.body === undefined || req.body === null) return {};
  if (!isPlainObject(req.body)) throw validationError({ body: 'The request body must be a JSON object' });
  return req.body;
};

// Finite number (numbers or numeric strings) within [min, max], with at most `decimals` decimals.
const readNumber = (value, field, details, { min, max, decimals = null }) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) {
    details[field] = `${field} must be a number between ${min} and ${max}`;
    return undefined;
  }
  if (decimals !== null && Math.abs(number * 10 ** decimals - Math.round(number * 10 ** decimals)) > 1e-6) {
    details[field] = `${field} must have at most ${decimals} decimals`;
    return undefined;
  }
  return decimals === null ? number : Math.round(number * 10 ** decimals) / 10 ** decimals;
};

// One line of plain text: whitespace runs become one space.
const oneLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ') : value);
// Plain text with line breaks kept (CRLF → LF).
const multiLine = (value) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value);

/** { label?, lat, lng }: label optional (default: the nearest known place), coordinates in degrees. */
const readPlace = (value, field, details) => {
  if (!isPlainObject(value)) {
    details[field] = `${field} must be an object { label, lat, lng }`;
    return undefined;
  }
  const lat = readNumber(value.lat, `${field}.lat`, details, { min: -90, max: 90 });
  const lng = readNumber(value.lng, `${field}.lng`, details, { min: -180, max: 180 });
  let label = null;
  if (value.label !== undefined && value.label !== null) {
    label = readString(oneLine(value.label), `${field}.label`, details, { min: 0, max: Trip.LABEL_MAX_LENGTH });
    if (label === '') label = null;
  }
  if (lat === undefined || lng === undefined || label === undefined) return undefined;
  return { label, lat, lng };
};

const readDepartureAt = (value, details) => {
  const date = typeof value === 'string' ? parseInstant(value, { allowDateOnly: false }) : null;
  if (!date) {
    details.departureAt = 'departureAt must be an ISO 8601 date-time (or campus time YYYY-MM-DDTHH:mm)';
    return undefined;
  }
  return date;
};

const readPreferences = (value, details) => {
  if (!isPlainObject(value)) {
    details.preferences = 'preferences must be an object';
    return undefined;
  }
  const preferences = {};
  Trip.PREFERENCE_KEYS.forEach((key) => {
    if (value[key] === undefined) return;
    const flag = readBoolean(value[key], `preferences.${key}`, details);
    if (flag !== undefined) preferences[key] = flag;
  });
  return preferences;
};

const readOptionalText = (value, field, details, max, { lines = false } = {}) => {
  if (value === undefined || value === null) return '';
  const text = readString(lines ? multiLine(value) : oneLine(value), field, details, { min: 0, max });
  return text === undefined ? undefined : text;
};

const readPrice = (value, details) =>
  readNumber(value, 'pricePerSeat', details, { min: Trip.MIN_PRICE, max: Trip.MAX_PRICE, decimals: 3 });

/** Trip fields of a create / update body. Only the fields present are returned (every invalid field at once). */
const parseTripInput = (input, { create }) => {
  const values = {};
  const details = {};

  if (has(input, 'direction')) values.direction = readEnum(input.direction, Trip.DIRECTIONS, 'direction', details);
  if (has(input, 'departure') && !(create && input.departure === null)) {
    values.departure = readPlace(input.departure, 'departure', details);
  }
  if (has(input, 'destination') && !(create && input.destination === null)) {
    values.destination = readPlace(input.destination, 'destination', details);
  }
  if (has(input, 'departureAt')) values.departureAt = readDepartureAt(input.departureAt, details);
  else if (create) details.departureAt = 'departureAt is required';
  if (has(input, 'seats')) {
    values.seats = readInteger(input.seats, 'seats', details, { min: Trip.MIN_SEATS, max: Trip.MAX_SEATS });
  } else if (create) details.seats = 'seats is required';
  if (has(input, 'pricePerSeat') && input.pricePerSeat !== null) {
    values.pricePerSeat = readPrice(input.pricePerSeat, details);
  }
  if (has(input, 'preferences') && input.preferences !== null) {
    values.preferences = readPreferences(input.preferences, details);
  }
  if (has(input, 'notes')) {
    values.notes = readOptionalText(input.notes, 'notes', details, Trip.NOTES_MAX_LENGTH, { lines: true });
  }

  throwIfInvalid(details);
  return values;
};

// Single query-string value (repeated parameters are refused), trimmed; undefined when absent or empty.
const queryValue = (value, field, details, { max = 100 } = {}) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    details[field] = `${field} must be a single value`;
    return undefined;
  }
  const text = value.trim();
  if (text.length > max) {
    details[field] = `${field} must be at most ${max} characters`;
    return undefined;
  }
  return text || undefined;
};

const parseSearch = (query) => {
  const details = {};
  const raw = {};
  ['lat', 'lng', 'radiusKm', 'from', 'to', 'direction', 'seats'].forEach((field) => {
    raw[field] = queryValue(query[field], field, details);
  });
  const params = { seats: 1 };
  if (raw.lat !== undefined || raw.lng !== undefined) {
    if (raw.lat === undefined || raw.lng === undefined) {
      details[raw.lat === undefined ? 'lat' : 'lng'] = 'lat and lng must be sent together';
    } else {
      params.lat = readNumber(raw.lat, 'lat', details, { min: -90, max: 90 });
      params.lng = readNumber(raw.lng, 'lng', details, { min: -180, max: 180 });
    }
  }
  params.radiusKm = carpool.defaultSearchRadiusKm();
  if (raw.radiusKm !== undefined) {
    const radius = readNumber(raw.radiusKm, 'radiusKm', details, { min: 0.1, max: carpool.MAX_SEARCH_RADIUS_KM });
    if (radius !== undefined) params.radiusKm = radius;
  }
  let from = null;
  let to = null;
  if (raw.from !== undefined) {
    from = parseInstant(raw.from);
    if (!from) details.from = 'from must be a date (YYYY-MM-DD) or an ISO 8601 date-time';
  }
  if (raw.to !== undefined) {
    to = parseInstant(raw.to);
    if (!to) details.to = 'to must be a date (YYYY-MM-DD) or an ISO 8601 date-time';
  }
  if (raw.direction !== undefined) params.direction = readEnum(raw.direction, Trip.DIRECTIONS, 'direction', details);
  if (raw.seats !== undefined) {
    params.seats = readInteger(raw.seats, 'seats', details, { min: Trip.MIN_SEATS, max: Trip.MAX_SEATS });
  }
  throwIfInvalid(details);

  const window = carpool.searchWindow(from, to);
  if (window.to <= window.from) throw validationError({ to: 'to must be after from (and after now)' });
  return { ...params, ...window, ...parsePagination(query) };
};

const readUuid = (value, field, details) => {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : null;
  if (!text || !TripMessage.CLIENT_REQUEST_ID_PATTERN.test(text)) {
    details[field] = `${field} must be a UUID`;
    return undefined;
  }
  return text;
};

// ---------- Places and settings ----------

// GET /api/carpool/places → [{ id, label, lat, lng }] (curated Greater Tunis places for the picker).
const listPlaces = async (req, res) => {
  res.status(200).json(carpool.listPlaces());
};

// GET /api/carpool/settings → { campus, costPerKm, roadFactor, defaultRadiusKm, maxRadiusKm, ... }.
const getSettings = async (req, res) => {
  res.status(200).json(carpool.getSettings());
};

// ---------- Trips ----------

// GET /api/carpool/trips?lat&lng&radiusKm&from&to&direction&seats&page&limit → { items, total, page, limit }.
const searchTrips = async (req, res) => {
  res.status(200).json(await carpool.searchTrips(req.user, parseSearch(req.query)));
};

// POST /api/carpool/trips (STUDENT) → 201 Trip (detail).
const createTrip = async (req, res) => {
  const input = parseTripInput(readBody(req), { create: true });
  if (input.pricePerSeat === undefined) {
    // Default: the suggested shared cost of the contract.
    const direction = input.direction || 'TO_CAMPUS';
    const site = carpool.campus();
    const from = direction === 'FROM_CAMPUS' ? input.departure || site : input.departure;
    const to = direction === 'FROM_CAMPUS' ? input.destination : input.destination || site;
    input.pricePerSeat = from && to ? carpool.suggestedPricePerSeat(carpool.roadDistanceKm(from, to), input.seats) : 0;
  }
  res.status(201).json(await carpool.createTrip(req.user, input));
};

// GET /api/carpool/trips/:id → Trip (detail: participants, canRate, requests for the driver).
const getTrip = async (req, res) => {
  res.status(200).json(await carpool.getTripDetail(req.user, req.params.id));
};

// PATCH /api/carpool/trips/:id (driver) → Trip (detail).
const updateTrip = async (req, res) => {
  const changes = parseTripInput(readBody(req), { create: false });
  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, 'NO_CHANGES', 'Nothing to update');
  }
  res.status(200).json(await carpool.updateTrip(req.user, req.params.id, changes));
};

// POST /api/carpool/trips/:id/cancel { reason? } (driver, or ADMIN: audited) → Trip (detail).
const cancelTrip = async (req, res) => {
  const body = readBody(req);
  const details = {};
  const reason = readOptionalText(body.reason, 'reason', details, Trip.CANCEL_REASON_MAX_LENGTH, { lines: true });
  throwIfInvalid(details);
  const result = await carpool.cancelTrip(req.user, req.params.id, { reason: reason || null });
  if (result.byAdmin) {
    const { trip } = result;
    const route = `${trip.departure.label} → ${trip.destination.label}`;
    await auditService.record(req, {
      action: 'carpool.trip.cancel',
      targetType: 'Trip',
      targetId: trip.id,
      summary: `Cancelled the carpool trip ${route} of ${trip.driver.firstname} ${trip.driver.lastname} (${new Date(
        trip.departureAt
      ).toISOString()})`,
      metadata: {
        driverId: trip.driver.id,
        departureAt: trip.departureAt,
        previousStatus: result.previousStatus,
        passengersNotified: result.passengers,
        reason: reason || null,
      },
    });
  }
  res.status(200).json(result.trip);
};

// GET /api/carpool/me/trips?role=driver|passenger&scope=upcoming|past&page&limit → { items, total, page, limit }.
const listMyTrips = async (req, res) => {
  const details = {};
  const roleValue = queryValue(req.query.role, 'role', details);
  const scopeValue = queryValue(req.query.scope, 'scope', details);
  const role =
    roleValue === undefined
      ? 'driver'
      : readEnum(roleValue.toLowerCase(), ['driver', 'passenger'], 'role', details, { upper: false });
  const scope =
    scopeValue === undefined
      ? 'upcoming'
      : readEnum(scopeValue.toLowerCase(), ['upcoming', 'past'], 'scope', details, { upper: false });
  throwIfInvalid(details);
  res.status(200).json(await carpool.listMyTrips(req.user, { role, scope, ...parsePagination(req.query) }));
};

// ---------- Requests ----------

// GET /api/carpool/trips/:id/requests (driver) → [TripRequest].
const listTripRequests = async (req, res) => {
  res.status(200).json(await carpool.listTripRequests(req.user, req.params.id));
};

// POST /api/carpool/trips/:id/requests (STUDENT) { seats: 1-3 (default 1), message? } → 201 TripRequest + trip.
const createRequest = async (req, res) => {
  const body = readBody(req);
  const details = {};
  const seats =
    body.seats === undefined
      ? 1
      : readInteger(body.seats, 'seats', details, { min: TripRequest.MIN_SEATS, max: TripRequest.MAX_SEATS });
  const message = readOptionalText(body.message, 'message', details, TripRequest.MESSAGE_MAX_LENGTH, { lines: true });
  throwIfInvalid(details);
  res.status(201).json(await carpool.createRequest(req.user, req.params.id, { seats, message }));
};

// POST /api/carpool/requests/:id/accept (driver) → TripRequest + trip.
const acceptRequest = async (req, res) => {
  res.status(200).json(await carpool.acceptRequest(req.user, req.params.id));
};

// POST /api/carpool/requests/:id/decline (driver) { message? } → TripRequest + trip.
const declineRequest = async (req, res) => {
  const body = readBody(req);
  const details = {};
  const message = readOptionalText(body.message, 'message', details, TripRequest.MESSAGE_MAX_LENGTH, { lines: true });
  throwIfInvalid(details);
  res.status(200).json(await carpool.declineRequest(req.user, req.params.id, { message }));
};

// POST /api/carpool/requests/:id/cancel (passenger) → TripRequest + trip.
const cancelRequest = async (req, res) => {
  res.status(200).json(await carpool.cancelRequest(req.user, req.params.id));
};

// ---------- Chat ----------

// GET /api/carpool/trips/:id/messages?before&limit (participants) → { items (oldest first), hasMore }.
const listMessages = async (req, res) => {
  const details = {};
  const beforeValue = queryValue(req.query.before, 'before', details);
  const limitValue = queryValue(req.query.limit, 'limit', details);
  let before = null;
  if (beforeValue !== undefined) {
    if (/^[a-f0-9]{24}$/i.test(beforeValue)) before = { id: beforeValue };
    else {
      const date = parseInstant(beforeValue, { allowDateOnly: false });
      if (date) before = { date };
      else details.before = 'before must be a message id or an ISO 8601 date-time';
    }
  }
  const limit =
    limitValue === undefined
      ? carpool.DEFAULT_MESSAGES_LIMIT
      : readInteger(limitValue, 'limit', details, { min: 1, max: carpool.MAX_MESSAGES_LIMIT });
  throwIfInvalid(details);
  res.status(200).json(await carpool.listMessages(req.user, req.params.id, { before, limit }));
};

// POST /api/carpool/trips/:id/messages (participants) { body, clientRequestId? } → 201 message, or 200 (replay).
const postMessage = async (req, res) => {
  const input = readBody(req);
  const details = {};
  let body;
  if (input.body === undefined || input.body === null) details.body = 'body is required';
  else {
    body = readString(multiLine(input.body), 'body', details, {
      min: TripMessage.BODY_MIN_LENGTH,
      max: TripMessage.BODY_MAX_LENGTH,
    });
  }
  const clientRequestId = readUuid(input.clientRequestId, 'clientRequestId', details);
  throwIfInvalid(details);
  const { message, created } = await carpool.postMessage(req.user, req.params.id, { body, clientRequestId });
  res.status(created ? 201 : 200).json(message);
};

// ---------- Ratings ----------

// POST /api/carpool/trips/:id/ratings (participants) { userId, score: 1-5, comment? } → 201 TripRating.
// `ratee` is accepted for userId and `rating` for score.
const rateParticipant = async (req, res) => {
  const input = readBody(req);
  const details = {};
  const userValue = input.userId ?? input.ratee;
  let userId;
  if (typeof userValue === 'string' && /^[a-f0-9]{24}$/i.test(userValue.trim())) userId = userValue.trim();
  else details.userId = 'userId must be a valid id';
  const scoreValue = input.score ?? input.rating;
  let score;
  if (scoreValue === undefined || scoreValue === null) details.score = 'score is required';
  else score = readInteger(scoreValue, 'score', details, { min: TripRating.MIN_SCORE, max: TripRating.MAX_SCORE });
  const comment = readOptionalText(input.comment, 'comment', details, TripRating.COMMENT_MAX_LENGTH, { lines: true });
  throwIfInvalid(details);
  res.status(201).json(await carpool.rateParticipant(req.user, req.params.id, { userId, score, comment }));
};

module.exports = {
  listPlaces,
  getSettings,
  searchTrips,
  createTrip,
  getTrip,
  updateTrip,
  cancelTrip,
  listMyTrips,
  listTripRequests,
  createRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  listMessages,
  postMessage,
  rateParticipant,
};
