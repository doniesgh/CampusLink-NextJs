const mongoose = require('mongoose');
const User = require('../models/userModel');
const Group = require('../models/groupModel');
const Assessment = require('../models/assessmentModel');
const ClassSession = require('../models/classSessionModel');
const time = require('../utils/time');
const attendanceService = require('./attendanceService');
const gradeService = require('./gradeService');

/*
 * Student analytics (Module 9, phase 2 contract section 3.3): the student view (attendance, grades, trend,
 * 12-week activity, optional anonymized group comparison) and the staff group overview. Everything is
 * aggregated on the server; the comparison only ever exposes group averages, and only for groups of at least
 * MIN_COMPARISON_GROUP_SIZE students.
 */

const ACTIVITY_WEEKS = 12;
const MIN_COMPARISON_GROUP_SIZE = 5;
const ACTIVITY_MAX_DOCS = 10000;
const NAME_SORT_COLLATION = { locale: 'fr', strength: 1 };

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value?._id ?? value));
const idString = (value) => (value === null || value === undefined ? null : String(value?._id ?? value));
const round2 = (value) => Math.round(value * 100) / 100;
const round4 = (value) => Math.round(value * 10000) / 10000;
const mean = (values) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

// { id, name, level, academicYear, program } of a populated group, or null.
const groupSummary = (group) => (group && group._id ? Group.summarizeGroup(group) : null);

// { id, firstname, lastname, group } of a student (group populated by the User find hook).
const studentSummary = (student) => ({
  id: String(student._id),
  firstname: student.firstname,
  lastname: student.lastname,
  group: groupSummary(student.group),
});

// ---------- Activity (last 12 weeks) ----------

// Other modules' collections, read loosely (phase 2 contract section 0): a missing model counts 0.
const ACTIVITY_SOURCES = [
  { key: 'forumQuestions', model: 'ForumQuestion', userFields: ['author', 'user', 'createdBy'], dateFields: ['createdAt'] },
  { key: 'forumAnswers', model: 'ForumAnswer', userFields: ['author', 'user', 'createdBy'], dateFields: ['createdAt'] },
  { key: 'announcementsRead', model: 'AnnouncementRead', userFields: ['user'], dateFields: ['readAt', 'createdAt'] },
];

// Dates of a user's documents in a source since `start`, or [] when the model or its fields are missing.
const activityDates = async (source, userId, start) => {
  const Model = mongoose.models[source.model];
  if (!Model) return [];
  const userField = source.userFields.find((field) => Model.schema.path(field));
  const dateField = source.dateFields.find((field) => Model.schema.path(field));
  if (!userField || !dateField) return [];
  try {
    const docs = await Model.find({ [userField]: toObjectId(userId), [dateField]: { $gte: start } })
      .select(dateField)
      .limit(ACTIVITY_MAX_DOCS)
      .lean();
    return docs.map((doc) => doc[dateField]).filter((date) => date instanceof Date);
  } catch (error) {
    console.error(`[analytics] Could not read ${source.model}:`, error.message);
    return [];
  }
};

/**
 * { weeks: [{ week, forumQuestions, forumAnswers, announcementsRead }] }: the current week and the 11 before it,
 * oldest first; `week` = Monday "YYYY-MM-DD" (campus timezone).
 */
const activity = async (userId, now = new Date()) => {
  const currentWeek = time.startOfLocalWeek(now);
  const start = time.addLocalDays(currentWeek, -7 * (ACTIVITY_WEEKS - 1));
  const firstMonday = time.formatLocalDate(start);
  const weeks = [];
  const byKey = new Map();
  for (let index = 0; index < ACTIVITY_WEEKS; index += 1) {
    const week = { week: time.addDaysToDateString(firstMonday, index * 7) };
    ACTIVITY_SOURCES.forEach(({ key }) => {
      week[key] = 0;
    });
    weeks.push(week);
    byKey.set(week.week, week);
  }
  const results = await Promise.all(ACTIVITY_SOURCES.map((source) => activityDates(source, userId, start)));
  results.forEach((dates, index) => {
    const { key } = ACTIVITY_SOURCES[index];
    dates.forEach((date) => {
      const week = byKey.get(time.formatLocalDate(time.startOfLocalWeek(date)));
      if (week) week[key] += 1;
    });
  });
  return { weeks };
};

