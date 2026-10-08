const Booking = require('../models/bookingModel');
const Room = require('../models/roomModel');
const HttpError = require('../utils/httpError');
const time = require('../utils/time');
const {
  assertObjectId,
  notFound,
  throwIfInvalid,
  isBlank,
  parsePagination,
  readString,
  readEnum,
  readInteger,
  readObjectId,
} = require('../utils/validation');
const auditService = require('../service/auditService');
const bookingService = require('../service/bookingService');
const { parseInstant, parseRange } = require('../service/timetableService');
const { parseListQuery } = require('./resourceController');

/*
 * /api/bookings (Module 5, phase 2 contract section 1.2). Every route needs authentication.
 * Anyone: availability, free rooms, own bookings, cancel (owner before the start, or ADMIN).
 * STUDENT / TEACHER / ADMIN: create (ALUMNI → 403 FORBIDDEN, refused by the route).
 * ADMIN: list, approve, reject (audited booking.approve|reject|cancel), statistics.
 */

const { RESOURCE_TYPES, BOOKING_STATUSES, BOOKING_POPULATE, PURPOSE_MIN_LENGTH, PURPOSE_MAX_LENGTH, NOTE_MAX_LENGTH } =
  Booking;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bodyOf = (req) => (isPlainObject(req.body) ? req.body : {});
const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const firstValue = (value) => (Array.isArray(value) ? value[0] : value);

// ---------- Parsing ----------

// startsAt / endsAt: ISO 8601 with "Z" or an offset, or campus wall-clock time "YYYY-MM-DDTHH:mm".
const readInstant = (value, field, details) => {
  if (isBlank(value)) {
    details[field] = `${field} is required`;
    return undefined;
  }
  const date = parseInstant(value, { allowDateOnly: false });
  if (!date) details[field] = `${field} must be an ISO 8601 date-time`;
  return date ?? undefined;
};

// POST /api/bookings body → { resourceType, resourceId, startsAt, endsAt, purpose } (400 VALIDATION_ERROR).
const parseCreate = (body) => {
  const details = {};
  let resourceType;
  if (isBlank(body.resourceType)) details.resourceType = 'resourceType is required';
  else resourceType = readEnum(body.resourceType, RESOURCE_TYPES, 'resourceType', details);

  let resourceId;
  if (resourceType) {
    const field = bookingService.resourceField(resourceType);
    const other = field === 'room' ? 'equipment' : 'room';
    if (isBlank(body[field])) details[field] = `${field} is required`;
    else resourceId = readObjectId(body[field], field, details);
    if (!isBlank(body[other])) details[other] = `${other} must be empty for a ${resourceType} booking`;
  }

  const startsAt = readInstant(body.startsAt, 'startsAt', details);
  const endsAt = readInstant(body.endsAt, 'endsAt', details);
  let purpose;
  if (isBlank(body.purpose)) details.purpose = 'purpose is required';
  else purpose = readString(body.purpose, 'purpose', details, { min: PURPOSE_MIN_LENGTH, max: PURPOSE_MAX_LENGTH });

  throwIfInvalid(details);
  return { resourceType, resourceId, startsAt, endsAt, purpose };
};

// { version, note? } of a status change. `noteRequired` for a rejection.
const parseDecision = (body, { noteRequired = false, acceptNote = true } = {}) => {
  const details = {};
  let version;
  if (body.version === undefined || body.version === null || body.version === '') details.version = 'version is required';
  else version = readInteger(body.version, 'version', details, { min: 0 });
  let note = '';
  if (acceptNote) {
    if (isBlank(body.note)) {
      if (noteRequired) details.note = 'note is required';
    } else {
      note = readString(body.note, 'note', details, { min: 1, max: NOTE_MAX_LENGTH }) ?? '';
    }
  }
  throwIfInvalid(details);
  return { version, note };
};

const readQueryEnum = (value, allowed, field) => {
  const details = {};
  const result = readEnum(String(firstValue(value)), allowed, field, details);
  throwIfInvalid(details);
  return result;
};

const readQueryId = (value, field) => {
  const details = {};
  const id = readObjectId(String(firstValue(value)), field, details);
  throwIfInvalid(details);
  return id;
};

const readQueryInstant = (value, field) => {
  const date = parseInstant(String(firstValue(value)));
  if (!date) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', {
      [field]: `${field} must be a date (YYYY-MM-DD) or an ISO 8601 date-time`,
    });
  }
  return date;
};

// ---------- Helpers ----------

const loadPopulated = (id) => Booking.findById(id).populate(BOOKING_POPULATE);

const describe = (booking) => {
  const name = booking.room?.name ?? booking.equipment?.name ?? booking.resourceSnapshot?.name ?? '?';
  const day = time.formatLocalDate(booking.startsAt);
  const slot = `${time.formatLocalTime(booking.startsAt)}-${time.formatLocalTime(booking.endsAt)}`;
  const who = booking.user
    ? `${booking.user.firstname} ${booking.user.lastname}`
    : `${booking.userSnapshot?.firstname ?? ''} ${booking.userSnapshot?.lastname ?? ''}`.trim();
  return `${name} on ${day} ${slot} for ${who}`;
};

