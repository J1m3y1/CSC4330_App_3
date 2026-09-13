'use strict';

const { query, withTransaction } = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { grantMembership } = require('./membershipController');
const crypto = require('crypto');

// ── GET /api/admin/pending ────────────────────────────────────────────────────
// Applicants awaiting review — the queue B1 in the audit found nothing fed.
async function listPending(req, res) {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.created_at,
              p.display_name, p.full_name, p.date_of_birth, p.bio
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.is_approved = FALSE AND u.is_active = TRUE
       ORDER BY u.created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin.listPending]', err.message);
    res.status(500).json({ error: 'Could not fetch pending applications.' });
  }
}

// ── POST /api/admin/users/:id/approve ─────────────────────────────────────────
async function approveUser(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `UPDATE users SET is_approved = TRUE
       WHERE id = $1 AND is_active = TRUE
       RETURNING id, email`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Applicant not found.' });

    await sendMail(
      rows[0].email,
      "You're in — Fantasi application approved",
      `<p>Your Fantasi application has been approved. You can sign in now and finish setting up your profile.</p>`
    );

    res.json({ message: 'Applicant approved.' });
  } catch (err) {
    console.error('[admin.approveUser]', err.message);
    res.status(500).json({ error: 'Could not approve applicant.' });
  }
}

// ── POST /api/admin/users/:id/reject ──────────────────────────────────────────
// The schema has no separate "rejected" state distinct from an ordinary
// deactivated account, so a rejection is recorded as is_active = FALSE —
// the account never becomes reachable, and re-registering with the same
// email is blocked by the unique constraint (which is the intended effect).
async function rejectUser(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `UPDATE users SET is_active = FALSE, is_approved = FALSE
       WHERE id = $1
       RETURNING id, email`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Applicant not found.' });

    await sendMail(
      rows[0].email,
      'Your Fantasi application',
      `<p>Thank you for your interest in Fantasi. We're not able to approve your application at this time.</p>`
    );

    res.json({ message: 'Applicant rejected.' });
  } catch (err) {
    console.error('[admin.rejectUser]', err.message);
    res.status(500).json({ error: 'Could not reject applicant.' });
  }
}

// ── GET /api/admin/reports ────────────────────────────────────────────────────
async function listReports(req, res) {
  const status = ['pending', 'reviewed', 'resolved', 'dismissed'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  try {
    const { rows } = await query(
      `SELECT r.id, r.reason, r.status, r.created_at,
              reporter.display_name AS reporter_name, r.reporter_id,
              reported.display_name AS reported_name, r.reported_id
       FROM reports r
       JOIN profiles reporter ON reporter.user_id = r.reporter_id
       JOIN profiles reported ON reported.user_id = r.reported_id
       WHERE r.status = $1
       ORDER BY r.created_at ASC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin.listReports]', err.message);
    res.status(500).json({ error: 'Could not fetch reports.' });
  }
}

// ── POST /api/admin/reports/:id/resolve ───────────────────────────────────────
async function resolveReport(req, res) {
  const { id } = req.params;
  const { status } = req.body; // 'resolved' | 'dismissed'

  try {
    const { rows } = await query(
      `UPDATE reports SET status = $1, reviewed_by = $2
       WHERE id = $3
       RETURNING *`,
      [status, req.user.id, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[admin.resolveReport]', err.message);
    res.status(500).json({ error: 'Could not update report.' });
  }
}

// ── GET /api/admin/privacy-requests ───────────────────────────────────────────
async function listPrivacyRequests(req, res) {
  const status = ['pending', 'completed', 'dismissed'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  try {
    const { rows } = await query(
      `SELECT pr.id, pr.type, pr.reason, pr.status, pr.created_at,
              pr.user_id, u.email, p.display_name
       FROM privacy_requests pr
       JOIN users u ON u.id = pr.user_id
       JOIN profiles p ON p.user_id = pr.user_id
       WHERE pr.status = $1
       ORDER BY pr.created_at ASC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin.listPrivacyRequests]', err.message);
    res.status(500).json({ error: 'Could not fetch privacy requests.' });
  }
}

// ── POST /api/admin/privacy-requests/:id/resolve ──────────────────────────────
// Resolving a 'delete' request as 'completed' actually deletes the account —
// every other type (access/correct/restrict/object/portability) is manual
// work an operator does outside the app; this just records that it happened.
async function resolvePrivacyRequest(req, res) {
  const { id } = req.params;
  const { status } = req.body; // 'completed' | 'dismissed'

  try {
    const { rows } = await query('SELECT * FROM privacy_requests WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found.' });
    const request = rows[0];

    await withTransaction(async (client) => {
      if (status === 'completed' && request.type === 'delete') {
        // ON DELETE CASCADE removes the profile, memberships, messages,
        // blocks, and reports tied to this user.
        await client.query('DELETE FROM users WHERE id = $1', [request.user_id]);
      }
      await client.query(
        `UPDATE privacy_requests SET status = $1, reviewed_by = $2 WHERE id = $3`,
        [status, req.user.id, id]
      );
    });

    res.json({ message: 'Request updated.' });
  } catch (err) {
    console.error('[admin.resolvePrivacyRequest]', err.message);
    res.status(500).json({ error: 'Could not update request.' });
  }
}

// ── GET /api/admin/membership-requests ────────────────────────────────────────
async function listMembershipRequests(req, res) {
  const status = ['pending', 'granted', 'declined'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  try {
    const { rows } = await query(
      `SELECT mr.id, mr.requested_tier, mr.note, mr.status, mr.created_at,
              mr.user_id, u.email, u.membership_tier AS current_tier, p.display_name
       FROM membership_requests mr
       JOIN users u ON u.id = mr.user_id
       JOIN profiles p ON p.user_id = mr.user_id
       WHERE mr.status = $1
       ORDER BY mr.created_at ASC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin.listMembershipRequests]', err.message);
    res.status(500).json({ error: 'Could not fetch membership requests.' });
  }
}

// ── POST /api/admin/membership-requests/:id/resolve ───────────────────────────
// Approving actually grants the tier (via the same path as a manual comp);
// declining just records the decision.
async function resolveMembershipRequest(req, res) {
  const { id } = req.params;
  const { status } = req.body; // 'granted' | 'declined'

  try {
    const { rows } = await query('SELECT * FROM membership_requests WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found.' });
    const request = rows[0];

    if (status === 'granted') {
      await grantMembership(request.user_id, request.requested_tier, `invitation_${crypto.randomUUID()}`);
    }
    await query(
      `UPDATE membership_requests SET status = $1, reviewed_by = $2 WHERE id = $3`,
      [status, req.user.id, id]
    );

    res.json({ message: 'Request updated.' });
  } catch (err) {
    console.error('[admin.resolveMembershipRequest]', err.message);
    res.status(500).json({ error: 'Could not update request.' });
  }
}

module.exports = {
  listPending, approveUser, rejectUser, listReports, resolveReport,
  listPrivacyRequests, resolvePrivacyRequest,
  listMembershipRequests, resolveMembershipRequest,
};
