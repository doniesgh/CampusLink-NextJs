const time = require('../utils/time');
const { envString } = require('../utils/env');

/*
 * iCalendar (RFC 5545) export of class sessions. Times are written in UTC ("...Z"), so no
 * VTIMEZONE is needed; lines end with CRLF and are folded at 75 octets without splitting a
 * UTF-8 character; TEXT values are escaped (\\ \; \, \n). Cancelled sessions keep their event
 * with STATUS:CANCELLED so subscribed calendars update them instead of keeping a stale copy.
 */

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;
const PRODID = '-//CampusLink//Timetable 1.0//EN';

const TYPE_LABELS = {
  fr: { LECTURE: 'Cours', TUTORIAL: 'TD', LAB: 'TP', EXAM: 'Examen', OTHER: 'Autre' },
  en: { LECTURE: 'Lecture', TUTORIAL: 'Tutorial', LAB: 'Lab', EXAM: 'Exam', OTHER: 'Other' },
};

const LABELS = {
  fr: {
    colon: ' : ', // French typography: space before the colon
    calendarName: 'CampusLink – Emploi du temps',
    calendarDescription: 'Ton emploi du temps CampusLink',
    cancelled: 'Annulé',
    teacher: 'Enseignant',
    groups: 'Groupes',
    type: 'Type',
    room: 'Salle',
    movedFrom: 'Salle changée, avant',
    previousTime: 'Horaire modifié, avant',
  },
  en: {
    colon: ': ',
    calendarName: 'CampusLink – Timetable',
    calendarDescription: 'Your CampusLink timetable',
    cancelled: 'Cancelled',
    teacher: 'Teacher',
    groups: 'Groups',
    type: 'Type',
    room: 'Room',
    movedFrom: 'Room changed, previously',
    previousTime: 'Time changed, previously',
  },
};

// Control characters are not allowed in TEXT values (line breaks are escaped separately).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// RFC 5545 §3.3.11 TEXT escaping.
const escapeText = (value) =>
  String(value ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

// 20261008T093000Z
const formatUtc = (date) =>
  new Date(date)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');

// RFC 5545 §3.1: lines longer than 75 octets are split, each continuation starts with one space.
const foldLine = (line) => {
  if (Buffer.byteLength(line, 'utf8') <= MAX_LINE_OCTETS) return line;
  const parts = [];
  let current = '';
  let octets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
      limit = MAX_LINE_OCTETS - 1; // the leading space counts
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
};

const property = (name, value) => foldLine(`${name}:${value}`);

const appUrl = () => envString('APP_URL', '').replace(/\/+$/, '');

const fullName = (person) => (person ? `${person.firstname ?? ''} ${person.lastname ?? ''}`.trim() : '');

const roomText = (room) => (room ? (room.building ? `${room.name} (${room.building})` : room.name) : '');

// Lines of one VEVENT. `session` is a populated lean session (SESSION_POPULATE).
const eventLines = (session, locale) => {
  const labels = LABELS[locale] || LABELS.fr;
  const typeLabel = (TYPE_LABELS[locale] || TYPE_LABELS.fr)[session.type] || session.type;
  const cancelled = session.status === 'CANCELLED';
  const subjectName = session.subject?.name || session.subject?.code || 'CampusLink';
  const summary = `${cancelled ? `[${labels.cancelled}] ` : ''}${subjectName} (${typeLabel})`;
  const groups = (session.groups || []).map((group) => group.name).filter(Boolean);

  const description = [];
  if (session.teacher) description.push(`${labels.teacher}${labels.colon}${fullName(session.teacher)}`);
  if (groups.length > 0) description.push(`${labels.groups}${labels.colon}${groups.join(', ')}`);
  description.push(`${labels.type}${labels.colon}${typeLabel}`);
  if (session.room) description.push(`${labels.room}${labels.colon}${roomText(session.room)}`);
  if (session.change?.kind !== 'CANCELLED' && session.change?.previousRoom?.name) {
    description.push(`${labels.movedFrom}${labels.colon}${session.change.previousRoom.name}`);
  }
  if (session.change?.kind === 'TIME' && session.change.previousStartsAt) {
    const previous = session.change.previousStartsAt;
    description.push(`${labels.previousTime}${labels.colon}${time.formatLocalDate(previous)} ${time.formatLocalTime(previous)}`);
  }
  if (session.notes) description.push('', session.notes);

  const lines = [
    'BEGIN:VEVENT',
    property('UID', `${session._id}@campuslink`),
    property('DTSTAMP', formatUtc(session.updatedAt || session.createdAt || new Date())),
    property('DTSTART', formatUtc(session.startsAt)),
    property('DTEND', formatUtc(session.endsAt)),
    property('SUMMARY', escapeText(summary)),
  ];
  if (session.room) lines.push(property('LOCATION', escapeText(roomText(session.room))));
  lines.push(property('DESCRIPTION', escapeText(description.join('\n'))));
  lines.push(property('CATEGORIES', escapeText(typeLabel)));
  lines.push(property('STATUS', cancelled ? 'CANCELLED' : 'CONFIRMED'));
  lines.push(property('TRANSP', cancelled ? 'TRANSPARENT' : 'OPAQUE'));
  lines.push(property('SEQUENCE', String(Math.max(0, Number(session.sequence) || 0))));
  if (session.createdAt) lines.push(property('CREATED', formatUtc(session.createdAt)));
  if (session.updatedAt) lines.push(property('LAST-MODIFIED', formatUtc(session.updatedAt)));
  if (appUrl()) {
    lines.push(property('URL', `${appUrl()}/dashboard/timetable?date=${time.formatLocalDate(session.startsAt)}`));
  }
  lines.push('END:VEVENT');
  return lines;
};

/**
 * Builds a VCALENDAR document (string with CRLF line endings).
 * @param {Array} sessions  populated lean sessions (SESSION_POPULATE), any order
 * @param {{ locale?: 'fr'|'en', name?: string }} [options]
 */
const buildCalendar = (sessions, { locale = 'fr', name } = {}) => {
  const labels = LABELS[locale] || LABELS.fr;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    property('PRODID', PRODID),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    property('X-WR-CALNAME', escapeText(name || labels.calendarName)),
    property('X-WR-CALDESC', escapeText(labels.calendarDescription)),
    property('X-WR-TIMEZONE', time.getAppTimezone()),
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  sessions.forEach((session) => lines.push(...eventLines(session, locale)));
  lines.push('END:VCALENDAR');
  return `${lines.join(CRLF)}${CRLF}`;
};

module.exports = { buildCalendar, escapeText, foldLine, formatUtc, TYPE_LABELS };
