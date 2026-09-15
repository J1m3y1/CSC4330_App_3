'use strict';

const path = require('path');
const fs   = require('fs');
const { query, withTransaction } = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { grantMembership } = require('./membershipController');
const { ID_UPLOAD_DIR } = require('../middleware/upload');
const crypto = require('crypto');

// ── GET /api/admin/pending ────────────────────────────────────────────────────
// Applicants awaiting review — the queue B1 in the audit found nothing fed.
async function listPending(req, res) {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.created_at,
              p.display_name, p.full_name, p.date_of_birth, p.bio,
              idoc.id AS id_document_id, idoc.status AS id_document_status,
              idoc.veriff_session_id IS NOT NULL AS id_verified_via_veriff
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT id, status, veriff_session_id FROM identity_documents
         WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
       ) idoc ON TRUE
       WHERE u.is_approved = FALSE AND u.is_active = TRUE
       ORDER BY u.created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin.listPending]', err.message);
    res.status(500).json({ error: 'Could not fetch pending applications.' });
  }
}

// ── GET /api/admin/users/:id/id-document ──────────────────────────────────────
// Streams the applicant's uploaded ID back to an admin. This file was never
// written under a statically-served directory (see middleware/upload.js), so
// this route — gated by requireAuth + requireAdmin at the router level — is
// the only way to read one back.
async function getIdentityDocument(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT storage_key, mime_type, original_filename, veriff_session_id FROM identity_documents
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No ID on file for this applicant.' });

    // A Veriff-checked applicant has no file at all by design — Veriff's own
    // hosted flow captured and verified the document+selfie directly, never
    // relayed through our server (see migration 024). That's the expected,
    // correct state, not missing data — the plain "missing from storage"
    // message below is reserved for the legacy raw-upload path.
    if (rows[0].veriff_session_id) {
      return res.status(409).json({ error: 'This applicant was verified automatically via Veriff — there is no uploaded file to view.' });
    }

    const { storage_key, mime_type, original_filename } = rows[0];
    // storage_key is a server-generated random filename (see upload.js), never
    // user input, so joining it directly onto ID_UPLOAD_DIR is safe here.
    const filePath = path.join(ID_UPLOAD_DIR, storage_key);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'ID file is missing from storage.' });

    res.setHeader('Content-Type', mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${original_filename || storage_key}"`);
    res.sendFile(filePath);
  } catch (err) {
    console.error('[admin.getIdentityDocument]', err.message);
    res.status(500).json({ error: 'Could not fetch ID document.' });
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

    await query(
      `UPDATE identity_documents SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE user_id = $2 AND status = 'pending'`,
      [req.user.id, id]
    );

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

    await query(
      `UPDATE identity_documents SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
       WHERE user_id = $2 AND status = 'pending'`,
      [req.user.id, id]
    );

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

// ── GET /api/admin/users ──────────────────────────────────────────────────────
// The all-members directory. Status here is derived from is_approved/is_active
// rather than stored directly — there's no separate "status" column, so the
// same four combinations that listPending/approveUser/rejectUser already use
// are just named: pending, active, suspended, rejected.
const STATUS_CASE = `
  CASE
    WHEN u.is_approved AND u.is_active THEN 'active'
    WHEN u.is_approved AND NOT u.is_active THEN 'suspended'
    WHEN NOT u.is_approved AND u.is_active THEN 'pending'
    ELSE 'rejected'
  END
`;

async function listUsers(req, res) {
  const q       = (req.query.q || '').trim();
  const role    = req.query.role;
  const tier    = req.query.tier;
  const status  = req.query.status;
  const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit   = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const offset  = (page - 1) * limit;

  const where  = [];
  const values = [];
  let idx = 1;

  if (q) {
    where.push(`(u.email ILIKE $${idx} OR p.display_name ILIKE $${idx})`);
    values.push(`%${q}%`);
    idx++;
  }
  if (role) { where.push(`u.role = $${idx++}`); values.push(role); }
  if (tier) { where.push(`u.membership_tier = $${idx++}`); values.push(tier); }
  if (status) { where.push(`${STATUS_CASE} = $${idx++}`); values.push(status); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM users u JOIN profiles p ON p.user_id = u.id ${whereClause}`,
      values
    );
    const total = parseInt(countRows[0].count, 10);

    const { rows } = await query(
      `SELECT u.id, u.email, u.role, u.membership_tier, u.is_active, u.is_approved,
              u.created_at, u.last_login_at,
              p.display_name, p.avatar_url, p.last_active_at,
              ${STATUS_CASE} AS status
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    );

    res.json({ users: rows, total, page, limit });
  } catch (err) {
    console.error('[admin.listUsers]', err.message);
    res.status(500).json({ error: 'Could not fetch members.' });
  }
}

