import {
  categoryLabel, DIETARY_TAG_LABELS,
  MAX_COOK_TIME_MINUTES, MAX_DESCRIPTION_LENGTH, MAX_INSTRUCTION_LENGTH,
  MAX_INSTRUCTIONS, MAX_PREP_TIME_MINUTES, MAX_SERVINGS, MAX_TITLE_LENGTH,
} from '../recipeOptions.js';

export const MAX_RECIPE_INTAKE_BYTES = 256 * 1024;

const supportedProperties = new Set([
  '@context', '@type', 'name', 'description', 'prepTime', 'cookTime',
  'recipeYield', 'recipeInstructions', 'recipeIngredient',
]);
const structuralWrapperProperties = new Set(['@context', '@graph']);
const metadataProperties = new Set(['recipeCategory', 'suitableForDiet', 'recipeCuisine']);
const categorySuggestions = new Map([
  ['breakfast', 'breakfast'], ['lunch', 'lunch'], ['dinner', 'dinner'], ['snack', 'snack'],
]);
const dietarySuggestions = new Map([
  ['VegetarianDiet', 'vegetarian'], ['VeganDiet', 'vegan'], ['GlutenFreeDiet', 'glutenFree'],
]);
const MAX_METADATA_SOURCE_DISPLAY = 200;
const TRUNCATION_MARKER = '… [truncated]';

function emptyResult(error = null) {
  return { ok: !error, error, values: {}, mapped: [], metadata: [], unsupported: [], invalid: [], unresolved: [] };
}

function hasType(value, expected) {
  const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']];
  return types.includes(expected);
}

function recipeSelection(document) {
  if (Array.isArray(document)) return { candidates: document.filter((item) => hasType(item, 'Recipe')), wrapper: null };
  if (!document || typeof document !== 'object') return null;
  if (!Object.hasOwn(document, '@graph')) {
    return { candidates: hasType(document, 'Recipe') ? [document] : [], wrapper: null };
  }
  if (!Array.isArray(document['@graph'])) return null;
  const candidates = document['@graph'].filter((item) => hasType(item, 'Recipe'));
  if (hasType(document, 'Recipe')) candidates.unshift(document);
  return { candidates, wrapper: candidates[0] === document ? null : document };
}

function addMapped(result, source, field, value) {
  result.values[field] = value;
  result.mapped.push({ source, field, value });
}

function addInvalid(result, field, message) {
  result.invalid.push({ field, message });
}

function nonblankString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function mapText(result, recipe, source, field, maxLength, extraCheck) {
  if (!Object.hasOwn(recipe, source)) return;
  const value = nonblankString(recipe[source]);
  if (!value) return addInvalid(result, source, 'Expected a nonblank string.');
  if (value.length > maxLength) return addInvalid(result, source, `Value exceeds ${maxLength} characters.`);
  if (extraCheck && !extraCheck(value)) return addInvalid(result, source, 'Value does not meet the Recipe field requirements.');
  addMapped(result, source, field, value);
}

function isoDurationMinutes(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const weekMatch = text.match(/^P(\d+(?:\.\d+)?)W$/);
  const match = text.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (weekMatch) {
    const total = Number(weekMatch[1]) * 10080;
    return Number.isSafeInteger(total) ? total : null;
  }
  if (!match || match.slice(1).every((part) => part == null) || (text.includes('T') && match.slice(2).every((part) => part == null))) return null;
  const components = match.slice(1);
  const fractionalIndex = components.findIndex((part) => part?.includes('.'));
  if (fractionalIndex !== -1 && components.slice(fractionalIndex + 1).some((part) => part != null)) return null;
  const [days = 0, hours = 0, minutes = 0, seconds = 0] = components.map((part) => part == null ? 0 : Number(part));
  const total = days * 1440 + hours * 60 + minutes + seconds / 60;
  return Number.isSafeInteger(total) ? total : null;
}

function mapDuration(result, recipe, source, field, minimum, maximum) {
  if (!Object.hasOwn(recipe, source)) return;
  const minutes = isoDurationMinutes(recipe[source]);
  if (minutes == null || minutes < minimum || minutes > maximum) {
    addInvalid(result, source, `Expected an ISO-8601 duration totaling ${minimum} to ${maximum} whole minutes.`);
    return;
  }
  addMapped(result, source, field, minutes);
}

