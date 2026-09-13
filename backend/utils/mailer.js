'use strict';

const nodemailer = require('nodemailer');

/**
 * Thin mail wrapper. If SMTP_HOST isn't configured (local dev, or a fresh
 * checkout with no mail provider yet), every call logs to the console
 * instead of failing — the rest of the app must keep working without mail.
 * Configure SMTP_HOST/PORT/USER/PASS/FROM (any provider: Postmark, SES,
 * SendGrid, Resend's SMTP endpoint, etc.) to send for real.
 */

let transporter = null;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!transporter && isConfigured()) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: (parseInt(process.env.SMTP_PORT, 10) || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 */
async function sendMail(to, subject, html) {
  if (!isConfigured()) {
    console.log(`[mailer] SMTP not configured — would have sent to ${to}: "${subject}"`);
    if (process.env.NODE_ENV !== 'production') console.log(`[mailer] body:\n${html}`);
    return { sent: false, reason: 'not_configured' };
  }

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || `Fantasi <no-reply@${process.env.SMTP_HOST}>`,
      to,
      subject,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail, isConfigured };
