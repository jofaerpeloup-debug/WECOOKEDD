const test = require('node:test');
const assert = require('node:assert/strict');
const MealPlanEntry = require('../src/modules/meal-plan/meal-plan.model');

const USER_ID = '507f1f77bcf86cd799439001';
const RECIPE_ID = '507f1f77bcf86cd799439099';

test('meal plan model contains only ownership, calendar date, recipe, and timestamps', () => {
  const paths = Object.keys(MealPlanEntry.schema.paths).filter((path) => path !== '_id' && path !== '__v');
  assert.deepEqual(paths.sort(), ['createdAt', 'dateKey', 'recipeId', 'updatedAt', 'userId'].sort());
  assert.equal(MealPlanEntry.schema.path('userId').options.ref, 'User');
  assert.equal(MealPlanEntry.schema.path('recipeId').options.ref, 'Recipe');
  assert.equal(MealPlanEntry.schema.options.timestamps, true);
});

test('model requires every domain field and validates real date keys', async () => {
  await assert.rejects(() => new MealPlanEntry({}).validate());
  await assert.rejects(() => new MealPlanEntry({ userId: USER_ID, recipeId: RECIPE_ID, dateKey: '2026-02-30' }).validate());
  await assert.doesNotReject(() => new MealPlanEntry({ userId: USER_ID, recipeId: RECIPE_ID, dateKey: '2026-09-13' }).validate());
});

test('indexes allow multiple recipes per day while preventing duplicate recipe/date entries', () => {
  const indexes = MealPlanEntry.schema.indexes();
  const unique = indexes.find(([spec]) => spec.userId === 1 && spec.dateKey === 1 && spec.recipeId === 1);
  assert.ok(unique);
  assert.equal(unique[1].unique, true);
  assert.equal('mealType' in unique[0], false);
  const range = indexes.find(([spec]) => spec.userId === 1 && spec.dateKey === 1 && spec.createdAt === 1 && spec._id === 1);
  assert.ok(range);
});
