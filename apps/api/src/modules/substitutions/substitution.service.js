const substitutionRepository = require('./substitution.repository');
const ingredientService = require('../ingredients/ingredient.service');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
};

function notFoundError() {
  return new AppError('Substitution not found.', {
    statusCode: 404,
    code: 'SUBSTITUTION_NOT_FOUND',
  });
}

function duplicatePairError() {
  return new AppError('This substitution relationship already exists.', {
    statusCode: 409,
    code: 'SUBSTITUTION_ALREADY_EXISTS',
  });
}

function sameIngredientError() {
  return new AppError('A substitution cannot use the same ingredient as source and substitute.', {
    statusCode: 400,
    code: 'SUBSTITUTION_SAME_INGREDIENT',
  });
}

function forbiddenStatusError() {
  return new AppError('You do not have permission to view archived substitutions.', {
    statusCode: 403,
    code: 'FORBIDDEN',
  });
}

// Trims and drops case-insensitive duplicates, mirroring ingredient alias
// normalization.
function normalizeContexts(contexts = []) {
  const seen = new Set();
  const result = [];
  for (const raw of contexts) {
    const trimmed = raw.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

// Verifies (via IngredientService, never the Ingredient model/repository
// directly) that a referenced ingredient exists and is active. `label` is
// only used to make the error message point at which side (source vs
// substitute) failed.
async function assertActiveIngredient(id, label) {
  const ingredient = await ingredientService.findIngredientById(id);
  if (!ingredient) {
    throw new AppError(`${label} ingredient not found.`, {
      statusCode: 404,
      code: 'INGREDIENT_NOT_FOUND',
    });
  }
  if (!ingredient.isActive) {
    throw new AppError(`${label} ingredient is not active.`, {
      statusCode: 400,
      code: 'INGREDIENT_INACTIVE',
    });
  }
  return ingredient;
}

// A substitution is only "usable" for a non-admin caller when the
// relationship itself is active AND both referenced ingredients are still
// active (missing/archived populate refs read as null/inactive). See
// docs/architecture/ingredients-substitutions.md for why this is checked
// in application code rather than the query itself.
function isUsableForNonAdmin(substitution) {
  const source = substitution.sourceIngredientId;
  const substitute = substitution.substituteIngredientId;
  return Boolean(substitution.isActive && source?.isActive && substitute?.isActive);
}

async function createSubstitution({ sourceIngredientId, substituteIngredientId, ratio, contexts = [], notes }) {
  if (String(sourceIngredientId) === String(substituteIngredientId)) {
    throw sameIngredientError();
  }

  await assertActiveIngredient(sourceIngredientId, 'Source');
  await assertActiveIngredient(substituteIngredientId, 'Substitute');

  try {
    return await substitutionRepository.createSubstitution({
      sourceIngredientId,
      substituteIngredientId,
      ratio,
      contexts: normalizeContexts(contexts),
      notes,
    });
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw duplicatePairError();
    }
    throw err;
  }
}

async function getSubstitutionById(id, { isAdmin } = {}) {
  const substitution = await substitutionRepository.findByIdWithIngredients(id);
  if (!substitution || (!isAdmin && !isUsableForNonAdmin(substitution))) {
    throw notFoundError();
  }
  return substitution;
}

async function listSubstitutions({
  sourceIngredientId,
  substituteIngredientId,
  context,
  status,
  page,
  limit,
  sort,
  isAdmin,
}) {
  if ((status === 'inactive' || status === 'all') && !isAdmin) {
    throw forbiddenStatusError();
  }

  const filter = {};
  if (sourceIngredientId) {
    filter.sourceIngredientId = sourceIngredientId;
  }
  if (substituteIngredientId) {
    filter.substituteIngredientId = substituteIngredientId;
  }
  if (context) {
    filter.contexts = context;
  }
  if (status === 'active') {
    filter.isActive = true;
  } else if (status === 'inactive') {
    filter.isActive = false;
  }

  const skip = (page - 1) * limit;
  const [rawItems, total] = await Promise.all([
    substitutionRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
    substitutionRepository.countByFilter(filter),
  ]);

  // Known V1 simplification: pagination (skip/limit/total) is computed
  // against the Substitution collection alone. The "active" view then
  // additionally drops rows whose source/substitute ingredient has since
  // been archived, in application code, after the page is fetched — so a
  // page can come back with fewer than `limit` visible rows in the rare
  // case a referenced ingredient was archived after the substitution
  // stayed active. See docs/architecture/ingredients-substitutions.md.
  const items = status === 'active' ? rawItems.filter(isUsableForNonAdmin) : rawItems;

  return { items, total, page, limit };
}

async function updateSubstitution(id, patch) {
  const existing = await substitutionRepository.findRawById(id);
  if (!existing) {
    throw notFoundError();
  }

  const nextSourceId = patch.sourceIngredientId ?? String(existing.sourceIngredientId);
  const nextSubstituteId = patch.substituteIngredientId ?? String(existing.substituteIngredientId);
  if (String(nextSourceId) === String(nextSubstituteId)) {
    throw sameIngredientError();
  }

  const sourceChanged = patch.sourceIngredientId !== undefined;
  const substituteChanged = patch.substituteIngredientId !== undefined;
  const reactivating = patch.isActive === true && existing.isActive === false;

  if (sourceChanged || reactivating) {
    await assertActiveIngredient(nextSourceId, 'Source');
  }
  if (substituteChanged || reactivating) {
    await assertActiveIngredient(nextSubstituteId, 'Substitute');
  }

  const update = { $set: {} };
  if (sourceChanged) update.$set.sourceIngredientId = patch.sourceIngredientId;
  if (substituteChanged) update.$set.substituteIngredientId = patch.substituteIngredientId;
  if (patch.ratio !== undefined) update.$set.ratio = patch.ratio;
  if (patch.contexts !== undefined) update.$set.contexts = normalizeContexts(patch.contexts);
  if (patch.notes !== undefined) update.$set.notes = patch.notes;
  if (patch.isActive !== undefined) update.$set.isActive = patch.isActive;

  try {
    const updated = await substitutionRepository.updateById(id, update);
    if (!updated) {
      throw notFoundError();
    }
    return updated;
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw duplicatePairError();
    }
    throw err;
  }
}

async function archiveSubstitution(id) {
  const archived = await substitutionRepository.archiveById(id);
  if (!archived) {
    throw notFoundError();
  }
  return archived;
}

module.exports = {
  createSubstitution,
  getSubstitutionById,
  listSubstitutions,
  updateSubstitution,
  archiveSubstitution,
};