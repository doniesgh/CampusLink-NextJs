// const nodemailer = require('nodemailer');
const nodemailer = require('nodemailer');

const path = require('path');

require('dotenv').config();

const envoyerEmail = async ({ to, subject, html }) => {
  if (!to) return null;
  return transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html,
  });
};




const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  port: 587,
  secure: false,
  connectionTimeout: 10000,
});

const sendEmail = async (to, subject, html, imageBase64) => {
  try {
    const info = await transporter.sendMail({
      from: '" " <05@gmail.com>',
      to,
      subject,
      html,
      attachments: [
        {
          filename: 'logo.png',
          path: __dirname + '/../public/tu.png',
          cid: 'logo@ticket',
          contentDisposition: 'inline'
        }
      ]
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email: ', error && error.stack ? error.stack : error);
    return false;
  }
};

const sendEmailWithAttachments = async (to, subject, html, attachments) => {
  try {
    const extra = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
    const info = await transporter.sendMail({
      from: '" " <05@gmail.com>',
      to,
      subject,
      html,
      attachments: [
        {
          filename: 'logo.png',
          path: __dirname + '/../public/tu.png',
          cid: 'logo@ticket',
          contentDisposition: 'inline'
        },
        ...extra
      ]
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email: ', error && error.stack ? error.stack : error);
    return false;
  }
};




const sendOTPMail = (otp) => {
  const subject = `TSS OTP Code`;
  // HTML version
  const html = `
  <div style="font-family: Arial, sans-serif;">
    <p>Your OTP is ${otp}. It will expire in 10 minutes.</p>
    <br><br>
    <p></p>
    <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys " />

    <p><small>Note: This email was automatically generated, please do not reply.</small></p>
  </div>
  `;

  return { subject, html };
}






module.exports = { sendOTPMail,  sendEmail, sendEmailWithAttachments, };

