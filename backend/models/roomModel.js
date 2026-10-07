const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const ROOM_TYPES = ['CLASSROOM', 'AMPHITHEATER', 'LAB', 'OTHER'];
const MAX_CAPACITY = 10000;
// Names are unique, ignoring case ("b12" = "B12").
const NAME_COLLATION = { locale: 'en', strength: 2 };

const roomSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [50, 'Name must be at most 50 characters'],
    },
    building: {
      type: String,
      trim: true,
      maxlength: [100, 'Building must be at most 100 characters'],
      default: '',
    },
    // Number of seats, or null when unknown.
    capacity: {
      type: Number,
      default: null,
      min: [1, `Capacity must be an integer between 1 and ${MAX_CAPACITY}`],
      max: [MAX_CAPACITY, `Capacity must be an integer between 1 and ${MAX_CAPACITY}`],
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: `Capacity must be an integer between 1 and ${MAX_CAPACITY}`,
      },
    },
    type: {
      type: String,
      enum: { values: ROOM_TYPES, message: `Type must be one of ${ROOM_TYPES.join(', ')}` },
      default: 'CLASSROOM',
    },
  },
  {
    timestamps: true,
    toJSON: {
      // { id, name, building, capacity, type }
      transform: (doc, ret) => ({
        id: String(ret._id),
        name: ret.name,
        building: ret.building || '',
        capacity: ret.capacity ?? null,
        type: ret.type,
      }),
    },
  }
);

roomSchema.index({ name: 1 }, { unique: true, collation: NAME_COLLATION });

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;
module.exports.ROOM_TYPES = ROOM_TYPES;
module.exports.NAME_COLLATION = NAME_COLLATION;
