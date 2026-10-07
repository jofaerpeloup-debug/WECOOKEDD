const {
  DIETARY_OPTIONS,
  DIFFICULTY_OPTIONS,
  REGION_OPTIONS,
  CATEGORY_OPTIONS,
  TOTAL_TIME_OPTIONS,
  DEFAULT_DISCOVER_SORT,
  MAX_PREP_MINUTES,
  activeFilterCount,
  discoverFilterQuery,
  draftFromFilters,
  normalizeDiscoverFilters,
  presetFilters,
  presetFiltersState,
  selectedPresetKey,
  validateDiscoverFilterDraft,
} = require('../src/utils/discoverFilters');
const { DISCOVER_SORT_OPTIONS } = require('../src/api/recipeOptions');

describe('Discover replacement presets', () => {
  it.each([
    ['all', { sort: 'titleAsc' }],
    ['easy', { difficulty: 'easy', sort: 'titleAsc' }],
    ['vegetarian', { dietaryTags: ['vegetarian'], sort: 'titleAsc' }],
    ['vegan', { dietaryTags: ['vegan'], sort: 'titleAsc' }],
  ])('%s replaces the complete filter state', (key, expected) => {
    expect(presetFilters(key)).toEqual(expected);
    expect(selectedPresetKey(expected)).toBe(key);
  });

  it('fails closed to All for an unsupported preset key', () => {
    expect(presetFilters('medium')).toEqual({ sort: 'titleAsc' });
  });

  it('preserves state identity for the equivalent initial Dashboard handoff', () => {
    const initialState = presetFilters('vegan');
    let lifecycleTransitions = 0;
    let firstPageRequests = 1;
    let state = initialState;
    const commit = (next) => {
      if (next !== state) {
        lifecycleTransitions += 1;
        firstPageRequests += 1;
      }
      state = next;
    };

    commit(presetFiltersState(state, 'vegan'));

    expect(state).toBe(initialState);
    expect(lifecycleTransitions).toBe(0);
    expect(firstPageRequests).toBe(1);
  });

  it('returns a new exact preset state when a Dashboard handoff changes filters', () => {
    const initialState = presetFilters('easy');
    const nextState = presetFiltersState(initialState, 'vegetarian');

    expect(nextState).not.toBe(initialState);
    expect(nextState).toEqual({ dietaryTags: ['vegetarian'], sort: 'titleAsc' });
  });

  it('does not preserve an equivalent but unnormalized state object', () => {
    const invalidState = { dietaryTags: ['vegan'], category: 'hidden-client-state' };
    const nextState = presetFiltersState(invalidState, 'vegan');

    expect(nextState).not.toBe(invalidState);
    expect(nextState).toEqual({ dietaryTags: ['vegan'], sort: 'titleAsc' });
  });

  it('leaves every preset unselected for non-preset states', () => {
    expect(selectedPresetKey({ difficulty: 'medium' })).toBeNull();
    expect(selectedPresetKey({ difficulty: 'easy', dietaryTags: ['vegan'] })).toBeNull();
    expect(selectedPresetKey({ maxPrepTimeMinutes: 30 })).toBeNull();
  });

  it('preserves the approved sort while replacing every narrowing filter', () => {
    expect(
      presetFiltersState(
        {
          difficulty: 'hard',
          ingredient: { id: 'ingredient-1', name: 'Garlic' },
          sort: 'newest',
        },
        'vegan'
      )
    ).toEqual({ dietaryTags: ['vegan'], sort: 'newest' });
  });
});