const auditMetadata = (booking, extra = {}) => ({
  resourceType: booking.resourceType,
  resourceId: String(booking.room?._id ?? booking.room ?? booking.equipment?._id ?? booking.equipment ?? ''),
  resourceName: booking.room?.name ?? booking.equipment?.name ?? booking.resourceSnapshot?.name ?? null,
  user: String(booking.user?._id ?? booking.user ?? ''),
  startsAt: booking.startsAt,
  endsAt: booking.endsAt,
  status: booking.status,
  version: booking.version,
  ...extra,
});

const paginated = async (filter, sort, req) => {
  const { page, limit, skip } = parsePagination(req.query);
  const [items, total] = await Promise.all([
    Booking.find(filter).sort(sort).skip(skip).limit(limit).populate(BOOKING_POPULATE),
    Booking.countDocuments(filter),
  ]);
  return { items, total, page, limit };
};

// ---------- Handlers ----------

// GET /api/bookings/availability?resourceType&resource&from&to → { from, to, busy } (range ≤ 31 days)
const getAvailability = async (req, res) => {
  const missing = ['resourceType', 'resource'].filter((field) => !present(firstValue(req.query[field])));
  if (missing.length > 0) {
    throw new HttpError(400, 'MISSING_FIELDS', `Missing required fields: ${missing.join(', ')}`, { fields: missing });
  }
  const resourceType = readQueryEnum(req.query.resourceType, RESOURCE_TYPES, 'resourceType');
  const resourceId = readQueryId(req.query.resource, 'resource');
  const { from, to } = parseRange(
    { from: firstValue(req.query.from), to: firstValue(req.query.to) },
    { maxDays: bookingService.AVAILABILITY_MAX_DAYS }
  );
  const resource = await bookingService.findResource(resourceType, resourceId);
  if (!resource) throw notFound(resourceType === 'ROOM' ? 'Room' : 'Equipment');

  const busy = await bookingService.availability({ viewer: req.user, resourceType, resource, from, to });
  res.status(200).json({
    resourceType,
    resource: String(resource._id),
    bookable: bookingService.isBookableResource(resourceType, resource),
    requiresApproval: bookingService.resourceRequiresApproval(resourceType, resource),
    from,
    to,
    busy,
  });
};

// GET /api/bookings/free-rooms?from&to&minCapacity&type → [Room] free for the whole interval
const getFreeRooms = async (req, res) => {
  const missing = ['from', 'to'].filter((field) => !present(firstValue(req.query[field])));
  if (missing.length > 0) {
    throw new HttpError(400, 'MISSING_FIELDS', `Missing required fields: ${missing.join(', ')}`, { fields: missing });
  }
  const { from, to } = parseRange(
    { from: firstValue(req.query.from), to: firstValue(req.query.to) },
    { maxDays: bookingService.FREE_ROOMS_MAX_DAYS }
  );
  const details = {};
  let minCapacity;
  if (present(firstValue(req.query.minCapacity))) {
    minCapacity = readInteger(String(firstValue(req.query.minCapacity)), 'minCapacity', details, { min: 1, max: 10000 });
  }
  let type;
  if (present(firstValue(req.query.type))) type = readEnum(String(firstValue(req.query.type)), Room.ROOM_TYPES, 'type', details);
  throwIfInvalid(details);

  res.status(200).json(await bookingService.freeRooms({ from, to, minCapacity, type }));
};

// POST /api/bookings [STUDENT, TEACHER, ADMIN] → 201 Booking
const createBooking = async (req, res) => {
  const input = parseCreate(bodyOf(req));
  const booking = await bookingService.createBooking(req.user, input);
  res.status(201).json(booking);
};

// GET /api/bookings/me?status&scope=upcoming|past&page&limit → own bookings
const listMyBookings = async (req, res) => {
  const filter = { user: req.user._id };
  if (present(firstValue(req.query.status))) {
    filter.status = { $in: parseListQuery(req.query.status, BOOKING_STATUSES, 'status') };
  }
  const now = new Date();
  let sort = { startsAt: -1, _id: -1 };
  if (present(firstValue(req.query.scope))) {
    const scope = readQueryEnum(req.query.scope, ['UPCOMING', 'PAST'], 'scope');
    if (scope === 'UPCOMING') {
      filter.endsAt = { $gt: now };
      sort = { startsAt: 1, _id: 1 };
    } else {
      filter.endsAt = { $lte: now };
    }
  }
  res.status(200).json(await paginated(filter, sort, req));
};

