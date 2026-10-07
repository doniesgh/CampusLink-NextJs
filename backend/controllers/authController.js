const crypto = require('crypto');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const {
  isBlank,
  requireFields,
  normalizeEmail,
  normalizeLocale,
  checkPassword,
  throwIfInvalid,
  LOCALES,
} = require('../utils/validation');
const {
  hashToken,
  issueTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
} = require('../service/tokenService');
const { sendEmail, otpMailTemplate, passwordResetMailTemplate } = require('../service/mailService');
const auditService = require('../service/auditService');

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const FORGOT_PASSWORD_MESSAGE = 'If an account exists for this email, a password reset link has been sent.';

const otpMaxAttempts = () => Number(process.env.OTP_MAX_ATTEMPTS) || 5;
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

const otpInvalid = () => new HttpError(400, 'OTP_INVALID', 'Invalid or expired verification code');
const resetTokenInvalid = () => new HttpError(400, 'RESET_TOKEN_INVALID', 'This reset link is invalid or has expired');

// Both values are sha256 hex digests, so they always have the same length.
const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const clearOtp = (userId) =>
  User.updateOne({ _id: userId }, { $unset: { otpHash: 1, otpExpiresAt: 1 }, $set: { otpAttempts: 0 } });

// POST /api/auth/signup
const signup = async (req, res) => {
  const body = req.body ?? {};
  requireFields(body, ['firstname', 'lastname', 'email', 'password']);

  // Optional locale ('fr' | 'en'), 'fr' by default.
  let locale;
  if (body.locale !== undefined && body.locale !== null) {
    locale = normalizeLocale(body.locale);
    if (!locale) throwIfInvalid({ locale: `Locale must be one of ${LOCALES.join(', ')}` });
  }

  // Public signup always creates a STUDENT, whatever "role" the body contains.
  const user = new User({
    firstname: body.firstname,
    lastname: body.lastname,
    email: body.email,
    password: body.password,
    role: 'STUDENT',
    locale,
  });
  await user.validate();

  if (await User.exists({ email: user.email })) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  }

  await user.save();
  res.status(201).json(await issueTokens(user, req));
};

// POST /api/auth/login
const login = async (req, res) => {
  const body = req.body ?? {};
  requireFields(body, ['email', 'password']);

  const user = await User.findByCredentials(body.email, body.password);

  if (!user.twoFactorEnabled) {
    return res.status(200).json(await issueTokens(user, req));
  }

  // Two-factor: email a 6-digit code; tokens are issued by /verify-otp.
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await User.updateOne(
    { _id: user._id },
    { $set: { otpHash: hashToken(otp), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 } }
  );

  try {
    await sendEmail({ to: user.email, ...otpMailTemplate(otp, user.locale) });
  } catch (error) {
    console.error(`[auth] Could not send the login code to ${user.email}:`, error.message);
    await clearOtp(user._id);
    throw new HttpError(503, 'EMAIL_FAILED', 'Could not send the verification code, please try again later');
  }

  res.status(200).json({ otpRequired: true, email: user.email });
};

// POST /api/auth/verify-otp
const verifyOtp = async (req, res) => {
  const body = { ...(req.body ?? {}) };
  // Accept a numeric code too (leading zeros are lost in a JSON number).
  if (typeof body.otp === 'number') body.otp = String(body.otp).padStart(6, '0');
  requireFields(body, ['email', 'otp']);

  const user = await User.findOne({ email: normalizeEmail(body.email) }).select(
    '+otpHash +otpExpiresAt +otpAttempts'
  );
  if (!user || !user.otpHash || !user.otpExpiresAt) {
    throw otpInvalid();
  }
  if (user.otpExpiresAt.getTime() < Date.now()) {
    await clearOtp(user._id);
    throw otpInvalid();
  }

  if (!safeEqual(hashToken(body.otp.trim()), user.otpHash)) {
    // Atomic increment, so parallel guesses cannot exceed the attempt limit.
    const updated = await User.findOneAndUpdate(
      { _id: user._id, otpHash: user.otpHash },
      { $inc: { otpAttempts: 1 } },
      { returnDocument: 'after', projection: { otpAttempts: 1 } }
    );
    if (updated && updated.otpAttempts >= otpMaxAttempts()) {
      await User.updateOne(
        { _id: user._id, otpHash: user.otpHash },
        { $unset: { otpHash: 1, otpExpiresAt: 1 }, $set: { otpAttempts: 0 } }
      );
      throw new HttpError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong codes, please log in again');
    }
    throw otpInvalid();
  }

  // Consume the code atomically: it can only be used once, and not after the attempt limit.
  const consumed = await User.findOneAndUpdate(
    { _id: user._id, otpHash: user.otpHash, otpAttempts: { $lt: otpMaxAttempts() } },
    { $unset: { otpHash: 1, otpExpiresAt: 1 }, $set: { otpAttempts: 0 } },
    { returnDocument: 'after' }
  );
  if (!consumed) {
    throw otpInvalid();
  }

  res.status(200).json(await issueTokens(consumed, req));
};