describe('Discover filter normalization and server query projection', () => {
  it.each(['easy', 'medium', 'hard'])('accepts Difficulty %s', (difficulty) => {
    expect(normalizeDiscoverFilters({ difficulty })).toEqual({ sort: 'titleAsc', difficulty });
  });

  it('deduplicates and projects dietary selections in canonical taxonomy order', () => {
    expect(normalizeDiscoverFilters({
      dietaryTags: ['nutFree', 'vegan', 'nutFree', 'vegetarian'],
    })).toEqual({
      sort: 'titleAsc',
      dietaryTags: ['vegetarian', 'vegan', 'nutFree'],
    });
  });

  it('keeps single-select options complete and exposes all six dietary choices', () => {
    expect(DIFFICULTY_OPTIONS.map((option) => option.value)).toEqual([
      '',
      'easy',
      'medium',
      'hard',
    ]);
    expect(DIETARY_OPTIONS.map((option) => option.value)).toEqual([
      'vegetarian',
      'vegan',
      'pescatarian',
      'glutenFree',
      'dairyFree',
      'nutFree',
    ]);
    expect(TOTAL_TIME_OPTIONS.map((option) => option.value)).toEqual([
      '', 'under-15', '15-to-30', '31-to-60', 'over-60',
    ]);
    expect(REGION_OPTIONS.map((option) => option.value).slice(0, 3)).toEqual([
      '', 'national-capital-region', 'cordillera-administrative-region',
    ]);
    expect(CATEGORY_OPTIONS.map((option) => option.value)).toEqual([
      '', 'breakfast', 'lunch', 'dinner', 'snack',
    ]);
  });

  it('drops unsupported, array-valued, and unrelated fields', () => {
    expect(
      normalizeDiscoverFilters({
        difficulty: ['easy'],
        dietaryTags: ['keto'],
        maxPrepTimeMinutes: 20.5,
        category: 'dessert',
      })
    ).toEqual({ sort: 'titleAsc' });
    expect(normalizeDiscoverFilters({ maxPrepTimeMinutes: true })).toEqual({ sort: 'titleAsc' });
    expect(normalizeDiscoverFilters({ maxPrepTimeMinutes: '1e2' })).toEqual({ sort: 'titleAsc' });
  });

  it('projects all approved families with AND-style scalar query keys', () => {
    expect(
      discoverFilterQuery({
        region: 'bicol-region',
        category: 'dinner',
        difficulty: 'hard',
        dietaryTags: ['nutFree', 'vegan', 'nutFree'],
        maxPrepTimeMinutes: '45',
        totalTimeBucket: '31-to-60',
        ingredient: { id: 'ingredient-123', name: '  Garlic  ', aliases: ['bawang'] },
        sort: 'prepTimeDesc',
      })
    ).toEqual({
      sort: 'prepTimeDesc',
      region: 'bicol-region',
      category: 'dinner',
      difficulty: 'hard',
      dietaryTags: 'vegan,nutFree',
      maxPrepTimeMinutes: 45,
      totalTimeBucket: '31-to-60',
      ingredientId: 'ingredient-123',
    });
  });

  it('omits Any and blank optional values', () => {
    expect(
      discoverFilterQuery({ difficulty: '', dietaryTags: [], maxPrepTimeMinutes: '  ', totalTimeBucket: '' })
    ).toEqual({ sort: 'titleAsc' });
  });

  it('counts only valid active filter families', () => {
    expect(activeFilterCount({
      difficulty: 'easy', dietaryTags: ['vegan', 'nutFree'], maxPrepTimeMinutes: 30,
      totalTimeBucket: 'over-60',
    })).toBe(4);
    expect(activeFilterCount({ difficulty: 'impossible', maxPrepTimeMinutes: 0 })).toBe(0);
    expect(activeFilterCount({ sort: 'newest' })).toBe(0);
    expect(activeFilterCount({ ingredient: { id: 'ingredient-1', name: 'Garlic' } })).toBe(1);
  });

  it('accepts only frozen total-time buckets and omits empty dietary selection', () => {
    expect(normalizeDiscoverFilters({ totalTimeBucket: 'under-15' })).toEqual({
      sort: 'titleAsc', totalTimeBucket: 'under-15',
    });
    expect(normalizeDiscoverFilters({ totalTimeBucket: { $gt: 60 } })).toEqual({ sort: 'titleAsc' });
    expect(discoverFilterQuery({ dietaryTags: [] })).toEqual({ sort: 'titleAsc' });
  });

  it('fails closed for malformed Ingredient selections and never projects names or aliases', () => {
    expect(discoverFilterQuery({ ingredient: { id: '', name: 'Garlic' } })).toEqual({
      sort: 'titleAsc',
    });
    expect(discoverFilterQuery({ ingredient: { id: 'ingredient-1' } })).toEqual({
      sort: 'titleAsc',
    });
    expect(
      discoverFilterQuery({
        ingredient: { id: ' ingredient-1 ', name: ' Garlic ', aliases: ['bawang'] },
      })
    ).toEqual({ sort: 'titleAsc', ingredientId: 'ingredient-1' });
  });

  it('freezes the exact six consumer sorts and defaults invalid values', () => {
    expect(DEFAULT_DISCOVER_SORT).toBe('titleAsc');
    expect(DISCOVER_SORT_OPTIONS).toEqual([
      { value: 'titleAsc', label: 'Title: A-Z' },
      { value: 'titleDesc', label: 'Title: Z-A' },
      { value: 'newest', label: 'Newest added' },
      { value: 'oldest', label: 'Oldest added' },
      { value: 'prepTimeAsc', label: 'Prep time: low to high' },
      { value: 'prepTimeDesc', label: 'Prep time: high to low' },
    ]);
    expect(normalizeDiscoverFilters({ sort: 'updatedDesc' })).toEqual({ sort: 'titleAsc' });
    expect(normalizeDiscoverFilters({ sort: 'rating' })).toEqual({ sort: 'titleAsc' });
  });
});

