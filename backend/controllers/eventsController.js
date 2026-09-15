'use strict';

const { query } = require('../config/db');

const BLOCK_EXCLUSION = `NOT EXISTS (
  SELECT 1 FROM blocks b
  WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
     OR (b.blocker_id = u.id AND b.blocked_id = $1)
)`;

// ── GET /api/events ────────────────────────────────────────────────────────────
async function listEvents(req, res) {
  const { state, group_id, date_from, date_to, q } = req.query;
  const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const params = [];
    const clauses = ['e.is_active = TRUE'];
    if (state)     { params.push(state);     clauses.push(`e.state = $${params.length}`); }
    if (group_id)  { params.push(group_id);  clauses.push(`e.group_id = $${params.length}`); }
    if (date_from) { params.push(date_from); clauses.push(`e.event_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   clauses.push(`e.event_date <= $${params.length}`); }
    if (q)         { params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); clauses.push(`e.title ILIKE $${params.length}`); }
    // Default to upcoming-only unless a date range was explicitly given.
    if (!date_from && !date_to) clauses.push(`e.event_date >= NOW()`);

    const where = clauses.join(' AND ');
    const countRes = await query(`SELECT COUNT(*) FROM events e WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(req.user.id);
    const userIdParam = params.length;
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT e.id, e.title, e.description, e.location, e.state, e.event_date, e.event_end_date,
              e.cover_image_url, e.group_id, e.organizer_id, e.created_at,
              g.name AS group_name,
              (SELECT COUNT(*) FROM event_attendees ea WHERE ea.event_id = e.id AND ea.status = 'going') AS going_count,
              (SELECT COUNT(*) FROM event_attendees ea WHERE ea.event_id = e.id AND ea.status = 'interested') AS interested_count,
              (SELECT status FROM event_attendees ea WHERE ea.event_id = e.id AND ea.user_id = $${userIdParam}) AS my_status
       FROM events e
       LEFT JOIN groups g ON g.id = e.group_id
       WHERE ${where}
       ORDER BY e.event_date ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ events: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[listEvents]', err.message);
    res.status(500).json({ error: 'Could not fetch events.' });
  }
}

// ── GET /api/events/:id ────────────────────────────────────────────────────────
async function getEvent(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT e.id, e.title, e.description, e.location, e.state, e.event_date, e.event_end_date,
              e.cover_image_url, e.group_id, e.organizer_id, e.created_at,
              g.name AS group_name,
              p.display_name AS organizer_name,
              (SELECT COUNT(*) FROM event_attendees ea WHERE ea.event_id = e.id AND ea.status = 'going') AS going_count,
              (SELECT COUNT(*) FROM event_attendees ea WHERE ea.event_id = e.id AND ea.status = 'interested') AS interested_count,
              (SELECT status FROM event_attendees ea WHERE ea.event_id = e.id AND ea.user_id = $2) AS my_status
       FROM events e
       LEFT JOIN groups g ON g.id = e.group_id
       JOIN profiles p ON p.user_id = e.organizer_id
       WHERE e.id = $1 AND e.is_active = TRUE`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[getEvent]', err.message);
    res.status(500).json({ error: 'Could not fetch event.' });
  }
}

// ── GET /api/events/:id/attendees ──────────────────────────────────────────────
async function listEventAttendees(req, res) {
  const { id } = req.params;
  const status = ['interested', 'going'].includes(req.query.status) ? req.query.status : null;
  const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const params = [req.user.id, id];
    let statusClause = '';
    if (status) { params.push(status); statusClause = `AND ea.status = $${params.length}`; }

    const countRes = await query(
      `SELECT COUNT(*) FROM event_attendees ea JOIN users u ON u.id = ea.user_id
       WHERE ea.event_id = $2 ${statusClause} AND ${BLOCK_EXCLUSION}`,
      params
    );
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT ea.user_id, ea.status, ea.created_at, p.display_name, p.avatar_url
       FROM event_attendees ea
       JOIN users u ON u.id = ea.user_id
       JOIN profiles p ON p.user_id = ea.user_id
       WHERE ea.event_id = $2 ${statusClause} AND ${BLOCK_EXCLUSION}
       ORDER BY ea.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ attendees: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[listEventAttendees]', err.message);
    res.status(500).json({ error: 'Could not fetch attendees.' });
  }
}

// ── POST /api/events ───────────────────────────────────────────────────────────
async function createEvent(req, res) {
  const { title, description, location, state, event_date, event_end_date, group_id } = req.body;
  try {
    if (group_id) {
      const owns = await query(
        `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'owner'`,
        [group_id, req.user.id]
      );
      if (!owns.rows.length) return res.status(403).json({ error: 'Only that group\'s owner can host an event under it.' });
    }
    const { rows } = await query(
      `INSERT INTO events (title, description, location, state, event_date, event_end_date, organizer_id, group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, location, state, event_date, event_end_date, group_id, created_at`,
      [title, description || null, location || null, state || null, event_date, event_end_date || null, req.user.id, group_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[createEvent]', err.message);
    res.status(500).json({ error: 'Could not create event.' });
  }
}

async function requireOrganizer(eventId, userId) {
  const { rows } = await query('SELECT 1 FROM events WHERE id = $1 AND organizer_id = $2', [eventId, userId]);
  return rows.length > 0;
}

// ── PATCH /api/events/:id ──────────────────────────────────────────────────────
async function updateEvent(req, res) {
  const { id } = req.params;
  try {
    if (!(await requireOrganizer(id, req.user.id))) {
      return res.status(403).json({ error: 'Only the organizer can edit this event.' });
    }
    const fields = [];
    const params = [];
    const set = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };
    if (req.body.title          !== undefined) set('title', req.body.title);
    if (req.body.description    !== undefined) set('description', req.body.description);
    if (req.body.location       !== undefined) set('location', req.body.location);
    if (req.body.state          !== undefined) set('state', req.body.state);
    if (req.body.event_date     !== undefined) set('event_date', req.body.event_date);
    if (req.body.event_end_date !== undefined) set('event_end_date', req.body.event_end_date);
    if (!fields.length) return res.status(400).json({ error: 'No fields to update.' });

    params.push(id);
    const { rows } = await query(
      `UPDATE events SET ${fields.join(', ')} WHERE id = $${params.length}
       RETURNING id, title, description, location, state, event_date, event_end_date`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[updateEvent]', err.message);
    res.status(500).json({ error: 'Could not update event.' });
  }
}

// ── DELETE /api/events/:id ─────────────────────────────────────────────────────
async function deleteEvent(req, res) {
  const { id } = req.params;
  try {
    if (!(await requireOrganizer(id, req.user.id))) {
      return res.status(403).json({ error: 'Only the organizer can delete this event.' });
    }
    await query('UPDATE events SET is_active = FALSE WHERE id = $1', [id]);
    res.json({ message: 'Event deleted.' });
  } catch (err) {
    console.error('[deleteEvent]', err.message);
    res.status(500).json({ error: 'Could not delete event.' });
  }
}

// ── POST /api/events/:id/rsvp ──────────────────────────────────────────────────
async function rsvpEvent(req, res) {
  const { id } = req.params;
  const { status } = req.body; // 'interested' | 'going'
  try {
    const eventRes = await query('SELECT id FROM events WHERE id = $1 AND is_active = TRUE', [id]);
    if (!eventRes.rows.length) return res.status(404).json({ error: 'Event not found.' });

    await query(
      `INSERT INTO event_attendees (event_id, user_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3`,
      [id, req.user.id, status]
    );
    res.json({ status });
  } catch (err) {
    console.error('[rsvpEvent]', err.message);
    res.status(500).json({ error: 'Could not update RSVP.' });
  }
}

// ── DELETE /api/events/:id/rsvp ────────────────────────────────────────────────
async function cancelRsvp(req, res) {
  const { id } = req.params;
  try {
    await query('DELETE FROM event_attendees WHERE event_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ status: null });
  } catch (err) {
    console.error('[cancelRsvp]', err.message);
    res.status(500).json({ error: 'Could not update RSVP.' });
  }
}

module.exports = {
  listEvents, getEvent, listEventAttendees, createEvent, updateEvent, deleteEvent, rsvpEvent, cancelRsvp,
};
