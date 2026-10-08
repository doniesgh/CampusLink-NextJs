const mongoose = require('mongoose');
const Booking = require('../models/bookingModel');
const BookingSlot = require('../models/bookingSlotModel');
const Equipment = require('../models/equipmentModel');
const Room = require('../models/roomModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const time = require('../utils/time');
const { envNumber } = require('../utils/env');
const { notFound } = require('../utils/validation');
const scheduler = require('./scheduler');
const { notifyUsers, notifyUsersInBackground } = require('./notificationService');
const { formatDay } = require('./timetableService');

/*
 * Room and equipment bookings (Module 5, phase 2 contract section 1.2): booking rules, conflicts,
 * concurrency-safe slot claims, optimistic locking of status changes, BOOKING notifications,
 * reminders, availability, free rooms and statistics. Used by controllers/bookingController.js,
 * controllers/resourceController.js and the demo seed (scripts/seed/30-bookings.js).
 */

const { ACTIVE_STATUSES, BOOKING_POPULATE, MAX_DURATION_MS } = Booking;
const { SLOT_MS, resourceKey, slotsOf } = BookingSlot;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const OPEN_MINUTES = 7 * 60; // 07:00 campus time
const CLOSE_MINUTES = 21 * 60; // 21:00 campus time
// Opening days for the occupancy rate: Monday (1) to Saturday (6).
const OPENING_WEEKDAYS = [1, 2, 3, 4, 5, 6];
const MAX_DAYS_AHEAD = 60;
const MAX_HOURS_BY_ROLE = { STUDENT: 3, TEACHER: 8, ADMIN: 8 };
// A STUDENT holds at most this many upcoming PENDING / CONFIRMED bookings.
const STUDENT_ACTIVE_LIMIT = 3;
const AVAILABILITY_MAX_DAYS = 31;
const FREE_ROOMS_MAX_DAYS = 31;
const STATS_MAX_DAYS = 366;
const REMINDERS_PER_RUN = 100;
// A slot claimed this long ago by a booking that does not exist is the leftover of a request that
// never finished (crash): it is released.
const STALE_CLAIM_MS = 2 * MINUTE_MS;
const STALE_SLOTS_INTERVAL_MS = 10 * MINUTE_MS;
// The admins get at most one "new request" notification per requester in this window, so a create / cancel
// loop cannot flood them; the other requests of the window wait in the pending queue of the admin page.
const REQUEST_NOTIFY_COOLDOWN_MS = 10 * MINUTE_MS;

const reminderMinutes = () => envNumber('BOOKING_REMINDER_MINUTES', 60);

const isAdmin = (user) => user?.role === 'ADMIN';
const sameId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const toObjectId = (value) => new mongoose.Types.ObjectId(String(value?._id ?? value));

const bookingConflict = (conflicts) =>
  new HttpError(409, 'BOOKING_CONFLICT', 'This time slot is not available for this resource', { conflicts });

const invalidState = (message, details) => new HttpError(409, 'INVALID_STATE', message, details);

// ---------- Time rules (campus timezone) ----------

const localMinutes = (date) => {
  const parts = time.getZonedParts(date);
  return parts.hour * 60 + parts.minute;
};

const onGrid = (date) => {
  const parts = time.getZonedParts(date);
  return parts.minute % 15 === 0 && parts.second === 0 && date.getUTCMilliseconds() === 0;
};

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * First booking rule broken by [startsAt, endsAt) for a user of `role`, or null when the times are valid:
 * 15-minute grid, same day, 07:00–21:00 campus time, in the future, at most 60 days ahead, at most
 * 3 h (STUDENT) / 8 h (TEACHER, ADMIN). Returns { field, rule, message, ...extra }.
 */
const checkBookingTimes = (startsAt, endsAt, role, now = new Date()) => {
  if (!(endsAt > startsAt)) {
    return { field: 'endsAt', rule: 'END_BEFORE_START', message: 'endsAt must be after startsAt' };
  }
  if (!onGrid(startsAt)) {
    return { field: 'startsAt', rule: 'TIME_GRID', message: 'Times must be on a 15-minute grid (10:00, 10:15, 10:30...)' };
  }
  if (!onGrid(endsAt)) {
    return { field: 'endsAt', rule: 'TIME_GRID', message: 'Times must be on a 15-minute grid (10:00, 10:15, 10:30...)' };
  }
  if (!time.isSameLocalDay(startsAt, new Date(endsAt.getTime() - 1))) {
    return { field: 'endsAt', rule: 'SAME_DAY', message: 'A booking must start and end on the same day' };
  }
  const openingMessage = `Bookings are possible between ${hhmm(OPEN_MINUTES)} and ${hhmm(CLOSE_MINUTES)}`;
  if (localMinutes(startsAt) < OPEN_MINUTES) {
    return { field: 'startsAt', rule: 'OPENING_HOURS', message: openingMessage };
  }
  // An end at midnight is the end of the day (24:00).
  const endMinutes = time.isSameLocalDay(startsAt, endsAt) ? localMinutes(endsAt) : 24 * 60;
  if (endMinutes > CLOSE_MINUTES) {
    return { field: 'endsAt', rule: 'OPENING_HOURS', message: openingMessage };
  }
  if (startsAt <= now) {
    return { field: 'startsAt', rule: 'IN_PAST', message: 'A booking must start in the future' };
  }
  if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * time.DAY_MS) {
    return {
      field: 'startsAt',
      rule: 'TOO_FAR_AHEAD',
      message: `A booking can start at most ${MAX_DAYS_AHEAD} days ahead`,
      maxDaysAhead: MAX_DAYS_AHEAD,
    };
  }
  const maxHours = MAX_HOURS_BY_ROLE[role] ?? MAX_HOURS_BY_ROLE.STUDENT;
  if (endsAt.getTime() - startsAt.getTime() > maxHours * HOUR_MS) {
    return { field: 'endsAt', rule: 'MAX_DURATION', message: `A booking lasts at most ${maxHours} hours`, maxHours };
  }
  return null;
};

