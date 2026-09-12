const collectionRepository = require('./collection.repository');
const collectionRecipeRepository = require('./collection-recipe.repository');
const recipeService = require('../recipes/recipe.service');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;
// Cover images on a collection-list card show at most this many recipes —
// matches the mobile Saved-screen collage (1 full image, or a 2x2 quad).
const COVER_LIMIT = 4;

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
};

function notFoundError() {
  return new AppError('Collection not found.', { statusCode: 404, code: 'COLLECTION_NOT_FOUND' });
}

function recipeNotFoundError() {
  return new AppError('Recipe not found.', { statusCode: 404, code: 'RECIPE_NOT_FOUND' });
}

function alreadyExistsError() {
  return new AppError('This recipe is already in the collection.', {
    statusCode: 409,
    code: 'COLLECTION_RECIPE_ALREADY_EXISTS',
  });
}

function membershipNotFoundError() {
  return new AppError('This recipe is not in the collection.', {
    statusCode: 404,
    code: 'COLLECTION_RECIPE_NOT_FOUND',
  });
}

// Creates a Collection for the current user. `userId` always comes from the
// authenticated caller (req.auth.userId in the controller) — never accepted
// from the request body, so ownership can't be forged. Duplicate collection
// names for the same user are deliberately allowed: the teammate UI this
// ports (CollectionsContext, audited pre-implementation) never validated
// uniqueness either, and inventing a uniqueness/slug policy the product
// never asked for would be unjustified complexity. See collection.routes.js
// for the API surface this backs.
async function createCollection(userId, { name, description }) {
  const doc = { userId, name };
  if (description !== undefined) doc.description = description;
  return collectionRepository.createCollection(doc);
}

// Resolves cover images + recipeCount for one collection's list-card. Known
// V1 simplification, same trade-off Favorites documents: recipeCount reflects
// the raw membership count, which can include a recipe that has since become
// archived/unusable — cheap to compute (a single countDocuments) and no list
// screen has ever promised a live-filtered count. The covers themselves ARE
// filtered through RecipeService, so a card never shows an unusable recipe's
// image.
async function withCardData(collection) {
  const [recipeCount, recentMemberships] = await Promise.all([
    collectionRecipeRepository.countByFilter({ collectionId: collection._id }),
    collectionRecipeRepository.findRecentRecipeIds(collection._id, COVER_LIMIT),
  ]);
  const recipes = await Promise.all(
    recentMemberships.map((membership) => recipeService.findUsableRecipeById(membership.recipeId))
  );
  const coverRecipes = recipes.filter((recipe) => recipe !== null);
  return { collection, recipeCount, coverRecipes };
}

async function listCollections(userId) {
  const collections = await collectionRepository.findManyByUser(userId);
  return Promise.all(collections.map(withCardData));
}

async function getCollection(userId, collectionId) {
  const collection = await collectionRepository.findOwnedById(collectionId, userId);
  if (!collection) {
    throw notFoundError();
  }
  return collection;
}

async function updateCollection(userId, collectionId, patch) {
  const update = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;

  const updated = await collectionRepository.updateOwnedById(collectionId, userId, update);
  if (!updated) {
    throw notFoundError();
  }
  return updated;
}

// Deletes the collection, then cascades to remove its membership rows. The
// collection lookup is ownership-scoped first, so a non-owner's delete
// attempt never triggers a cascade against someone else's collection.
async function deleteCollection(userId, collectionId) {
  const deleted = await collectionRepository.deleteOwnedById(collectionId, userId);
  if (!deleted) {
    throw notFoundError();
  }
  await collectionRecipeRepository.deleteAllByCollectionId(deleted._id);
  return deleted;
}

async function listCollectionRecipes(userId, collectionId, { page, limit, sort }) {
  const collection = await collectionRepository.findOwnedById(collectionId, userId);
  if (!collection) {
    throw notFoundError();
  }

  const filter = { collectionId: collection._id };
  const skip = (page - 1) * limit;
  const [memberships, total] = await Promise.all([
    collectionRecipeRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
    collectionRecipeRepository.countByFilter(filter),
  ]);

  // Same known V1 trade-off as Favorites: resolved through RecipeService and
  // any since-archived/unusable recipe is omitted, so total/totalPages below
  // reflect the pre-filter membership count, not items.length.
  const resolved = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      recipe: await recipeService.findUsableRecipeById(membership.recipeId),
    }))
  );
  const items = resolved.filter((entry) => entry.recipe !== null);

  return { items, total, page, limit };
}

// Adding a recipe to a collection requires BOTH: the collection is owned by
// the caller, and the recipe currently exists/is usable (resolved through
// RecipeService only, never the Recipe model/repository directly — the same
// cross-module rule Favorites and ShoppingList follow).
async function addRecipeToCollection(userId, collectionId, recipeId) {
  const collection = await collectionRepository.findOwnedById(collectionId, userId);
  if (!collection) {
    throw notFoundError();
  }

  const recipe = await recipeService.findUsableRecipeById(recipeId);
  if (!recipe) {
    throw recipeNotFoundError();
  }

  let membership;
  try {
    membership = await collectionRecipeRepository.createMembership({
      collectionId: collection._id,
      recipeId,
    });
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw alreadyExistsError();
    }
    throw err;
  }

  return { membership, recipe };
}

// Removal only ever touches the CollectionRecipe collection — it must still
// work even if the referenced Recipe has since become archived/unavailable.
async function removeRecipeFromCollection(userId, collectionId, recipeId) {
  const collection = await collectionRepository.findOwnedById(collectionId, userId);
  if (!collection) {
    throw notFoundError();
  }

  const deleted = await collectionRecipeRepository.deleteByCollectionAndRecipe(collection._id, recipeId);
  if (!deleted) {
    throw membershipNotFoundError();
  }
  return deleted;
}

module.exports = {
  createCollection,
  listCollections,
  getCollection,
  updateCollection,
  deleteCollection,
  listCollectionRecipes,
  addRecipeToCollection,
  removeRecipeFromCollection,
};