function yieldNumber(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFKC');
  const match = normalized.match(/^(?:(\d+)\s+(?:servings?|person|people)|serves\s+(\d+)(?:\s+(?:servings?|person|people))?|makes\s+(\d+)\s+servings?)$/iu);
  if (!match) return null;
  const parsed = Number(match[1] ?? match[2] ?? match[3]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function instructionText(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && hasType(value, 'HowToStep')) return nonblankString(value.text);
  return '';
}

function mapInstructions(result, recipe) {
  if (!Object.hasOwn(recipe, 'recipeInstructions')) return;
  const source = Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions : [recipe.recipeInstructions];
  if (!source.length || source.length > MAX_INSTRUCTIONS) {
    addInvalid(result, 'recipeInstructions', `Expected 1 to ${MAX_INSTRUCTIONS} supported instructions.`);
    return;
  }
  const instructions = source.map(instructionText);
  if (instructions.some((text) => text.length < 3 || text.length > MAX_INSTRUCTION_LENGTH || !/\p{L}/u.test(text))) {
    addInvalid(result, 'recipeInstructions', 'Every instruction must be a string or HowToStep.text that meets the Recipe instruction limits.');
    return;
  }
  addMapped(result, 'recipeInstructions', 'instructions', instructions);
}

function mapIngredients(result, recipe) {
  if (!Object.hasOwn(recipe, 'recipeIngredient')) return;
  const source = Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [recipe.recipeIngredient];
  const values = source.map(nonblankString).filter(Boolean);
  if (!source.length || values.length !== source.length) {
    addInvalid(result, 'recipeIngredient', 'Expected only nonblank ingredient strings.');
    return;
  }
  result.unresolved.push({
    field: 'recipeIngredient', values,
    message: 'Resolve each ingredient through the canonical Ingredient picker.',
  });
}

function sourceDisplay(value) {
  const serialized = JSON.stringify(value);
  const text = serialized === undefined ? String(value) : serialized;
  if (text.length <= MAX_METADATA_SOURCE_DISPLAY) return text;
  return `${text.slice(0, MAX_METADATA_SOURCE_DISPLAY - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function addMetadata(result, source, value, status, details = {}) {
  result.metadata.push({ source, sourceValue: sourceDisplay(value), status, ...details });
}

function mapCategorySuggestion(result, recipe) {
  if (!Object.hasOwn(recipe, 'recipeCategory')) return;
  const source = recipe.recipeCategory;
  if (Array.isArray(source)) {
    addMetadata(result, 'recipeCategory', source, source.length > 1 ? 'ambiguous' : 'unsupported', {
      reason: source.length > 1
        ? 'Multiple category values are ambiguous; no category was suggested.'
        : 'Category arrays are not supported; no category was suggested.',
    });
    return;
  }
  if (typeof source !== 'string') {
    addMetadata(result, 'recipeCategory', source, 'unsupported', {
      reason: 'Expected one supported category string; no category was suggested.',
    });
    return;
  }
  const normalized = source.trim();
  if (normalized.includes(',')) {
    addMetadata(result, 'recipeCategory', source, 'ambiguous', {
      reason: 'Comma-separated category values are ambiguous; no category was suggested.',
    });
    return;
  }
  const value = categorySuggestions.get(normalized.toLowerCase());
  if (!value) {
    addMetadata(result, 'recipeCategory', source, 'unsupported', {
      reason: 'Source category is outside the supported canonical values; no category was suggested.',
    });
    return;
  }
  addMetadata(result, 'recipeCategory', source, 'suggested', {
    field: 'category', value, label: categoryLabel(value),
    reason: 'Exact supported category; Moderator acceptance is required.',
  });
}

function dietaryIdentity(value) {
  if (typeof value === 'string') {
    const identity = value.trim();
    if (dietarySuggestions.has(identity)) return identity;
    const urlMatch = identity.match(/^https:\/\/schema\.org\/(VegetarianDiet|VeganDiet|GlutenFreeDiet)$/u);
    return urlMatch?.[1] || null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== '@id' || typeof value['@id'] !== 'string') return null;
  const urlMatch = value['@id'].match(/^https:\/\/schema\.org\/(VegetarianDiet|VeganDiet|GlutenFreeDiet)$/u);
  return urlMatch?.[1] || null;
}

function mapDietarySuggestions(result, recipe) {
  if (!Object.hasOwn(recipe, 'suitableForDiet')) return;
  const source = recipe.suitableForDiet;
  if (Array.isArray(source) && source.length === 0) {
    addMetadata(result, 'suitableForDiet', source, 'unsupported', {
      reason: 'An empty dietary identity list is unsupported; no dietary tag was suggested.',
    });
    return;
  }
  const items = Array.isArray(source) ? source : [source];
  const suggested = new Set();
  for (const item of items) {
    const identity = dietaryIdentity(item);
    if (!identity) {
      addMetadata(result, 'suitableForDiet', item, 'unsupported', {
        reason: 'Source value is not an exact supported Schema.org dietary identity.',
      });
      continue;
    }
    const value = dietarySuggestions.get(identity);
    if (suggested.has(value)) continue;
    suggested.add(value);
    addMetadata(result, 'suitableForDiet', item, 'suggested', {
      field: 'dietaryTags', value, label: DIETARY_TAG_LABELS[value],
      reason: 'Exact supported dietary identity; Moderator acceptance is required.',
    });
  }
}

function discloseCuisine(result, recipe) {
  if (!Object.hasOwn(recipe, 'recipeCuisine')) return;
  const source = recipe.recipeCuisine;
  addMetadata(result, 'recipeCuisine', source, Array.isArray(source) && source.length > 1 ? 'ambiguous' : 'unsupported', {
    reason: Array.isArray(source) && source.length > 1
      ? 'Multiple cuisine values are ambiguous; META2 does not map cuisine to Region.'
      : 'META2 does not map recipeCuisine to Region.',
  });
}

export function parseRecipeIntake(input) {
  const text = typeof input === 'string' ? input : String(input ?? '');
  if (new TextEncoder().encode(text).byteLength > MAX_RECIPE_INTAKE_BYTES) {
    return emptyResult({ code: 'INPUT_TOO_LARGE', message: 'JSON-LD input must be 256 KiB or smaller.' });
  }
  let document;
  try { document = JSON.parse(text); }
  catch { return emptyResult({ code: 'MALFORMED_JSON', message: 'Enter valid JSON-LD.' }); }

  const selection = recipeSelection(document);
  if (selection == null) return emptyResult({ code: 'UNSUPPORTED_STRUCTURE', message: 'Use one object, an array, or an @graph array.' });
  const { candidates, wrapper } = selection;
  if (candidates.length === 0) return emptyResult({ code: 'NO_RECIPE', message: 'No Recipe object was found.' });
  if (candidates.length > 1) return emptyResult({ code: 'MULTIPLE_RECIPES', message: 'Paste exactly one unambiguous Recipe object.' });

  const recipe = candidates[0];
  const result = emptyResult();
  mapText(result, recipe, 'name', 'title', MAX_TITLE_LENGTH, (value) => value.length >= 2 && (value.match(/\p{L}/gu) || []).length >= 2);
  mapText(result, recipe, 'description', 'description', MAX_DESCRIPTION_LENGTH);
  mapDuration(result, recipe, 'prepTime', 'prepTimeMinutes', 1, MAX_PREP_TIME_MINUTES);
  mapDuration(result, recipe, 'cookTime', 'cookTimeMinutes', 3, MAX_COOK_TIME_MINUTES);
  if (Object.hasOwn(recipe, 'recipeYield')) {
    const servings = yieldNumber(recipe.recipeYield);
    if (servings == null || servings < 1 || servings > MAX_SERVINGS) addInvalid(result, 'recipeYield', `Expected an exact serving/person count from 1 to ${MAX_SERVINGS}, such as "4 servings" or "Serves 4".`);
    else addMapped(result, 'recipeYield', 'servings', servings);
  }
  mapInstructions(result, recipe);
  mapIngredients(result, recipe);
  mapCategorySuggestion(result, recipe);
  mapDietarySuggestions(result, recipe);
  discloseCuisine(result, recipe);
  for (const property of Object.keys(recipe)) {
    if (!supportedProperties.has(property) && !metadataProperties.has(property)) {
      result.unsupported.push({ field: property, message: 'Not mapped to the WeCooked Recipe form.' });
    }
  }
  if (wrapper) {
    for (const property of Object.keys(wrapper)) {
      if (!structuralWrapperProperties.has(property)) {
        result.unsupported.push({ field: property, location: '@graph wrapper', message: 'Not mapped to the WeCooked Recipe form.' });
      }
    }
  }
  return result;
}

const applyOrder = ['title', 'description', 'servings', 'prepTimeMinutes', 'cookTimeMinutes', 'instructions'];

export function applyRecipeIntake(form, result) {
  if (!result?.ok) return { form, applied: [], skipped: [] };
  let next = form;
  const applied = [];
  const skipped = [];
  const apply = (field, patch, blank) => {
    if (!Object.hasOwn(result.values, field)) return;
    if (!blank) { skipped.push({ field, reason: 'Existing value preserved.' }); return; }
    next = { ...next, ...patch };
    applied.push({ field });
  };

  for (const field of applyOrder) {
    if (!Object.hasOwn(result.values, field)) continue;
    if (field === 'title' || field === 'description') apply(field, { [field]: result.values[field] }, String(form[field] ?? '').trim() === '');
    else if (field === 'servings' || field === 'prepTimeMinutes') apply(field, { [field]: String(result.values[field]) }, String(form[field] ?? '').trim() === '');
    else if (field === 'cookTimeMinutes') {
      const total = result.values[field];
      apply(field, { cookTimeHours: String(Math.floor(total / 60)), cookTimeMinutePart: String(total % 60) },
        String(form.cookTimeHours ?? '').trim() === '' && String(form.cookTimeMinutePart ?? '').trim() === '');
    } else if (field === 'instructions') {
      apply(field, { instructions: [...result.values.instructions] },
        Array.isArray(form.instructions) && form.instructions.every((value) => String(value ?? '').trim() === ''));
    }
  }
  return { form: next, applied, skipped };
}

export function metadataSuggestionState(form, suggestion, accepted = false) {
  if (suggestion?.status !== 'suggested') return 'ineligible';
  if (suggestion.field === 'category') {
    const current = String(form?.category ?? '').trim();
    if (current === suggestion.value) return accepted ? 'accepted' : 'already-selected';
    return current ? 'existing-preserved' : 'eligible';
  }
  if (suggestion.field === 'dietaryTags') {
    const current = Array.isArray(form?.dietaryTags) ? form.dietaryTags : [];
    if (current.includes(suggestion.value)) return accepted ? 'accepted' : 'already-selected';
    return 'eligible';
  }
  return 'ineligible';
}

export function acceptMetadataSuggestion({ form, suggestion, change }) {
  const state = metadataSuggestionState(form, suggestion);
  if (state !== 'eligible') return { status: state, changed: false };
  if (suggestion.field === 'category') change('category', suggestion.value);
  else {
    const current = Array.isArray(form?.dietaryTags) ? form.dietaryTags : [];
    change('dietaryTags', [...current, suggestion.value]);
  }
  return { status: 'accepted', changed: true, field: suggestion.field, value: suggestion.value };
}

export function createRecipeIntakeHandlers({ input, form, preview, change, setPreview, setApplication }) {
  return {
    previewInput() {
      const result = parseRecipeIntake(input);
      setPreview(result);
      setApplication(null);
      return result;
    },
    applyPreview() {
      const outcome = applyRecipeIntake(form, preview);
      for (const field of ['title', 'description', 'servings', 'prepTimeMinutes', 'cookTimeHours', 'cookTimeMinutePart', 'instructions']) {
        if (outcome.form[field] !== form[field]) change(field, outcome.form[field]);
      }
      setApplication(outcome);
      return outcome;
    },
    acceptSuggestion(suggestion) {
      return acceptMetadataSuggestion({ form, suggestion, change });
    },
  };
}
