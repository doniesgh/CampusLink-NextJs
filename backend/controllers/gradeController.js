const Assessment = require('../models/assessmentModel');
const Grade = require('../models/gradeModel');
const Subject = require('../models/subjectModel');
const Group = require('../models/groupModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const {
  assertObjectId,
  notFound,
  parsePagination,
  parseBooleanQuery,
  requireFields,
  throwIfInvalid,
  validationError,
  readObjectId,
  readEnum,
  readString,
} = require('../utils/validation');
const auditService = require('../service/auditService');
const timetableService = require('../service/timetableService');
const attendanceService = require('../service/attendanceService');
const gradeService = require('../service/gradeService');

/*
 * /api/grades (Module 9, phase 2 contract section 3.2).
 * TEACHER (who teaches the subject to the group this academic year) or ADMIN: assessments, grade sheets,
 * publication (GRADE notification). STUDENT: own published grades and weighted averages.
 * Audited: grades.assessment.create|update|delete, grades.publish, grades.update (target Assessment).
 * A published assessment can only be deleted by an ADMIN.
 */

const {
  ASSESSMENT_TYPES,
  TITLE_MAX_LENGTH,
  MAX_MAX_SCORE,
  MAX_COEFFICIENT,
  ASSESSMENT_POPULATE,
  serializeAssessment,
} = Assessment;
const { COMMENT_MAX_LENGTH } = Grade;
const MAX_GRADES = 500;
// Audit entries list at most this many per-student changes (metadata stays small).
const MAX_AUDITED_CHANGES = 100;
// Assessment fields a PATCH can change (and that grades.assessment.update records).
const EDITABLE_FIELDS = ['title', 'type', 'date', 'maxScore', 'coefficient'];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPresent = (value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
const idString = (value) => (value === null || value === undefined ? null : String(value?._id ?? value));
const round2 = gradeService.round2;

const notTeaching = () =>
  new HttpError(403, 'FORBIDDEN', 'You can only manage the assessments of the subjects you teach to this group', {
    reason: 'NOT_TEACHING',
  });

// ---------- Helpers ----------

// Positive number (> 0, ≤ max). Returns undefined and sets details[field] when invalid.
const readPositiveNumber = (value, field, details, { max }) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    details[field] = `${field} must be a number greater than 0 and at most ${max}`;
    return undefined;
  }
  return round2(value);
};

const readAssessmentDate = (value, details) => {
  const date = typeof value === 'string' ? timetableService.parseInstant(value) : null;
  if (!date) details.date = 'date must be a date (YYYY-MM-DD) or an ISO 8601 date-time';
  return date || undefined;
};

// Loads the assessment of the URL (document) and checks that the user may manage it.
const loadManagedAssessment = async (req) => {
  assertObjectId(req.params.id);
  const assessment = await Assessment.findById(req.params.id);
  if (!assessment) throw notFound('Assessment');
  if (!(await gradeService.canManage(req.user, assessment.subject, assessment.group))) throw notTeaching();
  return assessment;
};

// { students, graded, average } per assessment id (average on 20 of the graded scores, or null).
const statsOf = async (assessments) => {
  if (assessments.length === 0) return new Map();
  const [rows, counts] = await Promise.all([
    Grade.aggregate([
      { $match: { assessment: { $in: assessments.map((assessment) => assessment._id) }, score: { $ne: null } } },
      { $group: { _id: '$assessment', graded: { $sum: 1 }, average: { $avg: '$score' } } },
    ]),
    attendanceService.countStudentsByGroup([...new Set(assessments.map((assessment) => idString(assessment.group)))]),
  ]);
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  return new Map(
    assessments.map((assessment) => {
      const row = byId.get(String(assessment._id));
      const maxScore = assessment.maxScore || 20;
      return [
        String(assessment._id),
        {
          students: counts.get(idString(assessment.group)) || 0,
          graded: row?.graded ?? 0,
          average: row ? round2((row.average / maxScore) * gradeService.SCALE) : null,
        },
      ];
    })
  );
};

// ---------- Audit ----------

const comparable = (value) => (value instanceof Date ? value.getTime() : value ?? null);
const sameValue = (a, b) => comparable(a) === comparable(b);

