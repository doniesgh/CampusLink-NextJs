const mongoose = require('mongoose');
const ClassSession = require('../models/classSessionModel');
const User = require('../models/userModel');
const Assessment = require('../models/assessmentModel');
const Grade = require('../models/gradeModel');
const time = require('../utils/time');
const timetableService = require('./timetableService');
const { notifyUsersInBackground } = require('./notificationService');

/*
 * Assessments and grades (Module 9, phase 2 contract section 3.2): who may manage an assessment, weighted
 * averages on 20 and their trend, a student's published grades, a group's grade figures, and the GRADE
 * notification sent when an assessment is published.
 *
 * Averages: each score is brought back on 20 (score / maxScore × 20) and weighted by the assessment's
 * coefficient. Subject average = weighted mean of the graded assessments of that subject; overall average =
 * weighted mean of every graded assessment. A null score (not graded / absent) is left out. Students only
 * ever see published assessments.
 */

const SCALE = 20;
const NAME_SORT_COLLATION = { locale: 'fr', strength: 1 };

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value?._id ?? value));
const idString = (value) => (value === null || value === undefined ? null : String(value?._id ?? value));
const round2 = (value) => Math.round(value * 100) / 100;

// ---------- Who teaches what ----------

/**
 * True when `user` may manage assessments of `subject` for `group`: ADMIN always; a TEACHER who teaches that
 * subject to that group this academic year (a SCHEDULED session of theirs, see
 * timetableService.taughtSessionsFilter); nobody else.
 */
const canManage = async (user, subjectId, groupId, now = new Date()) => {
  if (user?.role === 'ADMIN') return true;
  if (user?.role !== 'TEACHER') return false;
  const exists = await ClassSession.exists({
    ...timetableService.taughtSessionsFilter(user._id, now),
    subject: toObjectId(subjectId),
    groups: toObjectId(groupId),
  });
  return Boolean(exists);
};

/**
 * (subject, group) pairs taught this academic year: a TEACHER's own, or every pair of the timetable for an
 * ADMIN. Returns [{ subject: ObjectId, group: ObjectId, teachers: [ObjectId] }].
 */
const taughtPairs = async (user, now = new Date()) => {
  let match;
  if (user?.role === 'TEACHER') match = timetableService.taughtSessionsFilter(user._id, now);
  else if (user?.role === 'ADMIN') {
    const { start, end } = time.academicYearBounds(now);
    match = { status: 'SCHEDULED', startsAt: { $gte: start, $lt: end } };
  } else return [];
  const rows = await ClassSession.aggregate([
    { $match: match },
    { $unwind: '$groups' },
    { $group: { _id: { subject: '$subject', group: '$groups' }, teachers: { $addToSet: '$teacher' } } },
  ]);
  return rows.map((row) => ({ subject: row._id.subject, group: row._id.group, teachers: row.teachers }));
};

// ---------- Averages ----------

const onScale = (score, maxScore) => (score / maxScore) * SCALE;

// Weighted average on 20 of graded entries [{ score, maxScore, coefficient }], or null when none is graded.
const weightedAverage = (entries) => {
  let total = 0;
  let weights = 0;
  entries.forEach(({ score, maxScore, coefficient }) => {
    if (score === null || score === undefined || !(maxScore > 0) || !(coefficient > 0)) return;
    total += onScale(score, maxScore) * coefficient;
    weights += coefficient;
  });
  return weights > 0 ? round2(total / weights) : null;
};

/**
 * Averages of one student's entries [{ subject: { id, ... }, score, maxScore, coefficient, date }]:
 * { overall, bySubject: [{ subject, average, assessments }], trend: [{ date, average }] }.
 * `assessments` = number of graded assessments of the subject; `trend` = overall average after each day with a
 * graded assessment ("YYYY-MM-DD", campus timezone), oldest first.
 */
