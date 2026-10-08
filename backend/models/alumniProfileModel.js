const mongoose = require('mongoose');
const { idOf, isPopulated } = require('../utils/serialize');
const { summarizeProgram } = require('./programModel');

const Schema = mongoose.Schema;

/*
 * Module 6 (alumni directory and network), phase 3 contract section 4: the public profile of an ALUMNI account.
 * GDPR: PRIVATE by default; visible to other users only with visibility CAMPUS and an explicit consent (consentAt).
 * The e-mail address is never part of a profile (it lives on the User and is only shared through an accepted
 * mentoring request).
 */
const VISIBILITIES = ['PRIVATE', 'CAMPUS'];
const PROMOTION_MIN = 1950;
const HEADLINE_MAX_LENGTH = 120;
const BIO_MAX_LENGTH = 2000;
const COMPANY_MAX_LENGTH = 120;
const JOB_TITLE_MAX_LENGTH = 120;
const SECTOR_MAX_LENGTH = 80;
const CITY_MAX_LENGTH = 80;
const LINKEDIN_URL_MAX_LENGTH = 300;
const MAX_SKILLS = 20;
const SKILL_MAX_LENGTH = 40;
const MAX_MENTORING_TOPICS = 10;
const MENTORING_TOPIC_MIN_LENGTH = 2;
const MENTORING_TOPIC_MAX_LENGTH = 60;

/**
 * Search key of a label: lowercase, without diacritics, whitespace collapsed ("  Data & IA " → "data & ia",
 * "Sécurité" → "securite"). Used for the exact `sector` / `skill` filters of the directory.
 */
const normalizeKey = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const profileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    program: { type: Schema.Types.ObjectId, ref: 'Program', default: null },
    // Graduation year.
    promotion: {
      type: Number,
      min: PROMOTION_MIN,
      default: null,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: 'promotion must be an integer',
      },
    },
    headline: { type: String, trim: true, maxlength: HEADLINE_MAX_LENGTH, default: null },
    // Plain text with line breaks; clients never render it as HTML.
    bio: { type: String, maxlength: BIO_MAX_LENGTH, default: null },
    skills: {
      type: [{ type: String, trim: true, maxlength: SKILL_MAX_LENGTH }],
      default: [],
      validate: { validator: (list) => list.length <= MAX_SKILLS, message: `At most ${MAX_SKILLS} skills` },
    },
    company: { type: String, trim: true, maxlength: COMPANY_MAX_LENGTH, default: null },
    jobTitle: { type: String, trim: true, maxlength: JOB_TITLE_MAX_LENGTH, default: null },
    sector: { type: String, trim: true, maxlength: SECTOR_MAX_LENGTH, default: null },
    city: { type: String, trim: true, maxlength: CITY_MAX_LENGTH, default: null },
    linkedinUrl: { type: String, trim: true, maxlength: LINKEDIN_URL_MAX_LENGTH, default: null },
    mentoringAvailable: { type: Boolean, default: false },
    mentoringTopics: {
      type: [{ type: String, trim: true, maxlength: MENTORING_TOPIC_MAX_LENGTH }],
      default: [],
      validate: {
        validator: (list) => list.length <= MAX_MENTORING_TOPICS,
        message: `At most ${MAX_MENTORING_TOPICS} mentoring topics`,
      },
    },
    visibility: { type: String, enum: VISIBILITIES, default: 'PRIVATE' },
    // Explicit consent to be listed in the campus directory; null = no consent (always null when PRIVATE).
    consentAt: { type: Date, default: null },
    // Search keys (normalizeKey) of `sector` and `skills`, kept in sync by the pre-validate hook. Never serialized.
    sectorKey: { type: String, default: null },
    skillKeys: { type: [String], default: [] },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      transform: (doc) => serializeProfile(doc),
    },
  }
);

profileSchema.pre('validate', function () {
  this.sectorKey = this.sector ? normalizeKey(this.sector) || null : null;
  this.skillKeys = [...new Set((this.skills ?? []).map(normalizeKey).filter(Boolean))];
});

