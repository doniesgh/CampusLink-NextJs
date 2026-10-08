const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 2 (carpooling), phase 3 contract section 2.
const DIRECTIONS = ['TO_CAMPUS', 'FROM_CAMPUS'];
const STATUSES = ['OPEN', 'FULL', 'CANCELLED', 'COMPLETED'];
// Trips that still hold seats and count for the driver's limit.
const ACTIVE_STATUSES = ['OPEN', 'FULL'];
const CANCELLED_BY = ['DRIVER', 'ADMIN'];
const MIN_SEATS = 1;
const MAX_SEATS = 6;
const MIN_PRICE = 0;
const MAX_PRICE = 20;
const LABEL_MAX_LENGTH = 120;
const NOTES_MAX_LENGTH = 500;
const CANCEL_REASON_MAX_LENGTH = 300;
const PREFERENCE_KEYS = ['smoking', 'music', 'pets', 'womenOnly'];
const DEFAULT_PREFERENCES = { smoking: false, music: true, pets: false, womenOnly: false };

// GeoJSON point: coordinates = [longitude, latitude].
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value) =>
          Array.isArray(value) &&
          value.length === 2 &&
          Number.isFinite(value[0]) &&
          Number.isFinite(value[1]) &&
          Math.abs(value[0]) <= 180 &&
          Math.abs(value[1]) <= 90,
        message: 'coordinates must be [longitude, latitude]',
      },
    },
  },
  { _id: false }
);

const placeSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: LABEL_MAX_LENGTH },
    location: { type: pointSchema, required: true },
  },
  { _id: false }
);

const tripSchema = new Schema(
  {
    driver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Names when the trip was created (shown if the account is deleted later).
    driverSnapshot: {
      firstname: { type: String, default: '' },
      lastname: { type: String, default: '' },
    },
    direction: { type: String, enum: DIRECTIONS, default: 'TO_CAMPUS' },
    departure: { type: placeSchema, required: true },
    destination: { type: placeSchema, required: true },
    // Off-campus end of the trip (departure for TO_CAMPUS, destination for FROM_CAMPUS) rounded to 2 decimals
    // (~1 km): the search ($geoNear) only ever works on this point, so it cannot reveal exact addresses.
    searchPoint: { type: pointSchema, required: true },
    departureAt: { type: Date, required: true },
    seats: { type: Number, required: true, min: MIN_SEATS, max: MAX_SEATS },
    // seats minus the seats of the accepted requests (changed atomically, never below 0).
    seatsLeft: { type: Number, required: true, min: 0, max: MAX_SEATS },
    pricePerSeat: { type: Number, required: true, min: MIN_PRICE, max: MAX_PRICE },
    // Road distance estimate: haversine × 1.3, in km (1 decimal).
    distanceKm: { type: Number, required: true, min: 0 },
    preferences: {
      smoking: { type: Boolean, default: DEFAULT_PREFERENCES.smoking },
      music: { type: Boolean, default: DEFAULT_PREFERENCES.music },
      pets: { type: Boolean, default: DEFAULT_PREFERENCES.pets },
      womenOnly: { type: Boolean, default: DEFAULT_PREFERENCES.womenOnly },
    },
    // Plain text: clients never render HTML.
    notes: { type: String, trim: true, maxlength: NOTES_MAX_LENGTH, default: '' },
    status: { type: String, enum: STATUSES, default: 'OPEN' },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: [...CANCELLED_BY, null], default: null },
    cancelReason: { type: String, trim: true, maxlength: CANCEL_REASON_MAX_LENGTH, default: null },
    completedAt: { type: Date, default: null },
    // "SEED" for the demo data (scripts/seed/60-carpool.js), never serialized.
    source: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      // Safe default shape (approximate coordinates, no viewer fields). The API serializes trips with
      // carpoolService.presentTrip, which knows the viewer.
      transform: (doc) => serializeTrip(doc),
    },
  }
);