// "Exam 1" (BDD, 4TWIN1) from an assessment JSON (serializeAssessment of a populated assessment).
const describeAssessment = (json) =>
  `"${json.title}" (${json.subject?.code ?? json.subject?.id ?? '?'}, ${json.group?.name ?? json.group?.id ?? '?'})`;

// Values of an assessment recorded in its audit entries.
const auditValues = (json) => ({
  assessmentId: json.id,
  subject: json.subject?.id ?? null,
  subjectCode: json.subject?.code ?? null,
  group: json.group?.id ?? null,
  groupName: json.group?.name ?? null,
  title: json.title,
  type: json.type,
  date: json.date,
  maxScore: json.maxScore,
  coefficient: json.coefficient,
  published: json.published,
  publishedAt: json.publishedAt,
});

const recordAssessment = (req, action, json, summary, metadata = {}) =>
  auditService.record(req, {
    action,
    targetType: 'Assessment',
    targetId: json.id,
    summary,
    metadata: { ...auditValues(json), ...metadata },
  });

// Assessment JSON with its stats (staff views).
const withStats = async (assessment) => {
  const isPopulated = assessment.subject?.name !== undefined && assessment.group?.name !== undefined;
  const populated = isPopulated
    ? assessment
    : await Assessment.findById(assessment._id).populate(ASSESSMENT_POPULATE).lean();
  const stats = await statsOf([populated]);
  return { ...serializeAssessment(populated), stats: stats.get(String(populated._id)) };
};

// ---------- GET /teaching ----------

/**
 * (subject, group) pairs the user can manage: a TEACHER's pairs of the current academic year, or every pair of
 * the timetable for an ADMIN. → { items: [{ subject, group, teachers: [{ id, firstname, lastname }] }] }.
 */
const listTeaching = async (req, res) => {
  const pairs = await gradeService.taughtPairs(req.user);
  const [subjects, groups, teachers] = await Promise.all([
    Subject.find({ _id: { $in: [...new Set(pairs.map((pair) => String(pair.subject)))] } }).lean(),
    Group.find({ _id: { $in: [...new Set(pairs.map((pair) => String(pair.group)))] } })
      .populate({ path: 'program', select: 'name code' })
      .lean(),
    User.find({ _id: { $in: [...new Set(pairs.flatMap((pair) => pair.teachers.map(String)))] } })
      .select('firstname lastname')
      .lean(),
  ]);
  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));
  const groupById = new Map(groups.map((group) => [String(group._id), group]));
  const teacherById = new Map(teachers.map((teacher) => [String(teacher._id), teacher]));
  const items = pairs
    .filter((pair) => subjectById.has(String(pair.subject)) && groupById.has(String(pair.group)))
    .map((pair) => {
      const subject = subjectById.get(String(pair.subject));
      return {
        subject: { id: String(subject._id), name: subject.name, code: subject.code, color: subject.color },
        group: Group.summarizeGroup(groupById.get(String(pair.group))),
        teachers: pair.teachers
          .map((id) => teacherById.get(String(id)))
          .filter(Boolean)
          .map((teacher) => ({ id: String(teacher._id), firstname: teacher.firstname, lastname: teacher.lastname })),
      };
    })
    .sort(
      (a, b) =>
        a.group.name.localeCompare(b.group.name, 'fr', { numeric: true }) || a.subject.name.localeCompare(b.subject.name, 'fr')
    );
  res.status(200).json({ items });
};

// ---------- Assessments ----------