// 400 VALIDATION_ERROR of a broken time rule: details = { <field>: message, rule, ...extra }.
const timeRuleError = ({ field, message, ...extra }) =>
  new HttpError(400, 'VALIDATION_ERROR', message, { [field]: message, ...extra });

// ---------- Resources ----------

const resourceField = (resourceType) => (resourceType === 'ROOM' ? 'room' : 'equipment');

// The room or equipment item (lean), or null.
const findResource = async (resourceType, id) => {
  if (!mongoose.isObjectIdOrHexString(String(id))) return null;
  return resourceType === 'ROOM' ? Room.findById(id).lean() : Equipment.findById(id).lean();
};

// Can it be booked now? Rooms: bookable; equipment: active.
const isBookableResource = (resourceType, resource) =>
  resourceType === 'ROOM' ? Room.isRoomBookable(resource) : resource.active !== false;

const resourceRequiresApproval = (resourceType, resource) =>
  resourceType === 'ROOM' ? Room.roomRequiresApproval(resource) : Boolean(resource.requiresApproval);

const resourceSnapshot = (resourceType, resource) =>
  resourceType === 'ROOM'
    ? { name: resource.name, building: resource.building || '', capacity: resource.capacity ?? null, type: resource.type }
    : { name: resource.name, category: resource.category };

// ---------- Queries ----------

// Bookings / sessions overlapping [from, to). Both last at most 8 hours, so the startsAt bound keeps the
// query on the { <resource>: 1, startsAt: 1 } indexes.
const overlapFilter = (from, to) => ({
  startsAt: { $gt: new Date(from.getTime() - MAX_DURATION_MS), $lt: to },
  endsAt: { $gt: from },
});

const activeBookingsOf = (resourceType, resourceIds, from, to, { excludeId } = {}) =>
  Booking.find({
    [resourceField(resourceType)]: { $in: resourceIds.map(toObjectId) },
    status: { $in: ACTIVE_STATUSES },
    ...overlapFilter(from, to),
    ...(excludeId ? { _id: { $ne: toObjectId(excludeId) } } : {}),
  })
    .sort({ startsAt: 1, _id: 1 })
    .populate({ path: 'user', select: 'firstname lastname role' })
    .lean();

// SCHEDULED class sessions in these rooms overlapping [from, to) ([] when the timetable module is absent).
const scheduledSessionsIn = (roomIds, from, to) => {
  const ClassSession = mongoose.models.ClassSession;
  if (!ClassSession || roomIds.length === 0) return Promise.resolve([]);
  return ClassSession.find({ room: { $in: roomIds.map(toObjectId) }, status: 'SCHEDULED', ...overlapFilter(from, to) })
    .sort({ startsAt: 1, _id: 1 })
    .select('subject groups room startsAt endsAt type')
    .populate([
      { path: 'subject', select: 'name code' },
      { path: 'groups', select: 'name' },
    ])
    .lean();
};

