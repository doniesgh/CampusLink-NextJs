const mongoose = require('mongoose');
const Trip = require('../models/tripModel');
const TripRequest = require('../models/tripRequestModel');
const TripMessage = require('../models/tripMessageModel');
const TripRating = require('../models/tripRatingModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const { notFound, assertObjectId, validationError } = require('../utils/validation');
const { envNumber, envString } = require('../utils/env');
const time = require('../utils/time');
const realtime = require('./realtime');
const scheduler = require('./scheduler');
const { notifyUsersInBackground } = require('./notificationService');

/*
 * Module 2 (carpooling), phase 3 contract section 2: rules, coordinate privacy, search, seat accounting,
 * requests, chat, ratings, history, completion job and notifications. HTTP parsing is in
 * controllers/carpoolController.js.
 *
 * Seat accounting (no transactions): Trip.seatsLeft is only changed by atomic conditional updates.
 *  - accept: first claim the seats (findOneAndUpdate { status: OPEN, seatsLeft >= n } → seatsLeft - n, FULL at 0),
 *    then switch the request PENDING → ACCEPTED; if that switch fails (request cancelled or accepted meanwhile), the
 *    seats are given back. So seatsLeft can be briefly too low, never too high: a trip is never overbooked.
 *  - the passenger cancelling an ACCEPTED request (atomic ACCEPTED → CANCELLED, one winner) gives the seats back.
 *  - the driver changing `seats` applies the difference to both counters, only when seatsLeft stays >= 0.
 */

const { ACTIVE_STATUSES } = Trip;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const MAX_DAYS_AHEAD = 30;
const MAX_UPCOMING_TRIPS = 5;
// A trip is over (completion job, ratings, "past" history) one hour after its departure.
const TRIP_DURATION_MS = HOUR_MS;
// Participants can still chat for a week after the departure (lost items...).
const CHAT_OPEN_AFTER_DEPARTURE_MS = 7 * DAY_MS;
const MAX_SEARCH_RADIUS_KM = 20;
const SEARCH_WINDOW_DAYS = MAX_DAYS_AHEAD + 1;
const ROAD_FACTOR = 1.3;
const MIN_TRIP_KM = 0.5;
const MAX_TRIP_KM = 500;
const DEFAULT_MESSAGES_LIMIT = 50;
const MAX_MESSAGES_LIMIT = 100;
const COMPLETION_BATCH = 100;

const DEFAULT_CAMPUS = { label: 'ESPRIT Ghazela', lat: 36.8992, lng: 10.1897 };

// Curated Greater Tunis places for the web picker (GET /places). Approximate centres of the neighbourhoods.
const PLACES = [
  { id: 'ariana', label: 'Ariana', lat: 36.8625, lng: 10.1956 },
  { id: 'ennasr', label: 'Ennasr', lat: 36.858, lng: 10.164 },
  { id: 'menzah', label: 'El Menzah', lat: 36.8395, lng: 10.1767 },
  { id: 'raoued', label: 'Raoued', lat: 36.9333, lng: 10.1833 },
  { id: 'soukra', label: 'La Soukra', lat: 36.8667, lng: 10.25 },
  { id: 'aouina', label: 'El Aouina', lat: 36.8531, lng: 10.2511 },
  { id: 'lac2', label: 'Lac 2', lat: 36.8463, lng: 10.2724 },
  { id: 'marsa', label: 'La Marsa', lat: 36.8782, lng: 10.3247 },
  { id: 'carthage', label: 'Carthage', lat: 36.8528, lng: 10.3233 },
  { id: 'gammarth', label: 'Gammarth', lat: 36.9173, lng: 10.2871 },
  { id: 'centre-ville', label: 'Tunis Centre-ville', lat: 36.8, lng: 10.1817 },
  { id: 'bardo', label: 'Le Bardo', lat: 36.8092, lng: 10.1406 },
  { id: 'manouba', label: 'La Manouba', lat: 36.8101, lng: 10.0956 },
  { id: 'mnihla', label: 'El Mnihla', lat: 36.8667, lng: 10.1167 },
  { id: 'ben-arous', label: 'Ben Arous', lat: 36.7531, lng: 10.2189 },
  { id: 'megrine', label: 'Mégrine', lat: 36.7686, lng: 10.2339 },
  { id: 'mourouj', label: 'El Mourouj', lat: 36.729, lng: 10.21 },
  { id: 'rades', label: 'Radès', lat: 36.7681, lng: 10.2753 },
];

// ---------- Settings and geometry ----------

const envCoordinate = (name, fallback, max) => {
  const value = Number(envString(name, ''));
  return Number.isFinite(value) && Math.abs(value) <= max && envString(name, '') !== '' ? value : fallback;
};

/** The campus: default destination (TO_CAMPUS) or departure (FROM_CAMPUS). */
const campus = () => ({
  label: envString('CAMPUS_LABEL', DEFAULT_CAMPUS.label).slice(0, Trip.LABEL_MAX_LENGTH),
  lat: envCoordinate('CAMPUS_LAT', DEFAULT_CAMPUS.lat, 90),
  lng: envCoordinate('CAMPUS_LNG', DEFAULT_CAMPUS.lng, 180),
});

const costPerKm = () => envNumber('CARPOOL_COST_PER_KM', 0.25);
const defaultSearchRadiusKm = () => Math.min(envNumber('CARPOOL_SEARCH_RADIUS_KM', 5), MAX_SEARCH_RADIUS_KM);

/** GET /settings: what clients need to build the forms (campus, limits, suggested cost). */
const getSettings = () => ({
  campus: campus(),
  costPerKm: costPerKm(),
  roadFactor: ROAD_FACTOR,
  defaultRadiusKm: defaultSearchRadiusKm(),
  maxRadiusKm: MAX_SEARCH_RADIUS_KM,
  minSeats: Trip.MIN_SEATS,
  maxSeats: Trip.MAX_SEATS,
  maxRequestSeats: TripRequest.MAX_SEATS,
  maxPricePerSeat: Trip.MAX_PRICE,
  maxDaysAhead: MAX_DAYS_AHEAD,
  maxUpcomingTrips: MAX_UPCOMING_TRIPS,
});

const listPlaces = () => PLACES.map((place) => ({ ...place }));

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
};

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in km between two { lat, lng }. */
const haversineKm = (a, b) => {
  const R = 6371.0088;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Estimated road distance (haversine × 1.3), 1 decimal. */
const roadDistanceKm = (a, b) => round(haversineKm(a, b) * ROAD_FACTOR, 1);

/** Suggested shared cost per seat: distanceKm × CARPOOL_COST_PER_KM / (seats + 1), 1 decimal, capped at 20. */
const suggestedPricePerSeat = (distanceKm, seats) =>
  Math.min(Trip.MAX_PRICE, round((distanceKm * costPerKm()) / (Number(seats) + 1), 1));

const toPoint = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });
const roundedPoint = ({ lat, lng }) => ({ type: 'Point', coordinates: [round(lng, 2), round(lat, 2)] });
const latLngOf = (place) => ({ lat: place.location.coordinates[1], lng: place.location.coordinates[0] });

