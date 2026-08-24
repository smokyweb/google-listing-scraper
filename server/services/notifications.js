const nodemailer = require('nodemailer');
const db = require('../db');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || null;
}

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST || getSetting('smtp_host'),
    port: Number(process.env.SMTP_PORT || getSetting('smtp_port') || 587),
    auth: {
      user: process.env.SMTP_USER || getSetting('smtp_user'),
      pass: process.env.SMTP_PASS || getSetting('smtp_pass'),
    },
  };
}

/** Send an internal notice without allowing mail errors to affect the caller flow. */
async function sendSalespersonNotice(salesperson, { subject, text, html }) {
  if (!salesperson?.email) return false;

  const config = getSmtpConfig();
  if (!config.host) {
    console.warn(`[Notification] SMTP is not configured; skipped notice to ${salesperson.email}`);
    return false;
  }

  try {
    const transporter = nodemailer.createTransport(config);
    await transporter.sendMail({
      from: process.env.SMTP_FROM || getSetting('smtp_from') || config.auth.user,
      to: salesperson.email,
      subject,
      text,
      html,
    });
    console.log(`[Notification] Sent notice to ${salesperson.email}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[Notification] Failed to notify ${salesperson.email}:`, err.message);
    return false;
  }
}

module.exports = { sendSalespersonNotice };
