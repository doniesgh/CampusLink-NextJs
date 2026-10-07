const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const HttpError = require('../utils/httpError');
const { PASSWORD_MIN_LENGTH, LOCALES, DEFAULT_LOCALE } = require('../utils/validation');
const { summarizeGroup } = require('./groupModel');

const Schema = mongoose.Schema;

const ROLES = ['STUDENT', 'TEACHER', 'ADMIN', 'ALUMNI'];
const NAME_MAX_LENGTH = 100;

// Compared against when the email is unknown, so a login attempt takes about the same
// time whether or not the account exists (no account enumeration through timing).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('campuslink-dummy-password', 10);

// How `group` is populated for the public JSON shape.
const GROUP_POPULATE = {
  path: 'group',
  select: 'name level academicYear program',
  populate: { path: 'program', select: 'name code' },
};

const userSchema = new Schema(
  {
    firstname: {
      type: String,
      required: true,
      trim: true,
      maxlength: [NAME_MAX_LENGTH, `First name must be at most ${NAME_MAX_LENGTH} characters`],
    },
    lastname: {
      type: String,
      required: true,
      trim: true,
      maxlength: [NAME_MAX_LENGTH, `Last name must be at most ${NAME_MAX_LENGTH} characters`],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: [validator.isEmail, 'Invalid email address'],
    },
    // Hashed in the pre-save hook below. Never update it with findByIdAndUpdate:
    // set it on the document and call save() so the hook runs.
    password: {
      type: String,
      required: true,
      minlength: [PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`],
      select: false,
    },
    role: {
      type: String,
      enum: { values: ROLES, message: `Role must be one of ${ROLES.join(', ')}` },
      default: 'STUDENT',
    },
    // Language of emails, notifications and the web UI.
    locale: {
      type: String,
      enum: { values: LOCALES, message: `Locale must be one of ${LOCALES.join(', ')}` },
      default: DEFAULT_LOCALE,
    },
    // Class group, for students only (enforced by the controllers).
    group: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
      index: true,
    },
    // Secret of the personal ICS feed URL, created by the timetable module. Remove it with
    // $unset (not null) so the partial unique index below ignores it.
    calendarToken: { type: String, select: false },
    // When enabled, login sends a one-time code by email before issuing tokens.
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    otpHash: { type: String, select: false },
    otpExpiresAt: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    passwordResetHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      // Public shape: { id, firstname, lastname, email, role, twoFactorEnabled, locale,
      //   group: { id, name, level, academicYear, program: { id, name, code } } | null, createdAt, updatedAt }
      transform: (doc, ret) => ({
        id: String(ret._id),
        firstname: ret.firstname,
        lastname: ret.lastname,
        email: ret.email,
        role: ret.role,
        twoFactorEnabled: Boolean(ret.twoFactorEnabled),
        locale: LOCALES.includes(ret.locale) ? ret.locale : DEFAULT_LOCALE,
        group: summarizeGroup(doc.group ?? null),
        createdAt: ret.createdAt,
        updatedAt: ret.updatedAt,
      }),
    },
  }
);

userSchema.index(
  { calendarToken: 1 },
  { unique: true, partialFilterExpression: { calendarToken: { $type: 'string' } } }
);

// True when the query projection keeps the `group` path.
// Projection keys look like { name: 1 }, { '-name': 0 } or { '+password': 1 }.
const projectionKeepsGroup = (projection) => {
  if (!projection || typeof projection !== 'object') return true;
  const keys = Object.keys(projection);
  if (keys.length === 0) return true;
  if (keys.includes('group')) return Boolean(projection.group);
  if (keys.includes('-group')) return false;
  const inclusive = keys.some(
    (key) => !key.startsWith('+') && !key.startsWith('-') && (projection[key] === 1 || projection[key] === true)
  );
  return !inclusive;
};

// Every find query populates `group` (and its program), so req.user and every serialized
// user have the public group shape. Opt out with query.setOptions({ populateGroup: false }).
// Queries whose projection excludes `group` (e.g. .select('email'), Model.exists) are skipped.
userSchema.pre(/^find/, function () {
  if (this.getOptions().populateGroup === false) return;
  if (!projectionKeepsGroup(this.projection())) return;
  this.populate(GROUP_POPULATE);
});

// Mongoose validates (minlength on the plain password) before pre('save') hooks run.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(String(password), this.password);
};

// Populates `group` on a document (needed after save(), which leaves a changed group as an id).
userSchema.methods.populateGroup = function () {
  return this.populate(GROUP_POPULATE);
};

userSchema.statics.findByCredentials = async function (email, password) {
  const missing = [!email && 'email', !password && 'password'].filter(Boolean);
  if (missing.length > 0) {
    throw new HttpError(400, 'MISSING_FIELDS', 'Email and password are required', { fields: missing });
  }

  const user = await this.findOne({ email: String(email).toLowerCase().trim() }).select('+password');

  // Same error for unknown email and wrong password, so the API does not reveal which accounts exist.
  if (!user) {
    await bcrypt.compare(String(password), DUMMY_PASSWORD_HASH);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  if (!(await user.comparePassword(password))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  }

  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
module.exports.LOCALES = LOCALES;
module.exports.PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;
module.exports.GROUP_POPULATE = GROUP_POPULATE;
