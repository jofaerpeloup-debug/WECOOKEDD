import {
  ALLERGY_PRESETS,
  DIETARY_PRESETS,
  addPreference,
  editPreference,
  normalizePreferenceValues,
  togglePreset,
} from '../src/account/accountPreferences';

describe('ACCOUNT2 preference editing', () => {
  test('uses the frozen ordered preset lists', () => {
    expect(DIETARY_PRESETS).toEqual(['Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-Free', 'Dairy-Free', 'Halal', 'Kosher']);
    expect(ALLERGY_PRESETS).toEqual(['Peanuts', 'Tree Nuts', 'Milk', 'Eggs', 'Wheat', 'Gluten', 'Soy', 'Fish', 'Shellfish', 'Sesame']);
  });

  test('preserves unknown legacy spelling/order while trimming and first-wins deduplicating', () => {
    expect(normalizePreferenceValues(['  Low FODMAP  ', 'legacy Value', 'LOW fodmap'])).toEqual(['Low FODMAP', 'legacy Value']);
  });

  test('preset selection appends canonical value and deselection removes a case-insensitive match', () => {
    expect(togglePreset(['Legacy'], 'Vegan').values).toEqual(['Legacy', 'Vegan']);
    expect(togglePreset(['veGAN', 'Legacy'], 'Vegan').values).toEqual(['Legacy']);
  });

  test('custom add/edit rejects case-insensitive duplicates and does not comma-split', () => {
    expect(addPreference([], 'No onion, no garlic').values).toEqual(['No onion, no garlic']);
    expect(addPreference(['Vegan'], ' vegan ').error).toBe('Already added');
    expect(editPreference(['Alpha', 'Beta'], 'Beta', ' alpha ').error).toBe('Already added');
  });

  test('enforces the shared twenty-entry cap', () => {
    const full = Array.from({ length: 20 }, (_, index) => `Value ${index}`);
    expect(addPreference(full, 'Overflow').error).toBe('Up to 20 entries');
  });

  test('deduplicates legacy values before enforcing the twenty-entry cap', () => {
    const legacy = [
      ...Array.from({ length: 19 }, (_, index) => `Value ${index}`),
      ' value 0 ',
    ];
    expect(addPreference(legacy, 'Value 19')).toEqual({
      values: [...Array.from({ length: 19 }, (_, index) => `Value ${index}`), 'Value 19'],
      error: null,
    });
  });

  test('normalizes legacy duplicates consistently for hydration, edits, toggles, and saves', () => {
    const legacy = [' Vegan ', 'vegan', 'Low FODMAP', 'low fodmap'];
    expect(normalizePreferenceValues(legacy)).toEqual(['Vegan', 'Low FODMAP']);
    expect(editPreference(legacy, 'Low FODMAP', 'No onion').values).toEqual(['Vegan', 'No onion']);
    expect(togglePreset(legacy, 'Vegan').values).toEqual(['Low FODMAP']);
  });
});
