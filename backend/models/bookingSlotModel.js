const mongoose = require('mongoose');

const Schema = mongoose.Schema;

/*
 * One 15-minute slot of a resource held by a PENDING or CONFIRMED booking (phase 2 contract section 1.2).
 * The unique index (resourceKey, slot) is what makes double bookings impossible without transactions:
 * a booking claims every slot it covers, and a duplicate-key error means another booking holds one.
 * Slots are released (deleted) when their booking is rejected or cancelled. Internal, never serialized.
 */
const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60 * 1000;
// Past slots are useless (bookings are always in the future): MongoDB deletes them after 30 days.
const RETENTION_DAYS = 30;

const bookingSlotSchema = new Schema(
  {
    // "ROOM:<roomId>" or "EQUIPMENT:<equipmentId>".
    resourceKey: { type: String, required: true },
    // Start of the 15-minute slot (UTC).
    slot: { type: Date, required: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    // When the slot was claimed (stale claims of a request that never finished are released later).
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

bookingSlotSchema.index({ resourceKey: 1, slot: 1 }, { unique: true });
bookingSlotSchema.index({ booking: 1 });
bookingSlotSchema.index({ slot: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

// "ROOM:<id>" / "EQUIPMENT:<id>".
const resourceKey = (resourceType, resourceId) => `${resourceType}:${String(resourceId)}`;

// Start of every 15-minute slot covered by [startsAt, endsAt) (both on the 15-minute grid).
const slotsOf = (startsAt, endsAt) => {
  const slots = [];
  for (let at = startsAt.getTime(); at < endsAt.getTime(); at += SLOT_MS) slots.push(new Date(at));
  return slots;
};

const BookingSlot = mongoose.model('BookingSlot', bookingSlotSchema);

module.exports = BookingSlot;
module.exports.SLOT_MINUTES = SLOT_MINUTES;
module.exports.SLOT_MS = SLOT_MS;
module.exports.RETENTION_DAYS = RETENTION_DAYS;
module.exports.resourceKey = resourceKey;
module.exports.slotsOf = slotsOf;
