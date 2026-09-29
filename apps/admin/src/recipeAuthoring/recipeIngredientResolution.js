import { MAX_INGREDIENTS, RECIPE_UNITS, TO_TASTE_UNIT } from '../recipeOptions.js';
import { blankIngredient, parseIngredientQuantity } from './recipeAuthoringModel.js';

const VALID_UNITS = new Set(RECIPE_UNITS.map(({ value }) => value));
const MAX_INGREDIENT_NAME_LENGTH = 100;

export function createUnresolvedIngredientQueue(lines, generation) {
  return lines.map((sourceText, index) => ({
    key: `source-${generation}-${index}`,
    generation,
    sourceText,
    resolution: null,
    selectedIngredient: null,
    quantity: '',
    unit: '',
  }));
}

export function ingredientCreationPrefill(entry, currentGeneration) {
  const match = entry?.resolution?.match;
  const parsedName = entry?.resolution?.parsed?.name;
  const name = typeof parsedName === 'string' ? parsedName.trim() : '';
  if (entry?.generation !== currentGeneration
      || entry.resolutionError
      || match?.kind !== 'none'
      || match.totalCandidates !== 0
      || !Array.isArray(match.candidates)
      || match.candidates.length !== 0
      || match.truncated !== false
      || name.length < 1
      || name.length > MAX_INGREDIENT_NAME_LENGTH
      || entry.selectedIngredient) {
    return null;
  }
  return { name, aliases: [], category: '', allergenTags: [] };
}

export function prepareIngredientResolutionRequest(queue) {
  const submitted = [];
  const excluded = [];
  queue.forEach((entry, queueIndex) => {
    if (submitted.length >= 50) {
      excluded.push({ queueIndex, reason: 'Only 50 source lines can be resolved in one request.' });
    } else if (!entry.sourceText.trim() || entry.sourceText.length > 500) {
      excluded.push({ queueIndex, reason: 'This source line must be nonblank and 500 characters or fewer.' });
    } else {
      submitted.push({ queueIndex, sourceText: entry.sourceText });
    }
  });
  return { lines: submitted.map(({ sourceText }) => sourceText), submitted, excluded };
}

export function mergeIngredientResolutionResults(queue, request, resolutions) {
  const byRequestIndex = new Map(resolutions.map((resolution) => [resolution.index, resolution]));
  const excluded = new Map(request.excluded.map((item) => [item.queueIndex, item.reason]));
  return queue.map((entry, queueIndex) => {
    const requestIndex = request.submitted.findIndex((item) => item.queueIndex === queueIndex);
    const resolution = requestIndex === -1 ? null : byRequestIndex.get(requestIndex) || null;
    return {
      ...entry,
      resolution,
      resolutionError: excluded.get(queueIndex) || (requestIndex !== -1 && !resolution ? 'No resolver result was returned.' : ''),
      selectedIngredient: null,
      quantity: resolution?.parsed?.quantity == null ? '' : String(resolution.parsed.quantity),
      unit: resolution?.parsed?.unit || '',
    };
  });
}

export function resolutionConfirmationError(entry) {
  if (!entry?.selectedIngredient?.id) return 'Choose a canonical Ingredient.';
  if (!VALID_UNITS.has(entry.unit)) return 'Choose a valid unit.';
  if (entry.unit === TO_TASTE_UNIT) return '';
  if (parseIngredientQuantity(entry.quantity) == null) return 'Enter a positive number, fraction, or mixed fraction.';
  return '';
}

function isTrulyBlankRow(row) {
  return !row?.ingredient?.id
    && String(row?.quantity ?? '').trim() === ''
    && String(row?.note ?? '').trim() === ''
    && !row?.optional
    && (!row?.unit || row.unit === 'g');
}

export function confirmIngredientResolution(form, queue, queueIndex) {
  const entry = queue[queueIndex];
  const error = resolutionConfirmationError(entry);
  if (error) return { error, form, queue };

  const blankIndex = form.ingredients.findIndex(isTrulyBlankRow);
  if (blankIndex === -1 && form.ingredients.length >= MAX_INGREDIENTS) {
    return { error: `A maximum of ${MAX_INGREDIENTS} ingredients is allowed.`, form, queue };
  }
  const row = {
    ...blankIngredient(),
    ingredient: { id: entry.selectedIngredient.id, name: entry.selectedIngredient.name },
    quantity: entry.unit === TO_TASTE_UNIT ? '' : String(entry.quantity).trim(),
    unit: entry.unit,
    note: '',
    optional: false,
  };
  const ingredients = [...form.ingredients];
  if (blankIndex === -1) ingredients.push(row);
  else ingredients[blankIndex] = row;
  return {
    error: '',
    form: { ...form, ingredients },
    queue: queue.filter((_, index) => index !== queueIndex),
  };
}
