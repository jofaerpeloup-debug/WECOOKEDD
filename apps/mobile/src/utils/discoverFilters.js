import {
  categoryLabel, dietaryTagLabel, regionLabel, RECIPE_CATEGORIES, RECIPE_DIETARY_TAGS,
  RECIPE_DIFFICULTIES, RECIPE_REGIONS, RECIPE_SORTS, RECIPE_TOTAL_TIME_BUCKETS,
} from '../api/recipeOptions';

export const MAX_PREP_MINUTES = 1440;
export const DEFAULT_DISCOVER_SORT = 'titleAsc';

export const DIFFICULTY_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export const DIETARY_OPTIONS = RECIPE_DIETARY_TAGS.map((value) => ({ value, label: dietaryTagLabel(value) }));
export const TOTAL_TIME_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'under-15', label: 'Under 15 min' },
  { value: '15-to-30', label: '15-30 min' },
  { value: '31-to-60', label: '31-60 min' },
  { value: 'over-60', label: 'Over 60 min' },
];
export const REGION_OPTIONS = [{ value: '', label: 'Any' }, ...RECIPE_REGIONS.map((value) => ({ value, label: regionLabel(value) }))];
export const CATEGORY_OPTIONS = [{ value: '', label: 'Any' }, ...RECIPE_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))];

const PRESET_FILTERS = {
  all: {},
  easy: { difficulty: 'easy' },
  vegetarian: { dietaryTags: ['vegetarian'] },
  vegan: { dietaryTags: ['vegan'] },
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

function normalizedDietaryTags(value) {
  if (!Array.isArray(value)) return [];
  return RECIPE_DIETARY_TAGS.filter((tag) => value.includes(tag));
}

function equalFilterValue(key, left, right) {
  if (key === 'ingredient') {
    return left?.id === right?.id && left?.name === right?.name;
  }
  if (key === 'dietaryTags') {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((tag, index) => tag === right[index]);
  }
  return left === right;
}

export function normalizeDiscoverFilters(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = { sort: normalizedSort(source.sort) };
  if (RECIPE_REGIONS.includes(source.region)) normalized.region = source.region;
  if (RECIPE_CATEGORIES.includes(source.category)) normalized.category = source.category;
  if (RECIPE_DIFFICULTIES.includes(source.difficulty)) {
    normalized.difficulty = source.difficulty;
  }
  const dietaryTags = normalizedDietaryTags(source.dietaryTags);
  if (dietaryTags.length > 0) normalized.dietaryTags = dietaryTags;
  const prep = normalizedPrepMinutes(source.maxPrepTimeMinutes);
  if (prep !== undefined) normalized.maxPrepTimeMinutes = prep;
  if (RECIPE_TOTAL_TIME_BUCKETS.includes(source.totalTimeBucket)) {
    normalized.totalTimeBucket = source.totalTimeBucket;
  }
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
      return equalFilterValue(filterKey, current[filterKey], normalizedCurrent[filterKey]);
    });
  const equivalent =
    currentKeys.length === nextKeys.length &&
    nextKeys.every((filterKey) => equalFilterValue(filterKey, normalizedCurrent[filterKey], next[filterKey]));
  return currentIsNormalized && equivalent ? current : next;
}

export function selectedPresetKey(value) {
  const filters = normalizeDiscoverFilters(value);
  const keys = Object.keys(filters).filter((key) => key !== 'sort');
  if (keys.length === 0) return 'all';
  if (keys.length !== 1) return null;
  if (filters.difficulty === 'easy') return 'easy';
  if (filters.dietaryTags?.length === 1 && filters.dietaryTags[0] === 'vegetarian') return 'vegetarian';
  if (filters.dietaryTags?.length === 1 && filters.dietaryTags[0] === 'vegan') return 'vegan';
  return null;
}

export function activeFilterCount(value) {
  return Object.keys(normalizeDiscoverFilters(value)).filter((key) => key !== 'sort').length;
}

export function discoverFilterQuery(value) {
  const { ingredient, dietaryTags, ...filters } = normalizeDiscoverFilters(value);
  return {
    ...filters,
    ...(dietaryTags ? { dietaryTags: dietaryTags.join(',') } : {}),
    ...(ingredient ? { ingredientId: ingredient.id } : {}),
  };
}

export function draftFromFilters(value) {
  const filters = normalizeDiscoverFilters(value);
  return {
    region: filters.region || '',
    category: filters.category || '',
    difficulty: filters.difficulty || '',
    dietaryTags: [...(filters.dietaryTags || [])],
    maxPrepTimeMinutes:
      filters.maxPrepTimeMinutes === undefined ? '' : String(filters.maxPrepTimeMinutes),
    totalTimeBucket: filters.totalTimeBucket || '',
    ingredient: filters.ingredient || null,
    sort: filters.sort,
  };
}

export function validateDiscoverFilterDraft(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const difficulty = RECIPE_DIFFICULTIES.includes(source.difficulty) ? source.difficulty : '';
  const dietaryTags = normalizedDietaryTags(source.dietaryTags);
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
      dietaryTags,
      maxPrepTimeMinutes: rawPrep,
      totalTimeBucket: source.totalTimeBucket,
      ingredient: source.ingredient,
      sort: source.sort,
    }),
    prepError: null,
  };
}
