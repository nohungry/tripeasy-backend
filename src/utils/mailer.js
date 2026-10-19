// mailer adapter：依 MAIL_DRIVER 切換 smtp（本機 Mailpit）/ sendgrid（預設，維持原本行為）
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');

let transporter;

async function send({ to, subject, html }) {
  const driver = process.env.MAIL_DRIVER || 'sendgrid';
  const from = process.env.MAIL_FROM || process.env.SENDGRID_FROM_EMAIL;

  if (driver === 'smtp') {
    transporter =
      transporter ||
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 1025),
        secure: false,
      });
    await transporter.sendMail({ from, to, subject, html });
    return;
  }

  if (driver === 'sendgrid') {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({ to, from, subject, html });
    return;
  }

  throw new Error(`Unknown MAIL_DRIVER: ${driver}`);
}

module.exports = { send };
