const ingredientRepository = require('./ingredient.repository');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;

const SORT_MAP = {
  nameAsc: { name: 1 },
  nameDesc: { name: -1 },
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
};

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Trims/collapses whitespace and drops case-insensitive duplicates within
// the same ingredient, preserving the first-seen casing of each alias.
function normalizeAliases(aliases = []) {
  const seen = new Set();
  const result = [];
  for (const raw of aliases) {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

function normalizeAllergenTags(allergenTags = []) {
  return [...new Set(allergenTags)];
}

function duplicateNameError() {
  return new AppError('An ingredient with this name already exists.', {
    statusCode: 409,
    code: 'INGREDIENT_ALREADY_EXISTS',
  });
}

function notFoundError() {
  return new AppError('Ingredient not found.', { statusCode: 404, code: 'INGREDIENT_NOT_FOUND' });
}

function forbiddenStatusError() {
  return new AppError('You do not have permission to view archived ingredients.', {
    statusCode: 403,
    code: 'FORBIDDEN',
  });
}

// Escapes regex metacharacters so free-text search input is always treated
// as a literal substring match, never as attacker-controlled regex syntax.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function createIngredient({ name, aliases = [], category, allergenTags = [] }) {
  const trimmedName = name.trim();

  try {
    return await ingredientRepository.createIngredient({
      name: trimmedName,
      normalizedName: normalizeName(trimmedName),
      aliases: normalizeAliases(aliases),
      category,
      allergenTags: normalizeAllergenTags(allergenTags),
    });
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw duplicateNameError();
    }
    throw err;
  }
}

// Raw lookup with no visibility filtering, for trusted cross-module use
// (e.g. SubstitutionService validating a referenced ingredient) rather than
// direct HTTP responses. Returns null when not found; never throws.
function findIngredientById(id) {
  return ingredientRepository.findById(id);
}

// HTTP-facing lookup: a non-admin caller gets a 404 for an archived
// ingredient exactly as if it didn't exist, rather than a distinguishing
// error that would reveal it once existed.
async function getIngredientById(id, { isAdmin } = {}) {
  const ingredient = await ingredientRepository.findById(id);
  if (!ingredient || (!ingredient.isActive && !isAdmin)) {
    throw notFoundError();
  }
  return ingredient;
}

async function listIngredients({ search, category, allergen, status, page, limit, sort, isAdmin }) {
  if ((status === 'inactive' || status === 'all') && !isAdmin) {
    throw forbiddenStatusError();
  }

  const filter = {};
  if (status === 'active') {
    filter.isActive = true;
  } else if (status === 'inactive') {
    filter.isActive = false;
  }
  if (category) {
    filter.category = category;
  }
  if (allergen) {
    filter.allergenTags = allergen;
  }
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: pattern }, { aliases: pattern }];
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    ingredientRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
    ingredientRepository.countByFilter(filter),
  ]);

  return { items, total, page, limit };
}

async function updateIngredient(id, patch) {
  const update = {};
  if (patch.name !== undefined) {
    const trimmedName = patch.name.trim();
    update.name = trimmedName;
    update.normalizedName = normalizeName(trimmedName);
  }
  if (patch.aliases !== undefined) {
    update.aliases = normalizeAliases(patch.aliases);
  }
  if (patch.category !== undefined) {
    update.category = patch.category;
  }
  if (patch.allergenTags !== undefined) {
    update.allergenTags = normalizeAllergenTags(patch.allergenTags);
  }
  if (patch.isActive !== undefined) {
    update.isActive = patch.isActive;
  }

  try {
    const updated = await ingredientRepository.updateById(id, { $set: update });
    if (!updated) {
      throw notFoundError();
    }
    return updated;
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw duplicateNameError();
    }
    throw err;
  }
}

async function archiveIngredient(id) {
  const archived = await ingredientRepository.archiveById(id);
  if (!archived) {
    throw notFoundError();
  }
  return archived;
}

module.exports = {
  createIngredient,
  findIngredientById,
  getIngredientById,
  listIngredients,
  updateIngredient,
  archiveIngredient,
};