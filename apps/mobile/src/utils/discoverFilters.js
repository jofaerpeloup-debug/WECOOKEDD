import {
  categoryLabel, dietaryTagLabel, regionLabel, RECIPE_CATEGORIES, RECIPE_DIETARY_TAGS,
  RECIPE_DIFFICULTIES, RECIPE_REGIONS, RECIPE_SORTS,
} from '../api/recipeOptions';

export const MAX_PREP_MINUTES = 1440;
export const DEFAULT_DISCOVER_SORT = 'titleAsc';

export const DIFFICULTY_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export const DIETARY_OPTIONS = [{ value: '', label: 'Any' }, ...RECIPE_DIETARY_TAGS.map((value) => ({ value, label: dietaryTagLabel(value) }))];
export const REGION_OPTIONS = [{ value: '', label: 'Any' }, ...RECIPE_REGIONS.map((value) => ({ value, label: regionLabel(value) }))];
export const CATEGORY_OPTIONS = [{ value: '', label: 'Any' }, ...RECIPE_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))];

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

function normalizedSort(value) {
  return RECIPE_SORTS.includes(value) ? value : DEFAULT_DISCOVER_SORT;
}

function normalizedIngredient(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  return id && name ? { id, name } : undefined;
}

export function normalizeDiscoverFilters(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = { sort: normalizedSort(source.sort) };
  if (RECIPE_REGIONS.includes(source.region)) normalized.region = source.region;
  if (RECIPE_CATEGORIES.includes(source.category)) normalized.category = source.category;
  if (RECIPE_DIFFICULTIES.includes(source.difficulty)) {
    normalized.difficulty = source.difficulty;
  }
  if (RECIPE_DIETARY_TAGS.includes(source.dietaryTag)) {
    normalized.dietaryTag = source.dietaryTag;
  }
  const prep = normalizedPrepMinutes(source.maxPrepTimeMinutes);
  if (prep !== undefined) normalized.maxPrepTimeMinutes = prep;
  const ingredient = normalizedIngredient(source.ingredient);
  if (ingredient) normalized.ingredient = ingredient;
  return normalized;
}

export function presetFilters(key, sort = DEFAULT_DISCOVER_SORT) {
  return { ...(PRESET_FILTERS[key] || PRESET_FILTERS.all), sort: normalizedSort(sort) };
}

export function presetFiltersState(current, key) {
  const normalizedCurrent = normalizeDiscoverFilters(current);
  const next = presetFilters(key, normalizedCurrent.sort);
  const currentKeys = Object.keys(normalizedCurrent);
  const nextKeys = Object.keys(next);
  const sourceKeys =
    current && typeof current === 'object' && !Array.isArray(current) ? Object.keys(current) : [];
  const currentIsNormalized =
    sourceKeys.length === currentKeys.length &&
    currentKeys.every((filterKey) => {
      if (filterKey !== 'ingredient') return current[filterKey] === normalizedCurrent[filterKey];
      return (
        current.ingredient?.id === normalizedCurrent.ingredient.id &&
        current.ingredient?.name === normalizedCurrent.ingredient.name
      );
    });
  const equivalent =
    currentKeys.length === nextKeys.length &&
    nextKeys.every((filterKey) => normalizedCurrent[filterKey] === next[filterKey]);
  return currentIsNormalized && equivalent ? current : next;
}

export function selectedPresetKey(value) {
  const filters = normalizeDiscoverFilters(value);
  const keys = Object.keys(filters).filter((key) => key !== 'sort');
  if (keys.length === 0) return 'all';
  if (keys.length !== 1) return null;
  if (filters.difficulty === 'easy') return 'easy';
  if (filters.dietaryTag === 'vegetarian') return 'vegetarian';
  if (filters.dietaryTag === 'vegan') return 'vegan';
  return null;
}

export function activeFilterCount(value) {
  return Object.keys(normalizeDiscoverFilters(value)).filter((key) => key !== 'sort').length;
}

export function discoverFilterQuery(value) {
  const { ingredient, ...filters } = normalizeDiscoverFilters(value);
  return {
    ...filters,
    ...(ingredient ? { ingredientId: ingredient.id } : {}),
  };
}

export function draftFromFilters(value) {
  const filters = normalizeDiscoverFilters(value);
  return {
    region: filters.region || '',
    category: filters.category || '',
    difficulty: filters.difficulty || '',
    dietaryTag: filters.dietaryTag || '',
    maxPrepTimeMinutes:
      filters.maxPrepTimeMinutes === undefined ? '' : String(filters.maxPrepTimeMinutes),
    ingredient: filters.ingredient || null,
    sort: filters.sort,
  };
}

export function validateDiscoverFilterDraft(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const difficulty = RECIPE_DIFFICULTIES.includes(source.difficulty) ? source.difficulty : '';
  const dietaryTag = RECIPE_DIETARY_TAGS.includes(source.dietaryTag) ? source.dietaryTag : '';
  const region = RECIPE_REGIONS.includes(source.region) ? source.region : '';
  const category = RECIPE_CATEGORIES.includes(source.category) ? source.category : '';
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
      region,
      category,
      difficulty,
      dietaryTag,
      maxPrepTimeMinutes: rawPrep,
      ingredient: source.ingredient,
      sort: source.sort,
    }),
    prepError: null,
  };
}
