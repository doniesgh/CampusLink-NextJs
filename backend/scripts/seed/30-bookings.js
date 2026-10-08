// Seed plugin of Module 5 (room and equipment bookings), run by `npm run seed:demo` after the core data
// and the timetable. Upserts a few equipment items (by name), makes sure every room has the booking
// fields (amphitheaters need an approval), then replaces the demo bookings (source SEED) and their slots:
// upcoming ones (one PENDING on Amphi A, one PENDING on the camera, confirmed, rejected, cancelled) and
// past confirmed ones for the statistics. Bookings that would overlap a class or a booking made by hand
// are skipped. Sends no notification.
const Booking = require('../../models/bookingModel');
const BookingSlot = require('../../models/bookingSlotModel');
const Equipment = require('../../models/equipmentModel');
const Room = require('../../models/roomModel');
const bookingService = require('../../service/bookingService');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const EQUIPMENT = [
  {
    key: 'projector',
    name: 'Vidéoprojecteur Epson EB-X51',
    category: 'PROJECTOR',
    location: 'Bloc A, accueil',
    description: 'Vidéoprojecteur portable (HDMI et VGA) avec sa télécommande et un câble de 5 m.',
  },
  {
    key: 'projector2',
    name: 'Vidéoprojecteur BenQ MW560',
    category: 'PROJECTOR',
    location: 'Bloc B, salle des enseignants',
    description: 'Vidéoprojecteur lumineux pour les grandes salles, avec adaptateur USB-C.',
  },
  {
    key: 'laptop',
    name: 'Ordinateur portable Dell Latitude 5440',
    category: 'LAPTOP',
    location: 'Bloc C, bureau du laboratoire',
    description: 'Windows 11, suite Office, Visual Studio Code et Python 3.12 installés.',
  },
  {
    key: 'camera',
    name: 'Caméra Sony ZV-E10',
    category: 'CAMERA',
    location: 'Bloc A, club audiovisuel',
    description: 'Kit vidéo avec trépied, micro-canon et deux batteries. Prêt validé par l’administration.',
    requiresApproval: true,
  },
  {
    key: 'microphone',
    name: 'Micro sans fil Shure BLX24',
    category: 'AUDIO',
    location: 'Bloc A, accueil',
    description: 'Micro main sans fil avec son récepteur, pour les conférences et les soutenances.',
  },
  {
    key: 'arduino',
    name: 'Kit Arduino Uno (x10)',
    category: 'LAB_KIT',
    location: 'Bloc C, salle C202',
    description: '10 cartes Arduino Uno, capteurs, plaques d’essai et câbles.',
  },
  {
    key: 'raspberry',
    name: 'Kit Raspberry Pi 5',
    category: 'LAB_KIT',
    location: 'Bloc C, salle C202',
    description: 'En maintenance jusqu’à nouvel ordre.',
    active: false,
  },
];

