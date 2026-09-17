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
  RECIPE_DIFFICULTIES,
  RECIPE_UNITS,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  TO_TASTE_UNIT,
  normalizeSlugInput,
} from '../recipeOptions.js';

export const AUTHORING_STEPS = Object.freeze(['basics', 'ingredients', 'instructions', 'details', 'review']);
export const STEP_LABELS = Object.freeze({
  basics: 'Basics', ingredients: 'Ingredients', instructions: 'Instructions', details: 'Details', review: 'Review',
});

const DIFFICULTIES = new Set(RECIPE_DIFFICULTIES.map(({ value }) => value));
const DIETARY_TAGS = new Set(RECIPE_DIETARY_TAGS.map(({ value }) => value));
const UNITS = new Set(RECIPE_UNITS.map(({ value }) => value));
const scalarDetails = ['difficulty', 'prepTimeMinutes', 'cookTimeMinutes', 'servings'];

export function blankIngredient() {
  return { key: `ingredient-${Date.now()}-${Math.random()}`, ingredient: null, quantity: '', unit: 'g', optional: false, note: '' };
}

export function emptyRecipeForm() {
  return {
    title: '', description: '', imageUrl: null,
    ingredients: [blankIngredient()], instructions: [''],
    difficulty: '', prepTimeMinutes: '', cookTimeMinutes: '', servings: '',
    region: '', category: '', dietaryTags: [],
  };
}

export function formFromRecipe(recipe) {
  if (!recipe) return emptyRecipeForm();
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
    cookTimeMinutes: valueOrBlank(recipe.cookTimeMinutes), servings: valueOrBlank(recipe.servings),
    region: recipe.region ?? '', category: recipe.category ?? '', dietaryTags: [...(recipe.dietaryTags || [])],
  };
}

function valueOrBlank(value) { return value == null ? '' : String(value); }
function collapsed(value) { return String(value ?? '').trim().replace(/\s+/g, ' '); }
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
    if (row.unit !== TO_TASTE_UNIT && String(row.quantity ?? '').trim() !== '') item.quantity = Number(row.quantity);
    const note = String(row.note ?? '').trim();
    if (note) item.note = note;
    return item;
  });
}

export function normalizeInstructions(rows = []) {
  return rows.map((row) => String(row ?? '').trim()).filter(Boolean);
}

export function normalizeSection(form, step) {
  if (step === 'basics') return { title: collapsed(form.title), description: String(form.description ?? '').trim(), imageUrl: form.imageUrl ?? null };
  if (step === 'ingredients') return { ingredients: normalizeIngredients(form.ingredients) };
  if (step === 'instructions') return { instructions: normalizeInstructions(form.instructions) };
  if (step === 'details') return {
    difficulty: form.difficulty || '',
    prepTimeMinutes: form.prepTimeMinutes === '' ? '' : Number(form.prepTimeMinutes),
    cookTimeMinutes: form.cookTimeMinutes === '' ? '' : Number(form.cookTimeMinutes),
    servings: form.servings === '' ? '' : Number(form.servings),
    region: normalizeSlugInput(form.region), category: normalizeSlugInput(form.category),
    dietaryTags: [...new Set(form.dietaryTags || [])].sort(),
  };
  return {};
}

function error(errors, field, message) { if (!errors[field]) errors[field] = message; }
function validateInteger(errors, field, value, min, max, label, required) {
  if (value === '' || value == null) { if (required) error(errors, field, `${label} is required.`); return; }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) error(errors, field, `${label} must be a whole number from ${min} to ${max}.`);
}

