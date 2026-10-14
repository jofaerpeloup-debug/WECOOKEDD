// Only ever exposes id/name from a populated Ingredient sub-document —
// never isActive or any other internal Ingredient field.
function toIngredientSummary(ingredient) {
  if (!ingredient) {
    return null;
  }
  return {
    id: String(ingredient._id),
    name: ingredient.name,
  };
}

function toPublicRecipeIngredient(entry) {
  return {
    ingredient: toIngredientSummary(entry.ingredientId),
    quantity: entry.quantity ?? null,
    unit: entry.unit,
    note: entry.note ?? null,
    optional: entry.optional ?? false,
  };
}

function toPublicCooking(cooking) {
  if (cooking == null) return null;
  return {
    schemaVersion: 1,
    defaultSpiceLevel: cooking.defaultSpiceLevel ?? null,
    spiceAlternatives: (cooking.spiceAlternatives || []).map((alternative) => ({
      spiceLevel: alternative.spiceLevel,
      ingredients: alternative.ingredients.map(toPublicRecipeIngredient),
    })),
    stepTimers: (cooking.stepTimers || []).map((timer) => ({
      stepOrder: timer.stepOrder,
      servings: timer.servings,
      spiceLevel: timer.spiceLevel ?? null,
      durationSeconds: timer.durationSeconds,
    })),
  };
}

function toStaffCooking(cooking) {
  if (cooking == null) return null;
  return {
    schemaVersion: 1,
    defaultSpiceLevel: cooking.defaultSpiceLevel ?? null,
    spiceAlternatives: (cooking.spiceAlternatives || []).map((alternative) => ({
      spiceLevel: alternative.spiceLevel,
      ingredients: alternative.ingredients.map((entry) => ({
        ingredientId: entry.ingredientId == null ? null : String(entry.ingredientId._id || entry.ingredientId),
        quantity: entry.quantity ?? null,
        unit: entry.unit,
        note: entry.note ?? null,
        optional: entry.optional ?? false,
      })),
    })),
    stepTimers: (cooking.stepTimers || []).map((timer) => ({
      stepOrder: timer.stepOrder,
      servings: timer.servings,
      spiceLevel: timer.spiceLevel ?? null,
      durationSeconds: timer.durationSeconds,
    })),
  };
}

// Derived structured cooking steps. Mongo persists `instructions: string[]`
// as the source of truth (see docs/architecture/recipes.md); `steps` is a
// deterministic 1-based view of that same array, given to later
// RecipeDetail / CookMode work without any storage change. A legacy recipe
// with plain string instructions produces valid `steps` unchanged.
function toStructuredSteps(instructions) {
  return (Array.isArray(instructions) ? instructions : []).map((text, index) => ({
    order: index + 1,
    text,
  }));
}

const NUTRITION_KEYS = Object.freeze([
  'schemaVersion',
  'basis',
  'caloriesKcal',
  'proteinGrams',
  'carbohydrateGrams',
  'fatGrams',
  'sugarGrams',
  'fiberGrams',
]);
const NUTRIENT_KEYS = NUTRITION_KEYS.slice(2);

function malformedNutritionError() {
  const error = new Error('Stored Recipe nutrition is malformed.');
  error.code = 'RECIPE_NUTRITION_MALFORMED';
  return error;
}

function toPublicNutrition(value) {
  if (value === undefined || value === null) return null;
  const nutrition = typeof value.toObject === 'function' ? value.toObject() : value;
  if (!nutrition || typeof nutrition !== 'object' || Array.isArray(nutrition)) {
    throw malformedNutritionError();
  }
  const keys = Object.keys(nutrition).sort();
  if (keys.length !== NUTRITION_KEYS.length || keys.some((key, index) => key !== [...NUTRITION_KEYS].sort()[index])) {
    throw malformedNutritionError();
  }
  if (nutrition.schemaVersion !== 1 || nutrition.basis !== 'perServing') {
    throw malformedNutritionError();
  }
  if (NUTRIENT_KEYS.some((key) => (
    typeof nutrition[key] !== 'number' || !Number.isFinite(nutrition[key]) || nutrition[key] < 0
  ))) {
    throw malformedNutritionError();
  }
  return {
    schemaVersion: 1,
    basis: 'perServing',
    caloriesKcal: nutrition.caloriesKcal,
    proteinGrams: nutrition.proteinGrams,
    carbohydrateGrams: nutrition.carbohydrateGrams,
    fatGrams: nutrition.fatGrams,
    sugarGrams: nutrition.sugarGrams,
    fiberGrams: nutrition.fiberGrams,
  };
}

function toStaffNutritionSource(provenance) {
  if (!provenance) return null;
  const source = {
    kind: provenance.sourceKind,
    label: provenance.sourceLabel,
  };
  if (provenance.sourceUrl) source.url = provenance.sourceUrl;
  return source;
}

// Maps a Recipe document to the public API representation, field-by-field
// rather than spreading the document, so __v, a legacy physical `cuisine`
// property, and any other internal field is never leaked. `cuisine` is
// retired from the target contract (M3) — old documents may still carry it
// in Mongo but it is never read here.
function toPublicRecipe(recipe, { includeRatingSummary = false, includeCooking = false } = {}) {
  const serialized = {
    id: String(recipe._id),
    title: recipe.title,
    description: recipe.description,
    region: recipe.region ?? null,
    category: recipe.category ?? null,
    difficulty: recipe.difficulty,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    servings: recipe.servings,
    nutrition: toPublicNutrition(recipe.nutrition),
    ingredients: (recipe.ingredients || []).map(toPublicRecipeIngredient),
    instructions: recipe.instructions || [],
    steps: toStructuredSteps(recipe.instructions || []),
    dietaryTags: recipe.dietaryTags ?? [],
    imageUrl: recipe.imageUrl ?? null,
    isActive: recipe.isActive,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
  if (includeCooking) serialized.cooking = toPublicCooking(recipe.cooking);
  if (includeRatingSummary) {
    serialized.ratingSummary = {
      averageRating: recipe._ratingSummary.averageRating,
      ratingCount: recipe._ratingSummary.ratingCount,
    };
  }
  return serialized;
}

function actorId(value) {
  if (!value) return null;
  return String(value._id || value);
}

// Staff-only representation. Normal consumer responses continue to use
// toPublicRecipe and therefore never expose actor attribution.
function toStaffRecipe(recipe, options) {
  return {
    ...toPublicRecipe(recipe, options),
    ...(options?.includeCooking ? { cooking: toStaffCooking(recipe.cooking) } : {}),
    publicationStatus: recipe.publicationStatus === undefined ? 'published' : recipe.publicationStatus,
    createdBy: actorId(recipe.createdBy),
    updatedBy: actorId(recipe.updatedBy),
    publishedBy: actorId(recipe.publishedBy),
    publishedAt: recipe.publishedAt ?? null,
    nutritionSource: recipe.nutrition == null ? null : toStaffNutritionSource(recipe.nutritionProvenance),
  };
}

function toDuplicateCandidateRecipe(recipe) {
  const legacy = recipe.publicationStatus == null;
  return {
    id: String(recipe._id || recipe.id),
    title: recipe.title,
    publicationStatus: legacy ? 'published' : recipe.publicationStatus,
    publicationStatusSource: legacy ? 'legacy' : 'explicit',
    isActive: recipe.isActive !== false,
    updatedAt: recipe.updatedAt,
  };
}

module.exports = {
  toPublicRecipe,
  toStaffRecipe,
  toStructuredSteps,
  toDuplicateCandidateRecipe,
  toPublicNutrition,
};