const run = async (ctx) => {
  const { users, rooms, now, time, log } = ctx;
  const account = (name, fallback) => users.byEmail[`${name}@campuslink.local`] ?? fallback ?? null;
  const admin = users.admin;
  const yasmine = account('yasmine.haddad', users.students[0]);
  const omar = account('omar.ferchichi', users.students[1]);
  const ahmed = account('ahmed.karray', users.students[3]);
  const nour = account('nour.chaabane', users.students[4]);
  const ines = account('ines.zouari', users.students[6]);
  const amira = account('amira.bensalah', users.teachers[0]);
  const karim = account('karim.trabelsi', users.teachers[1]);
  const mehdi = account('mehdi.jaziri', users.teachers[3]);

  // Booking fields of the rooms (rooms created before phase 2 do not have them).
  await Room.updateMany({ bookable: { $exists: false } }, { $set: { bookable: true } });
  await Room.updateMany(
    { requiresApproval: { $exists: false }, type: 'AMPHITHEATER' },
    { $set: { requiresApproval: true } }
  );
  await Room.updateMany({ requiresApproval: { $exists: false } }, { $set: { requiresApproval: false } });
  if (rooms['Amphi A']) {
    await Room.updateOne({ _id: rooms['Amphi A']._id }, { $set: { bookable: true, requiresApproval: true } });
  }

  // Equipment (upsert by name: ids stay stable from one run to the next).
  const equipment = {};
  for (const { key, ...item } of EQUIPMENT) {
    equipment[key] = await Equipment.findOneAndUpdate(
      { name: item.name },
      { $set: { requiresApproval: false, active: true, ...item } },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
    ).collation(Equipment.NAME_COLLATION);
  }

  // Replace the bookings of a previous run (and their slots and seats).
  const previous = await Booking.find({ source: 'SEED' }).select('_id').lean();
  const previousIds = previous.map((booking) => booking._id);
  await BookingSlot.deleteMany({ booking: { $in: previousIds } });
  await Booking.deleteMany({ _id: { $in: previousIds } });

  // Campus day `offset` days from today, moved to Monday when it falls on a Sunday.
  const today = time.formatLocalDate(now);
  const day = (offset) => {
    let date = time.addDaysToDateString(today, offset);
    const { weekday } = time.getZonedParts(time.parseLocalDateTime(date, '12:00'));
    if (weekday === 7) date = time.addDaysToDateString(date, offset >= 0 ? 1 : -1);
    return date;
  };
  const at = (offset, hhmm) => time.parseLocalDateTime(day(offset), hhmm);
  const room = (name) => rooms[name] ?? null;

  // Timetable classes end at 16:15: room bookings are in the evening or on Saturdays.
  const items = [
    // Upcoming
    { user: yasmine, room: 'Amphi A', offset: 2, start: '17:00', end: '19:00', status: 'PENDING', purpose: 'Répétition générale du club théâtre' },
    { user: yasmine, room: 'A12', offset: 1, start: '16:30', end: '18:30', status: 'CONFIRMED', purpose: 'Révision en groupe : bases de données' },
    { user: omar, room: 'C201', offset: 3, start: '17:00', end: '19:00', status: 'CONFIRMED', purpose: 'Hackathon team practice' },
    { user: amira, equipment: 'projector', offset: 1, start: '10:15', end: '11:45', status: 'CONFIRMED', purpose: 'Cours de bases de données en A04' },
    { user: karim, room: 'B12', offset: 4, start: '17:00', end: '20:00', status: 'CONFIRMED', purpose: 'Séance de rattrapage : développement web' },
    { user: ines, equipment: 'camera', offset: 5, start: '14:00', end: '17:00', status: 'PENDING', purpose: 'Tournage de la vidéo de présentation du club IA' },
    {
      user: ahmed,
      room: 'Amphi A',
      offset: 3,
      start: '18:00',
      end: '20:00',
      status: 'REJECTED',
      purpose: 'Soirée jeux du BDE',
      note: 'L’amphi est déjà prévu pour un événement ce soir-là. Essaie la salle A12 !',
    },
    { user: nour, equipment: 'microphone', offset: 2, start: '13:00', end: '14:00', status: 'CANCELLED', purpose: 'Présentation du projet agile' },
    // Past
    { user: yasmine, room: 'A04', offset: -2, start: '17:00', end: '19:00', status: 'CONFIRMED', purpose: 'Préparation de l’exposé d’anglais' },
    { user: amira, equipment: 'projector', offset: -3, start: '08:30', end: '10:00', status: 'CONFIRMED', purpose: 'Cours de bases de données' },
    { user: karim, room: 'C202', offset: -6, start: '16:30', end: '19:30', status: 'CONFIRMED', purpose: 'Atelier Docker pour les 4TWIN' },
    { user: omar, equipment: 'laptop', offset: -1, start: '13:00', end: '15:00', status: 'CONFIRMED', purpose: 'Project demo rehearsal' },
    {
      user: mehdi,
      room: 'Amphi A',
      offset: -8,
      start: '17:00',
      end: '20:00',
      status: 'CONFIRMED',
      purpose: 'Conférence : l’agilité en entreprise',
      note: 'Validé, pense à rendre la clé à l’accueil.',
    },
  ];

  const counts = { created: 0, skipped: 0 };
  for (const item of items) {
    if (!item.user) continue;
    const resourceType = item.room ? 'ROOM' : 'EQUIPMENT';
    const resource = item.room ? room(item.room) : equipment[item.equipment];
    if (!resource) continue;
    const startsAt = at(item.offset, item.start);
    const endsAt = at(item.offset, item.end);
    const active = Booking.ACTIVE_STATUSES.includes(item.status);
    const bookingId = new ctx.mongoose.Types.ObjectId();

    if (active) {
      // Never overlap a class or a booking made by hand.
      const conflicts = await bookingService.findConflicts({ resourceType, resourceId: resource._id, startsAt, endsAt });
      const claim =
        conflicts.length === 0
          ? await bookingService.claimSlots({ bookingId, resourceType, resourceId: resource._id, startsAt, endsAt })
          : { ok: false };
      // Upcoming bookings of a student hold one of their seats (student limit).
      const seat =
        claim.ok && item.user.role === 'STUDENT' && endsAt > now
          ? await bookingService.claimSeat(item.user._id, bookingId, { now })
          : true;
      if (!claim.ok || !seat) {
        await bookingService.releaseSlots(bookingId);
        counts.skipped += 1;
        log(`skipped ${resource.name} on ${day(item.offset)} ${item.start} (${claim.ok ? 'student limit' : 'not free'})`);
        continue;
      }
    }

    const createdAt = new Date(Math.min(now.getTime(), startsAt.getTime()) - 2 * DAY_MS);
    const decided = item.status === 'REJECTED' || (item.status === 'CONFIRMED' && item.note);
    const decidedAt = new Date(createdAt.getTime() + 3 * HOUR_MS);
    const cancelledAt = new Date(createdAt.getTime() + 5 * HOUR_MS);
    const doc = new Booking({
      _id: bookingId,
      resourceType,
      room: resourceType === 'ROOM' ? resource._id : null,
      equipment: resourceType === 'EQUIPMENT' ? resource._id : null,
      resourceSnapshot: bookingService.resourceSnapshot(resourceType, resource),
      user: item.user._id,
      userSnapshot: { firstname: item.user.firstname, lastname: item.user.lastname, role: item.user.role },
      purpose: item.purpose,
      startsAt,
      endsAt,
      status: item.status,
      decision: decided
        ? {
            by: admin._id,
            bySnapshot: { firstname: admin.firstname, lastname: admin.lastname },
            at: decidedAt,
            note: item.note ?? '',
          }
        : null,
      cancellation: item.status === 'CANCELLED' ? { by: item.user._id, at: cancelledAt, byOwner: true } : null,
      // Past bookings never get a reminder.
      reminderSentAt: startsAt <= now ? startsAt : null,
      version: decided || item.status === 'CANCELLED' ? 1 : 0,
      source: 'SEED',
      createdAt,
      updatedAt: item.status === 'CANCELLED' ? cancelledAt : decided ? decidedAt : createdAt,
    });
    try {
      await doc.save({ timestamps: false });
      counts.created += 1;
    } catch (error) {
      await bookingService.releaseSlots(bookingId);
      throw error;
    }
  }

  const pending = items.filter((item) => item.status === 'PENDING').length;
  log(
    `${EQUIPMENT.length} equipment items, ${counts.created} bookings (${pending} pending)` +
      (counts.skipped > 0 ? `, ${counts.skipped} skipped` : '') +
      '.'
  );
};

module.exports = { name: 'bookings', run };
