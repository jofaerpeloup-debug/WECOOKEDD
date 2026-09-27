import { RECIPE_DIETARY_TAGS, RECIPE_DIFFICULTIES } from '../api/recipeOptions';

export const MAX_PREP_MINUTES = 1440;

export const DIFFICULTY_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export const DIETARY_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'glutenFree', label: 'Gluten-free' },
  { value: 'dairyFree', label: 'Dairy-free' },
  { value: 'nutFree', label: 'Nut-free' },
];

const PRESET_FILTERS = {
  all: {},
  easy: { difficulty: 'easy' },
  vegetarian: { dietaryTag: 'vegetarian' },
  vegan: { dietaryTag: 'vegan' },
};

function normalizedPrepMinutes(value) {
  if (value === '' || value === undefined || value === null) return undefined;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return undefined;
  const number = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(number) || number < 1 || number > MAX_PREP_MINUTES) {
    return undefined;
  }
  return number;
}

export function normalizeDiscoverFilters(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  if (RECIPE_DIFFICULTIES.includes(source.difficulty)) {
    normalized.difficulty = source.difficulty;
  }
  if (RECIPE_DIETARY_TAGS.includes(source.dietaryTag)) {
    normalized.dietaryTag = source.dietaryTag;
  }
  const prep = normalizedPrepMinutes(source.maxPrepTimeMinutes);
  if (prep !== undefined) normalized.maxPrepTimeMinutes = prep;
  return normalized;
}

export function presetFilters(key) {
  return { ...(PRESET_FILTERS[key] || PRESET_FILTERS.all) };
}

export function presetFiltersState(current, key) {
  const normalizedCurrent = normalizeDiscoverFilters(current);
  const next = presetFilters(key);
  const currentKeys = Object.keys(normalizedCurrent);
  const nextKeys = Object.keys(next);
  const sourceKeys =
    current && typeof current === 'object' && !Array.isArray(current) ? Object.keys(current) : [];
  const currentIsNormalized =
    sourceKeys.length === currentKeys.length &&
    currentKeys.every((filterKey) => current[filterKey] === normalizedCurrent[filterKey]);
  const equivalent =
    currentKeys.length === nextKeys.length &&
    nextKeys.every((filterKey) => normalizedCurrent[filterKey] === next[filterKey]);
  return currentIsNormalized && equivalent ? current : next;
}

export function selectedPresetKey(value) {
  const filters = normalizeDiscoverFilters(value);
  const keys = Object.keys(filters);
  if (keys.length === 0) return 'all';
  if (keys.length !== 1) return null;
  if (filters.difficulty === 'easy') return 'easy';
  if (filters.dietaryTag === 'vegetarian') return 'vegetarian';
  if (filters.dietaryTag === 'vegan') return 'vegan';
  return null;
}

export function activeFilterCount(value) {
  return Object.keys(normalizeDiscoverFilters(value)).length;
}

export function discoverFilterQuery(value) {
  return normalizeDiscoverFilters(value);
}

export function draftFromFilters(value) {
  const filters = normalizeDiscoverFilters(value);
  return {
    difficulty: filters.difficulty || '',
    dietaryTag: filters.dietaryTag || '',
    maxPrepTimeMinutes:
      filters.maxPrepTimeMinutes === undefined ? '' : String(filters.maxPrepTimeMinutes),
  };
}

export function validateDiscoverFilterDraft(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const difficulty = RECIPE_DIFFICULTIES.includes(source.difficulty) ? source.difficulty : '';
  const dietaryTag = RECIPE_DIETARY_TAGS.includes(source.dietaryTag) ? source.dietaryTag : '';
  const rawPrep = String(source.maxPrepTimeMinutes ?? '').trim();
  let prepError = null;

  if (rawPrep && !/^\d+$/.test(rawPrep)) {
    prepError = `Enter a whole number from 1 to ${MAX_PREP_MINUTES}.`;
  } else if (rawPrep) {
    const prep = Number(rawPrep);
    if (prep < 1 || prep > MAX_PREP_MINUTES) {
      prepError = `Enter a whole number from 1 to ${MAX_PREP_MINUTES}.`;
    }
  }

  if (prepError) return { filters: null, prepError };

  return {
    filters: normalizeDiscoverFilters({
      difficulty,
      dietaryTag,
      maxPrepTimeMinutes: rawPrep,
    }),
    prepError: null,
  };
}
