import {
  MAX_COOK_TIME_MINUTES,
  MAX_DESCRIPTION_LENGTH,
  MAX_INGREDIENT_NOTE_LENGTH,
  MAX_INGREDIENTS,
  MAX_INSTRUCTION_LENGTH,
  MAX_INSTRUCTIONS,
  MAX_PREP_TIME_MINUTES,
  MAX_SERVINGS,
  MAX_TITLE_LENGTH,
  RECIPE_DIETARY_TAGS,
  RECIPE_CATEGORIES,
  RECIPE_DIFFICULTIES,
  RECIPE_REGIONS,
  RECIPE_UNITS,
  TO_TASTE_UNIT,
} from '../recipeOptions.js';

export const AUTHORING_STEPS = Object.freeze(['basics', 'ingredients', 'instructions', 'details', 'review']);
export const STEP_LABELS = Object.freeze({
  basics: 'Basics', ingredients: 'Ingredients', instructions: 'Instructions', details: 'Details', review: 'Review',
});

const DIFFICULTIES = new Set(RECIPE_DIFFICULTIES.map(({ value }) => value));
const DIETARY_TAGS = new Set(RECIPE_DIETARY_TAGS.map(({ value }) => value));
const REGIONS = new Set(RECIPE_REGIONS.map(({ value }) => value));
const CATEGORIES = new Set(RECIPE_CATEGORIES.map(({ value }) => value));
const UNITS = new Set(RECIPE_UNITS.map(({ value }) => value));
const scalarDetails = ['difficulty', 'prepTimeMinutes', 'cookTimeMinutes', 'servings'];
export const NUTRIENT_FIELDS = Object.freeze([
  ['caloriesKcal', 'Calories', 'kcal'],
  ['proteinGrams', 'Protein', 'g'],
  ['carbohydrateGrams', 'Carbohydrate', 'g'],
  ['fatGrams', 'Fat', 'g'],
  ['sugarGrams', 'Sugar', 'g'],
  ['fiberGrams', 'Fiber', 'g'],
]);
const MAX_NUTRITION_SOURCE_LABEL_LENGTH = 500;

export function blankNutrition() {
  return Object.fromEntries(NUTRIENT_FIELDS.map(([field]) => [field, '']));
}

function blankNutritionSource() {
  return { kind: 'manual', label: '', url: '' };
}

export function blankIngredient() {
  return { key: `ingredient-${Date.now()}-${Math.random()}`, ingredient: null, quantity: '', unit: 'g', optional: false, note: '' };
}

export function emptyRecipeForm() {
  return {
    title: '', description: '', imageUrl: null,
    ingredients: [blankIngredient()], instructions: [''],
    difficulty: '', prepTimeMinutes: '', cookTimeHours: '', cookTimeMinutePart: '', servings: '',
    region: '', category: '', dietaryTags: [],
    nutrition: null, nutritionSource: blankNutritionSource(),
  };
}

export function formFromRecipe(recipe) {
  if (!recipe) return emptyRecipeForm();
  const cookTime = splitDuration(recipe.cookTimeMinutes);
  return {
    title: recipe.title ?? '', description: recipe.description ?? '', imageUrl: recipe.imageUrl ?? null,
    ingredients: recipe.ingredients?.length ? recipe.ingredients.map((entry, index) => ({
      key: `ingredient-${index}-${entry.ingredient?.id || 'missing'}`,
      ingredient: entry.ingredient ? { ...entry.ingredient } : { id: null, name: 'Unavailable', unavailable: true },
      quantity: entry.quantity == null ? '' : String(entry.quantity), unit: entry.unit || 'g',
      optional: Boolean(entry.optional), note: entry.note ?? '',
    })) : [blankIngredient()],
    instructions: recipe.instructions?.length ? [...recipe.instructions] : [''],
    difficulty: recipe.difficulty ?? '', prepTimeMinutes: valueOrBlank(recipe.prepTimeMinutes),
    cookTimeHours: cookTime.hours, cookTimeMinutePart: cookTime.minutes, servings: valueOrBlank(recipe.servings),
    region: recipe.region ?? '', category: recipe.category ?? '', dietaryTags: [...(recipe.dietaryTags || [])],
    nutrition: recipe.nutrition ? Object.fromEntries(NUTRIENT_FIELDS.map(([field]) => [field, valueOrBlank(recipe.nutrition[field])])) : null,
    nutritionSource: recipe.nutritionSource ? {
      kind: recipe.nutritionSource.kind || 'manual',
      label: recipe.nutritionSource.label ?? '',
      url: recipe.nutritionSource.url ?? '',
    } : blankNutritionSource(),
  };
}