const computeAverages = (entries) => {
  const graded = entries.filter((entry) => entry.score !== null && entry.score !== undefined);
  const subjects = new Map();
  entries.forEach((entry) => {
    const key = entry.subject?.id ?? idString(entry.subject);
    if (!subjects.has(key)) subjects.set(key, { subject: entry.subject, entries: [] });
    subjects.get(key).entries.push(entry);
  });
  const bySubject = [...subjects.values()]
    .map(({ subject, entries: list }) => ({
      subject,
      average: weightedAverage(list),
      assessments: list.filter((entry) => entry.score !== null && entry.score !== undefined).length,
    }))
    .sort((a, b) => String(a.subject?.name ?? '').localeCompare(String(b.subject?.name ?? ''), 'fr'));

  const trend = [];
  const sorted = [...graded].sort((a, b) => new Date(a.date) - new Date(b.date));
  const seen = [];
  sorted.forEach((entry, index) => {
    seen.push(entry);
    const day = time.formatLocalDate(entry.date);
    const next = sorted[index + 1];
    if (next && time.formatLocalDate(next.date) === day) return;
    trend.push({ date: day, average: weightedAverage(seen) });
  });

  return { overall: weightedAverage(graded), bySubject, trend };
};

// ---------- A student's published grades ----------

const subjectSummary = (subject) =>
  subject && subject._id
    ? { id: String(subject._id), name: subject.name, code: subject.code, color: subject.color }
    : subject
      ? { id: idString(subject) }
      : null;

/**
 * Published assessments of a student (those of their current group, plus any other one they have a grade in)
 * with their own score. Returns { items, overall, bySubject, trend }:
 * items (newest first) = [{ id, title, type, date, maxScore, coefficient, subject, group: { id, name },
 *   publishedAt, score, scoreOn20, comment }]. Unpublished assessments never appear.
 */
const studentGrades = async (student) => {
  const studentId = toObjectId(student);
  const groupId = student?.group ? idString(student.group) : null;
  const grades = await Grade.find({ student: studentId }).select('assessment score comment').lean();
  const gradeByAssessment = new Map(grades.map((grade) => [String(grade.assessment), grade]));

  const scope = [{ _id: { $in: grades.map((grade) => grade.assessment) } }];
  if (groupId) scope.push({ group: toObjectId(groupId) });
  const assessments = await Assessment.find({ published: true, $or: scope })
    .populate([
      { path: 'subject', select: 'name code color' },
      { path: 'group', select: 'name' },
    ])
    .sort({ date: -1, _id: -1 })
    .lean();

  const items = assessments.map((assessment) => {
    const grade = gradeByAssessment.get(String(assessment._id));
    const score = grade && grade.score !== null && grade.score !== undefined ? grade.score : null;
    return {
      id: String(assessment._id),
      title: assessment.title,
      type: assessment.type,
      date: assessment.date,
      maxScore: assessment.maxScore,
      coefficient: assessment.coefficient,
      subject: subjectSummary(assessment.subject),
      group: assessment.group ? { id: String(assessment.group._id ?? assessment.group), name: assessment.group.name ?? null } : null,
      publishedAt: assessment.publishedAt ?? null,
      score,
      scoreOn20: score === null ? null : round2(onScale(score, assessment.maxScore)),
      comment: grade?.comment || '',
    };
  });
  return { items, ...computeAverages(items) };
};

// ---------- Group figures ----------

/**
 * Published grades of a group's assessments for some students: Map<studentId, { overall, bySubject }> (see
 * computeAverages; students without grades get overall null and an empty bySubject for subjects without
 * graded assessment). `subjectIds` limits the subjects.
 */
