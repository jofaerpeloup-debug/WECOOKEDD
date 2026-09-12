const collectionService = require('./collection.service');
const {
  toPublicCollection,
  toPublicCollectionDetail,
  toPublicCollectionRecipe,
} = require('./collection.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listCollections = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const cards = await collectionService.listCollections(userId);
  sendSuccess(res, { collections: cards.map(toPublicCollection) });
});

const createCollection = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { name, description } = req.validated.body;

  const collection = await collectionService.createCollection(userId, { name, description });
  sendSuccess(res, { collection: toPublicCollectionDetail(collection) }, 201);
});

const getCollection = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { collectionId } = req.params;

  const collection = await collectionService.getCollection(userId, collectionId);
  sendSuccess(res, { collection: toPublicCollectionDetail(collection) });
});

const updateCollection = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { collectionId } = req.params;
  const patch = req.validated.body;

  const collection = await collectionService.updateCollection(userId, collectionId, patch);
  sendSuccess(res, { collection: toPublicCollectionDetail(collection) });
});

const deleteCollection = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { collectionId } = req.params;

  await collectionService.deleteCollection(userId, collectionId);
  sendSuccess(res, { deleted: true });
});

const listCollectionRecipes = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { collectionId } = req.params;
  const { page, limit, sort } = req.validated.query;

  const { items, total } = await collectionService.listCollectionRecipes(userId, collectionId, {
    page,
    limit,
    sort,
  });

  sendSuccess(res, {
    recipes: items.map(toPublicCollectionRecipe),
    pagination: toPagination({ page, limit, total }),
  });
});

const addCollectionRecipe = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { collectionId } = req.params;
  const { recipeId } = req.validated.body;

  const result = await collectionService.addRecipeToCollection(userId, collectionId, recipeId);
  sendSuccess(res, { recipe: toPublicCollectionRecipe(result) }, 201);
});

const removeCollectionRecipe = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { collectionId, recipeId } = req.params;

  await collectionService.removeRecipeFromCollection(userId, collectionId, recipeId);
  sendSuccess(res, { deleted: true });
});

module.exports = {
  listCollections,
  createCollection,
  getCollection,
  updateCollection,
  deleteCollection,
  listCollectionRecipes,
  addCollectionRecipe,
  removeCollectionRecipe,
};
