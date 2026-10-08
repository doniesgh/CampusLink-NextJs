const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const ROOM_TYPES = ['CLASSROOM', 'AMPHITHEATER', 'LAB', 'OTHER'];
const MAX_CAPACITY = 10000;
// Names are unique, ignoring case ("b12" = "B12").
const NAME_COLLATION = { locale: 'en', strength: 2 };

// Bookings (phase 2, module 5): bookings of an amphitheater need an admin approval by default.
// In an upsert (setDefaultsOnInsert) `this` is the query, so the type is read from the update.
const defaultRequiresApproval = (type) => type === 'AMPHITHEATER';
function requiresApprovalDefault() {
  if (this instanceof mongoose.Query) {
    const update = this.getUpdate() || {};
    const type = update.$set?.type ?? update.type ?? update.$setOnInsert?.type ?? this.getFilter()?.type;
    return defaultRequiresApproval(type);
  }
  return defaultRequiresApproval(this?.type);
}
// Effective values for any room, including lean objects stored before these fields existed.
const isRoomBookable = (room) => (typeof room?.bookable === 'boolean' ? room.bookable : true);
const roomRequiresApproval = (room) =>
  typeof room?.requiresApproval === 'boolean' ? room.requiresApproval : defaultRequiresApproval(room?.type);

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
    // Bookings: the room can be booked; bookings of it need an admin approval.
    bookable: { type: Boolean, default: true },
    requiresApproval: { type: Boolean, default: requiresApprovalDefault },
  },
  {
    timestamps: true,
    toJSON: {
      // { id, name, building, capacity, type, bookable, requiresApproval }
      transform: (doc, ret) => ({
        id: String(ret._id),
        name: ret.name,
        building: ret.building || '',
        capacity: ret.capacity ?? null,
        type: ret.type,
        bookable: isRoomBookable(ret),
        requiresApproval: roomRequiresApproval(ret),
      }),
    },
  }
);

roomSchema.index({ name: 1 }, { unique: true, collation: NAME_COLLATION });

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;
module.exports.ROOM_TYPES = ROOM_TYPES;
module.exports.NAME_COLLATION = NAME_COLLATION;
module.exports.isRoomBookable = isRoomBookable;
module.exports.roomRequiresApproval = roomRequiresApproval;
