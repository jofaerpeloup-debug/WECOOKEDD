const recipeRepository = require('./recipe.repository');
const ingredientService = require('../ingredients/ingredient.service');
const { AppError } = require('../../shared/errors/app-error');
const imageProvider = require('../uploads/cloudinary-image.provider');
const { toDuplicateCandidateRecipe, toPublicNutrition } = require('./recipe.serializer');
const {
  DUPLICATE_CANDIDATE_LIMIT,
  createDuplicateReview,
} = require('./recipe-duplicate');
const {
  publishedRecipeBodySchema,
  legacyPublishedRecipeBodySchema,
  prepTimeMinutesSchema,
  cookTimeMinutesSchema,
  titleSchema,
  draftInstructionsArraySchema,
  draftStepsArraySchema,
  nutritionSchema,
  nutritionSourceSchema,
  cookingSchema,
  cookingContextIssues,
} = require('./recipe.validation');
const { consumerPublicationFilter } = require('./recipe.visibility');
const { isPublicHttpsUrl } = require('../../shared/validation/public-https-url');

const SORT_MAP = {
  titleAsc: { title: 1, _id: 1 },
  titleDesc: { title: -1, _id: 1 },
  // Transitional M20B ordering remains creation-based until the publication
  // state/time backfill has been executed and verified in deployment.
  newest: { createdAt: -1, _id: 1 },
  oldest: { createdAt: 1, _id: 1 },
  prepTimeAsc: { prepTimeMinutes: 1, _id: 1 },
  prepTimeDesc: { prepTimeMinutes: -1, _id: 1 },
  updatedDesc: { updatedAt: -1, _id: 1 },
};

const SMART_COLLECTIONS = Object.freeze([
  Object.freeze({ key: 'quick-meals', name: 'Quick Meals' }),
  Object.freeze({ key: 'balanced-meals', name: 'Balanced Meals' }),
  Object.freeze({ key: 'weekend-cooking', name: 'Weekend Cooking' }),
  Object.freeze({ key: 'dinner-ideas', name: 'Dinner Ideas' }),
  Object.freeze({ key: 'breakfast', name: 'Breakfast' }),
]);

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

function conflictError() {
  return new AppError('Recipe changed after it was loaded. Refresh and try again.', {
    statusCode: 409,
    code: 'RECIPE_EDIT_CONFLICT',
  });
}

function incompleteRecipeError(issues) {
  return new AppError('Recipe is incomplete and cannot be published.', {
    statusCode: 400,
    code: 'RECIPE_INCOMPLETE',
    details: issues,
  });
}

function inactiveRecipeError() {
  return new AppError('An archived recipe cannot be published.', {
    statusCode: 409,
    code: 'RECIPE_ARCHIVED',
  });
}

function publicationStateError() {
  return new AppError('Only an active Draft can be published.', {
    statusCode: 409,
    code: 'RECIPE_NOT_DRAFT',
  });
}

function duplicateReviewError(code, message, duplicateReview) {
  return new AppError(message, {
    statusCode: 409,
    code,
    details: [{ field: 'duplicateReview', duplicateReview }],
  });
}

// Transitional compatibility is explicit: only a missing state is
// interpreted as published. The model deliberately has no default so legacy
// reads cannot accidentally become Drafts.
function effectivePublicationStatus(recipe) {
  return recipe.publicationStatus === undefined ? 'published' : recipe.publicationStatus;
}

function assertCurrentPrecondition(existing, expectedUpdatedAt) {
  if (!expectedUpdatedAt) return;
  const stored = existing.updatedAt && new Date(existing.updatedAt).getTime();
  if (!stored || stored !== new Date(expectedUpdatedAt).getTime()) {
    throw conflictError();
  }
}

// Escapes regex metacharacters so free-text search input is always treated
// as a literal substring match, never as attacker-controlled regex syntax.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAuthoringValue(schema, value, field) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw incompleteRecipeError(result.error.issues.map((issue) => ({
      ...issue,
      path: [field, ...issue.path],
    })));
  }
  return result.data;
}

function normalizeTitle(value) {
  return parseAuthoringValue(titleSchema, value, 'title');
}

function normalizeOptionalTime(schema, value, field) {
  return value === undefined ? undefined : parseAuthoringValue(schema, value, field);
}

function normalizeDietaryTags(tags = []) {
  return [...new Set(tags)];
}

function sourceFromProvenance(provenance) {
  if (!provenance) return undefined;
  const source = {
    kind: provenance.sourceKind,
    label: provenance.sourceLabel,
  };
  if (provenance.sourceUrl) source.url = provenance.sourceUrl;
  return source;
}

function buildNutritionProvenance(source, { actorId, now }) {
  if (!actorId) {
    throw new AppError('Authenticated staff attribution is required for nutrition.', {
      statusCode: 500,
      code: 'RECIPE_NUTRITION_ACTOR_REQUIRED',
    });
  }
  const normalized = parseAuthoringValue(nutritionSourceSchema, source, 'nutritionSource');
  return {
    sourceKind: normalized.kind,
    sourceLabel: normalized.label,
    sourceUrl: normalized.url,
    acceptedBy: actorId,
    acceptedAt: now,
  };
}

function applyNutritionToDocument(doc, nutrition, nutritionSource, context) {
  if (nutrition === undefined) return;
  if (nutrition === null) {
    doc.nutrition = null;
    return;
  }
  doc.nutrition = parseAuthoringValue(nutritionSchema, nutrition, 'nutrition');
  doc.nutritionProvenance = buildNutritionProvenance(nutritionSource, context);
}

