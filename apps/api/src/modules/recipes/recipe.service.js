const recipeRepository = require('./recipe.repository');
const ingredientService = require('../ingredients/ingredient.service');
const { AppError } = require('../../shared/errors/app-error');

const SORT_MAP = {
  titleAsc: { title: 1 },
  titleDesc: { title: -1 },
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  prepTimeAsc: { prepTimeMinutes: 1 },
  prepTimeDesc: { prepTimeMinutes: -1 },
};

function notFoundError() {
  return new AppError('Recipe not found.', { statusCode: 404, code: 'RECIPE_NOT_FOUND' });
}

function forbiddenStatusError() {
  return new AppError('You do not have permission to view archived recipes.', {
    statusCode: 403,
    code: 'FORBIDDEN',
  });
}

function ingredientNotFoundError() {
  return new AppError('One or more referenced ingredients do not exist.', {
    statusCode: 404,
    code: 'RECIPE_INGREDIENT_NOT_FOUND',
  });
}

function ingredientInactiveError() {
  return new AppError('One or more referenced ingredients are not active.', {
    statusCode: 400,
    code: 'RECIPE_INGREDIENT_INACTIVE',
  });
}

// Escapes regex metacharacters so free-text search input is always treated
// as a literal substring match, never as attacker-controlled regex syntax.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collapseWhitespace(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeDietaryTags(tags = []) {
  return [...new Set(tags)];
}

// Every referenced Ingredient — including entries marked optional — must
// exist and be active before a recipe is created, before a replacement
// ingredient list is saved, or before a recipe is reactivated. This is
// stricter than (and distinct from) isUsableForNonAdmin below, which
// tolerates an optional entry going inactive after the fact. Verified via
// IngredientService only: RecipeService never imports the Ingredient
// model/repository directly (cross-module boundary rule).
async function assertIngredientsActive(ingredients) {
  const uniqueIds = [...new Set(ingredients.map((entry) => String(entry.ingredientId)))];
  const found = await Promise.all(uniqueIds.map((id) => ingredientService.findIngredientById(id)));

  found.forEach((ingredient) => {
    if (!ingredient) {
      throw ingredientNotFoundError();
    }
    if (!ingredient.isActive) {
      throw ingredientInactiveError();
    }
  });
}

function normalizeIngredients(ingredients) {
  return ingredients.map((entry) => ({
    ingredientId: entry.ingredientId,
    quantity: entry.unit === 'toTaste' ? undefined : entry.quantity,
    unit: entry.unit,
    note: entry.note ?? undefined,
    optional: entry.optional ?? false,
  }));
}

// A recipe is "usable" for a non-admin view when it is itself active and
// every non-optional ingredient entry resolves to a currently-active
// Ingredient (a populated ref that fails to resolve reads as missing/
// inactive). Archiving an Ingredient never cascades into Recipe documents —
// no transactions, no batch updates — so this is checked at read time
// instead. An optional entry (e.g. a garnish) going inactive does not hide
// the whole recipe. See docs/architecture/recipes.md.
function isUsableForNonAdmin(recipe) {
  if (!recipe.isActive) {
    return false;
  }
  return recipe.ingredients.every((entry) => {
    if (entry.optional) {
      return true;
    }
    const ingredient = entry.ingredientId;
    return Boolean(ingredient && ingredient.isActive);
  });
}

// A non-optional entry is always safe to show as-is by the time this runs —
// isUsableForNonAdmin already hid the entire recipe otherwise. An optional
// entry whose Ingredient has since been archived or deleted is exactly what
// keeps the recipe visible, but it must never be handed to a normal user
// looking like an ordinary, currently-active ingredient usage.
function isIngredientEntryVisibleToNonAdmin(entry) {
  if (!entry.optional) {
    return true;
  }
  const ingredient = entry.ingredientId;
  return Boolean(ingredient && ingredient.isActive);
}

// Strips unusable optional ingredient usages (archived/missing Ingredient)
// out of the response for a non-admin caller, without touching the stored
// Recipe document — no cascading writes, no mutation of what's persisted.
// Admins always see the complete, unfiltered relationship for management
// purposes, regardless of the requested `status`.
function toNonAdminView(recipe) {
  const plain = typeof recipe.toObject === 'function' ? recipe.toObject() : recipe;
  return { ...plain, ingredients: plain.ingredients.filter(isIngredientEntryVisibleToNonAdmin) };
}

async function createRecipe({
  title,
  description,
  cuisine,
  difficulty,
  prepTimeMinutes,
  cookTimeMinutes,
  servings,
  ingredients,
  instructions,
  dietaryTags = [],
  imageUrl,
}) {
  await assertIngredientsActive(ingredients);

  return recipeRepository.createRecipe({
    title: collapseWhitespace(title),
    description: description.trim(),
    cuisine,
    difficulty,
    prepTimeMinutes,
    cookTimeMinutes,
    servings,
    ingredients: normalizeIngredients(ingredients),
    instructions: instructions.map((step) => step.trim()),
    dietaryTags: normalizeDietaryTags(dietaryTags),
    imageUrl: imageUrl ?? null,
  });
}

// Raw lookup with no visibility filtering, for trusted cross-module use
// rather than direct HTTP responses. Returns null when not found; never
// throws.
function findRecipeById(id) {
  return recipeRepository.findRawById(id);
}

// HTTP-facing lookup: a non-admin caller gets a 404 for an archived or
// unusable recipe exactly as if it didn't exist.
async function getRecipeById(id, { isAdmin } = {}) {
  const recipe = await recipeRepository.findByIdWithIngredients(id);
  if (!recipe || (!isAdmin && !isUsableForNonAdmin(recipe))) {
    throw notFoundError();
  }
  return isAdmin ? recipe : toNonAdminView(recipe);
}