function valueOrBlank(value) { return value == null ? '' : String(value); }
function collapsed(value) { return String(value ?? '').trim().replace(/\s+/g, ' '); }
function unicodeLetterCount(value) { return (value.match(/\p{L}/gu) || []).length; }

export function parseIngredientQuantity(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let quantity;
  let match = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (match) {
    const [, whole, numerator, denominator] = match.map(Number);
    if (numerator <= 0 || denominator <= 0) return null;
    quantity = whole + (numerator / denominator);
  } else {
    match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (match) {
      const [, numerator, denominator] = match.map(Number);
      if (numerator <= 0 || denominator <= 0) return null;
      quantity = numerator / denominator;
    } else if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) {
      quantity = Number(text);
    } else {
      return null;
    }
  }
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

export function splitDuration(totalMinutes) {
  if (totalMinutes === '' || totalMinutes == null) return { hours: '', minutes: '' };
  const total = Number(totalMinutes);
  if (!Number.isInteger(total) || total < 0) return { hours: '', minutes: '' };
  return { hours: String(Math.floor(total / 60)), minutes: String(total % 60) };
}

export function combineDuration(hours, minutes) {
  const hoursText = String(hours ?? '').trim();
  const minutesText = String(minutes ?? '').trim();
  if (!hoursText && !minutesText) return null;
  if ((hoursText && !/^\d+$/.test(hoursText)) || (minutesText && !/^\d+$/.test(minutesText))) return null;
  const parsedHours = hoursText ? Number(hoursText) : 0;
  const parsedMinutes = minutesText ? Number(minutesText) : 0;
  if (!Number.isInteger(parsedHours) || parsedHours < 0 || !Number.isInteger(parsedMinutes) || parsedMinutes < 0 || parsedMinutes > 59) return null;
  return (parsedHours * 60) + parsedMinutes;
}

export function formatDuration(totalMinutes) {
  if (totalMinutes === '' || totalMinutes == null) return '—';
  const total = Number(totalMinutes);
  if (!Number.isInteger(total) || total < 0) return '—';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  return `${hours} hr${minutes ? ` ${minutes} min` : ''}`;
}
function isBlankIngredient(row) {
  return !row?.ingredient?.id && String(row?.quantity ?? '').trim() === '' && String(row?.note ?? '').trim() === ''
    && !row?.optional && (!row?.unit || row.unit === 'g');
}
function hasAnyIngredientValue(row) {
  return Boolean(row?.ingredient?.id || String(row?.quantity ?? '').trim() || String(row?.note ?? '').trim() || row?.optional || (row?.unit && row.unit !== 'g'));
}

export function normalizeIngredients(rows = []) {
  return rows.filter((row) => !isBlankIngredient(row)).map((row) => {
    const item = { ingredientId: row.ingredient?.id || '', unit: row.unit, optional: Boolean(row.optional) };
    if (row.unit !== TO_TASTE_UNIT && String(row.quantity ?? '').trim() !== '') item.quantity = parseIngredientQuantity(row.quantity);
    const note = String(row.note ?? '').trim();
    if (note) item.note = note;
    return item;
  });
}

export function normalizeInstructions(rows = []) {
  return rows.map((row) => String(row ?? '').trim()).filter(Boolean);
}

function normalizeNutrition(nutrition) {
  if (nutrition == null) return null;
  return {
    schemaVersion: 1,
    basis: 'perServing',
    ...Object.fromEntries(NUTRIENT_FIELDS.map(([field]) => {
      const text = String(nutrition[field] ?? '').trim();
      return [field, text === '' ? null : Number(text)];
    })),
  };
}

function normalizeNutritionSource(source) {
  const normalized = {
    kind: source?.kind === 'jsonLd' ? 'jsonLd' : 'manual',
    label: String(source?.label ?? '').trim(),
  };
  const url = String(source?.url ?? '').trim();
  if (url) normalized.url = url;
  return normalized;
}

export function normalizeSection(form, step) {
  if (step === 'basics') return { title: collapsed(form.title), description: String(form.description ?? '').trim(), imageUrl: form.imageUrl ?? null };
  if (step === 'ingredients') return { ingredients: normalizeIngredients(form.ingredients) };
  if (step === 'instructions') return { instructions: normalizeInstructions(form.instructions) };
  if (step === 'details') return {
    difficulty: form.difficulty || '',
    prepTimeMinutes: form.prepTimeMinutes === '' ? '' : Number(form.prepTimeMinutes),
    cookTimeMinutes: combineDuration(form.cookTimeHours, form.cookTimeMinutePart) ?? '',
    servings: form.servings === '' ? '' : Number(form.servings),
    region: form.region || '', category: form.category || '',
    dietaryTags: [...new Set(form.dietaryTags || [])],
    nutrition: normalizeNutrition(form.nutrition),
    nutritionSource: form.nutrition == null ? null : normalizeNutritionSource(form.nutritionSource),
  };
  return {};
}

