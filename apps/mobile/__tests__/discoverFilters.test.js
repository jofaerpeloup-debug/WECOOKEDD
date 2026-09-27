const {
  DIETARY_OPTIONS,
  DIFFICULTY_OPTIONS,
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

describe('Discover replacement presets', () => {
  it.each([
    ['all', {}],
    ['easy', { difficulty: 'easy' }],
    ['vegetarian', { dietaryTag: 'vegetarian' }],
    ['vegan', { dietaryTag: 'vegan' }],
  ])('%s replaces the complete filter state', (key, expected) => {
    expect(presetFilters(key)).toEqual(expected);
    expect(selectedPresetKey(expected)).toBe(key);
  });

  it('fails closed to All for an unsupported preset key', () => {
    expect(presetFilters('medium')).toEqual({});
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
    expect(nextState).toEqual({ dietaryTag: 'vegetarian' });
  });

  it('does not preserve an equivalent but unnormalized state object', () => {
    const invalidState = { dietaryTag: 'vegan', category: 'hidden-client-state' };
    const nextState = presetFiltersState(invalidState, 'vegan');

    expect(nextState).not.toBe(invalidState);
    expect(nextState).toEqual({ dietaryTag: 'vegan' });
  });

  it('leaves every preset unselected for non-preset states', () => {
    expect(selectedPresetKey({ difficulty: 'medium' })).toBeNull();
    expect(selectedPresetKey({ difficulty: 'easy', dietaryTag: 'vegan' })).toBeNull();
    expect(selectedPresetKey({ maxPrepTimeMinutes: 30 })).toBeNull();
  });
});

describe('Discover filter normalization and server query projection', () => {
  it.each(['easy', 'medium', 'hard'])('accepts Difficulty %s', (difficulty) => {
    expect(normalizeDiscoverFilters({ difficulty })).toEqual({ difficulty });
  });

  it.each(['vegetarian', 'vegan', 'pescatarian', 'glutenFree', 'dairyFree', 'nutFree'])(
    'accepts Dietary tag %s',
    (dietaryTag) => {
      expect(normalizeDiscoverFilters({ dietaryTag })).toEqual({ dietaryTag });
    }
  );

  it('keeps option lists single-select and complete', () => {
    expect(DIFFICULTY_OPTIONS.map((option) => option.value)).toEqual([
      '',
      'easy',
      'medium',
      'hard',
    ]);
    expect(DIETARY_OPTIONS.map((option) => option.value)).toEqual([
      '',
      'vegetarian',
      'vegan',
      'pescatarian',
      'glutenFree',
      'dairyFree',
      'nutFree',
    ]);
  });

  it('drops unsupported, array-valued, and unrelated fields', () => {
    expect(
      normalizeDiscoverFilters({
        difficulty: ['easy'],
        dietaryTag: 'keto',
        maxPrepTimeMinutes: 20.5,
        category: 'dinner',
      })
    ).toEqual({});
    expect(normalizeDiscoverFilters({ maxPrepTimeMinutes: true })).toEqual({});
    expect(normalizeDiscoverFilters({ maxPrepTimeMinutes: '1e2' })).toEqual({});
  });

  it('projects all approved families with AND-style scalar query keys', () => {
    expect(
      discoverFilterQuery({
        difficulty: 'hard',
        dietaryTag: 'nutFree',
        maxPrepTimeMinutes: '45',
      })
    ).toEqual({ difficulty: 'hard', dietaryTag: 'nutFree', maxPrepTimeMinutes: 45 });
  });

  it('omits Any and blank optional values', () => {
    expect(
      discoverFilterQuery({ difficulty: '', dietaryTag: '', maxPrepTimeMinutes: '  ' })
    ).toEqual({});
  });

  it('counts only valid active filter families', () => {
    expect(activeFilterCount({ difficulty: 'easy', dietaryTag: 'vegan', maxPrepTimeMinutes: 30 })).toBe(3);
    expect(activeFilterCount({ difficulty: 'impossible', maxPrepTimeMinutes: 0 })).toBe(0);
  });
});

describe('Maximum prep draft validation', () => {
  it.each([
    ['1', 1],
    [String(MAX_PREP_MINUTES), MAX_PREP_MINUTES],
  ])('accepts boundary value %s', (input, expected) => {
    expect(validateDiscoverFilterDraft({ maxPrepTimeMinutes: input })).toEqual({
      filters: { maxPrepTimeMinutes: expected },
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
        dietaryTag: ['vegan'],
        maxPrepTimeMinutes: ' ',
      })
    ).toEqual({ filters: {}, prepError: null });
  });

  it('copies applied state into editable string draft state', () => {
    expect(
      draftFromFilters({
        difficulty: 'medium',
        dietaryTag: 'pescatarian',
        maxPrepTimeMinutes: 60,
      })
    ).toEqual({
      difficulty: 'medium',
      dietaryTag: 'pescatarian',
      maxPrepTimeMinutes: '60',
    });
  });
});
