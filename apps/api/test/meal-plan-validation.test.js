const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidDateKey,
  listMealPlanSchema,
  createMealPlanEntrySchema,
} = require('../src/modules/meal-plan/meal-plan.validation');

const RECIPE_ID = '507f1f77bcf86cd799439099';

test('dateKey accepts real calendar dates including leap day without transforming the string', () => {
  assert.equal(isValidDateKey('2024-02-29'), true);
  const parsed = createMealPlanEntrySchema.parse({ body: { dateKey: '2024-02-29', recipeId: RECIPE_ID } });
  assert.equal(parsed.body.dateKey, '2024-02-29');
});

test('dateKey rejects malformed and impossible dates', () => {
  for (const dateKey of ['2026-2-03', '2026-02-30', '2025-02-29', '0000-01-01']) {
    assert.equal(isValidDateKey(dateKey), false);
    assert.equal(createMealPlanEntrySchema.safeParse({ body: { dateKey, recipeId: RECIPE_ID } }).success, false);
  }
});

test('create is strict and rejects ownership, snapshots, timestamps, and unknown fields', () => {
  for (const field of ['userId', 'ownerId', 'mealType', 'servings', 'recipeTitle', 'createdAt']) {
    const result = createMealPlanEntrySchema.safeParse({ body: { dateKey: '2026-09-13', recipeId: RECIPE_ID, [field]: 'x' } });
    assert.equal(result.success, false, field);
  }
});

test('range validation rejects inverted, over-31-day, and extra query inputs', () => {
  assert.equal(listMealPlanSchema.safeParse({ query: { startDate: '2026-09-14', endDate: '2026-09-13' } }).success, false);
  assert.equal(listMealPlanSchema.safeParse({ query: { startDate: '2026-01-01', endDate: '2026-02-01' } }).success, false);
  assert.equal(listMealPlanSchema.safeParse({ query: { startDate: '2026-09-01', endDate: '2026-10-01' } }).success, true);
  assert.equal(listMealPlanSchema.safeParse({ query: { startDate: '2026-09-01', endDate: '2026-09-07', userId: RECIPE_ID } }).success, false);
});