function error(errors, field, message) { if (!errors[field]) errors[field] = message; }
function validateInteger(errors, field, value, min, max, label, required) {
  if (value === '' || value == null) { if (required) error(errors, field, `${label} is required.`); return; }
  const text = String(value).trim();
  const number = /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(number) || number < min || number > max) error(errors, field, `${label} must be a whole number from ${min} to ${max}.`);
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateNutrition(errors, form) {
  if (form.nutrition == null) return;
  for (const [field, label] of NUTRIENT_FIELDS) {
    const text = String(form.nutrition[field] ?? '').trim();
    const number = text === '' ? Number.NaN : Number(text);
    if (!Number.isFinite(number) || number < 0) {
      error(errors, `nutrition.${field}`, `${label} must be a finite nonnegative number.`);
    }
  }
  const label = String(form.nutritionSource?.label ?? '').trim();
  if (!label) error(errors, 'nutritionSource.label', 'Nutrition source is required.');
  else if (label.length > MAX_NUTRITION_SOURCE_LABEL_LENGTH) {
    error(errors, 'nutritionSource.label', `Nutrition source must be ${MAX_NUTRITION_SOURCE_LABEL_LENGTH} characters or fewer.`);
  }
  const url = String(form.nutritionSource?.url ?? '').trim();
  if (url && !isPublicHttpsUrl(url)) {
    error(errors, 'nutritionSource.url', 'Nutrition source URL must be HTTPS and contain no credentials.');
  }
}

