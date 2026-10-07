// Demo timetable (seed plugin of `npm run seed:demo`, see scripts/seed-demo.js).
// Weekly series for the current week and the next 4 weeks for every demo group, one exam, plus one
// room change and one cancellation in the coming days so the demo shows them. Idempotent: the
// sessions created by a previous run (source SEED) are replaced. Sends no notification.
const ClassSession = require('../../models/classSessionModel');
const timetableService = require('../../service/timetableService');

const WEEKS = 5; // current week + the next 4

const SLOTS = {
  S1: ['08:30', '10:00'],
  S2: ['10:15', '11:45'],
  S3: ['13:00', '14:30'],
  S4: ['14:45', '16:15'],
};

// Teachers by index in ctx.users.teachers: 0 Amira Ben Salah (BDD), 1 Karim Trabelsi (WEB),
// 2 Leila Gharbi (ML, ENG), 3 Mehdi Jaziri (ARCH, AGILE). Weekday: 1 = Monday.
// Conflict-free: no room, teacher or group is used twice in the same slot.
const WEEKLY = [
  // Monday
  { day: 1, slot: 'S1', subject: 'BDD', teacher: 0, groups: ['4TWIN1', '4TWIN2'], room: 'Amphi A', type: 'LECTURE' },
  { day: 1, slot: 'S1', subject: 'ML', teacher: 2, groups: ['4DS1'], room: 'C202', type: 'LAB' },
  { day: 1, slot: 'S1', subject: 'ARCH', teacher: 3, groups: ['4SAE1'], room: 'B12', type: 'LECTURE' },
  { day: 1, slot: 'S2', subject: 'WEB', teacher: 1, groups: ['4TWIN1'], room: 'C201', type: 'LAB' },
  { day: 1, slot: 'S2', subject: 'BDD', teacher: 0, groups: ['4DS1'], room: 'A04', type: 'TUTORIAL' },
  { day: 1, slot: 'S3', subject: 'WEB', teacher: 1, groups: ['4TWIN2'], room: 'C201', type: 'LAB' },
  { day: 1, slot: 'S3', subject: 'AGILE', teacher: 3, groups: ['4DS1', '4SAE1'], room: 'A12', type: 'LECTURE' },
  // Tuesday
  { day: 2, slot: 'S1', subject: 'ENG', teacher: 2, groups: ['4TWIN1', '4TWIN2', '4DS1', '4SAE1'], room: 'Amphi A', type: 'LECTURE' },
  { day: 2, slot: 'S2', subject: 'BDD', teacher: 0, groups: ['4TWIN1'], room: 'A04', type: 'TUTORIAL' },
  { day: 2, slot: 'S2', subject: 'WEB', teacher: 1, groups: ['4TWIN2'], room: 'B12', type: 'LECTURE' },
  { day: 2, slot: 'S2', subject: 'ARCH', teacher: 3, groups: ['4SAE1'], room: 'C202', type: 'LAB' },
  { day: 2, slot: 'S3', subject: 'BDD', teacher: 0, groups: ['4TWIN2'], room: 'A04', type: 'TUTORIAL' },
  { day: 2, slot: 'S3', subject: 'ML', teacher: 2, groups: ['4DS1'], room: 'A12', type: 'LECTURE' },
  // Wednesday
  { day: 3, slot: 'S1', subject: 'WEB', teacher: 1, groups: ['4TWIN1'], room: 'B12', type: 'LECTURE' },
  { day: 3, slot: 'S1', subject: 'AGILE', teacher: 3, groups: ['4DS1', '4SAE1'], room: 'A12', type: 'TUTORIAL' },
  { day: 3, slot: 'S2', subject: 'BDD', teacher: 0, groups: ['4TWIN2'], room: 'C201', type: 'LAB' },
  { day: 3, slot: 'S2', subject: 'ML', teacher: 2, groups: ['4DS1'], room: 'C202', type: 'LAB' },
  { day: 3, slot: 'S3', subject: 'ARCH', teacher: 3, groups: ['4SAE1'], room: 'B12', type: 'TUTORIAL' },
  { day: 3, slot: 'S3', subject: 'WEB', teacher: 1, groups: ['4TWIN1'], room: 'C201', type: 'TUTORIAL' },
  // Thursday
  { day: 4, slot: 'S1', subject: 'BDD', teacher: 0, groups: ['4TWIN1'], room: 'C201', type: 'LAB' },
  { day: 4, slot: 'S1', subject: 'ENG', teacher: 2, groups: ['4DS1', '4SAE1'], room: 'A12', type: 'TUTORIAL' },
  { day: 4, slot: 'S2', subject: 'WEB', teacher: 1, groups: ['4TWIN2'], room: 'C202', type: 'TUTORIAL' },
  { day: 4, slot: 'S2', subject: 'BDD', teacher: 0, groups: ['4DS1'], room: 'A04', type: 'LECTURE' },
  { day: 4, slot: 'S3', subject: 'ENG', teacher: 2, groups: ['4TWIN1', '4TWIN2'], room: 'A12', type: 'TUTORIAL' },
  { day: 4, slot: 'S3', subject: 'ARCH', teacher: 3, groups: ['4SAE1'], room: 'C202', type: 'LAB' },
  // Friday
  { day: 5, slot: 'S1', subject: 'AGILE', teacher: 3, groups: ['4DS1', '4SAE1'], room: 'Amphi A', type: 'LECTURE' },
  { day: 5, slot: 'S1', subject: 'WEB', teacher: 1, groups: ['4TWIN1', '4TWIN2'], room: 'B12', type: 'LECTURE' },
  { day: 5, slot: 'S2', subject: 'ML', teacher: 2, groups: ['4DS1'], room: 'C202', type: 'TUTORIAL' },
  { day: 5, slot: 'S2', subject: 'BDD', teacher: 0, groups: ['4TWIN1'], room: 'A04', type: 'TUTORIAL' },
];

