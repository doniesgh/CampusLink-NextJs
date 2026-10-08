// Demo attendance, absence alerts, assessments and grades (seed plugin of `npm run seed:demo`, see
// scripts/seed-demo.js; Module 9, phase 2 contract section 6).
//
// - Past weeks: the timetable plugin only creates the current week and the next 4, so this plugin copies the
//   current week's weekly series into the previous PAST_WEEKS weeks (inside the academic year, source SEED:
//   10-timetable removes them on its next run before re-creating its sessions).
// - Attendance for every held demo session (SCHEDULED, already ended) of the demo groups: everybody present
//   (a few late), except in 4TWIN1 where one student is above the warning threshold in one subject and another
//   one above the alert threshold, plus an excused absence. The matching alerts are created (no notification).
// - Assessments and grades for 4TWIN1 (most published, one future exam and one graded test not published).
//
// Idempotent: what a previous run created (source SEED) is replaced. Sends no notification.
const ClassSession = require('../../models/classSessionModel');
const AttendanceRecord = require('../../models/attendanceRecordModel');
const AttendanceAlert = require('../../models/attendanceAlertModel');
const Assessment = require('../../models/assessmentModel');
const Grade = require('../../models/gradeModel');
const attendanceService = require('../../service/attendanceService');

const PAST_WEEKS = 5;
const DEMO_GROUP = '4TWIN1';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// Demo students of 4TWIN1 (by email, falling back to the group order).
const WARNING_STUDENT = 'yasmine.haddad@campuslink.local';
const STEADY_STUDENT = 'omar.ferchichi@campuslink.local';
const CRITICAL_STUDENT = 'sarra.mansouri@campuslink.local';
// Two more graded students, so the anonymized group comparison (5+ graded students) can be shown.
const PEER_A_STUDENT = 'mariem.jlassi@campuslink.local';
const PEER_B_STUDENT = 'aziz.benamor@campuslink.local';
// Subjects tried, in order, for the student above the warning threshold and the one above the alert threshold.
const WARNING_SUBJECTS = ['WEB', 'BDD', 'ENG'];
const CRITICAL_SUBJECTS = ['BDD', 'WEB', 'ENG'];

// Assessments of 4TWIN1. `daysAgo` is relative to today; `exam: true` uses the date of the upcoming demo exam.
// Scores by student key (null = not graded); `published: false` keeps them hidden from the students.
const ASSESSMENTS = [
  {
    subject: 'BDD',
    title: 'Quiz 1 : modèle relationnel',
    type: 'QUIZ',
    daysAgo: 24,
    coefficient: 1,
    published: true,
    scores: { warning: 16, steady: 12.5, critical: 9, peerA: 14, peerB: 11 },
  },
  {
    subject: 'BDD',
    title: 'TP noté : requêtes SQL avancées',
    type: 'LAB',
    daysAgo: 10,
    coefficient: 1.5,
    published: true,
    scores: { warning: 17.5, steady: 13, critical: 10.5, peerA: 15.5, peerB: 12 },
    comments: { critical: 'Revois les jointures externes et les sous-requêtes corrélées.' },
  },
  {
    subject: 'BDD',
    title: 'Examen de mi-semestre',
    type: 'EXAM',
    exam: true,
    coefficient: 2,
    published: false,
    scores: null,
  },
  {
    subject: 'WEB',
    title: 'Projet : API REST avec Express',
    type: 'PROJECT',
    daysAgo: 17,
    coefficient: 2,
    published: true,
    scores: { warning: 15, steady: 14, critical: 11, peerA: 13, peerB: 16 },
    comments: { warning: 'Très bonne architecture, pense à ajouter des tests.' },
  },
  {
    subject: 'WEB',
    title: 'Quiz React',
    type: 'QUIZ',
    daysAgo: 6,
    maxScore: 10,
    coefficient: 1,
    published: true,
    scores: { warning: 8.5, steady: 6, critical: null, peerA: 7, peerB: 5.5 },
    comments: { critical: 'Quiz non rendu.' },
  },
  {
    subject: 'ENG',
    title: 'Oral presentation',
    type: 'OTHER',
    daysAgo: 13,
    coefficient: 1,
    published: true,
    scores: { warning: 14, steady: 16.5, critical: 12, peerA: 15, peerB: 13.5 },
  },
  {
    subject: 'ENG',
    title: 'Written test: business emails',
    type: 'EXAM',
    daysAgo: 3,
    coefficient: 1,
    published: false,
    scores: { warning: 13, steady: 15, critical: 11.5, peerA: 14, peerB: 12.5 },
  },
];

