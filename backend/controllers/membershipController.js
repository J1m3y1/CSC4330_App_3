'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../config/db');

// Tier rank for comparison
const TIER_RANK = { free: 0, silver: 1, gold: 2, black: 3 };

// ── GET /api/membership ───────────────────────────────────────────────────────
// Returns the current user's active membership + history + their most recent
// pending upgrade request, if any.
async function getMembership(req, res) {
  try {
    const { rows } = await query(
      `SELECT m.*, u.membership_tier AS current_tier
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.user_id = $1
       ORDER BY m.created_at DESC`,
      [req.user.id]
    );

    const { rows: pendingRequest } = await query(
      `SELECT id, requested_tier, note, created_at
       FROM membership_requests
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.user.id]
    );

    const active = rows.find(r => r.is_active) || null;

    res.json({
      current_tier: req.user.membership_tier,
      active_membership: active,
      history: rows,
      pending_request: pendingRequest[0] || null,
    });
  } catch (err) {
    console.error('[getMembership]', err.message);
    res.status(500).json({ error: 'Could not fetch membership.' });
  }
}

/**
 * Grants `tier` to `userId`, deactivating any existing active membership,
 * and records `grantRef` for idempotency (an audit trail of *who* triggered
 * which grant, not a payment identifier — this app takes no payment itself,
 * see membership_requests). A duplicate grantRef is treated as already
 * processed rather than double-granting.
 */
async function grantMembership(userId, tier, grantRef) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT id FROM memberships WHERE grant_ref = $1',
      [grantRef]
    );
    if (existing.rows.length) return existing.rows[0]; // already processed

    await client.query(
      `UPDATE memberships SET is_active = FALSE
       WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const { rows } = await client.query(
      `INSERT INTO memberships (user_id, tier, expires_at, payment_ref, grant_ref)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, tier, expiresAt, grantRef, grantRef]
    );

    await client.query('UPDATE users SET membership_tier = $1 WHERE id = $2', [tier, userId]);

    return rows[0];
  });
}

// ── POST /api/membership/request ──────────────────────────────────────────────
// A member asks to be upgraded — this is a private-invitation platform with
// no payment processor built in (see project notes on why), so this is the
// entire "upgrade" path: request, then a human reviews it.
async function requestUpgrade(req, res) {
  const { tier, note } = req.body;

  if (!['silver', 'gold', 'black'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid membership tier.' });
  }
  if (TIER_RANK[tier] <= TIER_RANK[req.user.membership_tier]) {
    return res.status(400).json({
      error: `You already have ${req.user.membership_tier} membership or higher.`,
    });
  }

  try {
    const { rows: existingPending } = await query(
      `SELECT id FROM membership_requests WHERE user_id = $1 AND status = 'pending'`,
      [req.user.id]
    );
    if (existingPending.length) {
      return res.status(409).json({ error: 'You already have a pending upgrade request.' });
    }

    const { rows } = await query(
      `INSERT INTO membership_requests (user_id, requested_tier, note)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.id, tier, note || null]
    );

    res.status(201).json({ message: 'Request received. Our team will follow up.', request: rows[0] });
  } catch (err) {
    console.error('[requestUpgrade]', err.message);
    res.status(500).json({ error: 'Could not submit request.' });
  }
}

// ── POST /api/membership/grant (admin only) ───────────────────────────────────
// Manually comp a membership — used both for the invitation flow above (an
// admin approving a membership_requests row) and standalone, e.g. for goodwill
// comps or support cases.
async function grantMembershipManually(req, res) {
  const { user_id, tier } = req.body;

  if (!['silver', 'gold', 'black'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid membership tier.' });
  }

  try {
    const membership = await grantMembership(user_id, tier, `manual_${crypto.randomUUID()}`);
    res.status(201).json({ message: `Granted ${tier} membership.`, membership });
  } catch (err) {
    console.error('[grantMembershipManually]', err.message);
    res.status(500).json({ error: 'Could not grant membership.' });
  }
}

// ── POST /api/membership/cancel ───────────────────────────────────────────────
// Cancels the active paid membership; user reverts to free at expiry.
async function cancelMembership(req, res) {
  if (req.user.membership_tier === 'free') {
    return res.status(400).json({ error: 'No active paid membership to cancel.' });
  }

  try {
    const cancelled = await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE memberships SET is_active = FALSE
         WHERE user_id = $1 AND is_active = TRUE`,
        [req.user.id]
      );
      if (!rowCount) return false;

      await client.query(
        "UPDATE users SET membership_tier = 'free' WHERE id = $1",
        [req.user.id]
      );
      return true;
    });

    if (!cancelled) return res.status(404).json({ error: 'No active membership found.' });
    res.json({ message: 'Membership cancelled. You have been moved to the free tier.' });
  } catch (err) {
    console.error('[cancelMembership]', err.message);
    res.status(500).json({ error: 'Could not cancel membership.' });
  }
}

// ── POST /api/membership/expire-check (internal / admin) ─────────────────────
// Scans for memberships past their expiry and reverts those users to free.
// In production, call this via a cron job or scheduled task.
async function expireCheck(req, res) {
  try {
    const expiredIds = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE memberships
         SET is_active = FALSE
         WHERE is_active = TRUE
           AND expires_at IS NOT NULL
           AND expires_at < NOW()
         RETURNING user_id`
      );
      if (rows.length) {
        await client.query(
          `UPDATE users SET membership_tier = 'free'
           WHERE id = ANY($1::uuid[])`,
          [rows.map(r => r.user_id)]
        );
      }
      return rows.map(r => r.user_id);
    });

    res.json({ expired_count: expiredIds.length });
  } catch (err) {
    console.error('[expireCheck]', err.message);
    res.status(500).json({ error: 'Expire check failed.' });
  }
}

module.exports = {
  getMembership, requestUpgrade, grantMembershipManually,
  cancelMembership, expireCheck, grantMembership,
};