// Search by distance ($geoNear on searchPoint) among OPEN trips in a time window.
tripSchema.index({ searchPoint: '2dsphere', status: 1, departureAt: 1 });
// Search without a location, completion job.
tripSchema.index({ status: 1, departureAt: 1 });
// A driver's trips (history, limit of upcoming trips).
tripSchema.index({ driver: 1, departureAt: -1 });

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
};

/** { label, lat, lng } of a stored place; coordinates rounded to 2 decimals unless `exact`. */
const serializePlace = (place, exact) => {
  const [lng, lat] = place?.location?.coordinates ?? [null, null];
  if (lat === null || lng === null) return { label: place?.label ?? '', lat: null, lng: null };
  return { label: place.label, lat: exact ? lat : round(lat, 2), lng: exact ? lng : round(lng, 2) };
};

const driverId = (doc) => {
  const { driver } = doc;
  if (driver && typeof driver === 'object' && driver._id) return String(driver._id);
  return driver ? String(driver) : null;
};

/**
 * Trip JSON (contract section 2). `viewer` = { exact, myRequest, myRole, driverName: { firstname, lastname },
 * driverRating: { rating, ratingCount }, distanceFromYouKm } (all optional). Coordinates are exact only when
 * `viewer.exact` is true (driver and accepted passengers).
 */
function serializeTrip(doc, viewer = {}) {
  const populated =
    doc.driver && typeof doc.driver === 'object' && doc.driver.firstname !== undefined ? doc.driver : null;
  const driver = viewer.driverName ?? populated;
  const exact = viewer.exact === true;
  const json = {
    id: String(doc._id),
    driver: {
      id: driverId(doc),
      firstname: driver?.firstname ?? doc.driverSnapshot?.firstname ?? '',
      lastname: driver?.lastname ?? doc.driverSnapshot?.lastname ?? '',
      rating: viewer.driverRating?.rating ?? null,
      ratingCount: viewer.driverRating?.ratingCount ?? 0,
    },
    direction: doc.direction || 'TO_CAMPUS',
    departure: serializePlace(doc.departure, exact),
    destination: serializePlace(doc.destination, exact),
    exactLocation: exact,
    departureAt: doc.departureAt,
    seats: doc.seats,
    seatsLeft: doc.seatsLeft,
    pricePerSeat: doc.pricePerSeat,
    distanceKm: doc.distanceKm,
    preferences: { ...DEFAULT_PREFERENCES, ...pickPreferences(doc.preferences) },
    notes: doc.notes || '',
    status: doc.status,
    cancelledAt: doc.cancelledAt ?? null,
    cancelledBy: doc.cancelledBy ?? null,
    cancelReason: doc.cancelReason ?? null,
    myRole: viewer.myRole ?? null,
    myRequest: viewer.myRequest ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (viewer.distanceFromYouKm !== undefined) json.distanceFromYouKm = viewer.distanceFromYouKm;
  return json;
}

function pickPreferences(preferences) {
  const result = {};
  if (!preferences) return result;
  PREFERENCE_KEYS.forEach((key) => {
    if (typeof preferences[key] === 'boolean') result[key] = preferences[key];
  });
  return result;
}

const Trip = mongoose.model('Trip', tripSchema);

module.exports = Trip;
module.exports.DIRECTIONS = DIRECTIONS;
module.exports.STATUSES = STATUSES;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
module.exports.MIN_SEATS = MIN_SEATS;
module.exports.MAX_SEATS = MAX_SEATS;
module.exports.MIN_PRICE = MIN_PRICE;
module.exports.MAX_PRICE = MAX_PRICE;
module.exports.LABEL_MAX_LENGTH = LABEL_MAX_LENGTH;
module.exports.NOTES_MAX_LENGTH = NOTES_MAX_LENGTH;
module.exports.CANCEL_REASON_MAX_LENGTH = CANCEL_REASON_MAX_LENGTH;
module.exports.PREFERENCE_KEYS = PREFERENCE_KEYS;
module.exports.DEFAULT_PREFERENCES = DEFAULT_PREFERENCES;
module.exports.serializeTrip = serializeTrip;
module.exports.serializePlace = serializePlace;