// ---------- Group comparison ----------

// A figure of the comparison is only published when it is computed from at least MIN_COMPARISON_GROUP_SIZE
// students. With fewer (e.g. a retake graded for one student), the "group average" would be that student's own
// figure, or could be derived from it (2 students: 2 × average − my own).
const enoughFigures = (values) => values.length >= MIN_COMPARISON_GROUP_SIZE;
// Grade averages of the comparison are rounded to the nearest 0.5: the change of a group average over time
// (one more graded assessment, one student more or less) says less about a single student's grade.
const roundHalf = (value) => Math.round(value * 2) / 2;
const groupAverage = (values, round) => (enoughFigures(values) ? round(mean(values)) : null);

/**
 * Anonymized averages of a student's group (opt-in): { available: false, minGroupSize } below 5 students,
 * else { available: true, groupSize, attendance: { averageRate, bySubject: [{ subject, averageRate }] },
 * grades: { overall, bySubject: [{ subject, average }] } } (rates = absence rates, averages on 20, rounded to
 * 0.5). Never individual data: every figure comes from at least 5 students. A grade average with fewer graded
 * students is null (overall) or null for its subject; an attendance figure with fewer students is left out
 * (subjects) or null (overall; cannot happen in practice, every student of the group shares its sessions).
 */
const groupComparison = async (group, now = new Date()) => {
  if (!group) return { available: false, minGroupSize: MIN_COMPARISON_GROUP_SIZE };
  const members = await User.find({ role: 'STUDENT', group: toObjectId(group) })
    .select('_id')
    .setOptions({ populateGroup: false })
    .lean();
  if (members.length < MIN_COMPARISON_GROUP_SIZE) return { available: false, minGroupSize: MIN_COMPARISON_GROUP_SIZE };
  const ids = members.map((member) => member._id);

  const figures = await attendanceService.computeGroupFigures({ group, studentIds: ids, now });
  const subjects = await attendanceService.loadSubjects(figures.subjects.keys());
  const overallRates = [];
  const subjectRates = new Map();
  figures.students.forEach((entry) => {
    overallRates.push(attendanceService.rateOf(entry.totals.absentMinutes, entry.totals.heldMinutes));
    entry.bySubject.forEach((value, subjectId) => {
      if (!subjectRates.has(subjectId)) subjectRates.set(subjectId, []);
      subjectRates.get(subjectId).push(attendanceService.rateOf(value.absentMinutes, value.heldMinutes));
    });
  });

  const grades = await gradeService.groupGradeFigures({ groupId: group._id ?? group, studentIds: ids });
  const overallGrades = [];
  const subjectGrades = new Map();
  grades.forEach((value) => {
    if (value.overall !== null) overallGrades.push(value.overall);
    value.bySubject.forEach(({ subject, average }) => {
      if (average === null) return;
      if (!subjectGrades.has(subject.id)) subjectGrades.set(subject.id, { subject, values: [] });
      subjectGrades.get(subject.id).values.push(average);
    });
  });

  const bySubjectName = (a, b) => String(a.subject?.name ?? '').localeCompare(String(b.subject?.name ?? ''), 'fr');
  return {
    available: true,
    groupSize: members.length,
    attendance: {
      averageRate: groupAverage(overallRates, round4),
      bySubject: [...subjectRates.entries()]
        .filter(([, rates]) => enoughFigures(rates))
        .map(([subjectId, rates]) => ({ subject: subjects.get(subjectId) ?? { id: subjectId }, averageRate: round4(mean(rates)) }))
        .sort(bySubjectName),
    },
    grades: {
      overall: groupAverage(overallGrades, roundHalf),
      bySubject: [...subjectGrades.values()]
        .map(({ subject, values }) => ({ subject, average: groupAverage(values, roundHalf) }))
        .sort(bySubjectName),
    },
  };
};

// ---------- Student view ----------

