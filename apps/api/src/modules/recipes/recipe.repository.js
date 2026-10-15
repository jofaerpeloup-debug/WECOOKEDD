const Recipe = require('./recipe.model');
const Review = require('../reviews/review.model');
const Ingredient = require('../ingredients/ingredient.model');
const { consumerPublicationFilter } = require('./recipe.visibility');

const {
  DIFFICULTIES,
  UNITS,
  DIETARY_TAGS,
  REGIONS,
  CATEGORIES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_PREP_TIME_MINUTES,
  MAX_COOK_TIME_MINUTES,
  MAX_SERVINGS,
  MAX_INGREDIENTS,
  MAX_INSTRUCTIONS,
  MAX_INSTRUCTION_LENGTH,
  MAX_INGREDIENT_NOTE_LENGTH,
  MAX_IMAGE_URL_LENGTH,
  MAX_IMAGE_ASSET_ID_LENGTH,
  MAX_NUTRITION_SOURCE_LABEL_LENGTH,
} = Recipe;

// Only the fields a populated ingredient summary is allowed to expose (see
// recipe.serializer.js) plus isActive, which the service needs to decide
// per-recipe usability but never forwards to the client.
const INGREDIENT_SUMMARY_FIELDS = 'name isActive';
const DUPLICATE_COMPARISON_FIELDS = '_id title ingredients instructions publicationStatus isActive updatedAt';
const SMART_COLLECTION_CANDIDATE_FIELDS = [
  '_id', 'title', 'description', 'region', 'category', 'difficulty',
  'prepTimeMinutes', 'cookTimeMinutes', 'servings', 'nutrition',
  'nutritionProvenance', 'ingredients', 'instructions', 'dietaryTags',
  'imageUrl', 'imageAssetId', 'publicationStatus', 'isActive',
  'createdAt', 'updatedAt',
].join(' ');
const SMART_COLLECTION_BATCH_SIZE = 100;
const SHOPPING_SOURCE_FIELDS = '_id title description difficulty prepTimeMinutes cookTimeMinutes servings ingredients instructions dietaryTags imageUrl imageAssetId region category nutrition nutritionProvenance publicationStatus isActive';

function withIngredientSummaries(query) {
  return query.populate('ingredients.ingredientId', INGREDIENT_SUMMARY_FIELDS);
}

async function createRecipe(data) {
  const doc = await Recipe.create(data);
  return doc.populate('ingredients.ingredientId', INGREDIENT_SUMMARY_FIELDS);
}

// Unpopulated lookup for internal service logic (existence checks, patch
// merges) where ingredients[].ingredientId must stay a raw ObjectId rather
// than a populated Ingredient document.
function findRawById(id) {
  return Recipe.findById(id);
}

function findByIdWithIngredients(id) {
  return withIngredientSummaries(Recipe.findById(id));
}

function findShoppingSourceCandidates(ids) {
  return withIngredientSummaries(Recipe.find({ _id: { $in: ids } }, SHOPPING_SOURCE_FIELDS));
}

function mutationFilter(id, expectedRevision, expectedUpdatedAt) {
  const filter = { _id: id };
  if (expectedRevision === undefined) {
    filter.__v = { $exists: false };
  } else if (Number.isSafeInteger(expectedRevision) && expectedRevision >= 0
    && expectedRevision < Number.MAX_SAFE_INTEGER) {
    filter.__v = expectedRevision;
  } else {
    throw new Error('Recipe revision is invalid.');
  }
  if (expectedUpdatedAt) filter.updatedAt = new Date(expectedUpdatedAt);
  return filter;
}

function updateById(id, update, { expectedUpdatedAt, expectedRevision } = {}) {
  return withIngredientSummaries(
    Recipe.findOneAndUpdate(mutationFilter(id, expectedRevision, expectedUpdatedAt), {
      ...update,
      $inc: { __v: 1 },
    }, {
      returnDocument: 'after',
      runValidators: true,
    })
  );
}