describe('Maximum prep draft validation', () => {
  it.each([
    ['1', 1],
    [String(MAX_PREP_MINUTES), MAX_PREP_MINUTES],
  ])('accepts boundary value %s', (input, expected) => {
    expect(validateDiscoverFilterDraft({ maxPrepTimeMinutes: input })).toEqual({
      filters: { sort: 'titleAsc', maxPrepTimeMinutes: expected },
      prepError: null,
    });
  });

  it.each(['1.5', '0', '-1', '1441', 'abc'])('rejects invalid value %s', (input) => {
    const result = validateDiscoverFilterDraft({ maxPrepTimeMinutes: input });
    expect(result.filters).toBeNull();
    expect(result.prepError).toBe('Enter a whole number from 1 to 1440.');
  });

  it('treats blank as no maximum and drops unsupported enum draft values', () => {
    expect(
      validateDiscoverFilterDraft({
        difficulty: 'expert',
        dietaryTags: ['keto'],
        totalTimeBucket: 'not-a-bucket',
        maxPrepTimeMinutes: ' ',
      })
    ).toEqual({ filters: { sort: 'titleAsc' }, prepError: null });
  });

  it('copies applied state into editable string draft state', () => {
    expect(
      draftFromFilters({
        difficulty: 'medium',
        dietaryTags: ['nutFree', 'pescatarian', 'nutFree'],
        maxPrepTimeMinutes: 60,
        totalTimeBucket: '15-to-30',
        ingredient: { id: 'ingredient-1', name: 'Garlic' },
        sort: 'newest',
      })
    ).toEqual({
      region: '',
      category: '',
      difficulty: 'medium',
      dietaryTags: ['pescatarian', 'nutFree'],
      maxPrepTimeMinutes: '60',
      totalTimeBucket: '15-to-30',
      ingredient: { id: 'ingredient-1', name: 'Garlic' },
      sort: 'newest',
    });
  });

  it('validates Ingredient and sort through the same fail-closed normalizer', () => {
    expect(
      validateDiscoverFilterDraft({
        ingredient: { id: 'ingredient-2', name: 'Onion', category: 'vegetable' },
        sort: 'oldest',
      })
    ).toEqual({
      filters: { sort: 'oldest', ingredient: { id: 'ingredient-2', name: 'Onion' } },
      prepError: null,
    });
    expect(
      validateDiscoverFilterDraft({ ingredient: { id: 'typed-only', name: '' }, sort: 'updatedDesc' })
    ).toEqual({ filters: { sort: 'titleAsc' }, prepError: null });
  });
});