/** Label of the curated place nearest to a point (default label of a place sent without one). */
const nearestPlaceLabel = (point) => {
  let best = null;
  PLACES.forEach((place) => {
    const distance = haversineKm(point, place);
    if (!best || distance < best.distance) best = { label: place.label, distance };
  });
  const site = campus();
  if (haversineKm(point, site) < (best?.distance ?? Infinity)) return site.label;
  return best ? best.label : site.label;
};

const placeDoc = ({ label, lat, lng }) => ({
  label: label || nearestPlaceLabel({ lat, lng }),
  location: toPoint({ lat, lng }),
});

// ---------- Small helpers ----------

const isDuplicateKey = (error) => error?.code === 11000;
const idString = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};
const sameId = (a, b) => Boolean(a) && Boolean(b) && idString(a) === idString(b);
const toObjectId = (value) => new mongoose.Types.ObjectId(idString(value));

const invalidState = (message, details) => new HttpError(409, 'INVALID_STATE', message, details);
const forbidden = (message = 'You do not have permission to perform this action', details) =>
  new HttpError(403, 'FORBIDDEN', message, details);
const ruleError = (field, message, rule, extra = {}) => validationError({ [field]: message, rule, ...extra });

const loadTrip = async (tripId) => {
  assertObjectId(tripId);
  const trip = await Trip.findById(tripId);
  if (!trip) throw notFound('Trip');
  return trip;
};

/**
 * Map(userId → { firstname, lastname }) of the current names. References are never populated, so a deleted account
 * keeps its id (and the snapshot names).
 */
const namesOf = async (userIds) => {
  const ids = [...new Set(userIds.filter(Boolean).map(idString))].filter((id) => mongoose.isObjectIdOrHexString(id));
  const map = new Map();
  if (ids.length === 0) return map;
  const users = await User.find({ _id: { $in: ids } }).select('firstname lastname').lean();
  users.forEach((user) => map.set(String(user._id), { firstname: user.firstname, lastname: user.lastname }));
  return map;
};

const hasDeparted = (trip, now) => new Date(trip.departureAt).getTime() <= now.getTime();
const isOver = (trip, now) => new Date(trip.departureAt).getTime() + TRIP_DURATION_MS <= now.getTime();

// ---------- Ratings ----------

/** Map(userId → { rating (1 decimal) | null, ratingCount }) of the carpool ratings received. */
const ratingsOf = async (userIds) => {
  const ids = [...new Set(userIds.filter(Boolean).map(idString))].filter((id) => mongoose.isObjectIdOrHexString(id));
  const result = new Map(ids.map((id) => [id, { rating: null, ratingCount: 0 }]));
  if (ids.length === 0) return result;
  const rows = await TripRating.aggregate([
    { $match: { ratee: { $in: ids.map(toObjectId) } } },
    { $group: { _id: '$ratee', average: { $avg: '$score' }, count: { $sum: 1 } } },
  ]);
  rows.forEach((row) => result.set(String(row._id), { rating: round(row.average, 1), ratingCount: row.count }));
  return result;
};

// ---------- Participants and privacy ----------

/** True when `userId` is the driver or an accepted passenger of the trip. */
const isParticipant = async (userId, trip) => {
  if (sameId(trip.driver, userId)) return true;
  return Boolean(
    await TripRequest.exists({ trip: toObjectId(trip._id), passenger: toObjectId(userId), status: 'ACCEPTED' })
  );
};

/** Map(userId → 'DRIVER' | 'PASSENGER') of the trip's participants. */
const participantRoles = async (trip) => {
  const roles = new Map([[idString(trip.driver), 'DRIVER']]);
  const accepted = await TripRequest.find({ trip: trip._id, status: 'ACCEPTED' }).select('passenger').lean();
  accepted.forEach((request) => roles.set(idString(request.passenger), 'PASSENGER'));
  return roles;
};

// The viewer's latest request of each trip: Map(tripId → request). A new request can only be sent when no other
// one is active, so the latest request is the active one when there is one.
const viewerRequests = async (viewerId, tripIds) => {
  const map = new Map();
  if (!viewerId || tripIds.length === 0) return map;
  const requests = await TripRequest.find({ passenger: toObjectId(viewerId), trip: { $in: tripIds.map(toObjectId) } })
    .sort({ createdAt: -1, _id: -1 })
    .select('trip status seats createdAt')
    .lean();
  requests.forEach((request) => {
    const key = idString(request.trip);
    if (!map.has(key)) map.set(key, request);
  });
  return map;
};

/**
 * Trip JSON for `viewer` (contract section 2). Coordinates are exact for the driver and accepted passengers,
 * rounded to 2 decimals (~1 km) for everyone else (other students, admins).
 * `distances` = Map(tripId → distanceFromYouKm) for searches.
 */
const presentTrips = async (trips, viewer, distances = null) => {
  if (trips.length === 0) return [];
  const [ratings, requests, names] = await Promise.all([
    ratingsOf(trips.map((trip) => trip.driver)),
    viewerRequests(viewer?._id, trips.map((trip) => trip._id)),
    namesOf(trips.map((trip) => trip.driver)),
  ]);
  return trips.map((trip) => {
    const request = requests.get(idString(trip._id));
    const isDriver = sameId(trip.driver, viewer?._id);
    const isPassenger = !isDriver && request?.status === 'ACCEPTED';
    const extra = {
      exact: isDriver || isPassenger,
      myRole: isDriver ? 'DRIVER' : isPassenger ? 'PASSENGER' : null,
      myRequest: request ? { id: String(request._id), status: request.status, seats: request.seats } : null,
      driverName: names.get(idString(trip.driver)),
      driverRating: ratings.get(idString(trip.driver)),
    };
    if (distances) extra.distanceFromYouKm = distances.get(idString(trip._id)) ?? null;
    const json = Trip.serializeTrip(trip, extra);
    // The campus end of a trip is public: an exact distance would place the other end on a thin ring around it.
    // Non-participants get it rounded to the kilometre, like the coordinates (security review, phase 3).
    if (!extra.exact && typeof json.distanceKm === 'number') json.distanceKm = Math.max(1, Math.round(json.distanceKm));
    return json;
  });
};

const presentTrip = async (trip, viewer) => (await presentTrips([trip], viewer))[0];

const presentRequests = async (requests) => {
  const passengers = requests.map((request) => request.passenger);
  const [ratings, names] = await Promise.all([ratingsOf(passengers), namesOf(passengers)]);
  return requests.map((request) =>
    TripRequest.serializeTripRequest(request, {
      passengerName: names.get(idString(request.passenger)),
      passengerRating: ratings.get(idString(request.passenger)),
    })
  );
};

const REQUEST_ORDER = { PENDING: 0, ACCEPTED: 1, DECLINED: 2, CANCELLED: 3, EXPIRED: 4 };

/** Every request of a trip for its driver: PENDING first, then ACCEPTED, then the others; newest first. */
const tripRequestsForDriver = async (trip) => {
  const requests = await TripRequest.find({ trip: trip._id }).sort({ createdAt: -1, _id: -1 }).lean();
  requests.sort((a, b) => (REQUEST_ORDER[a.status] ?? 9) - (REQUEST_ORDER[b.status] ?? 9));
  return presentRequests(requests);
};