/**
 * Analytics of one student (GET /api/analytics/me and the admin student view):
 * { student, academicYear, thresholds, attendance, grades: { overall, bySubject, trend, items }, activity,
 *   comparison? } — comparison only when `compare` is true; grades.items = the published assessments with the
 * student's score (gradeService.studentGrades).
 */
const studentAnalytics = async (student, { compare = false, now = new Date() } = {}) => {
  const group = await attendanceService.groupOfStudent(student);
  const [attendance, grades, weeks] = await Promise.all([
    attendanceService.studentAttendance(student, { now }),
    gradeService.studentGrades(student),
    activity(student._id, now),
  ]);
  const result = {
    student: studentSummary(student),
    academicYear: group?.academicYear ?? time.currentAcademicYear(now),
    thresholds: attendanceService.thresholds(),
    attendance,
    grades: { overall: grades.overall, bySubject: grades.bySubject, trend: grades.trend, items: grades.items },
    activity: weeks,
  };
  if (compare) result.comparison = await groupComparison(group, now);
  return result;
};

// ---------- Group overview (TEACHER / ADMIN) ----------

// Subjects with SCHEDULED sessions of the group this academic year, or with assessments of the group.
const groupSubjectIds = async (group, now = new Date()) => {
  const { start, end } = attendanceService.yearBounds(group.academicYear, now);
  const [fromSessions, fromAssessments] = await Promise.all([
    ClassSession.distinct('subject', { groups: group._id, status: 'SCHEDULED', startsAt: { $gte: start, $lt: end } }),
    Assessment.distinct('subject', { group: group._id }),
  ]);
  return [...new Set([...fromSessions, ...fromAssessments].map(String))];
};

/**
 * Per-student attendance and published-grade averages of a group, limited to `subjectIds`:
 * { group, subjects, thresholds, students: [{ student: { id, firstname, lastname }, attendance: { rate,
 *   heldHours, absentHours, excusedHours, lateCount, level, bySubject }, grades: { average, bySubject } }],
 *   summary: { students, averageRate, averageGrade, levels: { OK, WARNING, CRITICAL } } }.
 */
const groupOverview = async ({ group, subjectIds, now = new Date() }) => {
  const limits = attendanceService.thresholds();
  const members = await User.find({ role: 'STUDENT', group: group._id })
    .select('firstname lastname')
    .collation(NAME_SORT_COLLATION)
    .sort({ lastname: 1, firstname: 1, _id: 1 })
    .lean();
  const ids = members.map((member) => member._id);
  const [figures, grades, subjects] = await Promise.all([
    attendanceService.computeGroupFigures({ group, studentIds: ids, subjectIds, now }),
    gradeService.groupGradeFigures({ groupId: group._id, studentIds: ids, subjectIds }),
    attendanceService.loadSubjects(subjectIds),
  ]);

  const levels = { OK: 0, WARNING: 0, CRITICAL: 0 };
  const rates = [];
  const averages = [];
  const students = members.map((member) => {
    const key = String(member._id);
    const described = attendanceService.describeStudent(figures.students.get(key), subjects, limits);
    const { overallRate, ...attendanceRest } = described;
    const studentGrades = grades.get(key) ?? { overall: null, bySubject: [] };
    levels[described.worstLevel] += 1;
    rates.push(overallRate);
    if (studentGrades.overall !== null) averages.push(studentGrades.overall);
    return {
      student: { id: key, firstname: member.firstname, lastname: member.lastname },
      attendance: { rate: overallRate, ...attendanceRest },
      grades: { average: studentGrades.overall, bySubject: studentGrades.bySubject },
    };
  });

  const averageRate = mean(rates);
  const averageGrade = mean(averages);
  return {
    group: groupSummary(group),
    subjects: [...subjects.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr')),
    thresholds: limits,
    students,
    summary: {
      students: members.length,
      averageRate: averageRate === null ? 0 : round4(averageRate),
      averageGrade: averageGrade === null ? null : round2(averageGrade),
      levels,
    },
  };
};

module.exports = {
  ACTIVITY_WEEKS,
  MIN_COMPARISON_GROUP_SIZE,
  activity,
  groupComparison,
  studentAnalytics,
  groupSubjectIds,
  groupOverview,
  studentSummary,
  idString,
};