function deriveImageUrlIsPublicHttps(imageUrl) {
  return typeof imageUrl === 'string' && isPublicHttpsUrl(imageUrl.trim());
}

function deriveNutritionSourceUrlIsPublicHttps(provenance) {
  const sourceUrl = provenance?.sourceUrl;
  return typeof sourceUrl === 'string' && isPublicHttpsUrl(sourceUrl.trim());
}

function snapshotRevision(recipe) {
  const revision = recipe.__v;
  if (revision !== undefined && (
    !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER
  )) throw conflictError();
  return revision;
}

function nextRecipeUpdatedAt(recipe, now = new Date()) {
  const previous = recipe.updatedAt == null ? 0 : new Date(recipe.updatedAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(current)) throw conflictError();
  return new Date(Math.max(current, previous + 1));
}

// Reduces validated step input to the persisted `instructions: string[]`
// shape (Mongo's source of truth). A structured `steps` array wins when
// present — the validation layer has already guaranteed contiguous 1..N
// ordering and, when `instructions` is also present, that the two are
// equivalent. Legacy `instructions` input passes straight through.
function toInstructionsList({ instructions, steps }) {
  if (steps !== undefined) {
    const parsed = parseAuthoringValue(draftStepsArraySchema, steps, 'steps');
    return [...parsed].sort((a, b) => a.order - b.order).map((step) => step.text);
  }
  return parseAuthoringValue(draftInstructionsArraySchema, instructions || [], 'instructions');
}

// Every referenced Ingredient — including entries marked optional — must
// exist and be active before a recipe is created, before a replacement
// ingredient list is saved, or before a recipe is reactivated. This is
// stricter than (and distinct from) isUsableForNonAdmin below, which
// tolerates an optional entry going inactive after the fact. Verified via
// IngredientService only: RecipeService never imports the Ingredient
// model/repository directly (cross-module boundary rule).
async function evaluateIngredientEligibility(ingredients) {
  const uniqueIds = [...new Set(
    ingredients
      .filter((entry) => entry.ingredientId !== undefined)
      .map((entry) => String(entry.ingredientId))
  )];
  const found = await Promise.all(uniqueIds.map((id) => ingredientService.findIngredientById(id)));
  const byId = new Map(uniqueIds.map((id, index) => [id, found[index]]));

  return ingredients.flatMap((entry, index) => {
    if (entry.ingredientId === undefined) return [];
    const ingredient = byId.get(String(entry.ingredientId));
    if (!ingredient) {
      return [{
        code: 'RECIPE_INGREDIENT_NOT_FOUND',
        path: `ingredients.${index}.ingredientId`,
        message: 'One or more referenced ingredients do not exist.',
      }];
    }
    if (!ingredient.isActive) {
      return [{
        code: 'RECIPE_INGREDIENT_INACTIVE',
        path: `ingredients.${index}.ingredientId`,
        message: 'One or more referenced ingredients are not active.',
      }];
    }
    return [];
  });
}

async function assertIngredientsActive(ingredients) {
  const issues = await evaluateIngredientEligibility(ingredients);
  if (issues[0]?.code === 'RECIPE_INGREDIENT_NOT_FOUND') {
    throw ingredientNotFoundError();
  }
  if (issues.length > 0) {
    throw ingredientInactiveError();
  }
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

function normalizeCooking(cooking) {
  if (cooking == null) return null;
  return {
    schemaVersion: 1,
    defaultSpiceLevel: cooking.defaultSpiceLevel,
    spiceAlternatives: cooking.spiceAlternatives.map((alternative) => ({
      spiceLevel: alternative.spiceLevel,
      ingredients: normalizeIngredients(alternative.ingredients),
    })),
    stepTimers: cooking.stepTimers.map((timer) => ({ ...timer })),
  };
}

function cookingForValidation(cooking) {
  if (cooking == null) return null;
  return {
    schemaVersion: cooking.schemaVersion,
    defaultSpiceLevel: cooking.defaultSpiceLevel ?? null,
    spiceAlternatives: (cooking.spiceAlternatives || []).map((alternative) => ({
      spiceLevel: alternative.spiceLevel,
      ingredients: alternative.ingredients.map((entry) => ({
        ingredientId: entry.ingredientId == null
          ? '000000000000000000000000'
          : String(entry.ingredientId._id || entry.ingredientId),
        quantity: entry.quantity ?? null,
        unit: entry.unit,
        note: entry.note ?? null,
        optional: entry.optional ?? false,
      })),
    })),
    stepTimers: (cooking.stepTimers || []).map((timer) => ({
      stepOrder: timer.stepOrder, servings: timer.servings,
      spiceLevel: timer.spiceLevel ?? null, durationSeconds: timer.durationSeconds,
    })),
  };
}

function cookingValidationIssues(recipe) {
  if (recipe.cooking == null) return [];
  const input = cookingForValidation(recipe.cooking);
  const parsed = cookingSchema.safeParse(input);
  return [
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => ({
      path: ['cooking', ...issue.path], message: issue.message,
    }))),
    ...cookingContextIssues({
      cooking: input,
      servings: recipe.servings,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
    }),
  ];
}

function assertCookingValid(recipe) {
  const issues = cookingValidationIssues(recipe);
  if (issues.length) throw incompleteRecipeError(issues);
}

