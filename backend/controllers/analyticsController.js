const ClassSession = require('../models/classSessionModel');
const Group = require('../models/groupModel');
const Subject = require('../models/subjectModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const {
  assertObjectId,
  notFound,
  parseBooleanQuery,
  normalizeLocale,
  throwIfInvalid,
  validationError,
  readObjectId,
} = require('../utils/validation');
const timetableService = require('../service/timetableService');
const analyticsService = require('../service/analyticsService');
const reportService = require('../service/reportService');
const { contentDisposition } = require('../service/storageService');

/*
 * /api/analytics (Module 9, phase 2 contract section 3.3).
 * STUDENT: own analytics (+ opt-in anonymized group comparison) and PDF report. TEACHER: overview of a group
 * for the subjects they teach in it. ADMIN: any group, any student's analytics and report.
 */

const isPresent = (value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');

// ?locale=fr|en of a report (400 VALIDATION_ERROR when invalid), else the student's own language.
const reportLocale = (query, student) => {
  if (!isPresent(query.locale)) return normalizeLocale(student.locale) || 'fr';
  const locale = normalizeLocale(query.locale);
  if (!locale) throw validationError({ locale: 'locale must be fr or en' });
  return locale;
};

const sendReport = async (res, student, locale) => {
  const now = new Date();
  const analytics = await analyticsService.studentAnalytics(student, { now });
  const buffer = await reportService.buildStudentReport({ analytics, student, locale, now });
  res.status(200);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(buffer.length),
    'Content-Disposition': contentDisposition(reportService.reportFilename(student, locale, now)),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buffer);
};

// The STUDENT of the URL (ADMIN views), or 400 INVALID_ID / 404 RESOURCE_NOT_FOUND.
const loadStudent = async (id) => {
  assertObjectId(id);
  const student = await User.findOne({ _id: id, role: 'STUDENT' });
  if (!student) throw notFound('Student');
  return student;
};

// ---------- STUDENT ----------

// GET /me?compare=true
const getMine = async (req, res) => {
  res.status(200).json(await analyticsService.studentAnalytics(req.user, { compare: parseBooleanQuery(req.query.compare) }));
};

// GET /me/report.pdf?locale=fr|en
const getMyReport = async (req, res) => {
  await sendReport(res, req.user, reportLocale(req.query, req.user));
};

// ---------- TEACHER / ADMIN ----------

/**
 * GET /groups/:groupId?subject= — TEACHER: only a group they teach this academic year, for the subjects they
 * teach in it (403 FORBIDDEN otherwise, or for another ?subject); ADMIN: any group, every subject of its
 * timetable and assessments (or ?subject).
 */
const getGroup = async (req, res) => {
  assertObjectId(req.params.groupId);
  const group = await Group.findById(req.params.groupId).populate({ path: 'program', select: 'name code' }).lean();
  if (!group) throw notFound('Group');

  const details = {};
  const subject = isPresent(req.query.subject) ? readObjectId(req.query.subject, 'subject', details) : null;
  throwIfInvalid(details);

  let subjectIds;
  if (req.user.role === 'TEACHER') {
    const taught = (
      await ClassSession.distinct('subject', { ...timetableService.taughtSessionsFilter(req.user._id), groups: group._id })
    ).map(String);
    if (taught.length === 0) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not teach this group this academic year', { reason: 'NOT_TEACHING' });
    }
    if (subject && !taught.includes(String(subject))) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not teach this subject to this group', { reason: 'NOT_TEACHING' });
    }
    subjectIds = subject ? [String(subject)] : taught;
  } else {
    if (subject && !(await Subject.exists({ _id: subject }))) throw validationError({ subject: 'Unknown subject' });
    subjectIds = subject ? [String(subject)] : await analyticsService.groupSubjectIds(group);
  }

  res.status(200).json(await analyticsService.groupOverview({ group, subjectIds }));
};

// GET /students/:id?compare=true (ADMIN) — the student view of /me.
const getStudent = async (req, res) => {
  const student = await loadStudent(req.params.id);
  res.status(200).json(await analyticsService.studentAnalytics(student, { compare: parseBooleanQuery(req.query.compare) }));
};

// GET /students/:id/report.pdf?locale=fr|en (ADMIN) — in the student's language unless ?locale is given.
const getStudentReport = async (req, res) => {
  const student = await loadStudent(req.params.id);
  await sendReport(res, student, reportLocale(req.query, student));
};

module.exports = { getMine, getMyReport, getGroup, getStudent, getStudentReport };