function publishById(id, {
  actorId, publishedAt, expectedUpdatedAt, expectedRevision,
  imageUrlIsPublicHttps, nutritionSourceUrlIsPublicHttps,
}) {
  return withIngredientSummaries(
    Recipe.findOneAndUpdate(
      {
        ...mutationFilter(id, expectedRevision, expectedUpdatedAt),
        isActive: true,
        publicationStatus: 'draft',
      },
      {
        $set: {
          publicationStatus: 'published',
          publishedBy: actorId,
          publishedAt,
          updatedBy: actorId,
          imageUrlIsPublicHttps,
          nutritionSourceUrlIsPublicHttps,
        },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', runValidators: true }
    )
  );
}

function archiveById(id, { actorId, expectedUpdatedAt, expectedRevision } = {}) {
  const update = { isActive: false };
  if (actorId) update.updatedBy = actorId;
  return withIngredientSummaries(
    Recipe.findOneAndUpdate(
      mutationFilter(id, expectedRevision, expectedUpdatedAt),
      { $set: update, $inc: { __v: 1 } },
      { returnDocument: 'after' }
    )
  );
}

function restoreById(id, {
  actorId, expectedUpdatedAt, expectedRevision,
  imageUrlIsPublicHttps, nutritionSourceUrlIsPublicHttps,
} = {}) {
  const update = { isActive: true, imageUrlIsPublicHttps, nutritionSourceUrlIsPublicHttps };
  if (actorId) update.updatedBy = actorId;
  return withIngredientSummaries(
    Recipe.findOneAndUpdate(
      mutationFilter(id, expectedRevision, expectedUpdatedAt),
      { $set: update, $inc: { __v: 1 } },
      { returnDocument: 'after' }
    )
  );
}

function findMany({ filter, sort, skip, limit }) {
  let query = Recipe.find(filter).sort(sort);
  if (skip !== undefined) query = query.skip(skip);
  if (limit !== undefined) query = query.limit(limit);
  return withIngredientSummaries(query);
}

function aggregateFilter(filter) {
  const result = { ...filter };
  if (typeof result['ingredients.ingredientId'] === 'string') {
    result['ingredients.ingredientId'] = new Recipe.base.Types.ObjectId(result['ingredients.ingredientId']);
  }
  if (typeof result._id?.$ne === 'string') {
    result._id = { ...result._id, $ne: new Recipe.base.Types.ObjectId(result._id.$ne) };
  }
  return result;
}

function typeIs(path, type) {
  return { $eq: [{ $type: path }, type] };
}

function safeString(path) {
  return { $cond: [typeIs(path, 'string'), path, ''] };
}

function trimmedString(path) {
  // ECMAScript String.trim() whitespace, including BOM and line separators.
  const trimChars = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  return { $trim: { input: safeString(path), chars: trimChars } };
}

function utf16Length(path) {
  const input = trimmedString(path);
  return {
    $add: [
      { $strLenCP: input },
      { $size: { $regexFindAll: {
        input,
        regex: '[\\x{10000}-\\x{10FFFF}]',
      } } },
    ],
  };
}

function stringLengthBetween(path, minimum, maximum) {
  const length = utf16Length(path);
  return {
    $and: [
      typeIs(path, 'string'),
      { $gte: [length, minimum] },
      { $lte: [length, maximum] },
    ],
  };
}

function safeArray(path) {
  return { $cond: [{ $isArray: path }, path, []] };
}

function integerBetween(path, minimum, maximum) {
  const value = { $cond: [{ $isNumber: path }, path, null] };
  return {
    $and: [
      { $isNumber: path },
      { $eq: [value, { $trunc: value }] },
      { $gte: [value, minimum] },
      { $lte: [value, maximum] },
    ],
  };
}

function optionalIntegerBetween(path, minimum, maximum) {
  return { $or: [typeIs(path, 'missing'), integerBetween(path, minimum, maximum)] };
}

function optionalEnum(path, values) {
  return {
    $or: [
      typeIs(path, 'missing'),
      typeIs(path, 'null'),
      { $in: [path, values] },
    ],
  };
}

function safeObject(path) {
  return { $cond: [typeIs(path, 'object'), path, {}] };
}

function exactNutritionExpression() {
  const keys = [
    'schemaVersion', 'basis', 'caloriesKcal', 'proteinGrams',
    'carbohydrateGrams', 'fatGrams', 'sugarGrams', 'fiberGrams',
  ];
  const actualKeys = { $map: {
    input: { $objectToArray: safeObject('$nutrition') },
    as: 'entry',
    in: '$$entry.k',
  } };
  return {
    $and: [
      typeIs('$nutrition', 'object'),
      { $eq: [{ $size: actualKeys }, keys.length] },
      { $setEquals: [actualKeys, keys] },
      { $eq: ['$nutrition.schemaVersion', 1] },
      { $eq: ['$nutrition.basis', 'perServing'] },
      ...keys.slice(2).map((key) => {
        const path = `$nutrition.${key}`;
        return {
          $and: [
            { $in: [{ $type: path }, ['double', 'int', 'long']] },
            { $gte: [path, 0] },
            { $lte: [path, Number.MAX_VALUE] },
            { $or: [
              { $ne: [{ $type: path }, 'long'] },
              { $lte: [path, Number.MAX_SAFE_INTEGER] },
            ] },
          ],
        };
      }),
    ],
  };
}

function nutritionProvenanceExpression() {
  const sourceUrl = '$nutritionProvenance.sourceUrl';
  const acceptedAt = '$nutritionProvenance.acceptedAt';
  const acceptedAtMillis = { $toLong: { $cond: [typeIs(acceptedAt, 'date'), acceptedAt, new Date(0)] } };
  return {
    $and: [
      typeIs('$nutritionProvenance', 'object'),
      { $in: ['$nutritionProvenance.sourceKind', ['manual', 'jsonLd']] },
      stringLengthBetween('$nutritionProvenance.sourceLabel', 1, MAX_NUTRITION_SOURCE_LABEL_LENGTH),
      typeIs('$nutritionProvenance.acceptedBy', 'objectId'),
      typeIs(acceptedAt, 'date'),
      { $gte: [acceptedAtMillis, -8640000000000000] },
      { $lte: [acceptedAtMillis, 8640000000000000] },
      {
        $or: [
          { $in: [{ $type: sourceUrl }, ['missing', 'null']] },
          {
            $and: [
              stringLengthBetween(sourceUrl, 1, MAX_IMAGE_URL_LENGTH),
              { $eq: ['$nutritionSourceUrlIsPublicHttps', true] },
            ],
          },
        ],
      },
    ],
  };
}

function consumerCompletenessExpression() {
  const ingredients = safeArray('$ingredients');
  const instructions = safeArray('$instructions');
  const dietaryTags = safeArray('$dietaryTags');
  const imageUrlType = { $type: '$imageUrl' };
  const imageAssetIdType = { $type: '$imageAssetId' };

  return {
    $and: [
      stringLengthBetween('$title', 1, MAX_TITLE_LENGTH),
      stringLengthBetween('$description', 1, MAX_DESCRIPTION_LENGTH),
      optionalEnum('$region', [...REGIONS, 'tondo', 'bicol', 'mangaldan']),
      optionalEnum('$category', [...CATEGORIES, 'fine-dining-restaurant', 'medium']),
      { $in: ['$difficulty', DIFFICULTIES] },
      optionalIntegerBetween('$prepTimeMinutes', 0, MAX_PREP_TIME_MINUTES),
      integerBetween('$cookTimeMinutes', 0, MAX_COOK_TIME_MINUTES),
      integerBetween('$servings', 1, MAX_SERVINGS),
      { $isArray: '$ingredients' },
      { $gte: [{ $size: ingredients }, 1] },
      { $lte: [{ $size: ingredients }, MAX_INGREDIENTS] },
      {
        $allElementsTrue: [{
          $map: {
            input: ingredients,
            as: 'usage',
            in: {
              $and: [
                typeIs('$$usage.ingredientId', 'objectId'),
                { $in: ['$$usage.unit', UNITS] },
                {
                  $in: [
                    { $type: '$$usage.optional' },
                    ['missing', 'null', 'bool'],
                  ],
                },
                {
                  $or: [
                    {
                      $and: [
                        { $eq: ['$$usage.unit', 'toTaste'] },
                        { $in: [{ $type: '$$usage.quantity' }, ['missing', 'null']] },
                      ],
                    },
                    {
                      $and: [
                        { $ne: ['$$usage.unit', 'toTaste'] },
                        { $isNumber: '$$usage.quantity' },
                        { $gt: ['$$usage.quantity', 0] },
                        { $lte: ['$$usage.quantity', Number.MAX_VALUE] },
                      ],
                    },
                  ],
                },
                {
                  $or: [
                    { $in: [{ $type: '$$usage.note' }, ['missing', 'null']] },
                    stringLengthBetween('$$usage.note', 0, MAX_INGREDIENT_NOTE_LENGTH),
                  ],
                },
              ],
            },
          },
        }],
      },
      { $isArray: '$instructions' },
      { $gte: [{ $size: instructions }, 1] },
      { $lte: [{ $size: instructions }, MAX_INSTRUCTIONS] },
      {
        $allElementsTrue: [{
          $map: {
            input: instructions,
            as: 'instruction',
            in: stringLengthBetween('$$instruction', 1, MAX_INSTRUCTION_LENGTH),
          },
        }],
      },
      {
        $or: [
          { $in: [{ $type: '$dietaryTags' }, ['missing', 'null']] },
          {
            $and: [
              { $isArray: '$dietaryTags' },
              { $lte: [{ $size: dietaryTags }, DIETARY_TAGS.length] },
              { $setIsSubset: [dietaryTags, DIETARY_TAGS] },
            ],
          },
        ],
      },
      {
        $or: [
          { $in: [imageUrlType, ['missing', 'null']] },
          {
            $and: [
              typeIs('$imageUrl', 'string'),
              stringLengthBetween('$imageUrl', 1, MAX_IMAGE_URL_LENGTH),
              { $eq: ['$imageUrlIsPublicHttps', true] },
            ],
          },
        ],
      },
      {
        $or: [
          { $in: [imageAssetIdType, ['missing', 'null']] },
          stringLengthBetween('$imageAssetId', 1, MAX_IMAGE_ASSET_ID_LENGTH),
        ],
      },
      {
        $or: [
          { $in: [imageAssetIdType, ['missing', 'null']] },
          { $eq: [imageUrlType, 'string'] },
        ],
      },
      {
        $or: [
          {
            $and: [
              { $in: [{ $type: '$nutrition' }, ['missing', 'null']] },
              { $in: [{ $type: '$nutritionProvenance' }, ['missing', 'null']] },
            ],
          },
          {
            $and: [exactNutritionExpression(), nutritionProvenanceExpression()],
          },
        ],
      },
    ],
  };
}

function consumerEligibilityStages() {
  return [
    { $match: { $expr: consumerCompletenessExpression() } },
    {
      $set: {
        _requiredIngredientIds: {
          $setUnion: [
            [],
            {
              $map: {
                input: {
                  $filter: {
                    input: '$ingredients',
                    as: 'usage',
                    cond: { $ne: ['$$usage.optional', true] },
                  },
                },
                as: 'usage',
                in: '$$usage.ingredientId',
              },
            },
          ],
        },
      },
    },
    {
      $lookup: {
        from: Ingredient.collection.name,
        let: { requiredIds: '$_requiredIngredientIds' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ['$_id', '$$requiredIds'] },
                  { $eq: ['$isActive', true] },
                ],
              },
            },
          },
          { $project: { _id: 1 } },
        ],
        as: '_activeRequiredIngredients',
      },
    },
    {
      $match: {
        $expr: {
          $eq: [
            { $size: '$_activeRequiredIngredients' },
            { $size: '$_requiredIngredientIds' },
          ],
        },
      },
    },
    { $unset: ['_requiredIngredientIds', '_activeRequiredIngredients'] },
  ];
}