// Small deterministic hash (stable demo data from one run to the next).
const hash = (text) => {
  let value = 0;
  for (const char of String(text)) value = (value * 31 + char.charCodeAt(0)) % 1000003;
  return value;
};

const minutesOf = (session) => Math.round((session.endsAt - session.startsAt) / MINUTE_MS);

// k sessions spread evenly over the list.
const spread = (list, count) => {
  const picked = [];
  for (let index = 0; index < count; index += 1) picked.push(list[Math.floor(((index + 0.5) * list.length) / count)]);
  return picked;
};

// The fewest spread absences giving a rate strictly above `min` (and below `max`), or null.
const pickAbsences = (sessions, min, max = Infinity) => {
  const total = sessions.reduce((sum, session) => sum + minutesOf(session), 0);
  if (total === 0) return null;
  for (let count = 1; count <= sessions.length; count += 1) {
    const chosen = spread(sessions, count);
    const rate = chosen.reduce((sum, session) => sum + minutesOf(session), 0) / total;
    if (rate >= max) return null;
    if (rate > min) return { chosen, rate };
  }
  return null;
};

const run = async (ctx) => {
  const { mongoose, time, now, groups, users, subjects } = ctx;
  const { ObjectId } = mongoose.Types;
  const limits = attendanceService.thresholds();
  const { start: yearStart } = time.academicYearBounds(now);
  const groupList = Object.values(groups);
  const groupIds = groupList.map((group) => group._id);

  // ---------- Clean up the previous run ----------
  const previousAssessments = await Assessment.find({ source: 'SEED' }).distinct('_id');
  await Grade.deleteMany({ assessment: { $in: previousAssessments } });
  await Assessment.deleteMany({ _id: { $in: previousAssessments } });
  const removedRecords = await AttendanceRecord.deleteMany({ source: 'SEED' });
  await AttendanceAlert.deleteMany({ source: 'SEED' });
  // Records of sessions that no longer exist (the timetable plugin re-creates its sessions on every run).
  const recordSessions = await AttendanceRecord.distinct('session');
  const existingSessions = new Set((await ClassSession.distinct('_id', { _id: { $in: recordSessions } })).map(String));
  const orphans = recordSessions.filter((id) => !existingSessions.has(String(id)));
  if (orphans.length > 0) await AttendanceRecord.deleteMany({ session: { $in: orphans } });

  // ---------- Past weeks of the weekly timetable ----------
  const monday = time.startOfLocalWeek(now);
  const template = await ClassSession.find({
    source: 'SEED',
    seriesId: { $ne: null },
    startsAt: { $gte: monday, $lt: time.addLocalDays(monday, 7) },
  }).lean();
  const shift = (date, weeks) =>
    time.parseLocalDateTime(time.addDaysToDateString(time.formatLocalDate(date), -7 * weeks), time.formatLocalTime(date));
  const copies = [];
  for (let week = 1; week <= PAST_WEEKS; week += 1) {
    template.forEach((session) => {
      const startsAt = shift(session.startsAt, week);
      if (startsAt < yearStart) return;
      const originalRoom = session.change?.kind === 'ROOM' && session.change.previousRoom?.id ? session.change.previousRoom.id : null;
      copies.push({
        _id: new ObjectId(),
        subject: session.subject,
        teacher: session.teacher,
        groups: session.groups,
        room: originalRoom ?? session.room,
        startsAt,
        endsAt: shift(session.endsAt, week),
        type: session.type,
        status: 'SCHEDULED',
        notes: session.notes ?? '',
        seriesId: session.seriesId,
        change: null,
        changeBeforeCancel: null,
        sequence: 0,
        source: 'SEED',
        createdBy: session.createdBy ?? users.admin._id,
      });
    });
  }
  if (copies.length > 0) await ClassSession.insertMany(copies);
  if (template.length === 0) ctx.log('No demo timetable this week (10-timetable.js): no past sessions were added.');

  // ---------- Attendance ----------
  const held = await ClassSession.find({
    source: 'SEED',
    status: 'SCHEDULED',
    groups: { $in: groupIds },
    startsAt: { $gte: yearStart },
    endsAt: { $lte: now },
  })
    .sort({ startsAt: 1 })
    .lean();

  const groupById = new Map(groupList.map((group) => [String(group._id), group]));
  const studentsByGroupId = new Map(
    groupList.map((group) => [String(group._id), users.studentsByGroup[group.name] ?? []])
  );
  const demoGroupId = String(groups[DEMO_GROUP]?._id ?? '');
  const demoStudents = users.studentsByGroup[DEMO_GROUP] ?? [];
  const byEmail = (email, index) => users.byEmail[email] ?? demoStudents[index] ?? null;
  const roles = {
    warning: byEmail(WARNING_STUDENT, 0),
    steady: byEmail(STEADY_STUDENT, 1),
    critical: byEmail(CRITICAL_STUDENT, 2),
    peerA: byEmail(PEER_A_STUDENT, 3),
    peerB: byEmail(PEER_B_STUDENT, 4),
  };
  const subjectCodeById = new Map(Object.values(subjects).map((subject) => [String(subject._id), subject.code]));
  const demoSessionsOf = (code) =>
    held.filter(
      (session) =>
        subjectCodeById.get(String(session.subject)) === code && session.groups.some((id) => String(id) === demoGroupId)
    );

  // Planned marks: `${sessionId}:${studentId}` → { status, note, byAdmin }.
  const plan = new Map();
  const mark = (session, student, status, note = '', byAdmin = false) =>
    plan.set(`${session._id}:${student._id}`, { status, note, byAdmin });
  const chosenFor = (student, codes, min, max) => {
    if (!student) return null;
    for (const code of codes) {
      const picked = pickAbsences(demoSessionsOf(code), min, max);
      if (picked) return { code, ...picked };
    }
    return null;
  };

  const warningPick = chosenFor(roles.warning, WARNING_SUBJECTS, limits.warning, limits.critical);
  const criticalPick = chosenFor(roles.critical, CRITICAL_SUBJECTS, limits.critical);
  warningPick?.chosen.forEach((session) => mark(session, roles.warning, 'ABSENT'));
  criticalPick?.chosen.forEach((session) => mark(session, roles.critical, 'ABSENT'));

  // A few extra marks that do not change the alert levels: an excused absence and some late arrivals.
  if (roles.warning) {
    const excused = demoSessionsOf('ENG').find((session) => !plan.has(`${session._id}:${roles.warning._id}`));
    if (excused) mark(excused, roles.warning, 'EXCUSED', 'Certificat médical transmis à la scolarité.', true);
    demoSessionsOf('BDD')
      .filter((session) => !plan.has(`${session._id}:${roles.warning._id}`))
      .slice(-2)
      .forEach((session) => mark(session, roles.warning, 'LATE', 'Arrivée 10 min après le début.'));
  }
  if (roles.steady) {
    demoSessionsOf('WEB')
      .slice(1, 3)
      .forEach((session) => mark(session, roles.steady, 'LATE'));
  }
  if (roles.critical) {
    const late = demoSessionsOf('WEB').find((session) => !plan.has(`${session._id}:${roles.critical._id}`));
    if (late) mark(late, roles.critical, 'LATE');
  }

  const records = [];
  held.forEach((session) => {
    const seen = new Set();
    session.groups.forEach((groupId) => {
      if (!groupById.has(String(groupId))) return;
      (studentsByGroupId.get(String(groupId)) ?? []).forEach((student) => {
        if (seen.has(String(student._id))) return;
        seen.add(String(student._id));
        const planned = plan.get(`${session._id}:${student._id}`);
        // Outside the planned marks: present, about one late arrival in twenty (never in 4TWIN1).
        const late = String(groupId) !== demoGroupId && hash(`${session._id}${student._id}`) % 20 === 0;
        const status = planned?.status ?? (late ? 'LATE' : 'PRESENT');
        const markedAt = planned?.byAdmin
          ? new Date(Math.min(session.endsAt.getTime() + 24 * HOUR_MS, now.getTime()))
          : new Date(session.startsAt.getTime() + 10 * MINUTE_MS);
        records.push({
          session: session._id,
          student: student._id,
          status,
          note: planned?.note ?? '',
          markedBy: planned?.byAdmin ? users.admin._id : session.teacher,
          markedAt,
          alertCheckAt: null,
          source: 'SEED',
        });
      });
    });
  });
  if (records.length > 0) await AttendanceRecord.insertMany(records, { ordered: false });

  const studentIds = [...new Set(records.map((record) => String(record.student)))];
  const alerts = await attendanceService.evaluateAlerts({ studentIds, notify: false, source: 'SEED', now });

  // ---------- Assessments and grades (4TWIN1) ----------
  const demoGroup = groups[DEMO_GROUP];
  let assessmentCount = 0;
  let gradeCount = 0;
  if (demoGroup) {
    const exam = await ClassSession.findOne({ source: 'SEED', type: 'EXAM', groups: demoGroup._id, startsAt: { $gt: now } })
      .sort({ startsAt: 1 })
      .lean();
    const teacherOf = (code) =>
      ctx.teaching.find(
        (entry) => entry.subject.code === code && entry.groups.some((group) => String(group._id) === String(demoGroup._id))
      )?.teacher ?? users.teachers[0];
    const dayAt = (daysAgo) => {
      const date = time.parseLocalDateTime(time.addDaysToDateString(time.formatLocalDate(now), -daysAgo), '10:00');
      return date < yearStart ? time.parseLocalDateTime(time.formatLocalDate(yearStart), '10:00') : date;
    };

    const grades = [];
    for (const definition of ASSESSMENTS) {
      const subject = subjects[definition.subject];
      if (!subject) continue;
      const teacher = teacherOf(definition.subject);
      const date = definition.exam
        ? exam?.startsAt ?? time.parseLocalDateTime(time.addDaysToDateString(time.formatLocalDate(now), 14), '14:45')
        : dayAt(definition.daysAgo);
      const publishedAt = definition.published
        ? new Date(Math.min(date.getTime() + 3 * 24 * HOUR_MS, now.getTime() - HOUR_MS))
        : null;
      const assessment = await Assessment.create({
        subject: subject._id,
        group: demoGroup._id,
        title: definition.title,
        type: definition.type,
        date,
        maxScore: definition.maxScore ?? 20,
        coefficient: definition.coefficient,
        published: definition.published,
        publishedAt,
        createdBy: teacher._id,
        source: 'SEED',
      });
      assessmentCount += 1;
      if (!definition.scores) continue;
      Object.entries(roles).forEach(([key, student]) => {
        if (!student || definition.scores[key] === undefined) return;
        grades.push({
          assessment: assessment._id,
          student: student._id,
          score: definition.scores[key],
          comment: definition.comments?.[key] ?? '',
          gradedBy: teacher._id,
          gradedAt: new Date(Math.min(date.getTime() + 2 * 24 * HOUR_MS, now.getTime())),
        });
      });
    }
    if (grades.length > 0) await Grade.insertMany(grades);
    gradeCount = grades.length;
  }

  // ---------- Report ----------
  const percent = (rate) => `${Math.round(rate * 1000) / 10} %`;
  const name = (student) => (student ? `${student.firstname} ${student.lastname}` : '?');
  ctx.log(
    `${copies.length} past sessions (${PAST_WEEKS} weeks), ${records.length} attendance records for ${held.length} held sessions` +
      ` (replaced ${removedRecords.deletedCount}).`
  );
  if (warningPick) ctx.log(`Above the warning threshold: ${name(roles.warning)} in ${warningPick.code} (${percent(warningPick.rate)}).`);
  else ctx.log('Warning: not enough held sessions yet for a student above the warning threshold.');
  if (criticalPick) ctx.log(`Above the alert threshold: ${name(roles.critical)} in ${criticalPick.code} (${percent(criticalPick.rate)}).`);
  else ctx.log('Warning: not enough held sessions yet for a student above the alert threshold.');
  ctx.log(`${alerts.length} absence alert(s); ${assessmentCount} assessments and ${gradeCount} grades for ${DEMO_GROUP}.`);
};

module.exports = { name: 'analytics', run };
