const mongoose = require('mongoose');
const { parse } = require('csv-parse/sync');
const ClassSession = require('../models/classSessionModel');
const Subject = require('../models/subjectModel');
const Group = require('../models/groupModel');
const Room = require('../models/roomModel');
const User = require('../models/userModel');
const time = require('../utils/time');
const { normalizeEmail } = require('../utils/validation');
const timetableService = require('./timetableService');

/*
 * CSV import of class sessions (contract section 6). UTF-8, "," or ";" separator (detected on the
 * header line), one session per row:
 *   date (YYYY-MM-DD), start (HH:mm), end (HH:mm), subject_code, teacher_email,
 *   groups (names separated by "|"), room (optional), type (optional, default LECTURE), notes (optional)
 * Times are campus wall-clock times (APP_TIMEZONE). All-or-nothing: analyzeImport() only reads,
 * the controller writes the sessions when there is no error and no conflict.
 *
 * Error entries: { line, code, message, column? }. `line` is the line number in the file (header =
 * line 1), or null for a problem with the whole file. Codes:
 *   INVALID_ENCODING, CSV_PARSE_ERROR, EMPTY_FILE, TOO_MANY_ROWS, MISSING_COLUMNS, UNKNOWN_COLUMNS,
 *   DUPLICATE_COLUMNS, TOO_MANY_VALUES, MISSING_VALUE, INVALID_DATE, INVALID_TIME, INVALID_TIME_RANGE,
 *   UNKNOWN_SUBJECT, UNKNOWN_TEACHER, NOT_A_TEACHER, UNKNOWN_GROUP, TOO_MANY_GROUPS, UNKNOWN_ROOM,
 *   INVALID_TYPE, NOTES_TOO_LONG.
 * Conflict entries: { line, sessionId, reason, startsAt, endsAt } for an existing session, or
 *   { line, sessionId: null, otherLine, reason } between two rows of the file.
 */

const REQUIRED_COLUMNS = ['date', 'start', 'end', 'subject_code', 'teacher_email', 'groups'];
const OPTIONAL_COLUMNS = ['room', 'type', 'notes'];
const KNOWN_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];
const MAX_ROWS = 2000;
const MAX_FILE_MB = 2;
// Keeps the 422 response small; `details.truncated` is true when entries were left out.
const MAX_REPORTED = 500;

const lower = (value) => String(value).toLocaleLowerCase('en');

// ";" when the header line has more semicolons than commas, else ",".
const detectDelimiter = (text) => {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] || '';
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons > commas ? ';' : ',';
};