/**
 * Trip detail (GET /trips/:id and the answers of the trip actions): Trip JSON plus
 *  - participants (driver and accepted passengers only, else null): [{ id, firstname, lastname, role, seats,
 *    rating, ratingCount, me, myRating: { score, comment, createdAt } | null }]
 *  - canRate: the viewer may rate the others now (participant, trip not cancelled, departure + 1 h passed)
 *  - requests (driver only, else null): every request of the trip.
 */
const presentTripDetail = async (trip, viewer, { now = new Date() } = {}) => {
  const json = await presentTrip(trip, viewer);
  json.participants = null;
  json.canRate = false;
  json.requests = null;
  if (!json.myRole) return json;

  const accepted = await TripRequest.find({ trip: trip._id, status: 'ACCEPTED' })
    .sort({ decidedAt: 1, _id: 1 })
    .lean();
  const names = await namesOf([trip.driver, ...accepted.map((request) => request.passenger)]);
  const participant = (id, snapshot, role, seats) => {
    const name = names.get(idString(id)) ?? snapshot ?? {};
    return { id: idString(id), firstname: name.firstname ?? '', lastname: name.lastname ?? '', role, seats };
  };
  const people = [
    participant(trip.driver, trip.driverSnapshot, 'DRIVER', null),
    ...accepted.map((request) => participant(request.passenger, request.passengerSnapshot, 'PASSENGER', request.seats)),
  ];
  const [ratings, given] = await Promise.all([
    ratingsOf(people.map((person) => person.id)),
    TripRating.find({ trip: trip._id, rater: viewer._id }).lean(),
  ]);
  const givenByRatee = new Map(given.map((rating) => [idString(rating.ratee), rating]));
  json.participants = people.map((person) => {
    const mine = givenByRatee.get(person.id);
    const rating = ratings.get(person.id) ?? { rating: null, ratingCount: 0 };
    return {
      ...person,
      rating: rating.rating,
      ratingCount: rating.ratingCount,
      me: sameId(person.id, viewer._id),
      myRating: mine ? { score: mine.score, comment: mine.comment || '', createdAt: mine.createdAt } : null,
    };
  });
  json.canRate = trip.status !== 'CANCELLED' && isOver(trip, now) && people.length > 1;
  if (json.myRole === 'DRIVER') json.requests = await tripRequestsForDriver(trip);
  return json;
};

const getTripDetail = async (viewer, tripId) => presentTripDetail(await loadTrip(tripId), viewer);

// ---------- Notifications (type CARPOOL, recipient's locale, French uses "tu") ----------

const dayFormatters = new Map();
const formatDay = (date, locale) => {
  const timeZone = time.getAppTimezone();
  const key = `${locale}|${timeZone}`;
  if (!dayFormatters.has(key)) {
    dayFormatters.set(
      key,
      new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone,
      })
    );
  }
  return dayFormatters.get(key).format(new Date(date));
};

/** "mar. 13 oct. à 07:30" / "Tue, Oct 13 at 07:30" (campus time). */
const formatWhen = (date, locale) =>
  `${formatDay(date, locale)} ${locale === 'en' ? 'at' : 'à'} ${time.formatLocalTime(new Date(date))}`;

const routeOf = (trip) => `${trip.departure.label} → ${trip.destination.label}`;
const nameOf = (person) => `${person?.firstname ?? ''} ${person?.lastname ?? ''}`.trim();
const seatsText = (seats, locale) =>
  locale === 'en' ? `${seats} seat${seats > 1 ? 's' : ''}` : `${seats} place${seats > 1 ? 's' : ''}`;
const quoted = (text, locale) => (locale === 'en' ? `"${text}"` : `« ${text} »`);

const tripLink = (trip) => `/dashboard/carpool/${trip._id}`;

/**
 * Texts of every CARPOOL notification. `info` = { person, request, reason, message, byAdmin, previousDepartureAt,
 * timeChanged, placeChanged }.
 */
const buildCarpoolText = (locale, kind, trip, info = {}) => {
  const fr = locale !== 'en';
  const route = routeOf(trip);
  const when = formatWhen(trip.departureAt, locale);
  const who = nameOf(info.person);
  const seats = info.request ? seatsText(info.request.seats, locale) : '';
  const withLine = (text, line) => (line ? `${text}\n${line}` : text);
  switch (kind) {
    case 'REQUEST':
      return {
        title: fr
          ? `Nouvelle demande pour ton trajet ${route} (${when})`
          : `New seat request for your trip ${route} (${when})`,
        body: withLine(
          fr ? `${who} demande ${seats}.` : `${who} asks for ${seats}.`,
          info.message ? quoted(info.message, locale) : ''
        ),
      };
    case 'ACCEPTED':
      return {
        title: fr ? `Demande acceptée : ${route} (${when})` : `Request accepted: ${route} (${when})`,
        body: fr
          ? `${who} a accepté ta demande (${seats}). Tu peux discuter avec ton conducteur sur la page du trajet.`
          : `${who} accepted your request (${seats}). You can chat with your driver on the trip page.`,
      };
    case 'DECLINED':
      return {
        title: fr ? `Demande refusée : ${route} (${when})` : `Request declined: ${route} (${when})`,
        body: withLine(
          fr
            ? `Désolé, ${who} n’a pas pu accepter ta demande. Jette un œil aux autres trajets !`
            : `Sorry, ${who} could not accept your request. Have a look at the other trips!`,
          info.message ? quoted(info.message, locale) : ''
        ),
      };
    case 'REQUEST_CANCELLED':
      return {
        title: fr ? `Demande annulée : ${route} (${when})` : `Request cancelled: ${route} (${when})`,
        body:
          info.request?.status === 'ACCEPTED'
            ? fr
              ? `${who} a annulé sa réservation (${seats}). Les places sont de nouveau disponibles.`
              : `${who} cancelled their booking (${seats}). The seats are available again.`
            : fr
              ? `${who} a retiré sa demande (${seats}).`
              : `${who} withdrew their request (${seats}).`,
      };
    case 'TRIP_CANCELLED':
      return {
        title: fr ? `Trajet annulé : ${route} (${when})` : `Trip cancelled: ${route} (${when})`,
        body: withLine(
          info.byAdmin
            ? fr
              ? 'L’équipe CampusLink a annulé ce trajet.'
              : 'The CampusLink team cancelled this trip.'
            : fr
              ? `${who} a annulé ce trajet. Pense à chercher un autre covoiturage.`
              : `${who} cancelled this trip. Remember to look for another ride.`,
          info.reason ? `${fr ? 'Motif :' : 'Reason:'} ${info.reason}` : ''
        ),
      };
    case 'UPDATED': {
      const lines = [];
      if (info.timeChanged) {
        lines.push(
          fr
            ? `Nouveau départ : ${when} (au lieu de ${formatWhen(info.previousDepartureAt, locale)}).`
            : `New departure: ${when} (was ${formatWhen(info.previousDepartureAt, locale)}).`
        );
      }
      if (info.placeChanged) {
        lines.push(fr ? `Nouveau trajet : ${route}.` : `New route: ${route}.`);
      }
      return {
        title: info.timeChanged
          ? fr
            ? `Horaire modifié : ${route}`
            : `Time changed: ${route}`
          : fr
            ? `Trajet modifié : ${route} (${when})`
            : `Trip updated: ${route} (${when})`,
        body: lines.join('\n'),
      };
    }
    case 'RATE':
      return {
        title: fr ? `Comment s’est passé ton trajet ? ${route}` : `How was your trip? ${route}`,
        body: fr
          ? 'Note tes covoitureurs : ça aide toute la communauté.'
          : 'Rate your fellow travellers: it helps the whole community.',
      };
    default:
      throw new Error(`Unknown carpool notification kind ${kind}`);
  }
};