// POST /api/auth/refresh
const refresh = async (req, res) => {
  const body = req.body ?? {};
  requireFields(body, ['refreshToken']);

  res.status(200).json(await rotateRefreshToken(body.refreshToken, req));
};

// POST /api/auth/logout (idempotent: always 204)
const logout = async (req, res) => {
  const { refreshToken } = req.body ?? {};

  if (typeof refreshToken === 'string' && refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  res.status(204).end();
};

// Creates a reset token and emails the link. Runs after the response is sent; never throws.
const sendPasswordResetLink = async (email) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const user = await User.findOneAndUpdate(
      { email },
      {
        $set: {
          passwordResetHash: hashToken(token),
          passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      },
      { returnDocument: 'after', projection: { email: 1, locale: 1 } }
    );
    if (!user) return;

    const link = `${appUrl()}/reset-password?token=${token}`;
    await sendEmail({ to: user.email, ...passwordResetMailTemplate(link, user.locale) });
  } catch (error) {
    console.error(`[auth] Could not send the password reset email to ${email}:`, error.message);
  }
};

// POST /api/auth/forgot-password
// Always answers 200 with the same message, before looking up the account and sending the
// email, so neither the answer nor its timing reveals which accounts exist.
const forgotPassword = async (req, res) => {
  const { email } = req.body ?? {};

  res.status(200).json({ message: FORGOT_PASSWORD_MESSAGE });

  if (typeof email === 'string' && !isBlank(email)) {
    setImmediate(() => {
      sendPasswordResetLink(normalizeEmail(email));
    });
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res) => {
  const body = req.body ?? {};
  requireFields(body, ['token', 'password']);

  const tokenFilter = {
    passwordResetHash: hashToken(body.token.trim()),
    passwordResetExpiresAt: { $gt: new Date() },
  };
  if (!(await User.exists(tokenFilter))) {
    throw resetTokenInvalid();
  }

  throwIfInvalid(checkPassword(body.password));

  // Consume the token atomically: two parallel requests cannot both use it.
  const user = await User.findOneAndUpdate(
    tokenFilter,
    { $unset: { passwordResetHash: 1, passwordResetExpiresAt: 1 } },
    { returnDocument: 'after' }
  );
  if (!user) {
    throw resetTokenInvalid();
  }

  user.password = body.password;
  await user.save();
  await revokeAllRefreshTokens(user._id);

  await auditService.record(req, {
    actor: user,
    action: 'auth.password_reset',
    targetType: 'User',
    targetId: user._id,
    summary: `Password reset by email link for ${user.email}`,
  });

  res.status(200).json({ message: 'Your password has been reset. You can now log in.' });
};

// POST /api/auth/change-password [auth]
const changePassword = async (req, res) => {
  const body = req.body ?? {};
  requireFields(body, ['currentPassword', 'newPassword']);
  throwIfInvalid(checkPassword(body.newPassword, 'newPassword'));

  const user = await User.findById(req.user._id).select('+password');
  if (!user || !(await user.comparePassword(body.currentPassword))) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  }

  user.password = body.newPassword;
  await user.save();
  await revokeAllRefreshTokens(user._id);

  await auditService.record(req, {
    action: 'auth.password_change',
    targetType: 'User',
    targetId: user._id,
    summary: `Password changed by ${user.email}`,
  });

  res.status(200).json({ message: 'Your password has been changed. Please log in again on your other devices.' });
};

module.exports = {
  signup,
  login,
  verifyOtp,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
};
