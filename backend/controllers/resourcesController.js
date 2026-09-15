'use strict';

const { query } = require('../config/db');

function slugify(term) {
  return term.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── GET /api/resources/dictionary ──────────────────────────────────────────────
async function listDictionaryTerms(req, res) {
  const { q, category } = req.query;
  try {
    const params = [];
    const clauses = [];
    if (q)        { params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); clauses.push(`(term ILIKE $${params.length} OR definition ILIKE $${params.length})`); }
    if (category) { params.push(category); clauses.push(`category = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT id, term, slug, definition, category FROM dictionary_terms ${where} ORDER BY term ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[listDictionaryTerms]', err.message);
    res.status(500).json({ error: 'Could not fetch dictionary terms.' });
  }
}

// ── GET /api/resources/dictionary/:slug ────────────────────────────────────────
async function getDictionaryTerm(req, res) {
  try {
    const { rows } = await query('SELECT id, term, slug, definition, category FROM dictionary_terms WHERE slug = $1', [req.params.slug]);
    if (!rows.length) return res.status(404).json({ error: 'Term not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[getDictionaryTerm]', err.message);
    res.status(500).json({ error: 'Could not fetch term.' });
  }
}

module.exports = { listDictionaryTerms, getDictionaryTerm, slugify };