// ── POST /api/admin/users/:id/suspend ─────────────────────────────────────────
// Distinct from reject: this is for an already-active member (moderation),
// doesn't touch is_approved, and sends no "application" email.
async function suspendUser(req, res) {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot suspend your own account.' });

  try {
    const { rows } = await query(
      `UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING id, email`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'Account suspended.' });
  } catch (err) {
    console.error('[admin.suspendUser]', err.message);
    res.status(500).json({ error: 'Could not suspend account.' });
  }
}

// ── POST /api/admin/users/:id/reactivate ──────────────────────────────────────
// Brings an account back regardless of whether it was suspended or previously
// rejected — reactivating always means "usable again," so this sets both
// flags rather than requiring a separate re-approval step.
async function reactivateUser(req, res) {
  const { id } = req.params;

  try {
    const { rows } = await query(
      `UPDATE users SET is_active = TRUE, is_approved = TRUE WHERE id = $1 RETURNING id, email`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'Account reactivated.' });
  } catch (err) {
    console.error('[admin.reactivateUser]', err.message);
    res.status(500).json({ error: 'Could not reactivate account.' });
  }
}

// ── PATCH /api/admin/users/:id/role ───────────────────────────────────────────
async function updateUserRole(req, res) {
  const { id } = req.params;
  const { role } = req.body;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }

  try {
    if (role === 'member') {
      const { rows: adminRows } = await query(
        `SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = TRUE`
      );
      if (parseInt(adminRows[0].count, 10) <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last remaining admin.' });
      }
    }

    const { rows } = await query(
      `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role`,
      [role, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: `Role updated to ${role}.` });
  } catch (err) {
    console.error('[admin.updateUserRole]', err.message);
    res.status(500).json({ error: 'Could not update role.' });
  }
}

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
async function getStats(req, res) {
  try {
    const [statusCounts, tierCounts, queueCounts, signupCounts] = await Promise.all([
      query(`SELECT ${STATUS_CASE} AS status, COUNT(*) FROM users u JOIN profiles p ON p.user_id = u.id GROUP BY 1`),
      query(`SELECT membership_tier, COUNT(*) FROM users GROUP BY 1`),
      query(`SELECT
               (SELECT COUNT(*) FROM users WHERE is_approved = FALSE AND is_active = TRUE) AS pending_applicants,
               (SELECT COUNT(*) FROM reports WHERE status = 'pending') AS pending_reports,
               (SELECT COUNT(*) FROM privacy_requests WHERE status = 'pending') AS pending_privacy_requests,
               (SELECT COUNT(*) FROM membership_requests WHERE status = 'pending') AS pending_membership_requests`),
      query(`SELECT
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS signups_7d,
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS signups_30d
             FROM users`),
    ]);

    const by_status = { pending: 0, active: 0, suspended: 0, rejected: 0 };
    statusCounts.rows.forEach(r => { by_status[r.status] = parseInt(r.count, 10); });

    const by_tier = { free: 0, silver: 0, gold: 0, black: 0 };
    tierCounts.rows.forEach(r => { by_tier[r.membership_tier] = parseInt(r.count, 10); });

    const total_users = Object.values(by_status).reduce((a, b) => a + b, 0);

    res.json({
      total_users,
      by_status,
      by_tier,
      ...Object.fromEntries(
        Object.entries(queueCounts.rows[0]).map(([k, v]) => [k, parseInt(v, 10)])
      ),
      ...Object.fromEntries(
        Object.entries(signupCounts.rows[0]).map(([k, v]) => [k, parseInt(v, 10)])
      ),
    });
  } catch (err) {
    console.error('[admin.getStats]', err.message);
    res.status(500).json({ error: 'Could not fetch stats.' });
  }
}

// ── GET /api/admin/chatrooms ───────────────────────────────────────────────────
// Unlike the member-facing GET /api/chatrooms, this includes inactive rooms
// so an admin can find and reactivate one they deactivated earlier.
async function listAllChatrooms(req, res) {
  try {
    const { rows } = await query(
      `SELECT
         c.id, c.name, c.description, c.min_tier, c.is_active, c.created_at, c.created_by,
         COUNT(cm.id) FILTER (WHERE cm.is_deleted = FALSE) AS message_count,
         MAX(cm.created_at) AS last_message_at
       FROM chatrooms c
       LEFT JOIN chatroom_messages cm ON cm.room_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin.listAllChatrooms]', err.message);
    res.status(500).json({ error: 'Could not fetch chatrooms.' });
  }
}

module.exports = {
  listPending, approveUser, rejectUser, getIdentityDocument, listReports, resolveReport,
  listPrivacyRequests, resolvePrivacyRequest,
  listMembershipRequests, resolveMembershipRequest,
  listUsers, suspendUser, reactivateUser, updateUserRole,
  getStats, listAllChatrooms,
};
