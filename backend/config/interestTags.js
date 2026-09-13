'use strict';

/**
 * The fixed, generic interest tags every member can choose from — grouped
 * for display, but validated server-side as one flat allowlist. This is
 * the single source of truth: it was previously duplicated (and drifted)
 * across profile-setup.html, Profile.html, Discover.html, and Search.html.
 * Silver and Free members are limited to these; Gold and Black can also
 * add their own custom tags (see interestTagsController.js).
 */
const GENERIC_TAG_GROUPS = {
  'Arrangement Style': ['Power exchange', 'Mentorship', 'Financial partnership', 'Long-term arrangement'],
  'Lifestyle': ['Travel companionship', 'Fine dining', 'Life of leisure', 'Discretion'],
  'Connection': ['Casual', 'Emotional connection', 'No strings attached'],
};

const GENERIC_TAGS = Object.values(GENERIC_TAG_GROUPS).flat();

const INTEREST_LEVELS = ['into', 'curious', 'soft_limit', 'hard_limit'];

module.exports = { GENERIC_TAG_GROUPS, GENERIC_TAGS, INTEREST_LEVELS };