// GET /assessments?subject&group&published&page&limit → { items (with stats), total, page, limit }, newest first.
const listAssessments = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });
  const details = {};
  const subject = isPresent(req.query.subject) ? readObjectId(req.query.subject, 'subject', details) : null;
  const group = isPresent(req.query.group) ? readObjectId(req.query.group, 'group', details) : null;
  throwIfInvalid(details);

  const filter = {};
  if (subject) filter.subject = subject;
  if (group) filter.group = group;
  if (isPresent(req.query.published)) filter.published = parseBooleanQuery(req.query.published);
  if (req.user.role === 'TEACHER') {
    const pairs = (await gradeService.taughtPairs(req.user)).filter(
      (pair) => (!subject || String(pair.subject) === String(subject)) && (!group || String(pair.group) === String(group))
    );
    if (pairs.length === 0) return res.status(200).json({ items: [], total: 0, page, limit });
    filter.$or = pairs.map((pair) => ({ subject: pair.subject, group: pair.group }));
  }

  const [total, assessments] = await Promise.all([
    Assessment.countDocuments(filter),
    Assessment.find(filter)
      .sort({ date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate(ASSESSMENT_POPULATE)
      .lean(),
  ]);
  const stats = await statsOf(assessments);
  const items = assessments.map((assessment) => ({
    ...serializeAssessment(assessment),
    stats: stats.get(String(assessment._id)),
  }));
  return res.status(200).json({ items, total, page, limit });
};

// Validates the assessment fields present in `body`. Returns the values to set.
const parseAssessmentFields = (body, { create }) => {
  if (!isPlainObject(body)) throw validationError({ body: 'The request body must be a JSON object' });
  if (create) requireFields(body, ['subject', 'group', 'title', 'type', 'date']);
  const values = {};
  const details = {};
  const has = (field) => body[field] !== undefined;

  if (create) {
    values.subject = readObjectId(body.subject, 'subject', details);
    values.group = readObjectId(body.group, 'group', details);
  } else {
    ['subject', 'group'].forEach((field) => {
      if (has(field)) details[field] = `${field} cannot be changed: create a new assessment instead`;
    });
  }
  if (has('title')) values.title = readString(body.title, 'title', details, { min: 1, max: TITLE_MAX_LENGTH });
  if (has('type')) values.type = readEnum(body.type, ASSESSMENT_TYPES, 'type', details);
  if (has('date')) values.date = readAssessmentDate(body.date, details);
  if (has('maxScore')) values.maxScore = readPositiveNumber(body.maxScore, 'maxScore', details, { max: MAX_MAX_SCORE });
  if (has('coefficient')) {
    values.coefficient = readPositiveNumber(body.coefficient, 'coefficient', details, { max: MAX_COEFFICIENT });
  }
  ['published', 'publishedAt', 'createdBy'].forEach((field) => {
    if (has(field)) details[field] = `${field} cannot be set here`;
  });
  throwIfInvalid(details);
  return values;
};

// POST /assessments → 201 assessment.
const createAssessment = async (req, res) => {
  const values = parseAssessmentFields(req.body, { create: true });
  const [subjectExists, groupExists] = await Promise.all([Subject.exists({ _id: values.subject }), Group.exists({ _id: values.group })]);
  const details = {};
  if (!subjectExists) details.subject = 'Unknown subject';
  if (!groupExists) details.group = 'Unknown group';
  throwIfInvalid(details);
  if (!(await gradeService.canManage(req.user, values.subject, values.group))) throw notTeaching();

  const assessment = await Assessment.create({ ...values, createdBy: req.user._id });
  const json = await withStats(assessment);
  await recordAssessment(req, 'grades.assessment.create', json, `Created assessment ${describeAssessment(json)}`);
  res.status(201).json(json);
};

// GET /assessments/:id → assessment with stats.
const getAssessment = async (req, res) => {
  const assessment = await loadManagedAssessment(req);
  res.status(200).json(await withStats(assessment));
};

// PATCH /assessments/:id (title, type, date, maxScore, coefficient).
const updateAssessment = async (req, res) => {
  const assessment = await loadManagedAssessment(req);
  const values = parseAssessmentFields(req.body, { create: false });
  if (Object.keys(values).length === 0) throw new HttpError(400, 'NO_CHANGES', 'No changes provided');
  if (values.maxScore !== undefined && values.maxScore < assessment.maxScore) {
    const above = await Grade.exists({ assessment: assessment._id, score: { $gt: values.maxScore } });
    if (above) throw validationError({ maxScore: 'Some grades are above this maximum score: change them first' });
  }
  const changes = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (values[field] !== undefined && !sameValue(assessment[field], values[field])) {
      changes[field] = { from: assessment[field] ?? null, to: values[field] };
    }
  });
  assessment.set(values);
  await assessment.save();
  const json = await withStats(assessment);
  const changed = Object.keys(changes);
  if (changed.length > 0) {
    await recordAssessment(
      req,
      'grades.assessment.update',
      json,
      `Updated assessment ${describeAssessment(json)}: ${changed.join(', ')}${json.published ? ' (published)' : ''}`,
      { fields: changed, changes }
    );
  }
  res.status(200).json(json);
};