const notifyCarpool = (userIds, kind, trip, info = {}, data = {}) => {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return;
  notifyUsersInBackground(ids, (locale) => ({
    type: 'CARPOOL',
    ...buildCarpoolText(locale, kind, trip, info),
    link: tripLink(trip),
    data: { kind, tripId: String(trip._id), ...data },
    tag: `carpool-${kind.toLowerCase()}-${data.requestId || trip._id}`,
  }));
};

// Real-time hints (best effort): live trip counters for the trip room, request changes for the users concerned.
const emitTripUpdated = (trip) => {
  realtime.emitToRoom(`trip:${trip._id}`, 'trip:updated', {
    tripId: String(trip._id),
    status: trip.status,
    seats: trip.seats,
    seatsLeft: trip.seatsLeft,
    departureAt: trip.departureAt,
  });
};
const emitRequestChanged = (userId, request) => {
  realtime.emitToUser(userId, 'carpool:request', {
    tripId: idString(request.trip),
    requestId: String(request._id),
    status: request.status,
  });
};

// ---------- Trip rules ----------

/**
 * Checks the rules of a trip (create, and update with the merged values) and computes the stored values.
 * input = { direction, departure: { label, lat, lng } | null, destination: idem, departureAt, ... } (types checked
 * by the controller). Throws 400 VALIDATION_ERROR with `details.rule` (first broken rule).
 */
const checkTimeRules = (departureAt, now) => {
  if (departureAt.getTime() <= now.getTime()) {
    throw ruleError('departureAt', 'departureAt must be in the future', 'IN_PAST');
  }
  if (departureAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * DAY_MS) {
    throw ruleError('departureAt', `departureAt must be within ${MAX_DAYS_AHEAD} days`, 'TOO_FAR_AHEAD', {
      maxDaysAhead: MAX_DAYS_AHEAD,
    });
  }
};

const checkPlaceRules = (departure, destination) => {
  const crow = haversineKm(departure, destination);
  if (crow < MIN_TRIP_KM) {
    throw ruleError('destination', 'departure and destination must be different places', 'SAME_PLACE', {
      minDistanceKm: MIN_TRIP_KM,
    });
  }
  if (crow > MAX_TRIP_KM) {
    throw ruleError('destination', `The trip must be shorter than ${MAX_TRIP_KM} km`, 'TOO_LONG', {
      maxDistanceKm: MAX_TRIP_KM,
    });
  }
};

// Departure and destination of a new trip: the campus by default on the campus side.
const resolveEnds = (direction, departure, destination) => {
  const site = campus();
  if (direction === 'FROM_CAMPUS') {
    if (!destination) throw validationError({ destination: 'destination is required for a trip from the campus' });
    return { departure: departure || site, destination };
  }
  if (!departure) throw validationError({ departure: 'departure is required' });
  return { departure, destination: destination || site };
};

const offCampusEnd = (direction, departure, destination) => (direction === 'FROM_CAMPUS' ? destination : departure);

// ---------- Trips ----------

const countUpcomingTrips = (driverId, now) =>
  Trip.countDocuments({ driver: toObjectId(driverId), status: { $in: ACTIVE_STATUSES }, departureAt: { $gt: now } });

const tripLimitError = (current) =>
  new HttpError(409, 'TRIP_LIMIT_REACHED', `A driver can have at most ${MAX_UPCOMING_TRIPS} upcoming trips`, {
    limit: MAX_UPCOMING_TRIPS,
    current,
  });

/**
 * POST /trips (STUDENT). input = { direction, departure, destination, departureAt, seats, pricePerSeat, preferences,
 * notes } parsed by the controller. 400 VALIDATION_ERROR (rules), 409 TRIP_LIMIT_REACHED (5 upcoming OPEN/FULL trips).
 */
const createTrip = async (driver, input, { now = new Date() } = {}) => {
  const direction = input.direction || 'TO_CAMPUS';
  const ends = resolveEnds(direction, input.departure, input.destination);
  checkTimeRules(input.departureAt, now);
  checkPlaceRules(ends.departure, ends.destination);

  const current = await countUpcomingTrips(driver._id, now);
  if (current >= MAX_UPCOMING_TRIPS) throw tripLimitError(current);

  const departure = placeDoc(ends.departure);
  const destination = placeDoc(ends.destination);
  const trip = await Trip.create({
    driver: driver._id,
    driverSnapshot: { firstname: driver.firstname, lastname: driver.lastname },
    direction,
    departure,
    destination,
    searchPoint: roundedPoint(offCampusEnd(direction, ends.departure, ends.destination)),
    departureAt: input.departureAt,
    seats: input.seats,
    seatsLeft: input.seats,
    pricePerSeat: input.pricePerSeat,
    distanceKm: roadDistanceKm(ends.departure, ends.destination),
    preferences: { ...Trip.DEFAULT_PREFERENCES, ...(input.preferences || {}) },
    notes: input.notes || '',
  });

  // Concurrent creations: the trips with the smallest ids win, the others are removed (deterministic).
  const upcoming = await Trip.find({
    driver: driver._id,
    status: { $in: ACTIVE_STATUSES },
    departureAt: { $gt: now },
  })
    .sort({ _id: 1 })
    .select('_id')
    .lean();
  const position = upcoming.findIndex((item) => sameId(item._id, trip._id));
  if (position >= MAX_UPCOMING_TRIPS) {
    await Trip.deleteOne({ _id: trip._id });
    throw tripLimitError(upcoming.length - 1);
  }

  return presentTripDetail(trip, driver, { now });
};

const samePlace = (stored, next) => {
  if (!next) return true;
  const [lng, lat] = stored.location.coordinates;
  return stored.label === next.label && lat === next.lat && lng === next.lng;
};

/**
 * PATCH /trips/:id (driver, OPEN/FULL, before the departure). changes = parsed fields among departure, destination,
 * departureAt, seats, pricePerSeat, preferences, notes. Seats can never go below the seats already accepted
 * (400 VALIDATION_ERROR rule SEATS_TAKEN); the price cannot go up once a passenger is accepted (409 INVALID_STATE,
 * reason PRICE_LOCKED). A time change notifies the accepted and pending passengers, a place change the accepted ones.
 */