async function evaluateCookingIngredientEligibility(cooking) {
  if (cooking == null) return [];
  const issues = [];
  for (const [index, alternative] of cooking.spiceAlternatives.entries()) {
    const found = await evaluateIngredientEligibility(alternative.ingredients);
    issues.push(...found.map((issue) => ({ ...issue, path: `cooking.spiceAlternatives.${index}.${issue.path}` })));
  }
  return issues;
}

async function assertCookingIngredientsActive(cooking) {
  const issues = await evaluateCookingIngredientEligibility(cooking);
  if (issues.some((issue) => issue.code === 'RECIPE_INGREDIENT_NOT_FOUND')) throw ingredientNotFoundError();
  if (issues.length) throw ingredientInactiveError();
}

function toPublishedValidationInput(recipe, { nutritionSource } = {}) {
  // A populated reference becomes null when its target Ingredient was deleted.
  // The stored usage was still structurally complete, so use a validation-only
  // ObjectId sentinel here and leave missing/inactive-reference eligibility to
  // isUsableForNonAdmin below. An actually absent ingredientId stays invalid.
  const populatedIngredientId = (entry) => {
    if (entry.ingredientId === null) return '000000000000000000000000';
    return String(entry.ingredientId?._id || entry.ingredientId);
  };
  const input = {
    title: recipe.title,
    description: recipe.description,
    difficulty: recipe.difficulty,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    servings: recipe.servings,
    ingredients: (recipe.ingredients || []).map((entry) => ({
      ingredientId: populatedIngredientId(entry),
      quantity: entry.quantity,
      unit: entry.unit,
      note: entry.note,
      optional: entry.optional ?? false,
    })),
    cooking: cookingForValidation(recipe.cooking),
    instructions: recipe.instructions || [],
    dietaryTags: recipe.dietaryTags || [],
    imageUrl: recipe.imageUrl ?? null,
    imageAssetId: recipe.imageAssetId ?? null,
  };
  if (recipe.region != null) input.region = recipe.region;
  if (recipe.category != null) input.category = recipe.category;
  if (recipe.nutrition != null) {
    input.nutrition = typeof recipe.nutrition.toObject === 'function'
      ? recipe.nutrition.toObject()
      : recipe.nutrition;
    input.nutritionSource = nutritionSource === undefined
      ? sourceFromProvenance(recipe.nutritionProvenance)
      : nutritionSource;
  } else if (recipe.nutrition === null) {
    input.nutrition = null;
  }
  return input;
}

function assertPublishedComplete(recipe, options) {
  const result = publishedRecipeBodySchema.safeParse(toPublishedValidationInput(recipe, options));
  if (!result.success) {
    throw incompleteRecipeError(result.error.issues);
  }
}

function isPublishedComplete(recipe) {
  return legacyPublishedRecipeBodySchema.safeParse(toPublishedValidationInput(recipe)).success;
}

function assertLegacyPublishedComplete(recipe) {
  const result = legacyPublishedRecipeBodySchema.safeParse(toPublishedValidationInput(recipe));
  if (!result.success) {
    throw incompleteRecipeError(result.error.issues);
  }
}