// A plain, stable { id, name } ingredient summary for one usage entry —
// deliberately decoupled from Recipe's internal populated-ref field name
// (ingredients[].ingredientId). Cross-module callers (ShoppingListService)
// must depend on this explicit contract, never on how Recipe happens to
// represent a populated Ingredient reference internally. Only called for
// entries that already survived toNonAdminView's filter below, so
// entry.ingredientId is guaranteed to be a populated, active Ingredient.
function toUsageSummary(entry) {
  const ingredient = entry.ingredientId;
  return {
    ingredient: { id: String(ingredient._id), name: ingredient.name },
    quantity: entry.quantity,
    unit: entry.unit,
    optional: entry.optional,
  };
}

// Cross-module lookup for other modules (Favorites, ShoppingList) that need
// to check whether a Recipe is currently usable for an ordinary (non-admin)
// user, without importing the Recipe model/repository directly — the
// cross-module rule in docs/architecture/backend.md. Returns null when the
// recipe doesn't exist or isn't currently usable; never throws (a genuine
// repository/database failure is left to propagate as-is, same as every
// other lookup in this service). Unlike getRecipeById, `ingredients` here
// uses the decoupled toUsageSummary shape above rather than Recipe's raw
// internal field name, so callers never depend on Recipe persistence
// internals — archived optional ingredient usages are already dropped by
// the same non-admin filtering getRecipeById uses.
async function findUsableRecipeById(id) {
  const recipe = await recipeRepository.findByIdWithIngredients(id);
  if (!recipe || !isUsableForNonAdmin(recipe)) {
    return null;
  }
  const view = toNonAdminView(recipe);
  return { ...view, ingredients: view.ingredients.map(toUsageSummary) };
}

async function listRecipes({
  search,
  cuisine,
  difficulty,
  dietaryTag,
  ingredientId,
  maxPrepTimeMinutes,
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
  if (status === 'active') {
    filter.isActive = true;
  } else if (status === 'inactive') {
    filter.isActive = false;
  }
  if (cuisine) {
    filter.cuisine = cuisine;
  }
  if (difficulty) {
    filter.difficulty = difficulty;
  }
  if (dietaryTag) {
    filter.dietaryTags = dietaryTag;
  }
  if (ingredientId) {
    filter['ingredients.ingredientId'] = ingredientId;
  }
  if (maxPrepTimeMinutes !== undefined) {
    filter.prepTimeMinutes = { $lte: maxPrepTimeMinutes };
  }
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: pattern }, { description: pattern }];
  }

  const skip = (page - 1) * limit;
  const [rawItems, total] = await Promise.all([
    recipeRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
    recipeRepository.countByFilter(filter),
  ]);

  // Known V1 simplification, same trade-off as substitutions (see
  // docs/architecture/recipes.md): the "usable" filter runs in application
  // code after the database page is fetched, so pagination.total/
  // totalPages reflect the pre-filter Recipe count and can overstate how
  // many usable recipes actually exist. The returned `data` array itself is
  // always safe — no unusable recipe is ever included.
  const usableItems = status === 'active' ? rawItems.filter(isUsableForNonAdmin) : rawItems;
  const items = isAdmin ? usableItems : usableItems.map(toNonAdminView);

  return { items, total, page, limit };
}

async function updateRecipe(id, patch) {
  const existing = await recipeRepository.findRawById(id);
  if (!existing) {
    throw notFoundError();
  }

  const update = {};
  if (patch.title !== undefined) update.title = collapseWhitespace(patch.title);
  if (patch.description !== undefined) update.description = patch.description.trim();
  if (patch.cuisine !== undefined) update.cuisine = patch.cuisine;
  if (patch.difficulty !== undefined) update.difficulty = patch.difficulty;
  if (patch.prepTimeMinutes !== undefined) update.prepTimeMinutes = patch.prepTimeMinutes;
  if (patch.cookTimeMinutes !== undefined) update.cookTimeMinutes = patch.cookTimeMinutes;
  if (patch.servings !== undefined) update.servings = patch.servings;
  if (patch.instructions !== undefined) update.instructions = patch.instructions.map((step) => step.trim());
  if (patch.dietaryTags !== undefined) update.dietaryTags = normalizeDietaryTags(patch.dietaryTags);
  if (patch.imageUrl !== undefined) update.imageUrl = patch.imageUrl;

  const reactivating = patch.isActive === true && existing.isActive === false;

  if (patch.ingredients !== undefined) {
    // The provided array is the complete replacement list — validate and
    // persist it wholesale rather than merging with what's stored.
    await assertIngredientsActive(patch.ingredients);
    update.ingredients = normalizeIngredients(patch.ingredients);
  } else if (reactivating) {
    // Reactivating without replacing ingredients: re-verify every
    // currently-stored ingredient (including optional entries) is still
    // active before allowing it back into the active view.
    await assertIngredientsActive(existing.ingredients);
  }

  if (patch.isActive !== undefined) update.isActive = patch.isActive;

  const updated = await recipeRepository.updateById(id, { $set: update });
  if (!updated) {
    throw notFoundError();
  }
  return updated;
}

async function archiveRecipe(id) {
  const archived = await recipeRepository.archiveById(id);
  if (!archived) {
    throw notFoundError();
  }
  return archived;
}

module.exports = {
  createRecipe,
  findRecipeById,
  findUsableRecipeById,
  getRecipeById,
  listRecipes,
  updateRecipe,
  archiveRecipe,
};