const updateTrip = async (user, tripId, changes, { now = new Date() } = {}) => {
  const trip = await loadTrip(tripId);
  if (!sameId(trip.driver, user._id)) throw forbidden('Only the driver can change this trip');
  if (!ACTIVE_STATUSES.includes(trip.status)) {
    throw invalidState('This trip can no longer be changed', { status: trip.status });
  }
  if (hasDeparted(trip, now)) throw invalidState('This trip has already left', { reason: 'DEPARTED' });
  if (changes.direction !== undefined && changes.direction !== trip.direction) {
    throw validationError({ direction: 'direction cannot be changed: cancel the trip and offer a new one' });
  }

  const set = {};
  const currentDeparture = { label: trip.departure.label, ...latLngOf(trip.departure) };
  const currentDestination = { label: trip.destination.label, ...latLngOf(trip.destination) };
  const nextDeparture = changes.departure
    ? { ...changes.departure, label: changes.departure.label || nearestPlaceLabel(changes.departure) }
    : currentDeparture;
  const nextDestination = changes.destination
    ? { ...changes.destination, label: changes.destination.label || nearestPlaceLabel(changes.destination) }
    : currentDestination;
  const placeChanged = !samePlace(trip.departure, nextDeparture) || !samePlace(trip.destination, nextDestination);
  if (placeChanged) {
    checkPlaceRules(nextDeparture, nextDestination);
    set.departure = placeDoc(nextDeparture);
    set.destination = placeDoc(nextDestination);
    set.searchPoint = roundedPoint(offCampusEnd(trip.direction, nextDeparture, nextDestination));
    set.distanceKm = roadDistanceKm(nextDeparture, nextDestination);
  }

  const previousDepartureAt = trip.departureAt;
  const timeChanged =
    changes.departureAt !== undefined && changes.departureAt.getTime() !== new Date(trip.departureAt).getTime();
  if (timeChanged) {
    checkTimeRules(changes.departureAt, now);
    set.departureAt = changes.departureAt;
  }

  const taken = trip.seats - trip.seatsLeft;
  let delta = 0;
  if (changes.seats !== undefined && changes.seats !== trip.seats) {
    if (changes.seats < taken) {
      throw ruleError('seats', `seats must be at least ${taken} (seats already accepted)`, 'SEATS_TAKEN', { taken });
    }
    delta = changes.seats - trip.seats;
  }

  const priceUp = changes.pricePerSeat !== undefined && changes.pricePerSeat > trip.pricePerSeat;
  if (priceUp && taken > 0) {
    throw invalidState('The price cannot go up once a passenger is accepted', { reason: 'PRICE_LOCKED' });
  }
  if (changes.pricePerSeat !== undefined && changes.pricePerSeat !== trip.pricePerSeat) {
    set.pricePerSeat = changes.pricePerSeat;
  }
  if (changes.preferences) {
    const merged = { ...Trip.DEFAULT_PREFERENCES, ...trip.toObject().preferences, ...changes.preferences };
    set.preferences = merged;
  }
  if (changes.notes !== undefined && changes.notes !== (trip.notes || '')) set.notes = changes.notes;

  if (Object.keys(set).length === 0 && delta === 0) return presentTripDetail(trip, user, { now });

  // One atomic pipeline update: values are wrapped in $literal (user text may start with "$").
  const literalSet = Object.fromEntries(Object.entries(set).map(([key, value]) => [key, { $literal: value }]));
  const filter = { _id: trip._id, driver: trip.driver, status: { $in: ACTIVE_STATUSES }, departureAt: { $gt: now } };
  if (delta < 0) filter.seatsLeft = { $gte: -delta };
  if (priceUp) filter.$expr = { $eq: ['$seatsLeft', '$seats'] };
  const updated = await Trip.findOneAndUpdate(
    filter,
    [
      {
        $set: {
          ...literalSet,
          seats: { $add: ['$seats', delta] },
          seatsLeft: { $add: ['$seatsLeft', delta] },
          updatedAt: '$$NOW',
        },
      },
      { $set: { status: { $cond: [{ $gt: ['$seatsLeft', 0] }, 'OPEN', 'FULL'] } } },
    ],
    { updatePipeline: true, returnDocument: 'after', timestamps: false, runValidators: false }
  );

  if (!updated) {
    // Something changed meanwhile: explain with fresh values.
    const fresh = await Trip.findById(trip._id).lean();
    if (!fresh || !ACTIVE_STATUSES.includes(fresh.status)) {
      throw invalidState('This trip can no longer be changed', { status: fresh?.status ?? null });
    }
    if (hasDeparted(fresh, now)) throw invalidState('This trip has already left', { reason: 'DEPARTED' });
    const takenNow = fresh.seats - fresh.seatsLeft;
    if (priceUp && takenNow > 0) {
      throw invalidState('The price cannot go up once a passenger is accepted', { reason: 'PRICE_LOCKED' });
    }
    throw ruleError('seats', `seats must be at least ${takenNow} (seats already accepted)`, 'SEATS_TAKEN', {
      taken: takenNow,
    });
  }

  if (timeChanged || placeChanged) {
    const requests = await TripRequest.find({ trip: trip._id, status: { $in: ['PENDING', 'ACCEPTED'] } })
      .select('passenger status')
      .lean();
    const recipients = requests
      .filter((request) => timeChanged || request.status === 'ACCEPTED')
      .map((request) => request.passenger);
    notifyCarpool(recipients, 'UPDATED', updated, { timeChanged, placeChanged, previousDepartureAt });
  }
  emitTripUpdated(updated);
  return presentTripDetail(updated, user, { now });
};

/**
 * POST /trips/:id/cancel: the driver (before the departure) or an ADMIN (any OPEN/FULL trip). Pending requests are
 * closed (CANCELLED, cancelledBy TRIP); accepted ones stay ACCEPTED (history). Notifies the passengers (and the driver
 * when an admin cancels). Returns { trip (detail JSON), byAdmin, previousStatus, passengers }.
 */
const cancelTrip = async (user, tripId, { reason = null } = {}, { now = new Date() } = {}) => {
  const trip = await loadTrip(tripId);
  const isDriver = sameId(trip.driver, user._id);
  const isAdmin = user.role === 'ADMIN';
  if (!isDriver && !isAdmin) throw forbidden('Only the driver or an administrator can cancel this trip');
  if (!ACTIVE_STATUSES.includes(trip.status)) {
    throw invalidState('This trip can no longer be cancelled', { status: trip.status });
  }
  if (isDriver && !isAdmin && hasDeparted(trip, now)) {
    throw invalidState('This trip has already left', { reason: 'DEPARTED' });
  }

  const byAdmin = !isDriver;
  const cancelled = await Trip.findOneAndUpdate(
    { _id: trip._id, status: { $in: ACTIVE_STATUSES } },
    {
      $set: { status: 'CANCELLED', cancelledAt: now, cancelledBy: byAdmin ? 'ADMIN' : 'DRIVER', cancelReason: reason },
    },
    { returnDocument: 'after' }
  );
  if (!cancelled) {
    const fresh = await Trip.findById(trip._id).select('status').lean();
    throw invalidState('This trip can no longer be cancelled', { status: fresh?.status ?? null });
  }

  const requests = await TripRequest.find({ trip: trip._id, status: { $in: ['PENDING', 'ACCEPTED'] } })
    .select('passenger status')
    .lean();
  await TripRequest.updateMany(
    { trip: trip._id, status: 'PENDING' },
    { $set: { status: 'CANCELLED', active: false, cancelledAt: now, cancelledBy: 'TRIP' } }
  );
  const passengers = requests.map((request) => request.passenger);
  const driverName = (await namesOf([cancelled.driver])).get(idString(cancelled.driver)) ?? cancelled.driverSnapshot;
  const recipients = byAdmin ? [...passengers, cancelled.driver] : passengers;
  notifyCarpool(recipients, 'TRIP_CANCELLED', cancelled, { byAdmin, person: driverName, reason });
  emitTripUpdated(cancelled);
  return {
    trip: await presentTripDetail(cancelled, user, { now }),
    byAdmin,
    previousStatus: trip.status,
    passengers: passengers.length,
  };
};