const groupGradeFigures = async ({ groupId, studentIds, subjectIds = null }) => {
  const filter = { group: toObjectId(groupId), published: true };
  if (subjectIds) filter.subject = { $in: subjectIds.map(toObjectId) };
  const assessments = await Assessment.find(filter)
    .select('subject maxScore coefficient date')
    .populate({ path: 'subject', select: 'name code color' })
    .lean();
  const result = new Map(studentIds.map((id) => [String(id), { overall: null, bySubject: [], trend: [] }]));
  if (assessments.length === 0 || studentIds.length === 0) return result;

  const grades = await Grade.find({
    assessment: { $in: assessments.map((assessment) => assessment._id) },
    student: { $in: studentIds.map(toObjectId) },
  })
    .select('assessment student score')
    .lean();
  const scoreOf = new Map(grades.map((grade) => [`${grade.assessment}:${grade.student}`, grade.score]));

  result.forEach((value, studentId) => {
    const entries = assessments.map((assessment) => {
      const score = scoreOf.get(`${assessment._id}:${studentId}`);
      return {
        subject: subjectSummary(assessment.subject),
        score: score === undefined ? null : score,
        maxScore: assessment.maxScore,
        coefficient: assessment.coefficient,
        date: assessment.date,
      };
    });
    result.set(studentId, computeAverages(entries));
  });
  return result;
};

// ---------- Publication ----------

/**
 * Localized GRADE notification of a published assessment (French uses "tu"). The score itself is never put in
 * the notification (it may show on a lock screen). Exported for tests.
 */
const buildPublishedMessage = (assessment, locale) => {
  const fr = locale !== 'en';
  const subjectName = assessment.subject?.name || (fr ? 'Évaluation' : 'Assessment');
  return {
    type: 'GRADE',
    title: fr ? `Nouvelle note : ${subjectName}` : `New grade: ${subjectName}`,
    body: fr
      ? `Les notes de « ${assessment.title} » sont disponibles. Va voir ton suivi pour découvrir la tienne.`
      : `Grades for "${assessment.title}" are available. Check your progress page to see yours.`,
    link: '/dashboard/analytics',
    data: { assessmentId: String(assessment._id), subjectId: idString(assessment.subject) },
    tag: `grade-${assessment._id}`,
  };
};

// Notifies (in the background) the students of the assessment's group and every student graded in it.
const notifyPublished = async (assessment) => {
  const [members, graded] = await Promise.all([
    User.find({ role: 'STUDENT', group: toObjectId(assessment.group) }).distinct('_id'),
    Grade.find({ assessment: assessment._id }).distinct('student'),
  ]);
  const recipients = [...members, ...graded];
  if (recipients.length > 0) {
    notifyUsersInBackground(recipients, (locale) => buildPublishedMessage(assessment, locale));
  }
  return new Set([...members, ...graded].map(String)).size;
};

// ---------- Grade sheets ----------

/**
 * Students of an assessment's grade sheet: the students of its group (sorted by name) followed by students
 * who have a grade but left the group. Returns lean users { _id, firstname, lastname }.
 */
const sheetStudents = async (assessment) => {
  const members = await User.find({ role: 'STUDENT', group: toObjectId(assessment.group) })
    .select('firstname lastname')
    .collation(NAME_SORT_COLLATION)
    .sort({ lastname: 1, firstname: 1, _id: 1 })
    .lean();
  const known = new Set(members.map((member) => String(member._id)));
  const gradedIds = (await Grade.find({ assessment: assessment._id }).distinct('student')).filter(
    (id) => !known.has(String(id))
  );
  if (gradedIds.length === 0) return members;
  const former = await User.find({ _id: { $in: gradedIds } })
    .select('firstname lastname')
    .collation(NAME_SORT_COLLATION)
    .sort({ lastname: 1, firstname: 1, _id: 1 })
    .lean();
  return [...members, ...former];
};

module.exports = {
  SCALE,
  canManage,
  taughtPairs,
  weightedAverage,
  computeAverages,
  studentGrades,
  groupGradeFigures,
  buildPublishedMessage,
  notifyPublished,
  sheetStudents,
  round2,
};
