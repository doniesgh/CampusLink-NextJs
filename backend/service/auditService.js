const mongoose = require('mongoose');
const AuditLog = require('../models/auditLogModel');
const { redact } = require('../middleware/logger');
const { idOf } = require('../utils/serialize');

const USER_AGENT_MAX_LENGTH = 512;
const METADATA_MAX_LENGTH = 8000;

// Keeps metadata small and free of secrets (passwords, tokens, push keys... are redacted).
const sanitizeMetadata = (metadata) => {
  if (metadata === undefined || metadata === null) return {};
  // JSON round trip first: ObjectIds become strings, Dates ISO strings, functions disappear.
  let value = redact(JSON.parse(JSON.stringify(metadata)));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) value = { value };
  if (JSON.stringify(value).length > METADATA_MAX_LENGTH) {
    return { truncated: true, keys: Object.keys(value).slice(0, 50) };
  }
  return value;
};

const clientIp = (req) => (req ? req.ip || req.socket?.remoteAddress || null : null);
const clientUserAgent = (req) =>
  req ? String(req.get?.('user-agent') ?? req.headers?.['user-agent'] ?? '').slice(0, USER_AGENT_MAX_LENGTH) || null : null;

/**
 * Records an audit log entry. Never throws (a failure is logged), so callers can simply `await` it
 * (or not) after the action succeeded.
 *
 * @param {import('express').Request | null} req  actor = req.user, IP = req.ip (trust proxy), User-Agent header
 * @param {object} entry
 * @param {string} entry.action        e.g. "academic.group.create"
 * @param {string} [entry.targetType]  model name: "User", "Group", "ClassSession", ...
 * @param {string|ObjectId} [entry.targetId]
 * @param {string} [entry.summary]     short human-readable English sentence
 * @param {object} [entry.metadata]    details (secrets are redacted)
 * @param {object|null} [entry.actor]  overrides req.user (e.g. the account of a password reset)
 * @returns {Promise<AuditLog|null>}
 */
const record = async (req, { action, targetType = null, targetId = null, summary = '', metadata = {}, actor } = {}) => {
  try {
    if (!action) throw new Error('auditService.record: missing action');
    const who = actor === undefined ? req?.user ?? null : actor;
    const actorId = who ? idOf(who) : null;

    return await AuditLog.create({
      actor: actorId && mongoose.isObjectIdOrHexString(actorId) ? actorId : null,
      actorSnapshot: who
        ? { firstname: who.firstname, lastname: who.lastname, email: who.email, role: who.role }
        : undefined,
      action,
      targetType,
      targetId: targetId === null || targetId === undefined ? null : String(idOf(targetId) ?? targetId),
      summary: String(summary || '').slice(0, 500),
      metadata: sanitizeMetadata(metadata),
      ip: clientIp(req),
      userAgent: clientUserAgent(req),
    });
  } catch (error) {
    console.error(`[audit] Could not record "${action}":`, error.message);
    return null;
  }
};

module.exports = { record, sanitizeMetadata };