// One profile per account.
profileSchema.index({ user: 1 }, { unique: true });
// Directory: listed profiles (CAMPUS + consent) and their filters.
profileSchema.index({ visibility: 1, consentAt: 1, updatedAt: -1 });
profileSchema.index({ program: 1, promotion: 1 });
profileSchema.index({ sectorKey: 1 });
profileSchema.index({ skillKeys: 1 });
profileSchema.index({ mentoringAvailable: 1 });

const PROFILE_POPULATE = [
  // The projection leaves `group` out, so the User find hook does not populate it.
  { path: 'user', select: 'firstname lastname role' },
  { path: 'program', select: 'name code' },
];

// { id, firstname, lastname } of the populated owner (never the e-mail).
function summarizeOwner(user) {
  const id = idOf(user);
  if (!id) return null;
  if (!isPopulated(user)) return { id, firstname: null, lastname: null };
  return { id, firstname: user.firstname ?? null, lastname: user.lastname ?? null };
}

/**
 * AlumniProfile JSON (contract section 4), from a document or a lean object with `user` and `program` populated:
 * { id, user: { id, firstname, lastname }, program: { id, name, code } | null, promotion, headline, bio, skills,
 *   company, jobTitle, sector, city, linkedinUrl, mentoringAvailable, mentoringTopics, visibility, consentAt,
 *   updatedAt }
 * `user` may be passed separately (aggregation results).
 */
function serializeProfile(doc, { user } = {}) {
  const owner = user ?? doc.user;
  const program = doc.program;
  return {
    id: doc._id ? String(doc._id) : null,
    user: summarizeOwner(owner),
    program: isPopulated(program) ? summarizeProgram(program) : null,
    promotion: doc.promotion ?? null,
    headline: doc.headline ?? null,
    bio: doc.bio ?? null,
    skills: [...(doc.skills ?? [])],
    company: doc.company ?? null,
    jobTitle: doc.jobTitle ?? null,
    sector: doc.sector ?? null,
    city: doc.city ?? null,
    linkedinUrl: doc.linkedinUrl ?? null,
    mentoringAvailable: Boolean(doc.mentoringAvailable),
    mentoringTopics: [...(doc.mentoringTopics ?? [])],
    visibility: VISIBILITIES.includes(doc.visibility) ? doc.visibility : 'PRIVATE',
    consentAt: doc.consentAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

// MongoDB filter of the profiles other users may see (the owner's role is checked separately: ALUMNI only).
const LISTED_FILTER = Object.freeze({ visibility: 'CAMPUS', consentAt: { $ne: null } });

const isListed = (profile) => Boolean(profile) && profile.visibility === 'CAMPUS' && Boolean(profile.consentAt);

const AlumniProfile = mongoose.model('AlumniProfile', profileSchema);

module.exports = AlumniProfile;
module.exports.VISIBILITIES = VISIBILITIES;
module.exports.PROMOTION_MIN = PROMOTION_MIN;
module.exports.HEADLINE_MAX_LENGTH = HEADLINE_MAX_LENGTH;
module.exports.BIO_MAX_LENGTH = BIO_MAX_LENGTH;
module.exports.COMPANY_MAX_LENGTH = COMPANY_MAX_LENGTH;
module.exports.JOB_TITLE_MAX_LENGTH = JOB_TITLE_MAX_LENGTH;
module.exports.SECTOR_MAX_LENGTH = SECTOR_MAX_LENGTH;
module.exports.CITY_MAX_LENGTH = CITY_MAX_LENGTH;
module.exports.LINKEDIN_URL_MAX_LENGTH = LINKEDIN_URL_MAX_LENGTH;
module.exports.MAX_SKILLS = MAX_SKILLS;
module.exports.SKILL_MAX_LENGTH = SKILL_MAX_LENGTH;
module.exports.MAX_MENTORING_TOPICS = MAX_MENTORING_TOPICS;
module.exports.MENTORING_TOPIC_MIN_LENGTH = MENTORING_TOPIC_MIN_LENGTH;
module.exports.MENTORING_TOPIC_MAX_LENGTH = MENTORING_TOPIC_MAX_LENGTH;
module.exports.PROFILE_POPULATE = PROFILE_POPULATE;
module.exports.LISTED_FILTER = LISTED_FILTER;
module.exports.normalizeKey = normalizeKey;
module.exports.isListed = isListed;
module.exports.serializeProfile = serializeProfile;
module.exports.summarizeOwner = summarizeOwner;
