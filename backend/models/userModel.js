const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const HttpError = require('../utils/httpError');

const Schema = mongoose.Schema;

const ROLES = ['STUDENT', 'TEACHER', 'ADMIN', 'ALUMNI'];
const PASSWORD_MIN_LENGTH = 8;
const NAME_MAX_LENGTH = 100;

// Compared against when the email is unknown, so a login attempt takes about the same
// time whether or not the account exists (no account enumeration through timing).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('campuslink-dummy-password', 10);

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
      // Public shape: { id, firstname, lastname, email, role, twoFactorEnabled, createdAt, updatedAt }
      transform: (doc, ret) => {
        const {
          _id,
          __v,
          password,
          otpHash,
          otpExpiresAt,
          otpAttempts,
          passwordResetHash,
          passwordResetExpiresAt,
          ...rest
        } = ret;
        return { id: String(_id), ...rest };
      },
    },
  }
);

// Mongoose validates (minlength on the plain password) before pre('save') hooks run.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(String(password), this.password);
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
module.exports.PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;