const decode = (buffer) => {
  try {
    // fatal: invalid UTF-8 (e.g. a Windows-1252 export) is reported instead of garbled names.
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
};

// Groups the lookups of every row in one query per collection.
const loadReferences = async (rows) => {
  const subjectCodes = new Set();
  const emails = new Set();
  const groupNames = new Set();
  const roomNames = new Set();
  rows.forEach(({ values }) => {
    if (values.subject_code) subjectCodes.add(values.subject_code.toUpperCase());
    if (values.teacher_email) emails.add(normalizeEmail(values.teacher_email));
    (values.groups || '')
      .split('|')
      .map((name) => name.trim())
      .filter(Boolean)
      .forEach((name) => groupNames.add(name));
    if (values.room) roomNames.add(values.room);
  });

  const [subjects, teachers, groups, rooms] = await Promise.all([
    Subject.find({ code: { $in: [...subjectCodes] } }).select('name code').lean(),
    User.find({ email: { $in: [...emails] } })
      .select('email role firstname lastname')
      .setOptions({ populateGroup: false })
      .lean(),
    Group.find({ name: { $in: [...groupNames] } })
      .collation(Group.NAME_COLLATION)
      .select('name academicYear')
      .lean(),
    Room.find({ name: { $in: [...roomNames] } })
      .collation(Room.NAME_COLLATION)
      .select('name')
      .lean(),
  ]);

  const groupsByName = new Map();
  groups.forEach((group) => {
    const key = lower(group.name);
    if (!groupsByName.has(key)) groupsByName.set(key, []);
    groupsByName.get(key).push(group);
  });
  return {
    subjects: new Map(subjects.map((subject) => [subject.code, subject])),
    teachers: new Map(teachers.map((user) => [user.email, user])),
    groupsByName,
    rooms: new Map(rooms.map((room) => [lower(room.name), room])),
  };
};

// Group of that name for the academic year of the session, else the only group with that name.
const resolveGroup = (groupsByName, name, academicYear) => {
  const candidates = groupsByName.get(lower(name)) || [];
  return candidates.find((group) => group.academicYear === academicYear) || (candidates.length === 1 ? candidates[0] : null);
};

// Validates one row. Returns { doc } or pushes errors.
const validateRow = (row, refs, errors) => {
  const { line, values } = row;
  const rowErrors = [];
  const fail = (code, message, column) => rowErrors.push({ line, code, message, ...(column ? { column } : {}) });

  REQUIRED_COLUMNS.forEach((column) => {
    if (!values[column]) fail('MISSING_VALUE', `Missing value for "${column}"`, column);
  });

  let startsAt;
  let endsAt;
  const date = values.date ? time.parseDateOnly(values.date) : null;
  if (values.date && !date) fail('INVALID_DATE', `Invalid date "${values.date}" (expected YYYY-MM-DD)`, 'date');
  const start = values.start ? time.parseTimeOnly(values.start) : null;
  const end = values.end ? time.parseTimeOnly(values.end) : null;
  if (values.start && !start) fail('INVALID_TIME', `Invalid start time "${values.start}" (expected HH:mm)`, 'start');
  if (values.end && !end) fail('INVALID_TIME', `Invalid end time "${values.end}" (expected HH:mm)`, 'end');
  if (date && start && end) {
    startsAt = time.parseLocalDateTime(values.date, values.start);
    endsAt = time.parseLocalDateTime(values.date, values.end);
    const problem = timetableService.checkSessionTimes(startsAt, endsAt);
    if (problem) {
      fail('INVALID_TIME_RANGE', problem.replace('endsAt', 'end').replace('startsAt', 'start'), 'end');
    }
  }

  let subject;
  if (values.subject_code) {
    subject = refs.subjects.get(values.subject_code.toUpperCase());
    if (!subject) fail('UNKNOWN_SUBJECT', `Unknown subject code "${values.subject_code}"`, 'subject_code');
  }

  let teacher;
  if (values.teacher_email) {
    teacher = refs.teachers.get(normalizeEmail(values.teacher_email));
    if (!teacher) fail('UNKNOWN_TEACHER', `No account with the email "${values.teacher_email}"`, 'teacher_email');
    else if (teacher.role !== 'TEACHER') {
      fail('NOT_A_TEACHER', `"${values.teacher_email}" is not a teacher account`, 'teacher_email');
      teacher = undefined;
    }
  }

  const groups = [];
  if (values.groups) {
    const names = [];
    const seen = new Set();
    values.groups
      .split('|')
      .map((name) => name.trim())
      .filter(Boolean)
      .forEach((name) => {
        if (!seen.has(lower(name))) {
          seen.add(lower(name));
          names.push(name);
        }
      });
    if (names.length === 0) fail('MISSING_VALUE', 'Missing value for "groups"', 'groups');
    if (names.length > ClassSession.MAX_GROUPS) {
      fail('TOO_MANY_GROUPS', `A session has at most ${ClassSession.MAX_GROUPS} groups`, 'groups');
    }
    const academicYear = startsAt ? time.currentAcademicYear(startsAt) : time.currentAcademicYear();
    names.forEach((name) => {
      const group = resolveGroup(refs.groupsByName, name, academicYear);
      if (!group) fail('UNKNOWN_GROUP', `Unknown group "${name}"`, 'groups');
      else groups.push(group._id);
    });
  }

  let room = null;
  if (values.room) {
    room = refs.rooms.get(lower(values.room)) || null;
    if (!room) fail('UNKNOWN_ROOM', `Unknown room "${values.room}"`, 'room');
  }

  let type = 'LECTURE';
  if (values.type) {
    type = values.type.toUpperCase();
    if (!ClassSession.SESSION_TYPES.includes(type)) {
      fail('INVALID_TYPE', `Type must be one of ${ClassSession.SESSION_TYPES.join(', ')}`, 'type');
    }
  }

  const notes = values.notes || '';
  if (notes.length > ClassSession.NOTES_MAX_LENGTH) {
    fail('NOTES_TOO_LONG', `Notes must be at most ${ClassSession.NOTES_MAX_LENGTH} characters`, 'notes');
  }

  if (rowErrors.length > 0) {
    errors.push(...rowErrors);
    return null;
  }
  return {
    line,
    doc: {
      _id: new mongoose.Types.ObjectId(),
      subject: subject._id,
      teacher: teacher._id,
      groups,
      room: room ? room._id : null,
      startsAt,
      endsAt,
      type,
      status: 'SCHEDULED',
      notes,
      seriesId: null,
      change: null,
      source: 'IMPORT',
    },
  };
};

// First line of a record. csv-parse reports the line where the record ends; values spanning
// several lines (quoted line breaks) are counted back.
const recordLine = ({ record, info }) =>
  info.lines - record.reduce((count, cell) => count + (String(cell).match(/\n/g) || []).length, 0);

// Reads the CSV text into { header, rows: [{ line, values }] } or pushes file-level errors.
const readCsv = (rawText, errors) => {
  // One line ending style: csv-parse counts "\r\n" inside quoted values as two lines.
  const text = rawText.replace(/\r\n?/g, '\n');
  let records;
  try {
    records = parse(text, {
      delimiter: detectDelimiter(text),
      bom: true,
      info: true,
      trim: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
      relax_column_count: true,
      max_record_size: 64 * 1024,
    });
  } catch (error) {
    errors.push({
      line: Number.isInteger(error.lines) ? error.lines : null,
      code: 'CSV_PARSE_ERROR',
      message: `The file is not valid CSV: ${error.message}`,
    });
    return null;
  }
  if (records.length === 0) {
    errors.push({ line: null, code: 'EMPTY_FILE', message: 'The file is empty' });
    return null;
  }

  const [headerRecord, ...dataRecords] = records;
  const headerLine = recordLine(headerRecord);
  const header = headerRecord.record.map((name) => lower(name.trim()));
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  const unknown = header.filter((column) => column && !KNOWN_COLUMNS.includes(column));
  const duplicates = header.filter((column, index) => column && header.indexOf(column) !== index);
  if (missing.length > 0) {
    errors.push({ line: headerLine, code: 'MISSING_COLUMNS', message: `Missing columns: ${missing.join(', ')}` });
  }
  if (unknown.length > 0) {
    errors.push({
      line: headerLine,
      code: 'UNKNOWN_COLUMNS',
      message: `Unknown columns: ${unknown.join(', ')} (allowed: ${KNOWN_COLUMNS.join(', ')})`,
    });
  }
  if (duplicates.length > 0) {
    errors.push({ line: headerLine, code: 'DUPLICATE_COLUMNS', message: `Duplicate columns: ${[...new Set(duplicates)].join(', ')}` });
  }
  if (errors.length > 0) return null;

  if (dataRecords.length === 0) {
    errors.push({ line: null, code: 'EMPTY_FILE', message: 'The file has no session rows' });
    return null;
  }
  if (dataRecords.length > MAX_ROWS) {
    errors.push({
      line: recordLine(dataRecords[MAX_ROWS]),
      code: 'TOO_MANY_ROWS',
      message: `A file can hold at most ${MAX_ROWS} sessions (it has ${dataRecords.length})`,
    });
    return null;
  }

  const rows = dataRecords.map((entry) => {
    const { record } = entry;
    const values = {};
    header.forEach((column, index) => {
      values[column] = record[index] === undefined ? '' : String(record[index]).trim();
    });
    const extra = record.slice(header.length).some((cell) => String(cell).trim() !== '');
    return { line: recordLine(entry), values, extra };
  });
  return { header, rows };
};

/**
 * Reads and checks an import file without writing anything.
 * @param {Buffer} buffer  the uploaded file
 * @returns {Promise<{ rows: number, errors: Array, conflicts: Array, docs: Array, truncated: boolean }>}
 *          docs: ClassSession values ready for insertMany (only meaningful without errors/conflicts)
 */
const analyzeImport = async (buffer) => {
  const errors = [];
  const conflicts = [];
  const text = decode(buffer);
  if (text === null) {
    errors.push({ line: null, code: 'INVALID_ENCODING', message: 'The file must be encoded in UTF-8' });
    return { rows: 0, errors, conflicts, docs: [], truncated: false };
  }

  const csv = readCsv(text, errors);
  if (!csv) return { rows: 0, errors, conflicts, docs: [], truncated: false };

  const refs = await loadReferences(csv.rows);
  const valid = [];
  csv.rows.forEach((row) => {
    if (row.extra) {
      errors.push({
        line: row.line,
        code: 'TOO_MANY_VALUES',
        message: 'This row has more values than the header (quote values that contain the separator)',
      });
      return;
    }
    const result = validateRow(row, refs, errors);
    if (result) valid.push(result);
  });

  // Conflicts of the valid rows with existing sessions, then between rows of the file.
  const candidates = valid.map(({ line, doc }) => ({ key: line, ...doc }));
  const existing = await timetableService.findConflicts(candidates);
  existing.forEach((conflict) => {
    const { sessionId, startsAt, endsAt, reason, subject } = timetableService.describeConflict(conflict);
    conflicts.push({ line: conflict.key, sessionId, reason, startsAt, endsAt, subject });
  });
  timetableService.findInternalConflicts(candidates).forEach(({ key, otherKey, reason }) => {
    conflicts.push({ line: key, sessionId: null, otherLine: otherKey, reason });
  });

  const byLine = (a, b) => (a.line ?? 0) - (b.line ?? 0);
  errors.sort(byLine);
  conflicts.sort(byLine);
  const truncated = errors.length > MAX_REPORTED || conflicts.length > MAX_REPORTED;
  return {
    rows: csv.rows.length,
    errors: errors.slice(0, MAX_REPORTED),
    conflicts: conflicts.slice(0, MAX_REPORTED),
    docs: valid.map(({ doc }) => doc),
    truncated,
  };
};

module.exports = { analyzeImport, detectDelimiter, REQUIRED_COLUMNS, OPTIONAL_COLUMNS, MAX_ROWS, MAX_FILE_MB };