export function validateStep(form, step, { published = false } = {}) {
  const errors = {};
  if (step === 'basics') {
    const title = collapsed(form.title);
    if (title.length < 2) error(errors, 'title', 'Title must be at least 2 characters.');
    else if (title.length > MAX_TITLE_LENGTH) error(errors, 'title', `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
    else if (unicodeLetterCount(title) < 2) error(errors, 'title', 'Title must contain at least 2 letters.');
    const description = String(form.description ?? '').trim();
    if (published && !description) error(errors, 'description', 'Description is required for a Published recipe.');
    else if (description.length > MAX_DESCRIPTION_LENGTH) error(errors, 'description', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  if (step === 'ingredients') {
    const rows = form.ingredients || [];
    const persisted = rows.map((row, index) => ({ row, index })).filter(({ row }) => !isBlankIngredient(row));
    if (published && persisted.length === 0) error(errors, 'ingredients', 'At least one ingredient is required for a Published recipe.');
    if (persisted.length > MAX_INGREDIENTS) error(errors, 'ingredients', `A maximum of ${MAX_INGREDIENTS} ingredients is allowed.`);
    persisted.forEach(({ row, index }) => {
      if (!hasAnyIngredientValue(row)) return;
      if (!row.ingredient?.id) error(errors, `ingredients.${index}.ingredient`, 'Choose an ingredient.');
      if (!UNITS.has(row.unit)) error(errors, `ingredients.${index}.unit`, 'Choose a valid unit.');
      if (row.unit !== TO_TASTE_UNIT && parseIngredientQuantity(row.quantity) == null) error(errors, `ingredients.${index}.quantity`, 'Enter a positive number, fraction, or mixed fraction.');
      if (String(row.note ?? '').trim().length > MAX_INGREDIENT_NOTE_LENGTH) error(errors, `ingredients.${index}.note`, `Note must be ${MAX_INGREDIENT_NOTE_LENGTH} characters or fewer.`);
    });
  }
  if (step === 'instructions') {
    const instructions = (form.instructions || [])
      .map((text, index) => ({ text: String(text ?? '').trim(), index }))
      .filter(({ text }) => text.length > 0);
    if (published && instructions.length === 0) error(errors, 'instructions', 'At least one instruction is required for a Published recipe.');
    if (instructions.length > MAX_INSTRUCTIONS) error(errors, 'instructions', `A maximum of ${MAX_INSTRUCTIONS} instructions is allowed.`);
    instructions.forEach(({ text, index }) => {
      if (text.length < 3) error(errors, `instructions.${index}`, 'Instruction must be at least 3 characters.');
      else if (text.length > MAX_INSTRUCTION_LENGTH) error(errors, `instructions.${index}`, `Instruction must be ${MAX_INSTRUCTION_LENGTH} characters or fewer.`);
      else if (!/\p{L}/u.test(text)) error(errors, `instructions.${index}`, 'Instruction must contain text.');
    });
  }
  if (step === 'details') {
    if (form.difficulty && !DIFFICULTIES.has(form.difficulty)) error(errors, 'difficulty', 'Choose a valid difficulty.');
    if (published && !form.difficulty) error(errors, 'difficulty', 'Difficulty is required for a Published recipe.');
    validateInteger(errors, 'prepTimeMinutes', form.prepTimeMinutes, 1, MAX_PREP_TIME_MINUTES, 'Prep time', false);
    const cookTime = combineDuration(form.cookTimeHours, form.cookTimeMinutePart);
    const hasCookTime = String(form.cookTimeHours ?? '').trim() !== '' || String(form.cookTimeMinutePart ?? '').trim() !== '';
    if (!hasCookTime) {
      if (published) error(errors, 'cookTimeMinutes', 'Cooking time is required.');
    } else if (cookTime == null || cookTime < 3 || cookTime > MAX_COOK_TIME_MINUTES) {
      error(errors, 'cookTimeMinutes', `Cooking time must use whole hours and 0–59 minutes, totaling 3 to ${MAX_COOK_TIME_MINUTES} minutes.`);
    }
    validateInteger(errors, 'servings', form.servings, 1, MAX_SERVINGS, 'Servings', published);
    if (form.region && !REGIONS.has(form.region)) error(errors, 'region', 'Choose a supported region.');
    if (form.category && !CATEGORIES.has(form.category)) error(errors, 'category', 'Choose a supported category.');
    if ((form.dietaryTags || []).some((tag) => !DIETARY_TAGS.has(tag))) error(errors, 'dietaryTags', 'Choose only supported dietary tags.');
    validateNutrition(errors, form);
  }
  return errors;
}

export function publicationReadiness(form) {
  const sections = {};
  for (const step of AUTHORING_STEPS.slice(0, 4)) {
    const errors = validateStep(form, step, { published: true });
    sections[step] = { complete: Object.keys(errors).length === 0, errors, messages: [...new Set(Object.values(errors))] };
  }
  return { sections, complete: Object.values(sections).every(({ complete }) => complete) };
}

export function firstIncompleteStep(form) {
  const readiness = publicationReadiness(form);
  return AUTHORING_STEPS.slice(0, 4).find((step) => !readiness.sections[step].complete) || 'review';
}

export function stepForField(field = '') {
  if (/^(title|description|image)/.test(field)) return 'basics';
  if (/^ingredients/.test(field)) return 'ingredients';
  if (/^(instructions|steps)/.test(field)) return 'instructions';
  if (/^(difficulty|prepTimeMinutes|cookTimeMinutes|servings|region|category|dietaryTags|nutrition)/.test(field)) return 'details';
  return 'review';
}

function comparable(value) { return JSON.stringify(value); }
export function isStepDirty(savedForm, workingForm, step) { return comparable(normalizeSection(savedForm, step)) !== comparable(normalizeSection(workingForm, step)); }
export function dirtySteps(savedForm, workingForm) { return AUTHORING_STEPS.slice(0, 4).filter((step) => isStepDirty(savedForm, workingForm, step)); }

export function buildStepPatch(savedForm, workingForm, step) {
  const before = normalizeSection(savedForm, step);
  const after = normalizeSection(workingForm, step);
  const patch = {};
  for (const [field, value] of Object.entries(after)) {
    if (step === 'details' && (field === 'nutrition' || field === 'nutritionSource')) continue;
    if (comparable(value) === comparable(before[field])) continue;
    if (step === 'basics' && field === 'description' && value === '') patch[field] = null;
    else if (step === 'details' && (scalarDetails.includes(field) || field === 'region' || field === 'category') && value === '') patch[field] = null;
    else patch[field] = value;
  }
  if (step === 'details' && (
    comparable(before.nutrition) !== comparable(after.nutrition)
    || comparable(before.nutritionSource) !== comparable(after.nutritionSource)
  )) {
    patch.nutrition = after.nutrition;
    if (after.nutrition !== null) patch.nutritionSource = after.nutritionSource;
  }
  return patch;
}

export function createDraftBody(form) { return { title: collapsed(form.title) }; }
export function publishBody(updatedAt, duplicateReview) {
  const body = { confirmFilipinoCuisine: true, expectedUpdatedAt: updatedAt };
  if (duplicateReview?.resultDigest) {
    body.duplicateReview = { resultDigest: duplicateReview.resultDigest, confirmDistinctRecipe: true };
  }
  return body;
}
export function mutationBody(patch, updatedAt) { return { ...patch, expectedUpdatedAt: updatedAt }; }
export function statusLabel(recipe) {
  const publication = recipe?.publicationStatus === 'draft' ? 'Draft' : 'Published';
  return recipe?.isActive === false ? `Archived ${publication}` : publication;
}

