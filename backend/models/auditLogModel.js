const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// One entry per sensitive action (see service/auditService.js). The actor is snapshotted,
// so an entry stays readable after the account is renamed or deleted.
const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorSnapshot: {
      firstname: String,
      lastname: String,
      email: String,
      role: String,
    },
    // e.g. "user.update", "academic.group.delete", "timetable.session.cancel".
    action: { type: String, required: true, trim: true, maxlength: 100, index: true },
    // Model name of the target ("User", "Group", "ClassSession", ...) and its id.
    targetType: { type: String, trim: true, maxlength: 50, default: null },
    targetId: { type: String, trim: true, maxlength: 100, default: null },
    summary: { type: String, trim: true, maxlength: 500, default: '' },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
    toJSON: {
      // { id, actor: { id, firstname, lastname, email, role } | null, action, targetType, targetId,
      //   summary, metadata, ip, userAgent, createdAt }
      transform: (doc, ret) => ({
        id: String(ret._id),
        actor: ret.actor
          ? {
              id: String(ret.actor),
              firstname: ret.actorSnapshot?.firstname ?? null,
              lastname: ret.actorSnapshot?.lastname ?? null,
              email: ret.actorSnapshot?.email ?? null,
              role: ret.actorSnapshot?.role ?? null,
            }
          : null,
        action: ret.action,
        targetType: ret.targetType ?? null,
        targetId: ret.targetId ?? null,
        summary: ret.summary || '',
        metadata: ret.metadata ?? {},
        ip: ret.ip ?? null,
        userAgent: ret.userAgent ?? null,
        createdAt: ret.createdAt,
      }),
    },
  }
);

auditLogSchema.index({ createdAt: -1, _id: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
