const { createHash } = require('node:crypto');

const FINGERPRINT_VERSION = 'recipe-duplicate-v1';
const DUPLICATE_CANDIDATE_LIMIT = 500;

const CLASSIFICATION_PRIORITY = Object.freeze({
  exact_duplicate: 0,
  near_exact_duplicate: 1,
  possible_variant: 2,
});

function normalizeDuplicateTitle(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function ingredientId(entry) {
  return String(entry?.ingredientId?._id || entry?.ingredientId || '').toLowerCase();
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalRecipePayload(recipe) {
  const ingredientMultiset = (recipe.ingredients || []).map((entry) => [
    ingredientId(entry),
    entry.quantity == null ? null : entry.quantity,
    entry.unit,
  ]).sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));

  return {
    version: FINGERPRINT_VERSION,
    titleKey: normalizeDuplicateTitle(recipe.title),
    ingredientMultiset,
    instructionSequence: [...(recipe.instructions || [])],
  };
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fingerprintRecipe(recipe) {
  const payload = canonicalRecipePayload(recipe);
  const canonical = canonicalJson(payload);
  return { payload, canonical, fingerprint: sha256(canonical) };
}

function classifyRecipe(subject, candidate) {
  const subjectFingerprint = fingerprintRecipe(subject);
  const candidateFingerprint = fingerprintRecipe(candidate);
  const titleExact = subjectFingerprint.payload.titleKey === candidateFingerprint.payload.titleKey;
  const ingredientMultisetExact = canonicalJson(subjectFingerprint.payload.ingredientMultiset)
    === canonicalJson(candidateFingerprint.payload.ingredientMultiset);
  const instructionSequenceExact = canonicalJson(subjectFingerprint.payload.instructionSequence)
    === canonicalJson(candidateFingerprint.payload.instructionSequence);
  const fingerprintEqual = subjectFingerprint.fingerprint === candidateFingerprint.fingerprint;

  let classification = null;
  if (fingerprintEqual && subjectFingerprint.canonical === candidateFingerprint.canonical) {
    classification = 'exact_duplicate';
  } else if (ingredientMultisetExact && instructionSequenceExact && !titleExact) {
    classification = 'near_exact_duplicate';
  } else if (titleExact && ingredientMultisetExact !== instructionSequenceExact) {
    classification = 'possible_variant';
  }

  return {
    classification,
    evidence: { titleExact, ingredientMultisetExact, instructionSequenceExact, fingerprintEqual },
    candidatePayload: candidateFingerprint.payload,
  };
}

function effectiveLifecycle(recipe) {
  const legacy = recipe.publicationStatus == null;
  return {
    publicationStatus: legacy ? 'published' : recipe.publicationStatus,
    publicationStatusSource: legacy ? 'legacy' : 'explicit',
    isActive: recipe.isActive !== false,
  };
}

function canonicalUpdatedAt(recipe) {
  return new Date(recipe.updatedAt).toISOString();
}

function candidateId(recipe) {
  return String(recipe._id || recipe.id);
}

function compareMatches(left, right) {
  const priority = CLASSIFICATION_PRIORITY[left.classification] - CLASSIFICATION_PRIORITY[right.classification];
  if (priority !== 0) return priority;
  const titleOrder = compareText(String(left.recipe.title || ''), String(right.recipe.title || ''));
  return titleOrder || compareText(candidateId(left.recipe), candidateId(right.recipe));
}

function createDuplicateReview(subject, {
  candidates,
  candidateLimit = DUPLICATE_CANDIDATE_LIMIT,
  candidateUniverseCount,
  comparedCount,
  truncated,
}) {
  const subjectFingerprint = fingerprintRecipe(subject);
  const matches = candidates.map((recipe) => {
    const comparison = classifyRecipe(subject, recipe);
    return comparison.classification ? { recipe, ...comparison } : null;
  }).filter(Boolean).sort(compareMatches);

  const digestPayload = {
    fingerprintVersion: FINGERPRINT_VERSION,
    subject: subjectFingerprint.payload,
    candidateLimit,
    candidateUniverseCount,
    comparedCount,
    truncated,
    candidates: matches.map((match) => ({
      id: candidateId(match.recipe),
      payload: match.candidatePayload,
      classification: match.classification,
      ...effectiveLifecycle(match.recipe),
      updatedAt: canonicalUpdatedAt(match.recipe),
    })),
  };

  return {
    fingerprintVersion: FINGERPRINT_VERSION,
    resultDigest: sha256(canonicalJson(digestPayload)),
    candidateLimit,
    candidateUniverseCount,
    comparedCount,
    truncated,
    matches,
  };
}

module.exports = {
  FINGERPRINT_VERSION,
  DUPLICATE_CANDIDATE_LIMIT,
  canonicalRecipePayload,
  fingerprintRecipe,
  classifyRecipe,
  createDuplicateReview,
};
