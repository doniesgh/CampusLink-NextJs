const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Bookable equipment (Module 5, phase 2 contract section 1.1).
const EQUIPMENT_CATEGORIES = ['PROJECTOR', 'LAPTOP', 'CAMERA', 'AUDIO', 'LAB_KIT', 'OTHER'];
const NAME_MAX_LENGTH = 100;
const LOCATION_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 1000;
// Names are unique, ignoring case ("Projecteur 1" = "projecteur 1"), like room names.
const NAME_COLLATION = { locale: 'en', strength: 2 };

const equipmentSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [NAME_MAX_LENGTH, `Name must be at most ${NAME_MAX_LENGTH} characters`],
    },
    category: {
      type: String,
      enum: { values: EQUIPMENT_CATEGORIES, message: `Category must be one of ${EQUIPMENT_CATEGORIES.join(', ')}` },
      default: 'OTHER',
    },
    // Where to pick it up (free text, e.g. "Bloc A, accueil").
    location: {
      type: String,
      trim: true,
      maxlength: [LOCATION_MAX_LENGTH, `Location must be at most ${LOCATION_MAX_LENGTH} characters`],
      default: '',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [DESCRIPTION_MAX_LENGTH, `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`],
      default: '',
    },
    // Bookings of this item need an admin approval (PENDING until decided).
    requiresApproval: { type: Boolean, default: false },
    // Inactive items stay listed (for the history) but cannot be booked.
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      // { id, name, category, location, description, requiresApproval, active }
      transform: (doc, ret) => serializeEquipment(ret),
    },
  }
);

equipmentSchema.index({ name: 1 }, { unique: true, collation: NAME_COLLATION });
equipmentSchema.index({ category: 1, active: 1 });

// Contract JSON of an equipment item (document or lean object).
const serializeEquipment = (item) => ({
  id: String(item._id),
  name: item.name,
  category: item.category,
  location: item.location || '',
  description: item.description || '',
  requiresApproval: Boolean(item.requiresApproval),
  active: item.active !== false,
});

const Equipment = mongoose.model('Equipment', equipmentSchema);

module.exports = Equipment;
module.exports.EQUIPMENT_CATEGORIES = EQUIPMENT_CATEGORIES;
module.exports.NAME_MAX_LENGTH = NAME_MAX_LENGTH;
module.exports.LOCATION_MAX_LENGTH = LOCATION_MAX_LENGTH;
module.exports.DESCRIPTION_MAX_LENGTH = DESCRIPTION_MAX_LENGTH;
module.exports.NAME_COLLATION = NAME_COLLATION;
module.exports.serializeEquipment = serializeEquipment;