// ---------- Search and history ----------

/**
 * GET /trips. params = { lat, lng, radiusKm, from, to, direction, seats, page, limit, skip } (parsed).
 * With lat/lng: OPEN trips whose off-campus end (departure for TO_CAMPUS, destination for FROM_CAMPUS, rounded to
 * ~1 km) is within radiusKm, by distance (0.1 km) then departure time, with distanceFromYouKm. Without: by time.
 * A STUDENT does not see their own trips.
 */
const searchTrips = async (viewer, params) => {
  const query = {
    status: 'OPEN',
    departureAt: { $gte: params.from, $lt: params.to },
    seatsLeft: { $gte: params.seats },
  };
  if (params.direction) query.direction = params.direction;
  if (viewer.role === 'STUDENT') query.driver = { $ne: toObjectId(viewer._id) };

  if (params.lat === undefined) {
    const [items, total] = await Promise.all([
      Trip.find(query).sort({ departureAt: 1, _id: 1 }).skip(params.skip).limit(params.limit).lean(),
      Trip.countDocuments(query),
    ]);
    return { items: await presentTrips(items, viewer), total, page: params.page, limit: params.limit };
  }

  const [result] = await Trip.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [params.lng, params.lat] },
        key: 'searchPoint',
        distanceField: 'distanceMeters',
        maxDistance: params.radiusKm * 1000,
        spherical: true,
        query,
      },
    },
    { $addFields: { distanceFromYouKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 1] } } },
    { $sort: { distanceFromYouKm: 1, departureAt: 1, _id: 1 } },
    { $facet: { items: [{ $skip: params.skip }, { $limit: params.limit }], total: [{ $count: 'count' }] } },
  ]);
  const docs = result?.items ?? [];
  const distances = new Map(docs.map((doc) => [String(doc._id), doc.distanceFromYouKm]));
  return {
    items: await presentTrips(docs, viewer, distances),
    total: result?.total?.[0]?.count ?? 0,
    page: params.page,
    limit: params.limit,
  };
};

/** Default time window of the search: from now to the end of the bookable window. */
const searchWindow = (from, to, now = new Date()) => {
  const start = from && from > now ? from : now;
  const end = to || new Date(now.getTime() + SEARCH_WINDOW_DAYS * DAY_MS);
  return { from: start, to: end };
};

/**
 * GET /me/trips?role=driver|passenger&scope=upcoming|past. A trip is past one hour after its departure.
 * driver: own trips (any status). passenger: upcoming = trips with a PENDING or ACCEPTED request, past = trips where
 * the request was ACCEPTED. upcoming: soonest first; past: latest first.
 */
const listMyTrips = async (user, { role, scope, page, limit, skip }, { now = new Date() } = {}) => {
  const boundary = new Date(now.getTime() - TRIP_DURATION_MS);
  const filter = scope === 'past' ? { departureAt: { $lte: boundary } } : { departureAt: { $gt: boundary } };
  if (role === 'passenger') {
    const statuses = scope === 'past' ? ['ACCEPTED'] : ['PENDING', 'ACCEPTED'];
    const tripIds = await TripRequest.distinct('trip', { passenger: toObjectId(user._id), status: { $in: statuses } });
    filter._id = { $in: tripIds };
  } else {
    filter.driver = toObjectId(user._id);
  }
  const order = scope === 'past' ? -1 : 1;
  const [items, total] = await Promise.all([
    Trip.find(filter).sort({ departureAt: order, _id: order }).skip(skip).limit(limit).lean(),
    Trip.countDocuments(filter),
  ]);
  return { items: await presentTrips(items, user), total, page, limit };
};

// ---------- Requests ----------

const loadRequest = async (requestId) => {
  assertObjectId(requestId);
  const request = await TripRequest.findById(requestId);
  if (!request) throw notFound('Request');
  return request;
};

/** Atomically takes `seats` seats of an OPEN trip that has not left; FULL when none is left. */
const claimSeats = (tripId, seats, now) =>
  Trip.findOneAndUpdate(
    { _id: tripId, status: 'OPEN', seatsLeft: { $gte: seats }, departureAt: { $gt: now } },
    [
      { $set: { seatsLeft: { $subtract: ['$seatsLeft', seats] }, updatedAt: '$$NOW' } },
      { $set: { status: { $cond: [{ $gt: ['$seatsLeft', 0] }, 'OPEN', 'FULL'] } } },
    ],
    { updatePipeline: true, returnDocument: 'after', timestamps: false, runValidators: false }
  );

/** Gives `seats` seats back to an OPEN/FULL trip (never above `seats`); OPEN again. */
const releaseSeats = (tripId, seats) =>
  Trip.findOneAndUpdate(
    { _id: tripId, status: { $in: ACTIVE_STATUSES } },
    [
      { $set: { seatsLeft: { $min: ['$seats', { $add: ['$seatsLeft', seats] }] }, updatedAt: '$$NOW' } },
      { $set: { status: { $cond: [{ $gt: ['$seatsLeft', 0] }, 'OPEN', 'FULL'] } } },
    ],
    { updatePipeline: true, returnDocument: 'after', timestamps: false, runValidators: false }
  );

const requestAnswer = async (request, trip, viewer) => {
  const [json] = await presentRequests([request]);
  json.trip = await presentTripDetail(trip, viewer);
  return json;
};

/**
 * POST /trips/:id/requests (STUDENT, not the driver) { seats: 1-3, message? }. One active (PENDING or ACCEPTED)
 * request per trip and passenger, at most 3 requests in total → 409 ALREADY_REQUESTED; not enough seats → 409
 * TRIP_FULL. Notifies the driver. Returns TripRequest JSON + `trip`.
 */
