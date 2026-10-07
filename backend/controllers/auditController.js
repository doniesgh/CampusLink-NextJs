const AuditLog = require('../models/auditLogModel');
const { throwIfInvalid, parsePagination, readObjectId, readDate, escapeRegex } = require('../utils/validation');
const { parseDateOnly, parseLocalDateTime, addDaysToDateString } = require('../utils/time');

const present = (value) => value !== undefined && String(value).trim() !== '';

// `from` / `to` bounds: an ISO date-time, or a day "YYYY-MM-DD" in the campus timezone
// (from = start of that day; to = end of that day, inclusive).
const readBound = (value, field, details) => {
  if (parseDateOnly(value)) {
    return parseLocalDateTime(field === 'to' ? addDaysToDateString(value, 1) : value, '00:00');
  }
  const date = readDate(value, field, details);
  return date && field === 'to' ? new Date(date.getTime() + 1) : date;
};

// Filter of GET /api/audit. `action` is an exact match, or a prefix when it ends with "*" ("academic.*").
const buildFilter = (query) => {
  const filter = {};
  const details = {};

  if (present(query.action)) {
    const action = String(query.action).trim().slice(0, 100);
    filter.action = action.endsWith('*') ? { $regex: `^${escapeRegex(action.slice(0, -1))}` } : action;
  }
  if (present(query.actor)) {
    const actor = readObjectId(String(query.actor), 'actor', details);
    if (actor) filter.actor = actor;
  }
  if (present(query.targetType)) filter.targetType = String(query.targetType).trim().slice(0, 50);
  if (present(query.targetId)) filter.targetId = String(query.targetId).trim().slice(0, 100);

  const from = present(query.from) ? readBound(String(query.from).trim(), 'from', details) : undefined;
  const to = present(query.to) ? readBound(String(query.to).trim(), 'to', details) : undefined;
  throwIfInvalid(details);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = to;
  }

  return filter;
};

// GET /api/audit?action=&actor=&targetType=&targetId=&from=&to=&page&limit [admin] → newest first.
const listAuditLogs = async (req, res) => {
  const filter = buildFilter(req.query);
  const { page, limit, skip } = parsePagination(req.query);

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ]);

  res.status(200).json({ items, total, page, limit });
};

// GET /api/audit/actions [admin] → sorted list of the actions present in the log (for filters).
const listAuditActions = async (req, res) => {
  const actions = await AuditLog.distinct('action');
  res.status(200).json(actions.toSorted((a, b) => a.localeCompare(b)));
};

module.exports = { listAuditLogs, listAuditActions };
