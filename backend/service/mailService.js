const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const isSmtpConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

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
const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) throw new Error('sendEmail: missing recipient');

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

const layout = (title, bodyHtml) => `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      <p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#2563eb;">CampusLink</p>
      <h1 style="margin:0 0 16px;font-size:18px;">${escapeHtml(title)}</h1>
      ${bodyHtml}
      <p style="margin:32px 0 0;font-size:12px;color:#6b7280;">This email was sent automatically by CampusLink, please do not reply.</p>
    </div>
  </body>
</html>`;

const otpMailTemplate = (otp) => {
  const subject = 'Your CampusLink verification code';
  const text = [
    `Your CampusLink verification code is: ${otp}`,
    '',
    'It expires in 10 minutes.',
    'If you did not try to sign in, you can ignore this email and consider changing your password.',
  ].join('\n');
  const html = layout(
    'Your verification code',
    `<p style="margin:0 0 16px;">Use this code to finish signing in:</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:bold;letter-spacing:8px;">${escapeHtml(otp)}</p>
      <p style="margin:0;">It expires in 10 minutes. If you did not try to sign in, you can ignore this email and consider changing your password.</p>`
  );
  return { subject, text, html };
};

const passwordResetMailTemplate = (link) => {
  const subject = 'Reset your CampusLink password';
  const text = [
    'We received a request to reset your CampusLink password.',
    '',
    `Open this link to choose a new password (valid for 30 minutes): ${link}`,
    '',
    'If you did not ask for this, you can ignore this email: your password will not change.',
  ].join('\n');
  const html = layout(
    'Reset your password',
    `<p style="margin:0 0 16px;">We received a request to reset your CampusLink password. This link is valid for 30 minutes.</p>
      <p style="margin:0 0 16px;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;">Choose a new password</a></p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all;">Or copy this link: ${escapeHtml(link)}</p>
      <p style="margin:0;">If you did not ask for this, you can ignore this email: your password will not change.</p>`
  );
  return { subject, text, html };
};

module.exports = {
  sendEmail,
  otpMailTemplate,
  passwordResetMailTemplate,
};
