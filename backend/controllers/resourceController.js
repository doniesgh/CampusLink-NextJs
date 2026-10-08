const Equipment = require('../models/equipmentModel');
const HttpError = require('../utils/httpError');
const {
  assertObjectId,
  notFound,
  throwIfInvalid,
  isBlank,
  readString,
  readEnum,
  readBoolean,
} = require('../utils/validation');
const auditService = require('../service/auditService');
const bookingService = require('../service/bookingService');

/*
 * /api/resources (Module 5, phase 2 contract section 1.1). Rooms stay in /api/academic/rooms.
 * Equipment: GET (list / one) for any authenticated user; POST / PATCH / DELETE for ADMIN, audited as
 * equipment.create|update|delete. DELETE → 409 IN_USE while future PENDING / CONFIRMED bookings exist.
 */

const { EQUIPMENT_CATEGORIES, NAME_MAX_LENGTH, LOCATION_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, NAME_COLLATION } = Equipment;
const SORT_COLLATION = { locale: 'en', strength: 2, numericOrdering: true };

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (body, field) => body[field] !== undefined;
const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';

// ---------- Parsing ----------

const parseEquipment = (input, { create }) => {
  const body = isPlainObject(input) ? input : {};
  const values = {};
  const details = {};
  if (create && isBlank(body.name)) details.name = 'name is required';
  if (has(body, 'name') && !details.name) {
    values.name = readString(body.name, 'name', details, { min: 1, max: NAME_MAX_LENGTH });
  }
  if (has(body, 'category')) values.category = readEnum(body.category, EQUIPMENT_CATEGORIES, 'category', details);
  if (has(body, 'location')) {
    values.location =
      body.location === null ? '' : readString(body.location, 'location', details, { max: LOCATION_MAX_LENGTH });
  }
  if (has(body, 'description')) {
    values.description =
      body.description === null
        ? ''
        : readString(body.description, 'description', details, { max: DESCRIPTION_MAX_LENGTH });
  }
  if (has(body, 'requiresApproval')) {
    values.requiresApproval = readBoolean(body.requiresApproval, 'requiresApproval', details);
  }
  if (has(body, 'active')) values.active = readBoolean(body.active, 'active', details);
  throwIfInvalid(details);
  return values;
};

// "A,B" or repeated parameters → list of allowed values (400 VALIDATION_ERROR otherwise).
const parseListQuery = (value, allowed, field) => {
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const items = raw
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const details = {};
  if (items.length === 0 || items.some((item) => !allowed.includes(item))) {
    details[field] = `${field} must be one of ${allowed.join(', ')}`;
  }
  throwIfInvalid(details);
  return [...new Set(items)];
};

// ?active=true|false (absent: no filter).
const parseActiveQuery = (value) => {
  const text = String(Array.isArray(value) ? value[0] : value).trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid fields', { active: 'active must be true or false' });
};

const ensureUniqueName = async (name, excludeId) => {
  if (name === undefined) return;
  const query = Equipment.exists({ name, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).collation(NAME_COLLATION);
  if (await query) {
    throw new HttpError(409, 'ALREADY_EXISTS', 'An equipment item with this name already exists', { field: 'name' });
  }
};

const findOr404 = async (id) => {
  assertObjectId(id);
  const item = await Equipment.findById(id);
  if (!item) throw notFound('Equipment');
  return item;
};

// ---------- Handlers ----------

// GET /api/resources/equipment?category=PROJECTOR,LAPTOP&active=true → [Equipment] sorted by name
const listEquipment = async (req, res) => {
  const filter = {};
  if (present(req.query.category)) {
    filter.category = { $in: parseListQuery(req.query.category, EQUIPMENT_CATEGORIES, 'category') };
  }
  if (present(req.query.active)) {
    // Items stored before the field existed are active.
    filter.active = parseActiveQuery(req.query.active) ? { $ne: false } : false;
  }
  const items = await Equipment.find(filter).sort({ name: 1, _id: 1 }).collation(SORT_COLLATION);
  res.status(200).json(items);
};

// GET /api/resources/equipment/:id
const getEquipment = async (req, res) => {
  res.status(200).json(await findOr404(req.params.id));
};

// POST /api/resources/equipment [ADMIN] → 201
const createEquipment = async (req, res) => {
  const values = parseEquipment(req.body, { create: true });
  await ensureUniqueName(values.name);
  const item = await Equipment.create(values);

  await auditService.record(req, {
    action: 'equipment.create',
    targetType: 'Equipment',
    targetId: item._id,
    summary: `Created equipment ${item.name} (${item.category})`,
    metadata: { values: item.toJSON() },
  });

  res.status(201).json(item);
};

// PATCH /api/resources/equipment/:id [ADMIN] → 200
const updateEquipment = async (req, res) => {
  const item = await findOr404(req.params.id);
  const values = parseEquipment(req.body, { create: false });
  if (Object.keys(values).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No changes provided');
  await ensureUniqueName(values.name, item._id);

  const before = item.toJSON();
  item.set(values);
  const changes = Object.keys(values).filter((field) => item.isModified(field));
  await item.save();

  if (changes.length > 0) {
    const after = item.toJSON();
    await auditService.record(req, {
      action: 'equipment.update',
      targetType: 'Equipment',
      targetId: item._id,
      summary: `Updated equipment ${item.name} (${changes.join(', ')})`,
      metadata: {
        changes,
        before: Object.fromEntries(changes.map((field) => [field, before[field]])),
        after: Object.fromEntries(changes.map((field) => [field, after[field]])),
      },
    });
  }

  res.status(200).json(item);
};

// DELETE /api/resources/equipment/:id [ADMIN] → 204, or 409 IN_USE (details.references.bookings)
const deleteEquipment = async (req, res) => {
  const item = await findOr404(req.params.id);
  const bookings = await bookingService.countFutureActiveBookings('EQUIPMENT', item._id);
  if (bookings > 0) {
    throw new HttpError(409, 'IN_USE', 'This equipment still has upcoming bookings', { references: { bookings } });
  }

  await Equipment.deleteOne({ _id: item._id });

  await auditService.record(req, {
    action: 'equipment.delete',
    targetType: 'Equipment',
    targetId: item._id,
    summary: `Deleted equipment ${item.name}`,
    metadata: { values: item.toJSON() },
  });

  res.status(204).end();
};

module.exports = {
  listEquipment,
  getEquipment,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  parseListQuery,
};
