const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { normalizeLocale, DEFAULT_LOCALE } = require('../utils/validation');

// Design charter colors.
const BRAND_COLOR = '#253C6D';
const TEXT_COLOR = '#1F2937';
const MUTED_COLOR = '#6B7280';
const BACKGROUND_COLOR = '#F4F5F7';

const isSmtpConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
const isProduction = () => process.env.NODE_ENV === 'production';

let transporter = null;

// Created on first use so it always reflects the environment loaded by dotenv.
// Without SMTP credentials, emails are rendered to JSON and not delivered (local development).
const getTransporter = () => {
  if (transporter) return transporter;

  if (isSmtpConfigured()) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }

  return transporter;
};

const getFrom = () => process.env.SMTP_FROM || `"CampusLink" <${process.env.SMTP_USER || 'no-reply@campuslink.local'}>`;

// When MAIL_OUTBOX_FILE is set, every email is also appended to it as one JSON line.
// End-to-end tests read OTP codes and reset links from this file.
const appendToOutbox = async (mail) => {
  const outboxFile = process.env.MAIL_OUTBOX_FILE;
  if (!outboxFile) return;

  try {
    const file = path.resolve(outboxFile);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, `${JSON.stringify({ ...mail, sentAt: new Date().toISOString() })}\n`);
  } catch (error) {
    console.error('[mail] Could not write to MAIL_OUTBOX_FILE:', error.message);
  }
};

// Throws when the email could not be sent; callers decide how to report it.
// In production (NODE_ENV=production) without SMTP it fails, and the content is never logged.
const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) throw new Error('sendEmail: missing recipient');

  if (!isSmtpConfigured() && isProduction()) {
    throw new Error('SMTP is not configured (SMTP_USER/SMTP_PASS): emails cannot be sent in production');
  }

  await getTransporter().sendMail({ from: getFrom(), to, subject, text, html });

  if (!isSmtpConfigured()) {
    console.log(
      `[mail] SMTP is not configured (SMTP_USER/SMTP_PASS), email NOT delivered.\n  To: ${to}\n  Subject: ${subject}\n  ${String(text).replace(/\n/g, '\n  ')}`
    );
  }

  await appendToOutbox({ to, subject, text, html });
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const FOOTERS = {
  fr: 'Cet e-mail a été envoyé automatiquement par CampusLink, merci de ne pas y répondre.',
  en: 'This email was sent automatically by CampusLink, please do not reply.',
};

const pickLocale = (locale) => normalizeLocale(locale) || DEFAULT_LOCALE;

const layout = (locale, title, bodyHtml) => `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;padding:24px;background:${BACKGROUND_COLOR};font-family:Arial,Helvetica,sans-serif;color:${TEXT_COLOR};">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border-top:6px solid ${BRAND_COLOR};">
      <p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:${BRAND_COLOR};">CampusLink</p>
      <h1 style="margin:0 0 16px;font-size:18px;color:${TEXT_COLOR};">${escapeHtml(title)}</h1>
      ${bodyHtml}
      <p style="margin:32px 0 0;font-size:12px;color:${MUTED_COLOR};">${escapeHtml(FOOTERS[locale])}</p>
    </div>
  </body>
</html>`;

const paragraph = (content, style = '') => `<p style="margin:0 0 16px;${style}">${content}</p>`;

const OTP_TEXTS = {
  fr: {
    subject: 'Ton code de vérification CampusLink',
    title: 'Ton code de vérification',
    intro: 'Utilise ce code pour terminer ta connexion :',
    line: (otp) => `Ton code de vérification CampusLink est : ${otp}`,
    expires: 'Il expire dans 10 minutes.',
    ignore: "Si tu n'as pas essayé de te connecter, ignore cet e-mail et pense à changer ton mot de passe.",
  },
  en: {
    subject: 'Your CampusLink verification code',
    title: 'Your verification code',
    intro: 'Use this code to finish signing in:',
    line: (otp) => `Your CampusLink verification code is: ${otp}`,
    expires: 'It expires in 10 minutes.',
    ignore: 'If you did not try to sign in, you can ignore this email and consider changing your password.',
  },
};

// Login verification code (2FA), in the user's locale ('fr' by default).
const otpMailTemplate = (otp, locale = DEFAULT_LOCALE) => {
  const lang = pickLocale(locale);
  const t = OTP_TEXTS[lang];
  const text = [t.line(otp), '', t.expires, t.ignore].join('\n');
  const html = layout(
    lang,
    t.title,
    `${paragraph(escapeHtml(t.intro))}
      ${paragraph(escapeHtml(otp), `font-size:32px;font-weight:bold;letter-spacing:8px;color:${BRAND_COLOR};`)}
      <p style="margin:0;">${escapeHtml(`${t.expires} ${t.ignore}`)}</p>`
  );
  return { subject: t.subject, text, html };
};

const RESET_TEXTS = {
  fr: {
    subject: 'Réinitialise ton mot de passe CampusLink',
    title: 'Réinitialise ton mot de passe',
    intro: 'Nous avons reçu une demande de réinitialisation de ton mot de passe CampusLink.',
    open: (link) => `Ouvre ce lien pour choisir un nouveau mot de passe (valable 30 minutes) : ${link}`,
    validity: 'Ce lien est valable 30 minutes.',
    button: 'Choisir un nouveau mot de passe',
    copy: 'Ou copie ce lien :',
    ignore: "Si tu n'es pas à l'origine de cette demande, ignore cet e-mail : ton mot de passe ne changera pas.",
  },
  en: {
    subject: 'Reset your CampusLink password',
    title: 'Reset your password',
    intro: 'We received a request to reset your CampusLink password.',
    open: (link) => `Open this link to choose a new password (valid for 30 minutes): ${link}`,
    validity: 'This link is valid for 30 minutes.',
    button: 'Choose a new password',
    copy: 'Or copy this link:',
    ignore: 'If you did not ask for this, you can ignore this email: your password will not change.',
  },
};

// Password reset link, in the user's locale ('fr' by default).
const passwordResetMailTemplate = (link, locale = DEFAULT_LOCALE) => {
  const lang = pickLocale(locale);
  const t = RESET_TEXTS[lang];
  const text = [t.intro, '', t.open(link), '', t.ignore].join('\n');
  const html = layout(
    lang,
    t.title,
    `${paragraph(escapeHtml(`${t.intro} ${t.validity}`))}
      ${paragraph(
        `<a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:999px;font-weight:bold;">${escapeHtml(t.button)}</a>`
      )}
      ${paragraph(`${escapeHtml(t.copy)} ${escapeHtml(link)}`, 'font-size:12px;word-break:break-all;')}
      <p style="margin:0;">${escapeHtml(t.ignore)}</p>`
  );
  return { subject: t.subject, text, html };
};

module.exports = {
  BRAND_COLOR,
  isSmtpConfigured,
  sendEmail,
  escapeHtml,
  otpMailTemplate,
  passwordResetMailTemplate,
};