function topRatedStages() {
  return [
    {
      $lookup: {
        from: Review.collection.name,
        let: { rankedRecipeId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$recipeId', '$$rankedRecipeId'] } } },
          {
            $group: {
              _id: null,
              averageRating: { $avg: '$rating' },
              ratingCount: { $sum: 1 },
            },
          },
        ],
        as: '_rankingReviews',
      },
    },
    { $set: { _rankingReviews: { $first: '$_rankingReviews' } } },
    { $match: { '_rankingReviews.ratingCount': { $gt: 0 } } },
  ];
}

async function aggregatePage({ filter, sort, rankedSort, skip, limit, consumerOnly = false }) {
  const pipeline = [{ $match: aggregateFilter(filter) }];

  if (consumerOnly) pipeline.push(...consumerEligibilityStages());
  if (rankedSort === 'relevance') {
    pipeline.push({
      $set: {
        _rankingScore: { $meta: 'textScore' },
      },
    });
  }
  if (rankedSort === 'topRated') pipeline.push(...topRatedStages());

  const sortSpec = rankedSort === 'relevance'
    ? { _rankingScore: -1, _id: 1 }
    : rankedSort === 'topRated'
      ? { '_rankingReviews.averageRating': -1, '_rankingReviews.ratingCount': -1, _id: 1 }
      : sort;
  if (!sortSpec) throw new Error(`Unsupported ranked recipe sort: ${rankedSort}`);

  pipeline.push({
    $facet: {
      items: [
        { $sort: sortSpec },
        { $skip: skip },
        { $limit: limit },
        ...(rankedSort === 'topRated' ? [{
          $set: {
            _ratingSummary: {
              averageRating: { $round: ['$_rankingReviews.averageRating', 1] },
              ratingCount: '$_rankingReviews.ratingCount',
            },
          },
        }] : []),
        { $unset: ['_rankingScore', '_rankingReviews'] },
      ],
      total: [{ $count: 'value' }],
    },
  });

  const [page = { items: [], total: [] }] = await Recipe.aggregate(pipeline);
  const items = await Recipe.populate(page.items, {
    path: 'ingredients.ingredientId',
    select: INGREDIENT_SUMMARY_FIELDS,
  });
  return { items, total: page.total[0]?.value || 0 };
}