/**
 * DELETE /assessments/:id → 204 (its grades are deleted too). A published assessment (students already see its
 * grades) can only be deleted by an ADMIN: others get 409 INVALID_STATE, details.reason "PUBLISHED". The check
 * and the deletion are one atomic operation (a publication in between cannot slip through). The audit entry
 * keeps the assessment values and the deleted scores (at most 100).
 */
const deleteAssessment = async (req, res) => {
  const assessment = await loadManagedAssessment(req);
  const isAdmin = req.user.role === 'ADMIN';
  const deleted = await Assessment.findOneAndDelete(
    isAdmin ? { _id: assessment._id } : { _id: assessment._id, published: false }
  )
    .populate(ASSESSMENT_POPULATE)
    .lean();
  if (!deleted) {
    const current = await Assessment.findById(assessment._id).select('published').lean();
    if (!current) throw notFound('Assessment');
    throw new HttpError(409, 'INVALID_STATE', 'A published assessment can only be deleted by an administrator', {
      reason: 'PUBLISHED',
    });
  }
  const grades = await Grade.find({ assessment: deleted._id }).select('student score').lean();
  const { deletedCount } = await Grade.deleteMany({ assessment: deleted._id });
  const json = serializeAssessment(deleted);
  await recordAssessment(
    req,
    'grades.assessment.delete',
    json,
    `Deleted ${json.published ? 'published ' : ''}assessment ${describeAssessment(json)} and its ${deletedCount} grade(s)`,
    {
      gradesDeleted: deletedCount,
      graded: grades.filter((grade) => grade.score !== null && grade.score !== undefined).length,
      grades: grades.slice(0, MAX_AUDITED_CHANGES).map((grade) => ({ student: String(grade.student), score: grade.score ?? null })),
    }
  );
  res.status(204).end();
};

// POST /assessments/:id/publish → 200 assessment; 409 INVALID_STATE when already published. Claimed
// atomically, so concurrent requests notify the students once.
const publishAssessment = async (req, res) => {
  const assessment = await loadManagedAssessment(req);
  const published = await Assessment.findOneAndUpdate(
    { _id: assessment._id, published: false },
    { $set: { published: true, publishedAt: new Date() } },
    { returnDocument: 'after' }
  )
    .populate(ASSESSMENT_POPULATE)
    .lean();
  if (!published) throw new HttpError(409, 'INVALID_STATE', 'This assessment is already published');
  const notified = await gradeService.notifyPublished(published);
  const json = await withStats(published);
  await recordAssessment(req, 'grades.publish', json, `Published assessment ${describeAssessment(json)}`, {
    notified,
    graded: json.stats?.graded ?? 0,
  });
  res.status(200).json(json);
};

// ---------- Grade sheets ----------

// { assessment, grades: [{ student, score, comment, gradedAt }] } (students of the group, then former members
// with a grade).
const buildSheet = async (assessment) => {
  const [students, grades] = await Promise.all([
    gradeService.sheetStudents(assessment),
    Grade.find({ assessment: assessment._id }).select('student score comment gradedAt').lean(),
  ]);
  const gradeByStudent = new Map(grades.map((grade) => [String(grade.student), grade]));
  return {
    assessment: await withStats(assessment),
    grades: students.map((student) => {
      const grade = gradeByStudent.get(String(student._id));
      return {
        student: { id: String(student._id), firstname: student.firstname, lastname: student.lastname },
        score: grade?.score ?? null,
        comment: grade?.comment ?? '',
        gradedAt: grade?.gradedAt ?? null,
      };
    }),
  };
};

const getGrades = async (req, res) => {
  const assessment = await loadManagedAssessment(req);
  res.status(200).json(await buildSheet(assessment));
};