// One-off exam (no series), Friday afternoon two weeks from now.
const EXAM = {
  week: 2,
  day: 5,
  slot: 'S4',
  subject: 'BDD',
  teacher: 0,
  groups: ['4TWIN1', '4TWIN2'],
  room: 'Amphi A',
  type: 'EXAM',
  notes: 'Examen de mi-semestre : documents non autorisés.',
};

// Rooms tried, in order, for the demo room change.
const ROOM_CHANGE_ORDER = ['A04', 'B12', 'A12', 'C201', 'C202', 'Amphi A'];
const DEMO_GROUP = '4TWIN1';
const MIN_LEAD_MS = 60 * 60 * 1000;

const run = async (ctx) => {
  const { mongoose, time, now, subjects, rooms, groups, users } = ctx;
  const { ObjectId } = mongoose.Types;
  const admin = users.admin;
  const monday = time.formatLocalDate(time.startOfLocalWeek(now));

  const removed = await ClassSession.deleteMany({ source: 'SEED' });

  const build = ({ week, day, slot, subject, teacher, groups: names, room, type, notes = '' }, seriesId) => {
    const date = time.addDaysToDateString(monday, week * 7 + (day - 1));
    const [start, end] = SLOTS[slot];
    return {
      _id: new ObjectId(),
      subject: subjects[subject]._id,
      teacher: users.teachers[teacher]._id,
      groups: names.map((name) => groups[name]._id),
      room: room ? rooms[room]._id : null,
      startsAt: time.parseLocalDateTime(date, start),
      endsAt: time.parseLocalDateTime(date, end),
      type,
      status: 'SCHEDULED',
      notes,
      seriesId,
      change: null,
      changeBeforeCancel: null,
      sequence: 0,
      source: 'SEED',
      createdBy: admin._id,
    };
  };

  const docs = [];
  WEEKLY.forEach((entry) => {
    const seriesId = new ObjectId();
    for (let week = 0; week < WEEKS; week += 1) docs.push(build({ ...entry, week }, seriesId));
  });
  docs.push(build(EXAM, null));

  const internal = timetableService.findInternalConflicts(docs.map((doc) => ({ key: String(doc._id), ...doc })));
  if (internal.length > 0) throw new Error(`The demo timetable has ${internal.length} conflict(s)`);

  // Demo changes: the next two classes of 4TWIN1 (on two different days) starting in the future.
  const groupId = String(groups[DEMO_GROUP]._id);
  const upcoming = docs
    .filter((doc) => doc.groups.some((id) => String(id) === groupId) && doc.startsAt.getTime() > now.getTime() + MIN_LEAD_MS)
    .sort((a, b) => a.startsAt - b.startsAt);

  const moved = upcoming.find((doc) => doc.room && doc.type !== 'EXAM');
  if (moved) {
    const busy = new Set(
      docs
        .filter((doc) => doc !== moved && doc.room && doc.startsAt < moved.endsAt && moved.startsAt < doc.endsAt)
        .map((doc) => String(doc.room))
    );
    const target = ROOM_CHANGE_ORDER.map((name) => rooms[name]).find(
      (room) => room && String(room._id) !== String(moved.room) && !busy.has(String(room._id))
    );
    if (target) {
      const previous = Object.values(rooms).find((room) => String(room._id) === String(moved.room));
      moved.change = { kind: 'ROOM', previousRoom: { id: previous._id, name: previous.name }, changedAt: now };
      moved.room = target._id;
      moved.sequence = 1;
    }
  }

  const cancelled = upcoming.find(
    (doc) => doc !== moved && doc.type !== 'EXAM' && (!moved || !time.isSameLocalDay(doc.startsAt, moved.startsAt))
  );
  if (cancelled) {
    cancelled.status = 'CANCELLED';
    cancelled.change = { kind: 'CANCELLED', changedAt: now };
    cancelled.sequence = 1;
  }

  // Sessions created by hand (not by the seed) may overlap the demo slots: only report it.
  const external = await timetableService.findConflicts(
    docs.filter((doc) => doc.status === 'SCHEDULED').map((doc) => ({ key: String(doc._id), ...doc })),
    { excludeIds: docs.map((doc) => doc._id) }
  );

  await ClassSession.insertMany(docs);

  const describe = (doc) =>
    `${time.formatLocalDate(doc.startsAt)} ${time.formatLocalTime(doc.startsAt)} ${
      Object.values(subjects).find((subject) => String(subject._id) === String(doc.subject)).code
    }`;
  ctx.log(
    `${docs.length} sessions (${WEEKLY.length} weekly series × ${WEEKS} weeks + 1 exam) from ${monday}` +
      ` (replaced ${removed.deletedCount}).`
  );
  if (moved?.change) {
    const room = Object.values(rooms).find((r) => String(r._id) === String(moved.room));
    ctx.log(`Room change: ${describe(moved)} ${moved.change.previousRoom.name} → ${room.name} (${DEMO_GROUP}).`);
  }
  if (cancelled) ctx.log(`Cancelled: ${describe(cancelled)} (${DEMO_GROUP}).`);
  if (external.length > 0) {
    ctx.log(`Warning: ${external.length} overlap(s) with sessions that were not created by the seed.`);
  }
};

module.exports = { name: 'timetable', run };
