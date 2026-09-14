'use strict';

const { query, withTransaction } = require('../config/db');
const { normalizeFilters } = require('../services/searchFilters');
const { GENERIC_TAG_GROUPS } = require('../config/interestTags');
const { ETHNICITIES, DRINKING, CHILDREN, LANGUAGES } = require('../config/profileOptions');

function filterOptions(req, res) {
  res.json({ generic_groups: GENERIC_TAG_GROUPS, ethnicities: ETHNICITIES, drinking: DRINKING, children: CHILDREN, languages: LANGUAGES });
}

async function listSavedSearches(req, res) {
  try {
    const { rows } = await query('SELECT id, name, filters FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC, id', [req.user.id]);
    res.json({ searches: rows });
  } catch (error) {
    console.error('[listSavedSearches]', error.message);
    res.status(500).json({ error: 'Could not load saved searches.' });
  }
}

async function createSavedSearch(req, res) {
  try {
    if (typeof req.body?.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 60) {
      return res.status(422).json({ error: 'Name your search using 1–60 characters.' });
    }
    const filters = normalizeFilters(req.body.filters, req.user.membership_tier);
    delete filters.page;
    delete filters.limit;
    const search = await withTransaction(async client => {
      // Serialize writes per owner so simultaneous requests cannot exceed the cap.
      const owner = await client.query('SELECT membership_tier FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      if (owner.rows[0]?.membership_tier !== 'black') {
        const error = new Error('Creating custom filters requires Black membership.');
        error.status = 403;
        throw error;
      }
      const count = await client.query('SELECT COUNT(*) FROM saved_searches WHERE user_id = $1', [req.user.id]);
      if (Number(count.rows[0].count) >= 20) {
        const error = new Error('You can save up to 20 searches. Remove one before saving another.');
        error.status = 422;
        throw error;
      }
      const { rows } = await client.query('INSERT INTO saved_searches (user_id, name, filters) VALUES ($1, $2, $3::jsonb) RETURNING id, name, filters', [req.user.id, req.body.name.trim(), JSON.stringify(filters)]);
      return rows[0];
    });
    res.status(201).json({ search });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[createSavedSearch]', error.message);
    res.status(500).json({ error: 'Could not save this search.' });
  }
}

async function deleteSavedSearch(req, res) {
  try {
    const result = await query('DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Saved search not found.' });
    res.json({ message: 'Saved search removed.' });
  } catch (error) {
    console.error('[deleteSavedSearch]', error.message);
    res.status(500).json({ error: 'Could not remove saved search.' });
  }
}

module.exports = { filterOptions, listSavedSearches, createSavedSearch, deleteSavedSearch };
