const recipeRepository = require('./recipe.repository');
const ingredientService = require('../ingredients/ingredient.service');
const { AppError } = require('../../shared/errors/app-error');
const imageProvider = require('../uploads/cloudinary-image.provider');

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

// Reduces validated step input to the persisted `instructions: string[]`
// shape (Mongo's source of truth). A structured `steps` array wins when
// present — the validation layer has already guaranteed contiguous 1..N
// ordering and, when `instructions` is also present, that the two are
// equivalent. Legacy `instructions` input passes straight through.
function toInstructionsList({ instructions, steps }) {
  if (steps !== undefined) {
    return [...steps].sort((a, b) => a.order - b.order).map((step) => step.text.trim());
  }
  return (instructions || []).map((step) => step.trim());
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
  region,
  category,
  difficulty,
  prepTimeMinutes,
  cookTimeMinutes,
  servings,
  ingredients,
  instructions,
  steps,
  dietaryTags = [],
  imageUrl,
  imageAssetId,
}) {
  await assertIngredientsActive(ingredients);

  const doc = {
    title: collapseWhitespace(title),
    description: description.trim(),
    difficulty,
    prepTimeMinutes,
    cookTimeMinutes,
    servings,
    ingredients: normalizeIngredients(ingredients),
    instructions: toInstructionsList({ instructions, steps }),
    dietaryTags: normalizeDietaryTags(dietaryTags),
    imageUrl: imageUrl ?? null,
    imageAssetId: imageAssetId ?? null,
  };
  // region/category are optional canonical slugs (already normalized by the
  // validation layer). Never fabricated from cuisine/title/anything else.
  if (region !== undefined) doc.region = region;
  if (category !== undefined) doc.category = category;

  return recipeRepository.createRecipe(doc);
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
  region,
  category,
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
  if (region) {
    filter.region = region;
  }
  if (category) {
    filter.category = category;
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
  // Fields removed from the document rather than set — an explicit `null` for
  // an optional slug field clears it (see recipe.validation.js).
  const unset = {};
  if (patch.title !== undefined) update.title = collapseWhitespace(patch.title);
  if (patch.description !== undefined) update.description = patch.description.trim();
  if (patch.region !== undefined) {
    if (patch.region === null) unset.region = '';
    else update.region = patch.region;
  }
  if (patch.category !== undefined) {
    if (patch.category === null) unset.category = '';
    else update.category = patch.category;
  }
  if (patch.difficulty !== undefined) update.difficulty = patch.difficulty;
  if (patch.prepTimeMinutes !== undefined) update.prepTimeMinutes = patch.prepTimeMinutes;
  if (patch.cookTimeMinutes !== undefined) update.cookTimeMinutes = patch.cookTimeMinutes;
  if (patch.servings !== undefined) update.servings = patch.servings;
  if (patch.instructions !== undefined || patch.steps !== undefined) {
    update.instructions = toInstructionsList({ instructions: patch.instructions, steps: patch.steps });
  }
  if (patch.dietaryTags !== undefined) update.dietaryTags = normalizeDietaryTags(patch.dietaryTags);
  const oldImageAssetId = existing.imageAssetId ?? null;
  let nextImageAssetId = oldImageAssetId;
  let shouldSetImageAssetId = false;
  if (patch.imageUrl !== undefined) {
    update.imageUrl = patch.imageUrl;
    if (patch.imageUrl === null) {
      nextImageAssetId = null;
      shouldSetImageAssetId = true;
    } else if (patch.imageAssetId !== undefined) {
      nextImageAssetId = patch.imageAssetId;
      shouldSetImageAssetId = true;
    } else if (patch.imageUrl !== existing.imageUrl) {
      // A changed URL without managed metadata is a manual external image.
      nextImageAssetId = null;
      shouldSetImageAssetId = true;
    }
    if (shouldSetImageAssetId) {
      update.imageAssetId = nextImageAssetId;
    }
  }

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

  const ops = {};
  if (Object.keys(update).length > 0) ops.$set = update;
  if (Object.keys(unset).length > 0) ops.$unset = unset;

  const updated = await recipeRepository.updateById(id, ops);
  if (!updated) {
    throw notFoundError();
  }

  // Database state changes first. Cleanup is best-effort and can never roll
  // back a successful recipe update or delete an unmanaged external image.
  if (oldImageAssetId && oldImageAssetId !== nextImageAssetId) {
    try {
      await imageProvider.deleteByAssetId(oldImageAssetId);
    } catch {
      console.warn('Previous managed recipe image cleanup failed.');
    }
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
