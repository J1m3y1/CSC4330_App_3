'use strict';

const { query } = require('../config/db');
const { isConfigured, BASE_URL, sign, verifySignature } = require('../config/veriff');

// Veriff's own terminal/non-terminal status vocabulary, straight off their
// Sessions/webhook API — never invent our own names for these, since the
// webhook payload's `verification.status` is compared against this set
// as-is.
const TERMINAL_STATUSES = ['approved', 'declined', 'abandoned', 'expired'];

// ── POST /api/veriff/create-session ─────────────────────────────────────────
// Public — called from the sign-up wizard before any account exists, once
// the applicant has filled in their name and email (still earlier steps in
// the same form) but before they've submitted anything. Rate-limited by
// veriffLimiter (see routes/veriff.js) since, like phone verification, this
// is reachable pre-account and each call is a real third-party API request.
async function createSession(req, res) {
  if (!isConfigured) {
    return res.status(503).json({
      error: 'Identity verification is not configured yet. Set VERIFF_* in the backend .env to enable it.',
    });
  }

  const { email, full_name } = req.body;
  const [firstName, ...rest] = String(full_name || '').trim().split(/\s+/);
  const lastName = rest.join(' ') || firstName;

  const payload = {
    verification: {
      callback: `${process.env.APP_URL}/SignUpProcess/SignUp.html`,
      person: { firstName: firstName || 'Applicant', lastName: lastName || 'Applicant' },
      vendorData: email, // echoed back on the webhook — lets us double check the session is for this applicant
    },
  };
  const body = JSON.stringify(payload);

  try {
    const response = await fetch(`${BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AUTH-CLIENT': process.env.VERIFF_API_KEY,
        'X-HMAC-SIGNATURE': sign(body),
      },
      body,
    });
    const data = await response.json();

    if (!response.ok || data.status !== 'success' || !data.verification?.id) {
      console.error('[veriff.createSession]', response.status, JSON.stringify(data));
      return res.status(502).json({ error: 'Could not start identity verification. Please try again.' });
    }

    await query(
      `INSERT INTO veriff_sessions (id, email, status) VALUES ($1, $2, 'created')`,
      [data.verification.id, email]
    );

    res.json({ session_id: data.verification.id, url: data.verification.url });
  } catch (err) {
    console.error('[veriff.createSession]', err.message);
    res.status(502).json({ error: 'Could not reach the identity verification service. Please try again.' });
  }
}

// ── GET /api/veriff/session/:id/status ──────────────────────────────────────
// Public — polled by the sign-up wizard while the applicant completes
// Veriff's hosted flow in the popup this opened. Returns only the status,
// never the raw decision payload (that stays server-side for admin/support
// use, see identity_documents.veriff_session_id -> veriff_sessions.decision).
async function getStatus(req, res) {
  try {
    const { rows } = await query('SELECT status FROM veriff_sessions WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Verification session not found.' });
    res.json({ status: rows[0].status, terminal: TERMINAL_STATUSES.includes(rows[0].status) });
  } catch (err) {
    console.error('[veriff.getStatus]', err.message);
    res.status(500).json({ error: 'Could not check verification status.' });
  }
}

// ── POST /api/veriff/webhook ─────────────────────────────────────────────────
// Called directly by Veriff's own servers, not a browser — no CORS/session
// applies, no auth cookie exists to check. Authenticity instead comes from
// the HMAC signature Veriff attaches to every webhook, verified against the
// exact raw bytes of the request body (see server.js's express.json
// `verify` callback, which stashes that on req.rawBody — a body re-
// serialized from the parsed req.body would not reproduce Veriff's exact
// byte string and would always fail signature verification here).
async function webhook(req, res) {
  const signatureHeader = req.get('X-HMAC-SIGNATURE') || req.get('x-hmac-signature');
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';

  if (!isConfigured || !verifySignature(rawBody, signatureHeader)) {
    console.error('[veriff.webhook] signature verification failed');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  const verification = req.body?.verification;
  if (!verification?.id || !verification?.status) {
    return res.status(400).json({ error: 'Malformed webhook payload.' });
  }

  try {
    await query(
      `UPDATE veriff_sessions SET status = $1, decision = $2, updated_at = NOW() WHERE id = $3`,
      [verification.status, JSON.stringify(req.body), verification.id]
    );
    // Always 200 once accepted — Veriff retries on anything else, and a
    // session that doesn't exist in our table yet (e.g. a stray/duplicate
    // webhook) isn't something the sender can fix by retrying.
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[veriff.webhook]', err.message);
    res.status(500).json({ error: 'Could not record verification decision.' });
  }
}

module.exports = { createSession, getStatus, webhook };