const createRequest = async (passenger, tripId, { seats, message = '' }, { now = new Date() } = {}) => {
  const trip = await loadTrip(tripId);
  if (sameId(trip.driver, passenger._id)) {
    throw forbidden('You cannot request a seat on your own trip', { reason: 'OWN_TRIP' });
  }
  if (!ACTIVE_STATUSES.includes(trip.status)) {
    throw invalidState('This trip no longer takes requests', { status: trip.status });
  }
  if (hasDeparted(trip, now)) throw invalidState('This trip has already left', { reason: 'DEPARTED' });

  const previous = await TripRequest.find({ trip: trip._id, passenger: passenger._id }).select('status active').lean();
  const active = previous.find((request) => request.active);
  if (active) {
    throw new HttpError(409, 'ALREADY_REQUESTED', 'You already have a request for this trip', {
      requestId: String(active._id),
      status: active.status,
    });
  }
  if (previous.length >= TripRequest.MAX_REQUESTS_PER_TRIP) {
    throw new HttpError(409, 'ALREADY_REQUESTED', 'You cannot send more requests for this trip', {
      reason: 'LIMIT',
      limit: TripRequest.MAX_REQUESTS_PER_TRIP,
    });
  }
  if (trip.status === 'FULL' || trip.seatsLeft < seats) {
    throw new HttpError(409, 'TRIP_FULL', 'Not enough seats left on this trip', { seatsLeft: trip.seatsLeft });
  }

  let request;
  try {
    request = await TripRequest.create({
      trip: trip._id,
      passenger: passenger._id,
      passengerSnapshot: { firstname: passenger.firstname, lastname: passenger.lastname },
      seats,
      message,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await TripRequest.findOne({ trip: trip._id, passenger: passenger._id, active: true }).lean();
    throw new HttpError(409, 'ALREADY_REQUESTED', 'You already have a request for this trip', {
      requestId: existing ? String(existing._id) : null,
      status: existing?.status ?? null,
    });
  }

  notifyCarpool([trip.driver], 'REQUEST', trip, { person: passenger, request, message }, {
    requestId: String(request._id),
  });
  emitRequestChanged(trip.driver, request);
  return requestAnswer(request, trip, passenger);
};

// The driver of the request's trip, else 403 for the passenger and 404 for anyone else.
const loadRequestForDriver = async (user, requestId) => {
  const request = await loadRequest(requestId);
  const trip = await Trip.findById(request.trip);
  if (!trip) throw notFound('Request');
  if (!sameId(trip.driver, user._id)) {
    if (sameId(request.passenger, user._id)) throw forbidden('Only the driver can answer this request');
    throw notFound('Request');
  }
  return { request, trip };
};

/**
 * POST /requests/:id/accept (driver). PENDING only (409 INVALID_STATE), before the departure; seats are claimed
 * atomically (409 TRIP_FULL when they are gone, never overbooked). Notifies the passenger.
 */
const acceptRequest = async (user, requestId, { now = new Date() } = {}) => {
  const { request, trip } = await loadRequestForDriver(user, requestId);
  if (request.status !== 'PENDING') throw invalidState('This request is not pending', { status: request.status });
  if (!ACTIVE_STATUSES.includes(trip.status)) {
    throw invalidState('This trip no longer takes passengers', { status: trip.status });
  }
  if (hasDeparted(trip, now)) throw invalidState('This trip has already left', { reason: 'DEPARTED' });

  const claimed = await claimSeats(trip._id, request.seats, now);
  if (!claimed) {
    const fresh = await Trip.findById(trip._id).lean();
    if (!fresh || !ACTIVE_STATUSES.includes(fresh.status)) {
      throw invalidState('This trip no longer takes passengers', { status: fresh?.status ?? null });
    }
    if (hasDeparted(fresh, now)) throw invalidState('This trip has already left', { reason: 'DEPARTED' });
    throw new HttpError(409, 'TRIP_FULL', 'Not enough seats left on this trip', {
      seatsLeft: fresh.seatsLeft,
      requested: request.seats,
    });
  }

  const accepted = await TripRequest.findOneAndUpdate(
    { _id: request._id, status: 'PENDING' },
    { $set: { status: 'ACCEPTED', decidedAt: now } },
    { returnDocument: 'after' }
  );
  if (!accepted) {
    // Cancelled or answered meanwhile: give the seats back.
    const released = await releaseSeats(trip._id, request.seats);
    if (released) emitTripUpdated(released);
    const current = await TripRequest.findById(request._id).select('status').lean();
    throw invalidState('This request is not pending', { status: current?.status ?? null });
  }

  notifyCarpool([accepted.passenger], 'ACCEPTED', claimed, { person: user, request: accepted }, {
    requestId: String(accepted._id),
  });
  emitRequestChanged(accepted.passenger, accepted);
  emitTripUpdated(claimed);
  return requestAnswer(accepted, claimed, user);
};

/** POST /requests/:id/decline (driver) { message? }. PENDING only. Notifies the passenger. */
const declineRequest = async (user, requestId, { message = '' } = {}, { now = new Date() } = {}) => {
  const { request, trip } = await loadRequestForDriver(user, requestId);
  if (request.status !== 'PENDING') throw invalidState('This request is not pending', { status: request.status });
  const declined = await TripRequest.findOneAndUpdate(
    { _id: request._id, status: 'PENDING' },
    { $set: { status: 'DECLINED', active: false, decidedAt: now, responseMessage: message } },
    { returnDocument: 'after' }
  );
  if (!declined) {
    const current = await TripRequest.findById(request._id).select('status').lean();
    throw invalidState('This request is not pending', { status: current?.status ?? null });
  }
  notifyCarpool([declined.passenger], 'DECLINED', trip, { person: user, request: declined, message }, {
    requestId: String(declined._id),
  });
  emitRequestChanged(declined.passenger, declined);
  return requestAnswer(declined, trip, user);
};

/**
 * POST /requests/:id/cancel (the passenger). PENDING, or ACCEPTED before the departure (the seats are given back
 * atomically and the passenger leaves the trip room). The driver gets 403, anyone else 404. Notifies the driver.
 */
const cancelRequest = async (user, requestId, { now = new Date() } = {}) => {
  const request = await loadRequest(requestId);
  const trip = await Trip.findById(request.trip);
  if (!sameId(request.passenger, user._id)) {
    if (trip && sameId(trip.driver, user._id)) throw forbidden('Decline the request instead');
    throw notFound('Request');
  }
  if (!trip) throw notFound('Request');
  if (!['PENDING', 'ACCEPTED'].includes(request.status)) {
    throw invalidState('This request can no longer be cancelled', { status: request.status });
  }
  if (request.status === 'ACCEPTED') {
    if (!ACTIVE_STATUSES.includes(trip.status)) {
      throw invalidState('This trip can no longer be changed', { status: trip.status });
    }
    if (hasDeparted(trip, now)) throw invalidState('This trip has already left', { reason: 'DEPARTED' });
  }

  const cancelled = await TripRequest.findOneAndUpdate(
    { _id: request._id, passenger: user._id, status: request.status },
    { $set: { status: 'CANCELLED', active: false, cancelledAt: now, cancelledBy: 'PASSENGER' } },
    { returnDocument: 'after' }
  );
  if (!cancelled) {
    const current = await TripRequest.findById(request._id).select('status').lean();
    throw invalidState('This request changed meanwhile, please reload', { status: current?.status ?? null });
  }

  let currentTrip = trip;
  if (request.status === 'ACCEPTED') {
    currentTrip = (await releaseSeats(trip._id, request.seats)) || trip;
    realtime.removeUserFromRoom(user._id, `trip:${trip._id}`);
    emitTripUpdated(currentTrip);
  }
  const driverId = trip.driver;
  notifyCarpool([driverId], 'REQUEST_CANCELLED', currentTrip, { person: user, request }, {
    requestId: String(request._id),
  });
  emitRequestChanged(driverId, cancelled);
  return requestAnswer(cancelled, currentTrip, user);
};

/** GET /trips/:id/requests (driver only, 403 otherwise): every request of the trip. */
const listTripRequests = async (user, tripId) => {
  const trip = await loadTrip(tripId);
  if (!sameId(trip.driver, user._id)) throw forbidden('Only the driver can see the requests of this trip');
  return tripRequestsForDriver(trip);
};

// ---------- Chat ----------

const assertParticipant = async (user, trip) => {
  if (!(await isParticipant(user._id, trip))) {
    throw forbidden('Only the driver and the accepted passengers can use this chat');
  }
};

/**
 * GET /trips/:id/messages?before&limit (participants). Latest `limit` messages before the cursor (a message id or an
 * ISO date), oldest first → { items, hasMore }.
 */
const listMessages = async (user, tripId, { before = null, limit = DEFAULT_MESSAGES_LIMIT } = {}) => {
  const trip = await loadTrip(tripId);
  await assertParticipant(user, trip);
  const filter = { trip: trip._id };
  if (before?.id) {
    const cursor = await TripMessage.findOne({ _id: before.id, trip: trip._id }).select('createdAt').lean();
    if (!cursor) throw validationError({ before: 'before must be a message of this trip or a date' });
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
    ];
  } else if (before?.date) {
    filter.createdAt = { $lt: before.date };
  }
  const docs = await TripMessage.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = docs.length > limit;
  return { items: docs.slice(0, limit).reverse().map((doc) => TripMessage.serializeTripMessage(doc)), hasMore };
};

const clientRequestConflict = () =>
  new HttpError(409, 'ALREADY_EXISTS', 'This clientRequestId was already used for another trip', {
    field: 'clientRequestId',
  });

const findMessageReplay = async (user, trip, clientRequestId) => {
  const existing = await TripMessage.findOne({ sender: user._id, clientRequestId }).lean();
  if (!existing) return null;
  if (!sameId(existing.trip, trip._id)) throw clientRequestConflict();
  return existing;
};

/**
 * POST /trips/:id/messages (participants) { body, clientRequestId? }. Persists, then emits `chat:message` to the
 * room trip:<id>. The same sender + clientRequestId returns the first message ({ created: false }, no new emit).
 * Not on a cancelled trip, nor more than 7 days after the departure (409 INVALID_STATE).
 */
const postMessage = async (user, tripId, { body, clientRequestId = null }, { now = new Date() } = {}) => {
  const trip = await loadTrip(tripId);
  await assertParticipant(user, trip);
  if (clientRequestId) {
    const existing = await findMessageReplay(user, trip, clientRequestId);
    if (existing) return { message: TripMessage.serializeTripMessage(existing), created: false };
  }
  if (trip.status === 'CANCELLED') throw invalidState('This trip was cancelled', { reason: 'TRIP_CANCELLED' });
  if (new Date(trip.departureAt).getTime() + CHAT_OPEN_AFTER_DEPARTURE_MS <= now.getTime()) {
    throw invalidState('This chat is closed', { reason: 'CHAT_CLOSED' });
  }

  let message;
  try {
    message = await TripMessage.create({
      trip: trip._id,
      sender: user._id,
      senderSnapshot: { firstname: user.firstname, lastname: user.lastname },
      body,
      ...(clientRequestId ? { clientRequestId } : {}),
    });
  } catch (error) {
    if (isDuplicateKey(error) && clientRequestId) {
      const existing = await findMessageReplay(user, trip, clientRequestId);
      if (existing) return { message: TripMessage.serializeTripMessage(existing), created: false };
    }
    throw error;
  }
  const json = TripMessage.serializeTripMessage(message);
  realtime.emitToRoom(`trip:${trip._id}`, 'chat:message', json);
  return { message: json, created: true };
};

// ---------- Ratings ----------

/**
 * POST /trips/:id/ratings (participants) { userId, score: 1-5, comment? }: once per rated participant, after the
 * trip (departure + 1 h), not on a cancelled trip. 403 for non-participants, 409 ALREADY_RATED.
 */
const rateParticipant = async (user, tripId, { userId, score, comment = '' }, { now = new Date() } = {}) => {
  const trip = await loadTrip(tripId);
  const roles = await participantRoles(trip);
  const raterRole = roles.get(idString(user._id));
  if (!raterRole) throw forbidden('Only the participants of this trip can rate it');
  if (trip.status === 'CANCELLED') throw invalidState('This trip was cancelled', { reason: 'TRIP_CANCELLED' });
  if (!isOver(trip, now)) {
    throw invalidState('Ratings open one hour after the departure', {
      reason: 'TOO_EARLY',
      opensAt: new Date(new Date(trip.departureAt).getTime() + TRIP_DURATION_MS),
    });
  }
  if (sameId(userId, user._id)) throw validationError({ userId: 'You cannot rate yourself' });
  const rateeRole = roles.get(idString(userId));
  if (!rateeRole) throw validationError({ userId: 'userId must be a participant of this trip' });

  try {
    const rating = await TripRating.create({
      trip: trip._id,
      rater: user._id,
      ratee: toObjectId(userId),
      raterRole,
      rateeRole,
      score,
      comment,
    });
    return rating.toJSON();
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new HttpError(409, 'ALREADY_RATED', 'You already rated this participant for this trip');
    }
    throw error;
  }
};

