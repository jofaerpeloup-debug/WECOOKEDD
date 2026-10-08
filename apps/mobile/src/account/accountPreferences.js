export const DIETARY_PRESETS = Object.freeze([
  'Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-Free', 'Dairy-Free', 'Halal', 'Kosher',
]);

export const ALLERGY_PRESETS = Object.freeze([
  'Peanuts', 'Tree Nuts', 'Milk', 'Eggs', 'Wheat', 'Gluten', 'Soy', 'Fish', 'Shellfish', 'Sesame',
]);

export const MAX_PREFERENCE_ENTRIES = 20;
export const MAX_PREFERENCE_ENTRY_LENGTH = 50;

const keyOf = (value) => value.trim().toLowerCase();

export function normalizePreferenceValues(values) {
  const seen = new Set();
  const normalized = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || value.length > MAX_PREFERENCE_ENTRY_LENGTH) continue;
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function addPreference(values, rawValue) {
  const normalizedValues = normalizePreferenceValues(values);
  const value = rawValue.trim();
  if (!value) return { values: normalizedValues, error: 'Preference entries cannot be empty.' };
  if (value.length > MAX_PREFERENCE_ENTRY_LENGTH) return { values: normalizedValues, error: 'Keep entries under 50 characters' };
  if (normalizedValues.some((item) => keyOf(item) === keyOf(value))) return { values: normalizedValues, error: 'Already added' };
  if (normalizedValues.length >= MAX_PREFERENCE_ENTRIES) return { values: normalizedValues, error: 'Up to 20 entries' };
  return { values: [...normalizedValues, value], error: null };
}

export function editPreference(values, oldValue, rawValue) {
  const normalizedValues = normalizePreferenceValues(values);
  const value = rawValue.trim();
  if (!value) return { values: normalizedValues, error: 'Preference entries cannot be empty.' };
  if (value.length > MAX_PREFERENCE_ENTRY_LENGTH) return { values: normalizedValues, error: 'Keep entries under 50 characters' };
  if (normalizedValues.some((item) => item !== oldValue && keyOf(item) === keyOf(value))) {
    return { values: normalizedValues, error: 'Already added' };
  }
  return { values: normalizedValues.map((item) => item === oldValue ? value : item), error: null };
}

export function togglePreset(values, preset) {
  const normalizedValues = normalizePreferenceValues(values);
  const key = keyOf(preset);
  const existing = normalizedValues.find((item) => keyOf(item) === key);
  if (existing) return { values: normalizedValues.filter((item) => item !== existing), error: null };
  return addPreference(normalizedValues, preset);
}

export function isPresetSelected(values, preset) {
  return values.some((item) => keyOf(item) === keyOf(preset));
}
