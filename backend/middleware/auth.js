'use strict';

const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

/**
 * Verifies the JWT from the httpOnly cookie.
 * Attaches req.user = { id, email, role, membership_tier } on success.
 */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.access_token;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    // Confirm user still exists and is active (catches deleted/banned accounts mid-session)
    const { rows } = await query(
      'SELECT id, email, role, membership_tier, is_active FROM users WHERE id = $1',
      [payload.sub]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Account not found or deactivated.' });
    }

    req.user = {
      id:              rows[0].id,
      email:           rows[0].email,
      role:            rows[0].role,
      membership_tier: rows[0].membership_tier,
    };

    next();
  } catch (err) {
    console.error('[auth middleware]', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

/**
 * Requires the user to have an approved/verified account.
 * Use after requireAuth.
 */
async function requireApproved(req, res, next) {
  try {
    const { rows } = await query(
      'SELECT is_approved FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length || !rows[0].is_approved) {
      return res.status(403).json({ error: 'Your account is pending approval.' });
    }
    next();
  } catch (err) {
    console.error('[requireApproved]', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

/**
 * Factory: require a specific membership tier or higher.
 * Tier order: free < silver < gold < black
 */
const TIER_RANK = { free: 0, silver: 1, gold: 2, black: 3 };

function requireTier(minimumTier) {
  return (req, res, next) => {
    const userRank = TIER_RANK[req.user.membership_tier] ?? 0;
    const requiredRank = TIER_RANK[minimumTier] ?? 0;
    if (userRank < requiredRank) {
      return res.status(403).json({
        error: `This feature requires a ${minimumTier} membership or higher.`,
        upgrade_required: true,
      });
    }
    next();
  };
}

/**
 * Require admin role. Use after requireAuth.
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireApproved, requireTier, requireAdmin };