export function validateStep(form, step, { published = false } = {}) {
  const errors = {};
  if (step === 'basics') {
    const title = collapsed(form.title);
    if (!title) error(errors, 'title', 'Title is required.');
    else if (title.length > MAX_TITLE_LENGTH) error(errors, 'title', `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
    const description = String(form.description ?? '').trim();
    if (published && !description) error(errors, 'description', 'Description is required for a Published recipe.');
    else if (description.length > MAX_DESCRIPTION_LENGTH) error(errors, 'description', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  if (step === 'ingredients') {
    const rows = form.ingredients || [];
    const persisted = rows.filter((row) => !isBlankIngredient(row));
    if (published && persisted.length === 0) error(errors, 'ingredients', 'At least one ingredient is required for a Published recipe.');
    if (persisted.length > MAX_INGREDIENTS) error(errors, 'ingredients', `A maximum of ${MAX_INGREDIENTS} ingredients is allowed.`);
    persisted.forEach((row, index) => {
      if (!hasAnyIngredientValue(row)) return;
      if (!row.ingredient?.id) error(errors, `ingredients.${index}.ingredient`, 'Choose an ingredient.');
      if (!UNITS.has(row.unit)) error(errors, `ingredients.${index}.unit`, 'Choose a valid unit.');
      if (row.unit !== TO_TASTE_UNIT && !(Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0)) error(errors, `ingredients.${index}.quantity`, 'Enter a quantity greater than zero.');
      if (String(row.note ?? '').trim().length > MAX_INGREDIENT_NOTE_LENGTH) error(errors, `ingredients.${index}.note`, `Note must be ${MAX_INGREDIENT_NOTE_LENGTH} characters or fewer.`);
    });
  }
  if (step === 'instructions') {
    const instructions = normalizeInstructions(form.instructions);
    if (published && instructions.length === 0) error(errors, 'instructions', 'At least one instruction is required for a Published recipe.');
    if (instructions.length > MAX_INSTRUCTIONS) error(errors, 'instructions', `A maximum of ${MAX_INSTRUCTIONS} instructions is allowed.`);
    instructions.forEach((text, index) => { if (text.length > MAX_INSTRUCTION_LENGTH) error(errors, `instructions.${index}`, `Instruction must be ${MAX_INSTRUCTION_LENGTH} characters or fewer.`); });
  }
  if (step === 'details') {
    if (form.difficulty && !DIFFICULTIES.has(form.difficulty)) error(errors, 'difficulty', 'Choose a valid difficulty.');
    if (published && !form.difficulty) error(errors, 'difficulty', 'Difficulty is required for a Published recipe.');
    validateInteger(errors, 'prepTimeMinutes', form.prepTimeMinutes, 0, MAX_PREP_TIME_MINUTES, 'Prep time', published);
    validateInteger(errors, 'cookTimeMinutes', form.cookTimeMinutes, 0, MAX_COOK_TIME_MINUTES, 'Cook time', published);
    validateInteger(errors, 'servings', form.servings, 1, MAX_SERVINGS, 'Servings', published);
    for (const field of ['region', 'category']) {
      const value = normalizeSlugInput(form[field]);
      if (value && (value.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(value))) error(errors, field, `${field === 'region' ? 'Region' : 'Category'} must use letters, numbers, and single hyphens.`);
    }
    if ((form.dietaryTags || []).some((tag) => !DIETARY_TAGS.has(tag))) error(errors, 'dietaryTags', 'Choose only supported dietary tags.');
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
  if (/^(difficulty|prepTimeMinutes|cookTimeMinutes|servings|region|category|dietaryTags)/.test(field)) return 'details';
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
    if (comparable(value) === comparable(before[field])) continue;
    if (step === 'basics' && field === 'description' && value === '') patch[field] = null;
    else if (step === 'details' && (scalarDetails.includes(field) || field === 'region' || field === 'category') && value === '') patch[field] = null;
    else patch[field] = value;
  }
  return patch;
}

export function createDraftBody(form) { return { title: collapsed(form.title) }; }
export function publishBody(updatedAt) { return { confirmFilipinoCuisine: true, expectedUpdatedAt: updatedAt }; }
export function mutationBody(patch, updatedAt) { return { ...patch, expectedUpdatedAt: updatedAt }; }
export function statusLabel(recipe) {
  const publication = recipe?.publicationStatus === 'draft' ? 'Draft' : 'Published';
  return recipe?.isActive === false ? `Archived ${publication}` : publication;
}