// A recipe is "usable" for a non-admin view when it is itself active and
// every non-optional ingredient entry resolves to a currently-active
// Ingredient (a populated ref that fails to resolve reads as missing/
// inactive). Archiving an Ingredient never cascades into Recipe documents —
// no transactions, no batch updates — so this is checked at read time
// instead. An optional entry (e.g. a garnish) going inactive does not hide
// the whole recipe. See docs/architecture/recipes.md.
function isUsableForNonAdmin(recipe) {
  if (!recipe.isActive || effectivePublicationStatus(recipe) !== 'published') {
    return false;
  }
  if (!isPublishedComplete(recipe)) {
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
  const cooking = plain.cooking == null ? null : {
    ...plain.cooking,
    spiceAlternatives: plain.cooking.spiceAlternatives
      .filter((alternative) => alternative.ingredients.every((entry) =>
        entry.optional || Boolean(entry.ingredientId && entry.ingredientId.isActive)))
      .map((alternative) => ({
        ...alternative,
        ingredients: alternative.ingredients.filter(isIngredientEntryVisibleToNonAdmin),
      })),
  };
  if (cooking) {
    const offered = new Set([cooking.defaultSpiceLevel,
      ...cooking.spiceAlternatives.map((alternative) => alternative.spiceLevel)]);
    cooking.stepTimers = cooking.stepTimers.filter((timer) => offered.has(timer.spiceLevel));
  }
  return { ...plain, ingredients: plain.ingredients.filter(isIngredientEntryVisibleToNonAdmin), cooking };
}

function buildPublishedRecipeDocument({
  title, description, region, category, difficulty, prepTimeMinutes,
  cookTimeMinutes, servings, ingredients, instructions, steps,
  dietaryTags = [], imageUrl, imageAssetId, nutrition, nutritionSource, cooking,
}, { actorId, now = new Date() } = {}) {
  const doc = {
    title: normalizeTitle(title),
    description: description.trim(),
    difficulty,
    prepTimeMinutes: normalizeOptionalTime(prepTimeMinutesSchema, prepTimeMinutes, 'prepTimeMinutes'),
    cookTimeMinutes: normalizeOptionalTime(cookTimeMinutesSchema, cookTimeMinutes, 'cookTimeMinutes'),
    servings,
    ingredients: normalizeIngredients(ingredients),
    ...(cooking != null ? { cooking: normalizeCooking(cooking) } : {}),
    instructions: toInstructionsList({ instructions, steps }),
    dietaryTags: normalizeDietaryTags(dietaryTags),
    imageUrl: imageUrl ?? null,
    imageUrlIsPublicHttps: deriveImageUrlIsPublicHttps(imageUrl),
    imageAssetId: imageAssetId ?? null,
    publicationStatus: 'published',
    createdBy: actorId ?? null,
    updatedBy: actorId ?? null,
    publishedBy: actorId ?? null,
    publishedAt: now,
  };
  // region/category are optional canonical slugs (already normalized by the
  // validation layer). Never fabricated from cuisine/title/anything else.
  if (region !== undefined) doc.region = region;
  if (category !== undefined) doc.category = category;
  applyNutritionToDocument(doc, nutrition, nutritionSource, { actorId, now });
  doc.nutritionSourceUrlIsPublicHttps = deriveNutritionSourceUrlIsPublicHttps(doc.nutritionProvenance);

  return doc;
}

function toPublicDuplicateReview(review) {
  return {
    fingerprintVersion: review.fingerprintVersion,
    resultDigest: review.resultDigest,
    candidateLimit: review.candidateLimit,
    candidateUniverseCount: review.candidateUniverseCount,
    comparedCount: review.comparedCount,
    truncated: review.truncated,
    candidates: review.matches.map((match) => ({
      recipe: toDuplicateCandidateRecipe(match.recipe),
      classification: match.classification,
      evidence: match.evidence,
    })),
  };
}

async function compareRecipeSubject(subject, { excludeId } = {}) {
  const retrieval = await recipeRepository.findDuplicateCandidates({
    excludeId,
    limit: DUPLICATE_CANDIDATE_LIMIT,
  });
  return toPublicDuplicateReview(createDuplicateReview(subject, {
    ...retrieval,
    candidateLimit: DUPLICATE_CANDIDATE_LIMIT,
  }));
}

function enforceDuplicateReview(freshReview, suppliedReview) {
  const issue = evaluateDuplicateReview(freshReview, suppliedReview);
  if (issue) {
    throw duplicateReviewError(issue.code, issue.message, freshReview);
  }
}

function evaluateDuplicateReview(freshReview, suppliedReview) {
  const reviewRequired = freshReview.truncated || freshReview.candidates.length > 0;
  if (reviewRequired && (!suppliedReview?.resultDigest || suppliedReview.confirmDistinctRecipe !== true)) {
    return {
      code: 'RECIPE_DUPLICATE_REVIEW_REQUIRED',
      path: 'duplicateReview',
      message: 'Review the current duplicate and variant evidence before continuing.',
    };
  }
  if (suppliedReview?.resultDigest && suppliedReview.resultDigest !== freshReview.resultDigest) {
    return {
      code: 'RECIPE_DUPLICATE_REVIEW_STALE',
      path: 'duplicateReview',
      message: 'Recipe duplicate review is stale. Review the current candidates before continuing.',
    };
  }
  return null;
}

async function evaluatePublishReadiness(recipe, { duplicateReview, collectAllIssues = true } = {}) {
  if (!recipe.isActive) {
    return {
      issues: [{
        code: 'RECIPE_ARCHIVED',
        path: 'isActive',
        message: 'An archived recipe cannot be published.',
      }],
      duplicateReview: null,
      completenessIssues: [],
    };
  }
  if (effectivePublicationStatus(recipe) !== 'draft') {
    return {
      issues: [{
        code: 'RECIPE_NOT_DRAFT',
        path: 'publicationStatus',
        message: 'Only an active Draft can be published.',
      }],
      duplicateReview: null,
      completenessIssues: [],
    };
  }

  const completeness = publishedRecipeBodySchema.safeParse(toPublishedValidationInput(recipe));
  const completenessIssues = completeness.success ? [] : completeness.error.issues;
  const issues = completenessIssues.map((issue) => ({
    code: 'RECIPE_INCOMPLETE',
    path: issue.path.join('.'),
    message: issue.message,
  }));
  if (!collectAllIssues && completenessIssues.length > 0) {
    return { issues, duplicateReview: null, completenessIssues };
  }
  const ingredientIssues = await evaluateIngredientEligibility(recipe.ingredients || []);
  issues.push(...ingredientIssues);
  if (completenessIssues.length === 0) issues.push(...await evaluateCookingIngredientEligibility(recipe.cooking));

  if (issues.length > 0) {
    return { issues, duplicateReview: null, completenessIssues };
  }

  const freshReview = await compareRecipeSubject(recipe, { excludeId: recipe._id });
  const duplicateIssue = evaluateDuplicateReview(freshReview, duplicateReview);
  if (duplicateIssue) issues.push(duplicateIssue);
  return { issues, duplicateReview: freshReview, completenessIssues };
}

function toPublishReadinessProjection(recipe, evaluation) {
  const recipeUpdatedAt = recipe.updatedAt instanceof Date
    ? recipe.updatedAt.toISOString()
    : new Date(recipe.updatedAt).toISOString();
  return {
    ready: evaluation.issues.length === 0,
    recipeId: String(recipe._id),
    recipeUpdatedAt,
    issues: evaluation.issues,
    duplicateReview: evaluation.duplicateReview,
  };
}

function throwPublishReadinessIssue(evaluation) {
  const issue = evaluation.issues[0];
  if (!issue) return;
  if (issue.code === 'RECIPE_ARCHIVED') throw inactiveRecipeError();
  if (issue.code === 'RECIPE_NOT_DRAFT') throw publicationStateError();
  if (issue.code === 'RECIPE_INCOMPLETE') throw incompleteRecipeError(evaluation.completenessIssues);
  if (issue.code === 'RECIPE_INGREDIENT_NOT_FOUND') throw ingredientNotFoundError();
  if (issue.code === 'RECIPE_INGREDIENT_INACTIVE') throw ingredientInactiveError();
  throw duplicateReviewError(issue.code, issue.message, evaluation.duplicateReview);
}

async function createRecipe(input, { actorId, now = new Date() } = {}) {
  const candidate = { ...input };
  const duplicateReview = candidate.duplicateReview;
  delete candidate.duplicateReview;
  delete candidate.confirmFilipinoCuisine;
  await assertIngredientsActive(candidate.ingredients);
  const doc = buildPublishedRecipeDocument(candidate, { actorId, now });

  assertPublishedComplete(doc);
  await assertCookingIngredientsActive(doc.cooking);
  const freshReview = await compareRecipeSubject(doc);
  enforceDuplicateReview(freshReview, duplicateReview);
  return recipeRepository.createRecipe(doc);
}

async function checkRecipeDuplicates({ recipeId, expectedUpdatedAt, candidate }) {
  if (candidate) {
    await assertIngredientsActive(candidate.ingredients);
    // Duplicate checking is analysis only. Normalize the candidate nutrition
    // and its supplied source for completeness validation without constructing
    // persistence provenance or inventing an actor/acceptance timestamp.
    const { nutrition, nutritionSource, ...candidateWithoutNutrition } = candidate;
    const subject = buildPublishedRecipeDocument(candidateWithoutNutrition);
    let normalizedNutritionSource;
    if (nutrition !== undefined) {
      subject.nutrition = nutrition === null
        ? null
        : parseAuthoringValue(nutritionSchema, nutrition, 'nutrition');
      if (nutrition !== null) {
        normalizedNutritionSource = parseAuthoringValue(
          nutritionSourceSchema,
          nutritionSource,
          'nutritionSource',
        );
      }
    }
    assertPublishedComplete(subject, { nutritionSource: normalizedNutritionSource });
    return compareRecipeSubject(subject);
  }

  const subject = await recipeRepository.findRawById(recipeId);
  if (!subject) throw notFoundError();
  assertCurrentPrecondition(subject, expectedUpdatedAt);
  if (!subject.isActive) throw inactiveRecipeError();
  if (effectivePublicationStatus(subject) !== 'draft') throw publicationStateError();
  assertPublishedComplete(subject);
  await assertIngredientsActive(subject.ingredients || []);
  return compareRecipeSubject(subject, { excludeId: subject._id });
}

async function createDraft(input, { actorId, now = new Date() } = {}) {
  const doc = {
    title: normalizeTitle(input.title),
    publicationStatus: 'draft',
    isActive: true,
    createdBy: actorId ?? null,
    updatedBy: actorId ?? null,
  };
  if (input.description !== undefined) doc.description = input.description.trim();
  for (const field of ['region', 'category', 'difficulty', 'servings']) {
    if (input[field] !== undefined) doc[field] = input[field];
  }
  if (input.prepTimeMinutes !== undefined) doc.prepTimeMinutes = normalizeOptionalTime(prepTimeMinutesSchema, input.prepTimeMinutes, 'prepTimeMinutes');
  if (input.cookTimeMinutes !== undefined) doc.cookTimeMinutes = normalizeOptionalTime(cookTimeMinutesSchema, input.cookTimeMinutes, 'cookTimeMinutes');
  if (input.ingredients !== undefined) {
    if (input.ingredients.length > 0) await assertIngredientsActive(input.ingredients);
    doc.ingredients = normalizeIngredients(input.ingredients);
  }
  if (input.cooking != null) {
    doc.cooking = normalizeCooking(input.cooking);
    await assertCookingIngredientsActive(doc.cooking);
  }
  if (input.instructions !== undefined || input.steps !== undefined) {
    doc.instructions = toInstructionsList(input);
  }
  assertCookingValid(doc);
  if (input.dietaryTags !== undefined) doc.dietaryTags = normalizeDietaryTags(input.dietaryTags);
  if (input.imageUrl !== undefined) doc.imageUrl = input.imageUrl;
  if (input.imageAssetId !== undefined) doc.imageAssetId = input.imageAssetId;
  doc.imageUrlIsPublicHttps = deriveImageUrlIsPublicHttps(doc.imageUrl);
  applyNutritionToDocument(doc, input.nutrition, input.nutritionSource, { actorId, now });
  doc.nutritionSourceUrlIsPublicHttps = deriveNutritionSourceUrlIsPublicHttps(doc.nutritionProvenance);
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
  if (!recipe) {
    throw notFoundError();
  }
  if (!isAdmin) {
    // Match list behavior: malformed present authoritative nutrition is a
    // response failure, never ordinary publication/usability filtering.
    toPublicNutrition(recipe.nutrition);
    if (!isUsableForNonAdmin(recipe)) throw notFoundError();
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

async function findConsumerVisibleShoppingSources(ids) {
  if (!Array.isArray(ids) || ids.length > 200
    || ids.some((id) => !/^[a-f\d]{24}$/i.test(String(id)))) {
    throw new TypeError('Invalid Shopping source IDs.');
  }
  if (ids.length === 0) return new Map();
  const recipes = await recipeRepository.findShoppingSourceCandidates(ids);
  const visible = new Map();
  for (const recipe of recipes) {
    if (isUsableForNonAdmin(recipe)) {
      visible.set(String(recipe._id), { id: String(recipe._id), title: recipe.title });
    }
  }
  return visible;
}

function totalTimeExpression(bucket) {
  const normalizedPrep = { $ifNull: ['$prepTimeMinutes', 0] };
  const total = { $add: [normalizedPrep, '$cookTimeMinutes'] };
  const comparisons = {
    'under-15': [{ $lt: [total, 15] }],
    '15-to-30': [{ $gte: [total, 15] }, { $lte: [total, 30] }],
    '31-to-60': [{ $gte: [total, 31] }, { $lte: [total, 60] }],
    'over-60': [{ $gt: [total, 60] }],
  };
  const bucketComparisons = comparisons[bucket];
  return {
    $cond: [
      {
        $and: [
          { $isNumber: '$cookTimeMinutes' },
          { $isNumber: normalizedPrep },
        ],
      },
      bucketComparisons.length === 1 ? bucketComparisons[0] : { $and: bucketComparisons },
      false,
    ],
  };
}

function matchesSmartCollection(recipe, groupKey) {
  const totalTimeMinutes = (recipe.prepTimeMinutes ?? 0) + recipe.cookTimeMinutes;
  if (groupKey === 'quick-meals') return totalTimeMinutes <= 30;
  if (groupKey === 'weekend-cooking') return totalTimeMinutes >= 60;
  if (groupKey === 'dinner-ideas') return recipe.category === 'dinner';
  if (groupKey === 'breakfast') return recipe.category === 'breakfast';
  if (groupKey === 'balanced-meals') {
    const nutrition = recipe.nutrition;
    return nutrition != null
      && nutrition.caloriesKcal <= 650
      && nutrition.proteinGrams >= 15
      && nutrition.fiberGrams >= 5
      && nutrition.sugarGrams <= 20;
  }
  return false;
}

async function listSmartCollections() {
  const summaries = new Map(SMART_COLLECTIONS.map(({ key }) => [key, {
    recipeCount: 0,
    coverCandidatesSeen: 0,
    coverImageUrls: [],
  }]));
  for await (const recipe of recipeRepository.streamSmartCollectionCandidates()) {
    if (!isUsableForNonAdmin(recipe)) continue;
    for (const { key } of SMART_COLLECTIONS) {
      if (!matchesSmartCollection(recipe, key)) continue;
      const summary = summaries.get(key);
      summary.recipeCount += 1;
      if (summary.coverCandidatesSeen < 4) {
        summary.coverCandidatesSeen += 1;
        if (recipe.imageUrl != null) summary.coverImageUrls.push(recipe.imageUrl);
      }
    }
  }
  return SMART_COLLECTIONS.map(({ key, name }) => ({
    key,
    name,
    recipeCount: summaries.get(key).recipeCount,
    coverImageUrls: summaries.get(key).coverImageUrls,
  }));
}

async function getSmartCollection({ groupKey, page, limit }) {
  const definition = SMART_COLLECTIONS.find(({ key }) => key === groupKey);
  if (!definition) throw new AppError('Invalid smart collection key.', { statusCode: 400, code: 'VALIDATION_ERROR' });
  const skip = (page - 1) * limit;
  const items = [];
  let total = 0;
  for await (const recipe of recipeRepository.streamSmartCollectionCandidates()) {
    if (!isUsableForNonAdmin(recipe) || !matchesSmartCollection(recipe, groupKey)) continue;
    if (total >= skip && items.length < limit) items.push(toNonAdminView(recipe));
    total += 1;
  }
  return {
    smartCollection: { ...definition },
    items,
    total,
    page,
    limit,
  };
}

async function listRecipes({
  search,
  publicationStatus,
  region,
  category,
  difficulty,
  dietaryTag,
  dietaryTags,
  ingredientId,
  excludeRecipeId,
  maxPrepTimeMinutes,
  totalTimeBucket,
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
  if (publicationStatus === 'draft') {
    filter.publicationStatus = 'draft';
  }
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
  const selectedDietaryTags = dietaryTags || (dietaryTag ? [dietaryTag] : []);
  if (selectedDietaryTags.length > 0) {
    filter.dietaryTags = { $all: [...new Set(selectedDietaryTags)] };
  }
  if (ingredientId) {
    filter['ingredients.ingredientId'] = ingredientId;
  }
  if (maxPrepTimeMinutes !== undefined) {
    filter.prepTimeMinutes = { $lte: maxPrepTimeMinutes };
  }
  if (totalTimeBucket) {
    filter.$expr = totalTimeExpression(totalTimeBucket);
  }
  if (excludeRecipeId) {
    filter._id = { $ne: excludeRecipeId };
  }
  if (search && sort === 'relevance') {
    filter.$text = { $search: search };
  } else if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: pattern }, { description: pattern }];
  }

  if (!isAdmin) {
    filter.$and = [...(filter.$and || []), consumerPublicationFilter()];
  }

  const ranked = sort === 'relevance' || sort === 'topRated';
  const skip = (page - 1) * limit;
  let rawItems;
  let total;

  if (ranked) {
    ({ items: rawItems, total } = await recipeRepository.findRanked({
      filter,
      sort,
      skip,
      limit,
      consumerOnly: !isAdmin,
    }));
  } else if (isAdmin) {
    [rawItems, total] = await Promise.all([
      recipeRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
      recipeRepository.countByFilter(filter),
    ]);
  } else {
    ({ items: rawItems, total } = await recipeRepository.findConsumerPage({
      filter,
      sort: SORT_MAP[sort],
      skip,
      limit,
    }));
  }

  // Every consumer path returns an already eligible, counted, and paged
  // database result. Application memory holds at most the validated page.
  // Staff retain their existing raw catalogue visibility.
  if (!isAdmin) {
    rawItems.forEach((recipe) => toPublicNutrition(recipe.nutrition));
  }
  const items = isAdmin ? rawItems : rawItems.map(toNonAdminView);

  return { items, total, page, limit };
}

async function updateRecipe(id, patch, { actorId, now = new Date() } = {}) {
  const existing = await recipeRepository.findRawById(id);
  if (!existing) {
    throw notFoundError();
  }

  const { expectedUpdatedAt, ...contentPatch } = patch;
  patch = contentPatch;
  assertCurrentPrecondition(existing, expectedUpdatedAt);
  const expectedRevision = snapshotRevision(existing);
  if (existing.cooking != null && patch.cooking === undefined
    && (patch.ingredients !== undefined || patch.servings !== undefined
      || patch.instructions !== undefined || patch.steps !== undefined)) {
    throw new AppError('Reaffirm or clear cooking data when dependent Recipe fields change.', {
      statusCode: 409, code: 'RECIPE_COOKING_REVIEW_REQUIRED',
    });
  }
  if (patch.cooking !== undefined && expectedUpdatedAt === undefined) {
    throw new AppError('expectedUpdatedAt is required when cooking is written.', {
      statusCode: 400, code: 'VALIDATION_ERROR',
      details: [{ field: 'expectedUpdatedAt', message: 'Required for cooking writes.' }],
    });
  }

  const update = {};
  // Fields removed from the document rather than set — an explicit `null` for
  // an optional slug field clears it (see recipe.validation.js).
  const unset = {};
  if (patch.title !== undefined) update.title = normalizeTitle(patch.title);
  if (patch.description !== undefined) {
    if (patch.description === null) unset.description = '';
    else update.description = patch.description.trim();
  }
  if (patch.region !== undefined) {
    if (patch.region === null) unset.region = '';
    else update.region = patch.region;
  }
  if (patch.category !== undefined) {
    if (patch.category === null) unset.category = '';
    else update.category = patch.category;
  }
  for (const field of ['difficulty', 'servings']) {
    if (patch[field] !== undefined) {
      if (patch[field] === null) unset[field] = '';
      else update[field] = patch[field];
    }
  }
  for (const [field, schema] of [['prepTimeMinutes', prepTimeMinutesSchema], ['cookTimeMinutes', cookTimeMinutesSchema]]) {
    if (patch[field] !== undefined) {
      if (patch[field] === null) unset[field] = '';
      else update[field] = normalizeOptionalTime(schema, patch[field], field);
    }
  }
  if (patch.instructions !== undefined || patch.steps !== undefined) {
    update.instructions = toInstructionsList({ instructions: patch.instructions, steps: patch.steps });
  }
  if (patch.dietaryTags !== undefined) update.dietaryTags = normalizeDietaryTags(patch.dietaryTags);
  if (patch.nutrition !== undefined) {
    if (patch.nutrition === null) {
      unset.nutrition = '';
      unset.nutritionProvenance = '';
    } else {
      update.nutrition = parseAuthoringValue(nutritionSchema, patch.nutrition, 'nutrition');
      update.nutritionProvenance = buildNutritionProvenance(patch.nutritionSource, { actorId, now });
    }
  }
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

  if (patch.ingredients !== undefined) {
    // The provided array is the complete replacement list — validate and
    // persist it wholesale rather than merging with what's stored.
    await assertIngredientsActive(patch.ingredients);
    update.ingredients = normalizeIngredients(patch.ingredients);
  }
  if (patch.cooking !== undefined) {
    if (patch.cooking === null) unset.cooking = '';
    else update.cooking = normalizeCooking(patch.cooking);
  }
  if (actorId) update.updatedBy = actorId;

  const merged = {
    ...(typeof existing.toObject === 'function' ? existing.toObject() : existing),
    ...update,
  };
  for (const field of Object.keys(unset)) delete merged[field];
  assertCookingValid(merged);
  await assertCookingIngredientsActive(merged.cooking);
  update.imageUrlIsPublicHttps = deriveImageUrlIsPublicHttps(merged.imageUrl);
  merged.imageUrlIsPublicHttps = update.imageUrlIsPublicHttps;
  update.nutritionSourceUrlIsPublicHttps = deriveNutritionSourceUrlIsPublicHttps(merged.nutritionProvenance);
  merged.nutritionSourceUrlIsPublicHttps = update.nutritionSourceUrlIsPublicHttps;
  // Published records retain the pre-M25B completeness check after every
  // edit so unrelated repairs do not strand an older title/instruction. Any
  // newly supplied title or instruction has already passed the new-write
  // schema above. Transitional missing-status records keep the narrower
  // compatibility handling below.
  if (existing.publicationStatus === 'published') {
    assertLegacyPublishedComplete(merged);
  } else if (effectivePublicationStatus(existing) === 'published') {
    // Legacy records were created under the complete contract. Prevent the
    // only structurally-valid PATCH operations that could make one
    // incomplete, while tolerating unrelated edits on malformed legacy data
    // until the migration report has surfaced it for repair.
    if (patch.ingredients !== undefined && merged.ingredients.length === 0) {
      throw incompleteRecipeError([{ path: ['ingredients'], message: 'At least one ingredient is required.' }]);
    }
    if (
      (patch.instructions !== undefined || patch.steps !== undefined) &&
      merged.instructions.length === 0
    ) {
      throw incompleteRecipeError([{ path: ['instructions'], message: 'At least one instruction step is required.' }]);
    }
    const clearedRequiredField = ['description', 'difficulty', 'cookTimeMinutes', 'servings']
      .find((field) => patch[field] === null);
    if (clearedRequiredField) {
      throw incompleteRecipeError([{
        path: [clearedRequiredField],
        message: `${clearedRequiredField} is required for a Published recipe.`,
      }]);
    }
  }

  const ops = {};
  if (Object.keys(update).length > 0) ops.$set = update;
  if (Object.keys(unset).length > 0) ops.$unset = unset;

  const updated = await recipeRepository.updateById(id, ops, {
    expectedUpdatedAt, expectedRevision, nextUpdatedAt: nextRecipeUpdatedAt(existing, now),
  });
  if (!updated) {
    throw conflictError();
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

async function getRecipePublishReadiness(id, { expectedUpdatedAt, duplicateReview }) {
  const existing = await recipeRepository.findRawById(id);
  if (!existing) throw notFoundError();
  assertCurrentPrecondition(existing, expectedUpdatedAt);
  const evaluation = await evaluatePublishReadiness(existing, { duplicateReview });
  return toPublishReadinessProjection(existing, evaluation);
}

async function publishRecipe(id, { expectedUpdatedAt, duplicateReview } = {}, { actorId, now = new Date() } = {}) {
  const existing = await recipeRepository.findRawById(id);
  if (!existing) throw notFoundError();
  assertCurrentPrecondition(existing, expectedUpdatedAt);
  const expectedRevision = snapshotRevision(existing);
  const evaluation = await evaluatePublishReadiness(existing, {
    duplicateReview,
    collectAllIssues: false,
  });
  throwPublishReadinessIssue(evaluation);
  await assertCookingIngredientsActive(existing.cooking);

  const atomicUpdatedAt = expectedUpdatedAt || existing.updatedAt?.toISOString?.() || existing.updatedAt;
  const published = await recipeRepository.publishById(id, {
    actorId,
    publishedAt: existing.publishedAt || now,
    expectedUpdatedAt: atomicUpdatedAt,
    expectedRevision,
    nextUpdatedAt: nextRecipeUpdatedAt(existing, now),
    imageUrlIsPublicHttps: deriveImageUrlIsPublicHttps(existing.imageUrl),
    nutritionSourceUrlIsPublicHttps: deriveNutritionSourceUrlIsPublicHttps(existing.nutritionProvenance),
  });
  if (!published) throw conflictError();
  return published;
}

async function archiveRecipe(id, { expectedUpdatedAt } = {}, { actorId } = {}) {
  const existing = await recipeRepository.findRawById(id);
  if (!existing) throw notFoundError();
  assertCurrentPrecondition(existing, expectedUpdatedAt);
  const expectedRevision = snapshotRevision(existing);
  const archived = await recipeRepository.archiveById(id, {
    actorId, expectedUpdatedAt, expectedRevision, nextUpdatedAt: nextRecipeUpdatedAt(existing),
  });
  if (!archived) {
    throw conflictError();
  }
  return archived;
}

async function restoreRecipe(id, { expectedUpdatedAt } = {}, { actorId } = {}) {
  const existing = await recipeRepository.findRawById(id);
  if (!existing) throw notFoundError();
  assertCurrentPrecondition(existing, expectedUpdatedAt);
  const expectedRevision = snapshotRevision(existing);
  if (effectivePublicationStatus(existing) === 'published') {
    assertLegacyPublishedComplete(existing);
    await assertIngredientsActive(existing.ingredients || []);
  }
  assertCookingValid(existing);
  await assertCookingIngredientsActive(existing.cooking);
  const atomicUpdatedAt = expectedUpdatedAt || existing.updatedAt?.toISOString?.() || existing.updatedAt;
  const restored = await recipeRepository.restoreById(id, {
    actorId,
    expectedUpdatedAt: atomicUpdatedAt,
    expectedRevision,
    nextUpdatedAt: nextRecipeUpdatedAt(existing),
    imageUrlIsPublicHttps: deriveImageUrlIsPublicHttps(existing.imageUrl),
    nutritionSourceUrlIsPublicHttps: deriveNutritionSourceUrlIsPublicHttps(existing.nutritionProvenance),
  });
  if (!restored) {
    throw conflictError();
  }
  return restored;
}

module.exports = {
  createRecipe,
  checkRecipeDuplicates,
  createDraft,
  findRecipeById,
  findUsableRecipeById,
  findConsumerVisibleShoppingSources,
  getRecipeById,
  listRecipes,
  listSmartCollections,
  getSmartCollection,
  updateRecipe,
  getRecipePublishReadiness,
  publishRecipe,
  archiveRecipe,
  restoreRecipe,
  effectivePublicationStatus,
  assertPublishedComplete,
};
