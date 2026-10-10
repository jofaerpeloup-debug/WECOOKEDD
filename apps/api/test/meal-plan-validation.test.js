const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidDateKey,
  listMealPlanSchema,
  createMealPlanEntrySchema,
  moveMealPlanEntrySchema,
  putReminderSchema, deleteReminderSchema, removeMealPlanEntrySchema, clearMealPlanSchema,
} = require('../src/modules/meal-plan/meal-plan.validation');

const RECIPE_ID = '507f1f77bcf86cd799439099';
const ENTRY_ID = '507f1f77bcf86cd799439077';
const UPDATED_AT = '2026-09-14T08:30:00.000Z';

test('dateKey accepts real calendar dates including leap day without transforming the string', () => {
  assert.equal(isValidDateKey('2024-02-29'), true);
  const parsed = createMealPlanEntrySchema.parse({ body: { dateKey: '2024-02-29', recipeId: RECIPE_ID } });
  assert.equal(parsed.body.dateKey, '2024-02-29');
});

test('reminder and delete amendments require exact bodies and sorted complete snapshots', () => {
  const path = { params: { entryId: ENTRY_ID }, query: {} };
  const version = { expectedUpdatedAt: UPDATED_AT, expectedReminderRevision: 0 };
  assert.equal(putReminderSchema.safeParse({ ...path, body: { ...version, localTime: '09:00', timeZone: 'UTC' } }).success, true);
  assert.equal(putReminderSchema.safeParse({ ...path, body: { ...version, localTime: '09:00', timeZone: 'UTC', fireAt: UPDATED_AT } }).success, false);
  assert.equal(deleteReminderSchema.safeParse({ ...path, body: version }).success, true);
  assert.equal(deleteReminderSchema.safeParse({ ...path, body: { ...version, ownerId: ENTRY_ID } }).success, false);
  assert.equal(removeMealPlanEntrySchema.safeParse({ ...path, body: { expectedUpdatedAt: UPDATED_AT } }).success, true);
  assert.equal(removeMealPlanEntrySchema.safeParse({ ...path, body: {} }).success, false);
  const query = { startDate: '2026-09-14', endDate: '2026-09-20' };
  assert.equal(clearMealPlanSchema.safeParse({ query, body: { expectedEntries: [] } }).success, true);
  assert.equal(clearMealPlanSchema.safeParse({ query, body: { expectedEntries: [{ id: ENTRY_ID, expectedUpdatedAt: UPDATED_AT }, { id: ENTRY_ID, expectedUpdatedAt: UPDATED_AT }] } }).success, false);
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

test('move accepts only a real date and offset timestamp for a valid entry id', () => {
  const parsed = moveMealPlanEntrySchema.parse({
    params: { entryId: ENTRY_ID },
    body: { dateKey: '2024-02-29', expectedUpdatedAt: UPDATED_AT },
    query: {},
  });
  assert.deepEqual(parsed.body, { dateKey: '2024-02-29', expectedUpdatedAt: UPDATED_AT });

  for (const body of [
    { dateKey: '2026-02-30', expectedUpdatedAt: UPDATED_AT },
    { dateKey: '2026-09-15', expectedUpdatedAt: 'not-a-timestamp' },
    { dateKey: '2026-09-15', expectedUpdatedAt: '2026-09-14T08:30:00' },
  ]) {
    assert.equal(moveMealPlanEntrySchema.safeParse({ params: { entryId: ENTRY_ID }, body, query: {} }).success, false);
  }
});

test('move accepts offset-aware timestamps only through millisecond precision', () => {
  for (const expectedUpdatedAt of [
    '2026-10-02T10:20:30Z',
    '2026-10-02T10:20:30.1Z',
    '2026-10-02T10:20:30.12Z',
    '2026-10-02T10:20:30.123Z',
    '2026-10-02T18:20:30.123+08:00',
  ]) {
    const result = moveMealPlanEntrySchema.safeParse({
      params: { entryId: ENTRY_ID },
      body: { dateKey: '2026-10-03', expectedUpdatedAt },
      query: {},
    });
    assert.equal(result.success, true, expectedUpdatedAt);
  }

  for (const expectedUpdatedAt of [
    '2026-10-02T10:20:30.0009Z',
    '2026-10-02T10:20:30.1234Z',
    '2026-10-02T18:20:30.1234+08:00',
  ]) {
    const result = moveMealPlanEntrySchema.safeParse({
      params: { entryId: ENTRY_ID },
      body: { dateKey: '2026-10-03', expectedUpdatedAt },
      query: {},
    });
    assert.equal(result.success, false, expectedUpdatedAt);
  }
});

test('move rejects missing fields, mass assignment, and every unknown body field', () => {
  const base = { dateKey: '2026-09-15', expectedUpdatedAt: UPDATED_AT };
  assert.equal(moveMealPlanEntrySchema.safeParse({ params: { entryId: ENTRY_ID }, body: { dateKey: base.dateKey }, query: {} }).success, false);
  for (const field of ['userId', 'ownerId', 'recipeId', 'mealType', 'createdAt', 'updatedAt', '$set', 'unknown']) {
    const result = moveMealPlanEntrySchema.safeParse({
      params: { entryId: ENTRY_ID },
      body: { ...base, [field]: 'x' },
      query: {},
    });
    assert.equal(result.success, false, field);
  }
});
