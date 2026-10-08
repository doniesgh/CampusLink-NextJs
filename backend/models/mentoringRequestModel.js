const mongoose = require('mongoose');
const { idOf, isPopulated } = require('../utils/serialize');

const Schema = mongoose.Schema;

/*
 * Module 6 (alumni network), phase 3 contract section 4: a STUDENT asks an ALUMNI for mentoring.
 * PENDING → ACCEPTED | DECLINED (mentor), PENDING | ACCEPTED → CLOSED (either side, or SYSTEM when one side
 * erases their data). The e-mail addresses are only shared while the request is ACCEPTED (`contact`).
 *
 * Limits enforced by unique partial indexes (no transactions needed):
 *  - one PENDING request per (mentee, mentor) pair;
 *  - at most MAX_PENDING_PER_STUDENT PENDING requests per student: each PENDING request holds one numbered
 *    `pendingSlot` (1..3), unique per mentee among PENDING requests.
 */
const STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CLOSED'];
const CLOSED_BY = ['MENTOR', 'MENTEE', 'SYSTEM'];
const TOPIC_MIN_LENGTH = 2;
const TOPIC_MAX_LENGTH = 120;
const MESSAGE_MIN_LENGTH = 20;
const MESSAGE_MAX_LENGTH = 1000;
const REPLY_MAX_LENGTH = 1000;
const MAX_PENDING_PER_STUDENT = 3;

const nameSnapshotSchema = new Schema(
  {
    firstname: { type: String, default: '' },
    lastname: { type: String, default: '' },
  },
  { _id: false }
);

const requestSchema = new Schema(
  {
    // null once the mentor erased their alumni data (right to be forgotten).
    mentor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    mentee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Names when the request was made, used when an account no longer exists (cleared for an erased mentor).
    mentorSnapshot: { type: nameSnapshotSchema, default: () => ({}) },
    menteeSnapshot: { type: nameSnapshotSchema, default: () => ({}) },
    topic: { type: String, required: true, trim: true, minlength: TOPIC_MIN_LENGTH, maxlength: TOPIC_MAX_LENGTH },
    // Plain text with line breaks; clients never render it as HTML. Required on creation (checked by the controller),
    // null once the mentee erased their data.
    message: { type: String, minlength: MESSAGE_MIN_LENGTH, maxlength: MESSAGE_MAX_LENGTH, default: null },
    // Optional answer of the mentor (accept / decline).
    reply: { type: String, maxlength: REPLY_MAX_LENGTH, default: null },
    status: { type: String, enum: STATUSES, default: 'PENDING' },
    // 1..MAX_PENDING_PER_STUDENT while PENDING (see the unique index below), null afterwards.
    pendingSlot: { type: Number, min: 1, max: MAX_PENDING_PER_STUDENT, default: null },
    respondedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: String, enum: [...CLOSED_BY, null], default: null },
    // Set when a side erased their alumni data (right to be forgotten): that side's id, names and text are gone.
    mentorErasedAt: { type: Date, default: null },
    menteeErasedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      // Without the viewer (no contact). The API uses serializeRequest(doc, viewer) instead.
      transform: (doc) => serializeRequest(doc),
    },
  }
);

requestSchema.index(
  { mentee: 1, mentor: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' }, name: 'mentoring_pending_pair' }
);
requestSchema.index(
  { mentee: 1, pendingSlot: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' }, name: 'mentoring_pending_slot' }
);
requestSchema.index({ mentor: 1, status: 1, createdAt: -1 });
requestSchema.index({ mentee: 1, status: 1, createdAt: -1 });

// Names and e-mails of both sides; e-mails are only serialized in `contact` (ACCEPTED, participants).
const REQUEST_POPULATE = [
  { path: 'mentor', select: 'firstname lastname email role' },
  { path: 'mentee', select: 'firstname lastname email role' },
];

// { id, firstname, lastname } from the populated user, else from the snapshot; null when there is nobody.
function summarizeParty(value, snapshot) {
  const id = idOf(value);
  if (!id) return null;
  if (isPopulated(value)) return { id, firstname: value.firstname ?? '', lastname: value.lastname ?? '' };
  return { id, firstname: snapshot?.firstname ?? '', lastname: snapshot?.lastname ?? '' };
}

/**
 * MentoringRequest JSON:
 * { id, mentor: { id, firstname, lastname, profileId } | null, mentee: { id, firstname, lastname } | null, topic,
 *   message, reply, status, contact: { mentorEmail, menteeEmail } | null, createdAt, updatedAt, respondedAt,
 *   closedAt, closedBy }
 * `mentor` / `mentee` is null when that person erased their alumni data.
 *
 * @param {object} doc         document or lean object (mentor / mentee populated with their e-mail)
 * @param {object} [options]
 * @param {boolean} [options.withContact]  the viewer is a participant: share both e-mails while ACCEPTED
 * @param {string|null} [options.mentorProfileId]  id of the mentor's profile when the viewer may open it
 */
function serializeRequest(doc, { withContact = false, mentorProfileId = null } = {}) {
  const mentor = summarizeParty(doc.mentor, doc.mentorSnapshot);
  const mentee = summarizeParty(doc.mentee, doc.menteeSnapshot);
  const status = doc.status;
  let contact = null;
  if (withContact && status === 'ACCEPTED' && isPopulated(doc.mentor) && isPopulated(doc.mentee)) {
    contact = { mentorEmail: doc.mentor.email ?? null, menteeEmail: doc.mentee.email ?? null };
  }
  return {
    id: String(doc._id),
    mentor: mentor ? { ...mentor, profileId: mentorProfileId ? String(mentorProfileId) : null } : null,
    mentee,
    topic: doc.topic,
    message: doc.message ?? null,
    reply: doc.reply ?? null,
    status,
    contact,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? doc.createdAt,
    respondedAt: doc.respondedAt ?? null,
    closedAt: doc.closedAt ?? null,
    closedBy: doc.closedBy ?? null,
  };
}

const MentoringRequest = mongoose.model('MentoringRequest', requestSchema);

module.exports = MentoringRequest;
module.exports.STATUSES = STATUSES;
module.exports.CLOSED_BY = CLOSED_BY;
module.exports.TOPIC_MIN_LENGTH = TOPIC_MIN_LENGTH;
module.exports.TOPIC_MAX_LENGTH = TOPIC_MAX_LENGTH;
module.exports.MESSAGE_MIN_LENGTH = MESSAGE_MIN_LENGTH;
module.exports.MESSAGE_MAX_LENGTH = MESSAGE_MAX_LENGTH;
module.exports.REPLY_MAX_LENGTH = REPLY_MAX_LENGTH;
module.exports.MAX_PENDING_PER_STUDENT = MAX_PENDING_PER_STUDENT;
module.exports.REQUEST_POPULATE = REQUEST_POPULATE;
module.exports.serializeRequest = serializeRequest;