function findRanked({ filter, sort, skip, limit, consumerOnly = false }) {
  return aggregatePage({ filter, rankedSort: sort, skip, limit, consumerOnly });
}

function findConsumerPage({ filter, sort, skip, limit }) {
  return aggregatePage({ filter, sort, skip, limit, consumerOnly: true });
}

function countByFilter(filter) {
  return Recipe.countDocuments(filter);
}

function streamSmartCollectionCandidates() {
  return withIngredientSummaries(Recipe.find({
    isActive: true,
    ...consumerPublicationFilter(),
  }, SMART_COLLECTION_CANDIDATE_FIELDS)
    .sort({ title: 1, _id: 1 })
    .lean())
    .cursor({ batchSize: SMART_COLLECTION_BATCH_SIZE });
}

function duplicateLifecycleFilters(excludeId) {
  const withoutSelf = excludeId ? { _id: { $ne: excludeId } } : {};
  return [
    { ...withoutSelf, publicationStatus: 'published', isActive: true },
    { ...withoutSelf, publicationStatus: 'published', isActive: false },
    { ...withoutSelf, publicationStatus: null, isActive: true },
    { ...withoutSelf, publicationStatus: null, isActive: false },
    { ...withoutSelf, publicationStatus: 'draft', isActive: true },
  ];
}