// GET /api/bookings/:id → owner or ADMIN (others: 404)
const getBooking = async (req, res) => {
  assertObjectId(req.params.id);
  const booking = await loadPopulated(req.params.id);
  const ownerId = booking ? String(booking.user?._id ?? booking.populated('user') ?? booking.user) : null;
  if (!booking || (!bookingService.isAdmin(req.user) && ownerId !== String(req.user._id))) throw notFound('Booking');
  res.status(200).json(booking);
};

// POST /api/bookings/:id/cancel { version } → owner (before the start) or ADMIN → 200 CANCELLED
const cancelBooking = async (req, res) => {
  assertObjectId(req.params.id);
  const { version } = parseDecision(bodyOf(req), { acceptNote: false });
  const { booking, byOwner } = await bookingService.cancelBooking(req.user, req.params.id, { version });
  await auditService.record(req, {
    action: 'booking.cancel',
    targetType: 'Booking',
    targetId: booking._id,
    summary: `Cancelled booking of ${describe(booking)}${byOwner ? '' : ' (by an admin)'}`,
    metadata: auditMetadata(booking, { byOwner }),
  });
  res.status(200).json(booking);
};

// GET /api/bookings?status&resourceType&resource&user&from&to&order=asc|desc&page&limit [ADMIN]
const listBookings = async (req, res) => {
  const filter = {};
  const q = req.query;
  if (present(firstValue(q.status))) filter.status = { $in: parseListQuery(q.status, BOOKING_STATUSES, 'status') };
  let resourceType;
  if (present(firstValue(q.resourceType))) {
    resourceType = readQueryEnum(q.resourceType, RESOURCE_TYPES, 'resourceType');
    filter.resourceType = resourceType;
  }
  if (present(firstValue(q.resource))) {
    const id = readQueryId(q.resource, 'resource');
    if (resourceType) filter[bookingService.resourceField(resourceType)] = id;
    else filter.$or = [{ room: id }, { equipment: id }];
  }
  if (present(firstValue(q.user))) filter.user = readQueryId(q.user, 'user');
  const from = present(firstValue(q.from)) ? readQueryInstant(q.from, 'from') : null;
  const to = present(firstValue(q.to)) ? readQueryInstant(q.to, 'to') : null;
  if (from && to && to <= from) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', { to: 'to must be after from' });
  }
  if (from) filter.endsAt = { $gt: from };
  if (to) filter.startsAt = { $lt: to };
  let direction = 1;
  if (present(firstValue(q.order))) direction = readQueryEnum(q.order, ['ASC', 'DESC'], 'order') === 'DESC' ? -1 : 1;

  res.status(200).json(await paginated(filter, { startsAt: direction, _id: direction }, req));
};

// POST /api/bookings/:id/approve { version, note? } [ADMIN] → 200 CONFIRMED
const approveBooking = async (req, res) => {
  assertObjectId(req.params.id);
  const { version, note } = parseDecision(bodyOf(req));
  const booking = await bookingService.approveBooking(req.user, req.params.id, { version, note });
  await auditService.record(req, {
    action: 'booking.approve',
    targetType: 'Booking',
    targetId: booking._id,
    summary: `Approved booking of ${describe(booking)}`,
    metadata: auditMetadata(booking, { note }),
  });
  res.status(200).json(booking);
};

// POST /api/bookings/:id/reject { version, note } [ADMIN] → 200 REJECTED
const rejectBooking = async (req, res) => {
  assertObjectId(req.params.id);
  const { version, note } = parseDecision(bodyOf(req), { noteRequired: true });
  const booking = await bookingService.rejectBooking(req.user, req.params.id, { version, note });
  await auditService.record(req, {
    action: 'booking.reject',
    targetType: 'Booking',
    targetId: booking._id,
    summary: `Rejected booking of ${describe(booking)}`,
    metadata: auditMetadata(booking, { note }),
  });
  res.status(200).json(booking);
};

// Default statistics range: the current month (campus timezone).
const currentMonth = (now = new Date()) => {
  const { year, month } = time.getZonedParts(now);
  const pad = (value) => String(value).padStart(2, '0');
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    from: time.parseLocalDateTime(`${year}-${pad(month)}-01`, '00:00'),
    to: time.parseLocalDateTime(`${next.year}-${pad(next.month)}-01`, '00:00'),
  };
};

// GET /api/bookings/stats?from&to [ADMIN] → { from, to, totals: { byStatus, ... }, resources }
const getStats = async (req, res) => {
  const fromValue = firstValue(req.query.from);
  const toValue = firstValue(req.query.to);
  const range =
    present(fromValue) || present(toValue)
      ? parseRange({ from: fromValue, to: toValue }, { maxDays: bookingService.STATS_MAX_DAYS })
      : currentMonth();
  res.status(200).json(await bookingService.computeStats(range));
};

module.exports = {
  getAvailability,
  getFreeRooms,
  createBooking,
  listMyBookings,
  getBooking,
  cancelBooking,
  listBookings,
  approveBooking,
  rejectBooking,
  getStats,
  // Exported for tests.
  parseCreate,
  currentMonth,
};
