import {
  MAX_COOK_TIME_MINUTES, MAX_DESCRIPTION_LENGTH, MAX_INSTRUCTION_LENGTH,
  MAX_INSTRUCTIONS, MAX_PREP_TIME_MINUTES, MAX_SERVINGS, MAX_TITLE_LENGTH,
} from '../recipeOptions.js';

export const MAX_RECIPE_INTAKE_BYTES = 256 * 1024;

const supportedProperties = new Set([
  '@context', '@type', 'name', 'description', 'prepTime', 'cookTime',
  'recipeYield', 'recipeInstructions', 'recipeIngredient',
]);
const structuralWrapperProperties = new Set(['@context', '@graph']);

function emptyResult(error = null) {
  return { ok: !error, error, values: {}, mapped: [], unsupported: [], invalid: [], unresolved: [] };
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
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFKC');
  if (!normalized || /\b(?:minus|negative|zero|one|two|three|four|five|six|seven|eight|nine|ten|half|halves|quarter|quarters|third|thirds|dozen|dozens|score|point)\b/iu.test(normalized)) return null;
  if (/[+\u2212\uFE63\uFF0D]/u.test(normalized) || /-\s*\p{N}/u.test(normalized)) return null;
  if (/\p{N}\s*[\/.\u2044]\s*\p{N}/u.test(normalized)) return null;
  if (/\p{N}\s*(?:[x×*]|\b(?:to|through|or)\b)/iu.test(normalized)) return null;
  const numbers = normalized.match(/\p{N}+/gu) || [];
  if (numbers.length !== 1 || !/^\d+$/.test(numbers[0])) return null;
  const parsed = Number(numbers[0]);
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
    if (servings == null || servings < 1 || servings > MAX_SERVINGS) addInvalid(result, 'recipeYield', `Expected one positive whole number from 1 to ${MAX_SERVINGS}.`);
    else addMapped(result, 'recipeYield', 'servings', servings);
  }
  mapInstructions(result, recipe);
  mapIngredients(result, recipe);
  for (const property of Object.keys(recipe)) {
    if (!supportedProperties.has(property)) result.unsupported.push({ field: property, message: 'Not mapped to the WeCooked Recipe form.' });
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
  };
}