function compareDuplicateCandidateOrder(left, right) {
  const updatedOrder = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  if (updatedOrder !== 0) return updatedOrder;
  const leftId = String(left._id);
  const rightId = String(right._id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

async function findDuplicateCandidates({ excludeId, limit }) {
  const filters = duplicateLifecycleFilters(excludeId);
  const [branches, counts] = await Promise.all([
    Promise.all(filters.map((filter) => Recipe.find(filter, DUPLICATE_COMPARISON_FIELDS)
      .sort({ updatedAt: -1, _id: 1 })
      .limit(limit + 1)
      .lean())),
    Promise.all(filters.map((filter) => Recipe.countDocuments(filter))),
  ]);
  const candidateUniverseCount = counts.reduce((total, count) => total + count, 0);
  const candidates = branches.flat().sort(compareDuplicateCandidateOrder).slice(0, limit);
  return {
    candidates,
    candidateUniverseCount,
    comparedCount: candidates.length,
    truncated: candidateUniverseCount > candidates.length,
  };
}

async function hasActiveConsumerRecipeUsingIngredient(ingredientId) {
  const match = await Recipe.exists({
    isActive: true,
    'ingredients.ingredientId': ingredientId,
    ...consumerPublicationFilter(),
  });
  return Boolean(match);
}

module.exports = {
  createRecipe,
  findRawById,
  findByIdWithIngredients,
  findShoppingSourceCandidates,
  updateById,
  publishById,
  archiveById,
  restoreById,
  findMany,
  findRanked,
  findConsumerPage,
  countByFilter,
  streamSmartCollectionCandidates,
  findDuplicateCandidates,
  hasActiveConsumerRecipeUsingIngredient,
};