// Validated entries [{ index, student, score: number | null, comment: string | undefined }].
const parseGrades = (body, maxScore) => {
  if (!isPlainObject(body)) throw validationError({ body: 'The request body must be a JSON object' });
  const { grades } = body;
  if (!Array.isArray(grades)) throw validationError({ grades: 'grades must be an array' });
  if (grades.length === 0) throw validationError({ grades: 'grades must contain at least one item' });
  if (grades.length > MAX_GRADES) throw validationError({ grades: `grades accepts at most ${MAX_GRADES} items` });

  const details = {};
  const seen = new Set();
  const entries = [];
  grades.forEach((item, index) => {
    const field = `grades.${index}`;
    if (!isPlainObject(item)) {
      details[field] = `${field} must be an object`;
      return;
    }
    const student = readObjectId(item.student, `${field}.student`, details);
    let score = null;
    if (item.score === undefined) details[`${field}.score`] = `${field}.score is required (a number or null)`;
    else if (item.score !== null) {
      if (typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > maxScore) {
        details[`${field}.score`] = `${field}.score must be a number between 0 and ${maxScore}, or null`;
      } else score = round2(item.score);
    }
    let comment;
    if (item.comment === null) comment = '';
    else if (item.comment !== undefined) {
      const text = typeof item.comment === 'string' ? item.comment.replace(/\r\n?/g, '\n') : item.comment;
      comment = readString(text, `${field}.comment`, details, { max: COMMENT_MAX_LENGTH });
    }
    if (student) {
      if (seen.has(String(student))) details[`${field}.student`] = 'This student appears more than once';
      seen.add(String(student));
    }
    entries.push({ index, student, score, comment });
  });
  throwIfInvalid(details);
  return entries;
};

/**
 * PUT /assessments/:id/grades { grades: [{ student, score, comment? }] }: upserts the listed students' grades
 * (others are left as they are; an omitted comment keeps the current one). Students must be on the grade
 * sheet (group members, or students already graded). → 200 sheet + { changed }.
 */
const saveGrades = async (req, res) => {
  const assessment = await loadManagedAssessment(req);
  const entries = parseGrades(req.body, assessment.maxScore);

  const sheet = new Set((await gradeService.sheetStudents(assessment)).map((student) => String(student._id)));
  const outside = {};
  entries.forEach(({ index, student }) => {
    if (!sheet.has(String(student))) outside[`grades.${index}.student`] = 'This student is not in the group of the assessment';
  });
  throwIfInvalid(outside);

  const existing = await Grade.find({ assessment: assessment._id, student: { $in: entries.map((entry) => entry.student) } })
    .select('student score comment')
    .lean();
  const existingByStudent = new Map(existing.map((grade) => [String(grade.student), grade]));
  const now = new Date();
  const ops = [];
  const applied = [];
  entries.forEach(({ student, score, comment }) => {
    const previous = existingByStudent.get(String(student));
    const nextComment = comment === undefined ? previous?.comment ?? '' : comment;
    if (previous && (previous.score ?? null) === score && (previous.comment ?? '') === nextComment) return;
    ops.push({
      updateOne: {
        filter: { assessment: assessment._id, student },
        update: { $set: { score, comment: nextComment, gradedBy: req.user._id, gradedAt: now } },
        upsert: true,
      },
    });
    applied.push({
      student: String(student),
      from: previous ? previous.score ?? null : null,
      to: score,
      commentChanged: (previous?.comment ?? '') !== nextComment,
    });
  });
  if (ops.length > 0) await Grade.bulkWrite(ops, { ordered: false });

  const result = await buildSheet(assessment);
  if (applied.length > 0) {
    const json = result.assessment;
    const scoreChanges = applied.filter(({ from, to }) => from !== to);
    await recordAssessment(
      req,
      'grades.update',
      json,
      `Grades of ${describeAssessment(json)}: ${applied.length} change(s)${json.published ? ' after publication' : ''}`,
      {
        changed: applied.length,
        scoresChanged: scoreChanges.length,
        commentsChanged: applied.filter(({ commentChanged }) => commentChanged).length,
        // Score changes first (comment-only changes keep from === to).
        changes: [...scoreChanges, ...applied.filter(({ from, to }) => from === to)]
          .slice(0, MAX_AUDITED_CHANGES)
          .map(({ student, from, to }) => ({ student, from, to })),
      }
    );
  }
  res.status(200).json({ ...result, changed: ops.length });
};

// ---------- GET /me (STUDENT) ----------

// { items, bySubject: [{ subject, average, assessments }], overall, trend } — published assessments only.
const getMine = async (req, res) => {
  res.status(200).json(await gradeService.studentGrades(req.user));
};

module.exports = {
  listTeaching,
  listAssessments,
  createAssessment,
  getAssessment,
  updateAssessment,
  deleteAssessment,
  publishAssessment,
  getGrades,
  saveGrades,
  getMine,
};