// ---------- Completion job ----------

/**
 * Marks OPEN/FULL trips COMPLETED one hour after their departure (each claimed with findOneAndUpdate, so several
 * instances never process a trip twice), expires their pending requests and invites the participants to rate.
 */
const completeDueTrips = async ({ now = new Date(), batch = COMPLETION_BATCH } = {}) => {
  const due = await Trip.find({
    status: { $in: ACTIVE_STATUSES },
    departureAt: { $lte: new Date(now.getTime() - TRIP_DURATION_MS) },
  })
    .sort({ departureAt: 1 })
    .limit(batch)
    .select('_id')
    .lean();
  let completed = 0;
  for (const { _id } of due) {
    const trip = await Trip.findOneAndUpdate(
      { _id, status: { $in: ACTIVE_STATUSES } },
      { $set: { status: 'COMPLETED', completedAt: now } },
      { returnDocument: 'after' }
    );
    if (!trip) continue;
    completed += 1;
    await TripRequest.updateMany({ trip: _id, status: 'PENDING' }, { $set: { status: 'EXPIRED', active: false } });
    const passengers = await TripRequest.find({ trip: _id, status: 'ACCEPTED' }).select('passenger').lean();
    if (passengers.length > 0) {
      notifyCarpool([trip.driver, ...passengers.map((request) => request.passenger)], 'RATE', trip);
    }
  }
  return completed;
};

scheduler.registerJob('carpool.complete-trips', scheduler.defaultIntervalMs(), () => completeDueTrips());

// Room "trip:<id>": the driver and the accepted passengers only.
realtime.registerRoomAuthorizer('trip', async (user, id) => {
  if (!mongoose.isObjectIdOrHexString(id)) return false;
  const trip = await Trip.findById(id).select('driver').lean();
  if (!trip) return false;
  return isParticipant(user._id, trip);
});

module.exports = {
  MAX_DAYS_AHEAD,
  MAX_UPCOMING_TRIPS,
  MAX_SEARCH_RADIUS_KM,
  TRIP_DURATION_MS,
  DEFAULT_MESSAGES_LIMIT,
  MAX_MESSAGES_LIMIT,
  PLACES,
  campus,
  getSettings,
  listPlaces,
  haversineKm,
  roadDistanceKm,
  suggestedPricePerSeat,
  toPoint,
  roundedPoint,
  placeDoc,
  nearestPlaceLabel,
  offCampusEnd,
  defaultSearchRadiusKm,
  searchWindow,
  buildCarpoolText,
  presentTrips,
  presentTripDetail,
  getTripDetail,
  createTrip,
  updateTrip,
  cancelTrip,
  searchTrips,
  listMyTrips,
  createRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  listTripRequests,
  listMessages,
  postMessage,
  rateParticipant,
  completeDueTrips,
  isParticipant,
};