const personName = (user) => (user ? `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim() : '');
const userSummary = (user, snapshot) => {
  const source = user && user._id ? user : snapshot;
  const id = user?._id ?? null;
  if (!id && !snapshot) return null;
  return { id: id ? String(id) : null, firstname: source?.firstname ?? '', lastname: source?.lastname ?? '', role: source?.role ?? null };
};
const sessionSubject = (session) =>
  session.subject ? { id: String(session.subject._id), name: session.subject.name, code: session.subject.code } : null;
const sessionLabel = (session) => {
  const subject = session.subject?.name || session.subject?.code || 'Class';
  const groups = (session.groups || []).map((group) => group?.name).filter(Boolean);
  return groups.length > 0 ? `${subject} (${groups.join(', ')})` : subject;
};

/**
 * Conflicts of [startsAt, endsAt) on a resource: active bookings and (rooms) SCHEDULED class sessions.
 * Contract shape { kind: "BOOKING" | "CLASS", startsAt, endsAt } (+ mine for the viewer's own bookings);
 * ADMIN viewers also get bookingId, status, purpose and user / sessionId and subject.
 */
const findConflicts = async ({ resourceType, resourceId, startsAt, endsAt, viewer, excludeId }) => {
  const [bookings, sessions] = await Promise.all([
    activeBookingsOf(resourceType, [resourceId], startsAt, endsAt, { excludeId }),
    resourceType === 'ROOM' ? scheduledSessionsIn([resourceId], startsAt, endsAt) : [],
  ]);
  const admin = isAdmin(viewer);
  const conflicts = [
    ...bookings.map((booking) => {
      const conflict = {
        kind: 'BOOKING',
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        mine: sameId(booking.user?._id ?? booking.user, viewer?._id),
      };
      if (admin) {
        Object.assign(conflict, {
          bookingId: String(booking._id),
          status: booking.status,
          purpose: booking.purpose,
          user: userSummary(booking.user, booking.userSnapshot),
        });
      }
      return conflict;
    }),
    ...sessions.map((session) => {
      const conflict = { kind: 'CLASS', startsAt: session.startsAt, endsAt: session.endsAt };
      if (admin) Object.assign(conflict, { sessionId: String(session._id), subject: sessionSubject(session) });
      return conflict;
    }),
  ];
  return conflicts.sort((a, b) => a.startsAt - b.startsAt);
};

// ---------- Slot claims (concurrency) ----------

const isDuplicateKey = (error) =>
  error?.code === 11000 || (Array.isArray(error?.writeErrors) && error.writeErrors.some((w) => (w.code ?? w.err?.code) === 11000));

// Releases every slot of a booking (idempotent).
const releaseSlots = (bookingId) => BookingSlot.deleteMany({ booking: toObjectId(bookingId) });

/**
 * Slots of [startsAt, endsAt) on `key` held by other bookings. Holders that are no longer active
 * (rejected / cancelled whose release failed) or that never got created (request that crashed, claim
 * older than STALE_CLAIM_MS) are stale. Returns { stale: [slotIds], blocking: [{ bookingId, booking, slots }] }.
 */
const inspectClaims = async (key, startsAt, endsAt, bookingId) => {
  const slots = await BookingSlot.find({
    resourceKey: key,
    slot: { $gte: startsAt, $lt: endsAt },
    booking: { $ne: toObjectId(bookingId) },
  }).lean();
  const holderIds = [...new Set(slots.map((slot) => String(slot.booking)))];
  const holders = await Booking.find({ _id: { $in: holderIds.map(toObjectId) } })
    .select('status startsAt endsAt user userSnapshot purpose')
    .populate({ path: 'user', select: 'firstname lastname role' })
    .lean();
  const byId = new Map(holders.map((holder) => [String(holder._id), holder]));
  const now = Date.now();
  const stale = [];
  const blocking = new Map();
  slots.forEach((slot) => {
    const holder = byId.get(String(slot.booking));
    const isStale = holder
      ? !ACTIVE_STATUSES.includes(holder.status)
      : now - new Date(slot.createdAt ?? 0).getTime() > STALE_CLAIM_MS;
    if (isStale) {
      stale.push(slot._id);
      return;
    }
    const id = String(slot.booking);
    if (!blocking.has(id)) blocking.set(id, { bookingId: id, booking: holder ?? null, slots: [] });
    blocking.get(id).slots.push(slot.slot);
  });
  return { stale, blocking: [...blocking.values()] };
};

/**
 * Claims the 15-minute slots of [startsAt, endsAt) on a resource for `bookingId`. On a duplicate key
 * every slot claimed by this call is released; stale claims are cleaned up and the claim retried once.
 * Returns { ok: true } or { ok: false, blocking } (holders of the conflicting slots).
 */
const claimSlots = async ({ bookingId, resourceType, resourceId, startsAt, endsAt }) => {
  const key = resourceKey(resourceType, resourceId);
  const docs = slotsOf(startsAt, endsAt).map((slot) => ({ resourceKey: key, slot, booking: toObjectId(bookingId) }));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await BookingSlot.insertMany(docs, { ordered: true });
      return { ok: true };
    } catch (error) {
      // Only the slots of this resource (a student's seat, claimed before, stays).
      await BookingSlot.deleteMany({ booking: toObjectId(bookingId), resourceKey: key });
      if (!isDuplicateKey(error)) throw error;
      const { stale, blocking } = await inspectClaims(key, startsAt, endsAt, bookingId);
      if (blocking.length > 0 || stale.length === 0 || attempt === 1) return { ok: false, blocking };
      await BookingSlot.deleteMany({ _id: { $in: stale } });
    }
  }
  return { ok: false, blocking: [] };
};

// Conflicts of a failed claim: the bookings found by findConflicts, or the claimed slots of a booking
// still being created by another request.
const claimConflicts = async (claim, query) => {
  const conflicts = await findConflicts(query);
  if (conflicts.length > 0) return conflicts;
  return claim.blocking
    .map(({ slots }) => {
      const sorted = slots.map((slot) => new Date(slot)).sort((a, b) => a - b);
      return { kind: 'BOOKING', startsAt: sorted[0], endsAt: new Date(sorted.at(-1).getTime() + SLOT_MS), mine: false };
    })
    .sort((a, b) => a.startsAt - b.startsAt);
};

// ---------- Student limit ----------

const upcomingActiveFilter = (userId, now = new Date()) => ({
  user: toObjectId(userId),
  status: { $in: ACTIVE_STATUSES },
  endsAt: { $gt: now },
});

const countUpcomingActive = (userId, now) => Booking.countDocuments(upcomingActiveFilter(userId, now));

const limitReached = (current) =>
  new HttpError(
    409,
    'BOOKING_LIMIT_REACHED',
    `A student can hold at most ${STUDENT_ACTIVE_LIMIT} upcoming bookings`,
    { limit: STUDENT_ACTIVE_LIMIT, current: Math.min(current, STUDENT_ACTIVE_LIMIT) }
  );

/*
 * Seats: the student limit uses the same unique index as the slots. Each upcoming PENDING / CONFIRMED booking
 * of a STUDENT holds one of STUDENT_ACTIVE_LIMIT seat rows { resourceKey: "STUDENT:<userId>", slot: <seat n>,
 * booking }, so simultaneous requests of one student never exceed the limit and the first ones win. Seat
 * "slots" are fixed dates in year 9999 (never reached by the TTL). A seat is released with the booking's
 * slots (reject / cancel), and lazily once its booking has ended.
 */
const SEAT_EPOCH_MS = Date.UTC(9999, 0, 1);
const seatKey = (userId) => `STUDENT:${String(userId?._id ?? userId)}`;
const seatSlot = (index) => new Date(SEAT_EPOCH_MS + index * SLOT_MS);

// Claims a free seat of the student for bookingId. Returns false when every seat is held by an upcoming
// active booking.
const claimSeat = async (userId, bookingId, { now = new Date() } = {}) => {
  const key = seatKey(userId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (let index = 0; index < STUDENT_ACTIVE_LIMIT; index += 1) {
      try {
        await BookingSlot.create({ resourceKey: key, slot: seatSlot(index), booking: toObjectId(bookingId) });
        return true;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    // Every seat is taken: free those of ended, inactive or never-created bookings, then try once more.
    const seats = await BookingSlot.find({ resourceKey: key }).lean();
    const holders = await Booking.find({ _id: { $in: seats.map((seat) => seat.booking) } })
      .select('status endsAt')
      .lean();
    const byId = new Map(holders.map((holder) => [String(holder._id), holder]));
    const stale = seats.filter((seat) => {
      if (sameId(seat.booking, bookingId)) return false;
      const holder = byId.get(String(seat.booking));
      if (!holder) return now.getTime() - new Date(seat.createdAt ?? 0).getTime() > STALE_CLAIM_MS;
      return !ACTIVE_STATUSES.includes(holder.status) || holder.endsAt <= now;
    });
    if (stale.length === 0) return false;
    await BookingSlot.deleteMany({ _id: { $in: stale.map((seat) => seat._id) } });
  }
  return false;
};

// ---------- Notifications ----------

const resourceName = (booking) => {
  const resource = booking.resourceType === 'ROOM' ? booking.room : booking.equipment;
  return (resource && resource.name) || booking.resourceSnapshot?.name || '—';
};
const slotText = (booking, locale) =>
  `${formatDay(booking.startsAt, locale)}, ${time.formatLocalTime(booking.startsAt)}–${time.formatLocalTime(booking.endsAt)}`;
const quote = (text, locale) => (locale === 'en' ? `"${text}"` : `« ${text} »`);
const ownerId = (booking) => booking.user?._id ?? booking.user;
const myBookingsLink = (booking) => `/dashboard/bookings?booking=${booking._id}`;

const bookingData = (booking, extra = {}) => ({
  bookingId: String(booking._id),
  status: booking.status,
  resourceType: booking.resourceType,
  resourceId: String(booking.room?._id ?? booking.room ?? booking.equipment?._id ?? booking.equipment ?? ''),
  startsAt: booking.startsAt,
  endsAt: booking.endsAt,
  ...extra,
});

/** Localized BOOKING messages (French uses "tu"). kind: REQUEST | CONFIRMED | REJECTED | CANCELLED | REMINDER. */
const buildBookingText = (locale, kind, booking, { note = '', requester = null } = {}) => {
  const fr = locale !== 'en';
  const name = resourceName(booking);
  const when = slotText(booking, locale);
  const purpose = booking.purpose ? quote(booking.purpose, locale) : '';
  const withNote = (text, label) => (note ? `${text} ${label} ${note}` : text);
  switch (kind) {
    case 'REQUEST': {
      const who = personName(requester) || (fr ? 'Quelqu’un' : 'Someone');
      return {
        title: fr ? `Nouvelle demande de réservation : ${name} (${when})` : `New booking request: ${name} (${when})`,
        body: fr
          ? `${who} demande ${name} pour ${purpose}. Accepte-la ou refuse-la dans Réservations et ressources.`
          : `${who} requests ${name} for ${purpose}. Approve or reject it in Bookings & resources.`,
      };
    }
    case 'CONFIRMED':
      return {
        title: fr ? `Réservation confirmée : ${name} (${when})` : `Booking confirmed: ${name} (${when})`,
        body: fr
          ? withNote('Bonne nouvelle : ta demande a été acceptée.', 'Note :')
          : withNote('Good news: your request was approved.', 'Note:'),
      };
    case 'REJECTED':
      return {
        title: fr ? `Réservation refusée : ${name} (${when})` : `Booking rejected: ${name} (${when})`,
        body: fr
          ? withNote('Désolé, ta demande n’a pas été acceptée.', 'Motif :')
          : withNote('Sorry, your request was not approved.', 'Reason:'),
      };
    case 'CANCELLED':
      return {
        title: fr ? `Réservation annulée : ${name} (${when})` : `Booking cancelled: ${name} (${when})`,
        body: fr
          ? 'L’administration a annulé ta réservation. Tu peux réserver un autre créneau.'
          : 'Your booking was cancelled by the administration. You can book another time.',
      };
    case 'REMINDER':
      return {
        title: fr
          ? `Rappel : ${name} à ${time.formatLocalTime(booking.startsAt)} (${formatDay(booking.startsAt, locale)})`
          : `Reminder: ${name} at ${time.formatLocalTime(booking.startsAt)} (${formatDay(booking.startsAt, locale)})`,
        body: fr
          ? `Ta réservation ${purpose} commence bientôt : ${when}.`
          : `Your booking ${purpose} starts soon: ${when}.`,
      };
    default:
      throw new Error(`Unknown booking notification kind ${kind}`);
  }
};

/**
 * Every ADMIN except the requester gets a BOOKING notification about a new PENDING request, coalesced per
 * requester: none when another request of the same requester was notified less than REQUEST_NOTIFY_COOLDOWN_MS
 * (10 min) ago, and the push tag is per requester (`booking-request-<userId>`), so a new push replaces the
 * previous one on the admins' devices. The notified booking keeps `requestNotifiedAt`. Concurrent requests of
 * one requester may each notify (best effort; the per-user rate limit of POST /api/bookings bounds them).
 * Returns true when the admins are notified.
 */
const notifyAdminsOfRequest = async (booking, requester, { now = new Date() } = {}) => {
  const requesterId = toObjectId(ownerId(booking));
  const recent = await Booking.exists({
    user: requesterId,
    _id: { $ne: booking._id },
    requestNotifiedAt: { $gt: new Date(now.getTime() - REQUEST_NOTIFY_COOLDOWN_MS) },
  });
  if (recent) return false;
  const admins = await User.find({ role: 'ADMIN', _id: { $ne: requesterId } })
    .select('_id')
    .setOptions({ populateGroup: false })
    .lean();
  if (admins.length === 0) return false;
  await Booking.updateOne({ _id: booking._id }, { $set: { requestNotifiedAt: now } }, { timestamps: false });
  notifyUsersInBackground(
    admins.map((admin) => admin._id),
    (locale) => ({
      type: 'BOOKING',
      ...buildBookingText(locale, 'REQUEST', booking, { requester }),
      link: `/dashboard/admin/bookings?booking=${booking._id}`,
      data: bookingData(booking, { kind: 'REQUEST' }),
      tag: `booking-request-${requesterId}`,
    })
  );
  return true;
};

// The requester gets a BOOKING notification about a decision / cancellation (not about their own action).
const notifyRequester = (booking, kind, actor, { note = '' } = {}) => {
  const owner = ownerId(booking);
  if (!owner || sameId(owner, actor?._id)) return;
  notifyUsersInBackground([owner], (locale) => ({
    type: 'BOOKING',
    ...buildBookingText(locale, kind, booking, { note }),
    link: myBookingsLink(booking),
    data: bookingData(booking, { kind }),
    tag: `booking-${booking._id}`,
  }));
};

// ---------- Create ----------

/**
 * Creates a booking for `user` (STUDENT, TEACHER or ADMIN; the route refuses ALUMNI).
 * input = { resourceType, resourceId, startsAt, endsAt, purpose } already parsed (types checked).
 * Throws 400 VALIDATION_ERROR (unknown / unbookable resource, time rules), 409 BOOKING_LIMIT_REACHED,
 * 409 BOOKING_CONFLICT. Returns the populated booking document.
 */
const createBooking = async (user, { resourceType, resourceId, startsAt, endsAt, purpose }, { now = new Date() } = {}) => {
  const field = resourceField(resourceType);
  const resource = await findResource(resourceType, resourceId);
  if (!resource) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', {
      [field]: resourceType === 'ROOM' ? 'Unknown room' : 'Unknown equipment',
    });
  }
  if (!isBookableResource(resourceType, resource)) {
    const message = resourceType === 'ROOM' ? 'This room cannot be booked' : 'This equipment is not available for booking';
    throw new HttpError(400, 'VALIDATION_ERROR', message, {
      [field]: message,
      rule: resourceType === 'ROOM' ? 'NOT_BOOKABLE' : 'INACTIVE',
    });
  }

  const broken = checkBookingTimes(startsAt, endsAt, user.role, now);
  if (broken) throw timeRuleError(broken);

  const isStudent = user.role === 'STUDENT';
  if (isStudent) {
    const current = await countUpcomingActive(user._id, now);
    if (current >= STUDENT_ACTIVE_LIMIT) throw limitReached(current);
  }

  const query = { resourceType, resourceId: resource._id, startsAt, endsAt, viewer: user };
  const conflicts = await findConflicts(query);
  if (conflicts.length > 0) throw bookingConflict(conflicts);

  const bookingId = new mongoose.Types.ObjectId();
  if (isStudent && !(await claimSeat(user._id, bookingId, { now }))) {
    throw limitReached(await countUpcomingActive(user._id, now));
  }
  const claim = await claimSlots({ bookingId, resourceType, resourceId: resource._id, startsAt, endsAt });
  if (!claim.ok) {
    await releaseSlots(bookingId);
    throw bookingConflict(await claimConflicts(claim, query));
  }

  const requiresApproval = resourceRequiresApproval(resourceType, resource);
  let booking;
  try {
    booking = await Booking.create({
      _id: bookingId,
      resourceType,
      room: resourceType === 'ROOM' ? resource._id : null,
      equipment: resourceType === 'EQUIPMENT' ? resource._id : null,
      resourceSnapshot: resourceSnapshot(resourceType, resource),
      user: user._id,
      userSnapshot: { firstname: user.firstname, lastname: user.lastname, role: user.role },
      purpose,
      startsAt,
      endsAt,
      status: requiresApproval ? 'PENDING' : 'CONFIRMED',
    });
  } catch (error) {
    await releaseSlots(bookingId);
    throw error;
  }

  // Safety net behind the seats (e.g. bookings written without a seat): a booking that makes the count
  // exceed the limit (its own booking included) is rolled back, so the limit is never exceeded.
  if (isStudent) {
    const current = await countUpcomingActive(user._id, now);
    if (current > STUDENT_ACTIVE_LIMIT) {
      await Booking.deleteOne({ _id: bookingId });
      await releaseSlots(bookingId);
      throw limitReached(current - 1);
    }
  }

  await booking.populate(BOOKING_POPULATE);
  if (booking.status === 'PENDING') await notifyAdminsOfRequest(booking, user, { now });
  return booking;
};

// ---------- Status changes (optimistic locking) ----------

const findBookingOr404 = async (id) => {
  if (!mongoose.isObjectIdOrHexString(String(id))) throw new HttpError(400, 'INVALID_ID', 'Invalid id');
  const booking = await Booking.findById(id);
  if (!booking) throw notFound('Booking');
  return booking;
};

const versionConflict = (booking) =>
  new HttpError(409, 'VERSION_CONFLICT', 'This booking was changed in the meantime: reload it and try again', {
    version: booking.version,
    status: booking.status,
  });

/**
 * Atomic status change: applies `set` (+ version + 1) only when the booking still has `version` and one of
 * `fromStatuses`. Otherwise 409 VERSION_CONFLICT (stale version) or 409 INVALID_STATE (wrong status).
 */
const transition = async (bookingId, version, fromStatuses, set) => {
  const updated = await Booking.findOneAndUpdate(
    { _id: bookingId, version, status: { $in: fromStatuses } },
    { $set: set, $inc: { version: 1 } },
    { returnDocument: 'after' }
  );
  if (updated) return updated;
  const current = await Booking.findById(bookingId).select('version status');
  if (!current) throw notFound('Booking');
  if (current.version !== version) throw versionConflict(current);
  throw invalidState(`This booking is ${current.status.toLowerCase()}`, { status: current.status });
};

// Checks done on the loaded document before the atomic update (clearer errors in the common case).
const assertVersionAndState = (booking, version, fromStatuses) => {
  if (booking.version !== version) throw versionConflict(booking);
  if (!fromStatuses.includes(booking.status)) {
    throw invalidState(`This booking is ${booking.status.toLowerCase()}`, { status: booking.status });
  }
};

const decisionOf = (admin, note, now) => ({
  by: admin._id,
  bySnapshot: { firstname: admin.firstname, lastname: admin.lastname },
  at: now,
  note: note || '',
});

// ADMIN: PENDING → CONFIRMED (not for a booking that has already ended).
const approveBooking = async (admin, bookingId, { version, note = '' }, { now = new Date() } = {}) => {
  const booking = await findBookingOr404(bookingId);
  assertVersionAndState(booking, version, ['PENDING']);
  if (booking.endsAt <= now) throw invalidState('This booking has already ended', { status: booking.status, reason: 'ENDED' });
  const updated = await transition(booking._id, version, ['PENDING'], {
    status: 'CONFIRMED',
    decision: decisionOf(admin, note, now),
  });
  await updated.populate(BOOKING_POPULATE);
  notifyRequester(updated, 'CONFIRMED', admin, { note });
  return updated;
};

// ADMIN: PENDING → REJECTED (note required), the slots are released.
const rejectBooking = async (admin, bookingId, { version, note }, { now = new Date() } = {}) => {
  const booking = await findBookingOr404(bookingId);
  assertVersionAndState(booking, version, ['PENDING']);
  const updated = await transition(booking._id, version, ['PENDING'], {
    status: 'REJECTED',
    decision: decisionOf(admin, note, now),
  });
  await releaseSlots(updated._id);
  await updated.populate(BOOKING_POPULATE);
  notifyRequester(updated, 'REJECTED', admin, { note });
  return updated;
};

/**
 * Owner (before the start) or ADMIN (any time): PENDING / CONFIRMED → CANCELLED, the slots are released.
 * Someone else's booking → 404 (its existence is not revealed). The owner gets a notification when an
 * admin cancels their booking.
 */
const cancelBooking = async (actor, bookingId, { version }, { now = new Date() } = {}) => {
  const booking = await findBookingOr404(bookingId);
  const owner = sameId(booking.user, actor._id);
  const admin = isAdmin(actor);
  if (!owner && !admin) throw notFound('Booking');
  assertVersionAndState(booking, version, ACTIVE_STATUSES);
  if (!admin && booking.startsAt <= now) {
    throw invalidState('This booking has already started', { status: booking.status, reason: 'STARTED' });
  }
  const updated = await transition(booking._id, version, ACTIVE_STATUSES, {
    status: 'CANCELLED',
    cancellation: { by: actor._id, at: now, byOwner: owner },
  });
  await releaseSlots(updated._id);
  await updated.populate(BOOKING_POPULATE);
  if (!owner) notifyRequester(updated, 'CANCELLED', actor);
  return { booking: updated, byOwner: owner };
};

// ---------- Reminders (scheduler) ----------

/**
 * Sends the reminder of every CONFIRMED booking starting within BOOKING_REMINDER_MINUTES (default 60).
 * Each booking is claimed with findOneAndUpdate on reminderSentAt: null, so it is reminded once, even
 * with several backend instances. Returns how many reminders were sent.
 */
const sendDueReminders = async ({ now = new Date() } = {}) => {
  const horizon = new Date(now.getTime() + reminderMinutes() * MINUTE_MS);
  let sent = 0;
  for (let i = 0; i < REMINDERS_PER_RUN; i += 1) {
    const claimed = await Booking.findOneAndUpdate(
      { status: 'CONFIRMED', reminderSentAt: null, startsAt: { $gt: now, $lte: horizon } },
      { $set: { reminderSentAt: now } },
      { sort: { startsAt: 1, _id: 1 }, returnDocument: 'after', timestamps: false }
    ).populate(BOOKING_POPULATE);
    if (!claimed) break;
    sent += 1;
    await notifyUsers([ownerId(claimed)], (locale) => ({
      type: 'BOOKING',
      ...buildBookingText(locale, 'REMINDER', claimed),
      link: myBookingsLink(claimed),
      data: bookingData(claimed, { kind: 'REMINDER' }),
      tag: `booking-reminder-${claimed._id}`,
      urgency: 'high',
    }));
  }
  if (sent > 0) console.log(`[bookings] Sent ${sent} booking reminder(s).`);
  return sent;
};

/**
 * Releases future slots whose booking is not active any more (rejected / cancelled when the release
 * failed) or was never created (request interrupted after its claim). Returns how many were deleted.
 */
const releaseStaleSlots = async ({ now = new Date() } = {}) => {
  const ids = await BookingSlot.distinct('booking', {
    slot: { $gte: now },
    createdAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) },
  });
  if (ids.length === 0) return 0;
  const active = await Booking.distinct('_id', { _id: { $in: ids }, status: { $in: ACTIVE_STATUSES } });
  const activeSet = new Set(active.map(String));
  const stale = ids.filter((id) => !activeSet.has(String(id)));
  if (stale.length === 0) return 0;
  const { deletedCount } = await BookingSlot.deleteMany({ booking: { $in: stale }, slot: { $gte: now } });
  if (deletedCount > 0) console.log(`[bookings] Released ${deletedCount} stale booking slot(s).`);
  return deletedCount;
};

const reminderJob = scheduler.registerJob('bookings.reminders', scheduler.defaultIntervalMs(), () => sendDueReminders());
const staleSlotsJob = scheduler.registerJob(
  'bookings.release-stale-slots',
  Math.max(scheduler.defaultIntervalMs(), STALE_SLOTS_INTERVAL_MS),
  () => releaseStaleSlots()
);

// ---------- Availability, free rooms ----------

/**
 * Busy periods of a resource in [from, to): active bookings and (rooms) SCHEDULED class sessions, sorted.
 * { startsAt, endsAt, kind, label } + status / mine for bookings. Non-admins: label "Booked" / "Class"
 * (their own bookings show their purpose); ADMIN: details (who and why / subject and groups).
 */
const availability = async ({ viewer, resourceType, resource, from, to }) => {
  const [bookings, sessions] = await Promise.all([
    activeBookingsOf(resourceType, [resource._id], from, to),
    resourceType === 'ROOM' ? scheduledSessionsIn([resource._id], from, to) : [],
  ]);
  const admin = isAdmin(viewer);
  const busy = [
    ...bookings.map((booking) => {
      const mine = sameId(booking.user?._id ?? booking.user, viewer._id);
      let label = 'Booked';
      if (admin) label = `${personName(booking.user ?? booking.userSnapshot)} · ${booking.purpose}`;
      else if (mine) label = booking.purpose;
      const entry = { startsAt: booking.startsAt, endsAt: booking.endsAt, kind: 'BOOKING', label, status: booking.status, mine };
      if (mine || admin) entry.bookingId = String(booking._id);
      if (admin) Object.assign(entry, { purpose: booking.purpose, user: userSummary(booking.user, booking.userSnapshot) });
      return entry;
    }),
    ...sessions.map((session) => {
      const entry = { startsAt: session.startsAt, endsAt: session.endsAt, kind: 'CLASS', label: admin ? sessionLabel(session) : 'Class' };
      if (admin) Object.assign(entry, { sessionId: String(session._id), subject: sessionSubject(session) });
      return entry;
    }),
  ];
  return busy.sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt);
};

/**
 * Bookable rooms free for the whole [from, to) (no active booking, no SCHEDULED class session), with an
 * optional minimum capacity and type, sorted by name.
 */
const freeRooms = async ({ from, to, minCapacity, type }) => {
  const filter = { bookable: { $ne: false } };
  if (minCapacity !== undefined) filter.capacity = { $gte: minCapacity };
  if (type) filter.type = type;
  const rooms = await Room.find(filter).sort({ name: 1, _id: 1 }).collation({ locale: 'en', strength: 2, numericOrdering: true });
  if (rooms.length === 0) return [];
  const ids = rooms.map((room) => room._id);
  const [bookings, sessions] = await Promise.all([
    activeBookingsOf('ROOM', ids, from, to),
    scheduledSessionsIn(ids, from, to),
  ]);
  const busy = new Set([...bookings.map((booking) => String(booking.room)), ...sessions.map((session) => String(session.room))]);
  return rooms.filter((room) => !busy.has(String(room._id)));
};

// ---------- Statistics ----------

// Opening hours (Mon–Sat 07:00–21:00, campus time) inside [from, to), in hours.
const openingHoursBetween = (from, to) => {
  let total = 0;
  let day = time.formatLocalDate(from);
  for (let i = 0; i <= STATS_MAX_DAYS + 1; i += 1) {
    const dayStart = time.parseLocalDateTime(day, '00:00');
    if (dayStart >= to) break;
    const { weekday } = time.getZonedParts(time.parseLocalDateTime(day, '12:00'));
    if (OPENING_WEEKDAYS.includes(weekday)) {
      const open = time.parseLocalDateTime(day, hhmm(OPEN_MINUTES));
      const close = time.parseLocalDateTime(day, hhmm(CLOSE_MINUTES));
      const start = Math.max(open.getTime(), from.getTime());
      const end = Math.min(close.getTime(), to.getTime());
      if (end > start) total += end - start;
    }
    day = time.addDaysToDateString(day, 1);
  }
  return total / HOUR_MS;
};

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Usage statistics of [from, to): bookings overlapping the range by status, and per resource (bookable rooms
 * and active equipment, plus any resource booked in the range) the CONFIRMED bookings, their hours inside
 * the range and the occupancy rate = booked hours / opening hours (Mon–Sat 07:00–21:00), capped at 1.
 */
const computeStats = async ({ from, to }) => {
  const overlap = overlapFilter(from, to);
  const [statusRows, confirmed, rooms, equipment] = await Promise.all([
    Booking.aggregate([{ $match: overlap }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Booking.find({ ...overlap, status: 'CONFIRMED' }).select('resourceType room equipment startsAt endsAt resourceSnapshot').lean(),
    Room.find({}).select('name bookable type').lean(),
    Equipment.find({}).select('name active').lean(),
  ]);

  const byStatus = Object.fromEntries(Booking.BOOKING_STATUSES.map((status) => [status, 0]));
  statusRows.forEach(({ _id, count }) => {
    byStatus[_id] = count;
  });

  const usage = new Map();
  confirmed.forEach((booking) => {
    const id = String(booking.resourceType === 'ROOM' ? booking.room : booking.equipment);
    const key = `${booking.resourceType}:${id}`;
    if (!usage.has(key)) usage.set(key, { bookings: 0, ms: 0, snapshot: booking.resourceSnapshot });
    const entry = usage.get(key);
    entry.bookings += 1;
    entry.ms += Math.min(booking.endsAt.getTime(), to.getTime()) - Math.max(booking.startsAt.getTime(), from.getTime());
  });

  const openingHours = openingHoursBetween(from, to);
  const resources = [];
  const add = (resourceType, id, name, include) => {
    const key = `${resourceType}:${id}`;
    const entry = usage.get(key);
    if (!include && !entry) return;
    usage.delete(key);
    const bookedHours = entry ? entry.ms / HOUR_MS : 0;
    resources.push({
      resourceType,
      id,
      name,
      bookings: entry ? entry.bookings : 0,
      bookedHours: round(bookedHours),
      occupancyRate: openingHours > 0 ? round(Math.min(1, bookedHours / openingHours), 4) : 0,
    });
  };
  rooms.forEach((room) => add('ROOM', String(room._id), room.name, Room.isRoomBookable(room)));
  equipment.forEach((item) => add('EQUIPMENT', String(item._id), item.name, item.active !== false));
  // Resources deleted since then (kept by their snapshot name).
  usage.forEach((entry, key) => {
    const [resourceType, id] = key.split(':');
    add(resourceType, id, entry.snapshot?.name || '—', true);
  });
  resources.sort(
    (a, b) => b.occupancyRate - a.occupancyRate || b.bookedHours - a.bookedHours || a.name.localeCompare(b.name)
  );

  const totalHours = resources.reduce((sum, resource) => sum + resource.bookedHours, 0);
  return {
    from,
    to,
    totals: {
      byStatus,
      bookings: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      bookedHours: round(totalHours),
      openingHours: round(openingHours),
    },
    resources,
  };
};

// Future PENDING / CONFIRMED bookings of a resource (409 IN_USE before deleting equipment).
const countFutureActiveBookings = (resourceType, resourceId, now = new Date()) =>
  Booking.countDocuments({
    [resourceField(resourceType)]: toObjectId(resourceId),
    status: { $in: ACTIVE_STATUSES },
    endsAt: { $gt: now },
  });

module.exports = {
  OPEN_MINUTES,
  CLOSE_MINUTES,
  OPENING_WEEKDAYS,
  MAX_DAYS_AHEAD,
  MAX_HOURS_BY_ROLE,
  STUDENT_ACTIVE_LIMIT,
  AVAILABILITY_MAX_DAYS,
  FREE_ROOMS_MAX_DAYS,
  STATS_MAX_DAYS,
  REQUEST_NOTIFY_COOLDOWN_MS,
  reminderMinutes,
  isAdmin,
  checkBookingTimes,
  resourceField,
  findResource,
  isBookableResource,
  resourceRequiresApproval,
  resourceSnapshot,
  findConflicts,
  claimSlots,
  claimSeat,
  releaseSlots,
  countUpcomingActive,
  buildBookingText,
  notifyAdminsOfRequest,
  createBooking,
  findBookingOr404,
  approveBooking,
  rejectBooking,
  cancelBooking,
  sendDueReminders,
  releaseStaleSlots,
  reminderJob,
  staleSlotsJob,
  availability,
  freeRooms,
  openingHoursBetween,
  computeStats,
  countFutureActiveBookings,
};
