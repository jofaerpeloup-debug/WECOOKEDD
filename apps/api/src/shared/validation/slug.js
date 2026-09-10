// Canonical-slug normalization shared by the Recipe `region` and `category`
// fields. There is no approved project taxonomy yet (see
// docs/architecture/recipes.md) — these are conservative bounded slug
// strings, not enums. A future content milestone can layer a controlled
// vocabulary on top without a schema change.

const SLUG_MAX_LENGTH = 64;

// A canonical slug: lowercase alphanumeric words joined by single hyphens.
// e.g. "bicol", "central-luzon", "main-dish".
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Trims, lowercases, and collapses internal whitespace/underscores to single
// hyphens. It deliberately does NOT strip other punctuation — a value that
// still contains it after this is rejected by the validation layer rather
// than silently mangled, so an obvious typo ("main/dish") surfaces as an
// error instead of becoming "maindish".
function normalizeSlug(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

function isValidSlug(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

module.exports = { SLUG_MAX_LENGTH, SLUG_PATTERN, normalizeSlug, isValidSlug };
