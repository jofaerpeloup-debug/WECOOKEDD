import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStepPatch, createDraftBody, emptyRecipeForm, firstIncompleteStep, formFromRecipe,
  mutationBody, normalizeIngredients, normalizeInstructions, publicationReadiness,
  publishBody, statusLabel, stepForField, validateStep,
} from '../src/recipeAuthoring/recipeAuthoringModel.js';

test('normalization omits blank placeholders and preserves complete rows in order', () => {
  const form = emptyRecipeForm();
  form.ingredients.push({ ingredient: { id: 'i1', name: 'Garlic' }, quantity: '', unit: 'toTaste', optional: true, note: ' garnish ' });
  assert.deepEqual(normalizeIngredients(form.ingredients), [{ ingredientId: 'i1', unit: 'toTaste', optional: true, note: 'garnish' }]);
  assert.deepEqual(normalizeInstructions([' ', ' Simmer. ', '', 'Serve.']), ['Simmer.', 'Serve.']);
});

test('Draft step validation allows empty sections but blocks partial ingredient rows', () => {
  const form = emptyRecipeForm();
  form.title = 'Draft';
  assert.deepEqual(validateStep(form, 'ingredients'), {});
  assert.deepEqual(validateStep(form, 'instructions'), {});
  form.ingredients = [{ ingredient: null, quantity: '2', unit: 'g', optional: false, note: '' }];
  assert.match(validateStep(form, 'ingredients')['ingredients.0.ingredient'], /Choose/);
});

test('Published validation and readiness require all publication fields', () => {
  const form = emptyRecipeForm();
  form.title = 'Adobo';
  let readiness = publicationReadiness(form);
  assert.equal(readiness.complete, false);
  assert.equal(firstIncompleteStep(form), 'basics');
  form.description = 'A Filipino classic.'; form.difficulty = 'easy'; form.prepTimeMinutes = '10'; form.cookTimeMinutes = '30'; form.servings = '4';
  form.ingredients = [{ ingredient: { id: 'i1', name: 'Chicken' }, quantity: '1', unit: 'kg', optional: false, note: '' }];
  form.instructions = ['Simmer until tender.'];
  readiness = publicationReadiness(form);
  assert.equal(readiness.complete, true);
  assert.equal(firstIncompleteStep(form), 'review');
});

test('payload diff emits strict null clears and arrays clear with empty arrays', () => {
  const saved = formFromRecipe({ title: 'Draft', description: 'Known', difficulty: 'medium', prepTimeMinutes: 20, cookTimeMinutes: 30, servings: 4, ingredients: [{ ingredient: { id: 'i1', name: 'Chicken' }, quantity: 1, unit: 'kg' }], instructions: ['Cook'], dietaryTags: ['nutFree'] });
  const form = { ...saved, description: '', difficulty: '', prepTimeMinutes: '', servings: '', ingredients: [], instructions: [], dietaryTags: [] };
  assert.deepEqual(buildStepPatch(saved, form, 'basics'), { description: null });
  assert.deepEqual(buildStepPatch(saved, form, 'ingredients'), { ingredients: [] });
  assert.deepEqual(buildStepPatch(saved, form, 'instructions'), { instructions: [] });
  assert.deepEqual(buildStepPatch(saved, form, 'details'), { difficulty: null, prepTimeMinutes: null, servings: null, dietaryTags: [] });
});

test('field mapping, status labels, and command payloads are deterministic', () => {
  assert.equal(stepForField('ingredients.0.quantity'), 'ingredients');
  assert.equal(stepForField('steps.1.text'), 'instructions');
  assert.equal(stepForField('servings'), 'details');
  assert.equal(statusLabel({ publicationStatus: 'draft', isActive: false }), 'Archived Draft');
  assert.equal(statusLabel({ isActive: true }), 'Published');
  assert.deepEqual(createDraftBody({ title: '  Pork   Adobo ' }), { title: 'Pork Adobo' });
  assert.deepEqual(mutationBody({ description: null }, 'token'), { description: null, expectedUpdatedAt: 'token' });
  assert.deepEqual(publishBody('token'), { confirmFilipinoCuisine: true, expectedUpdatedAt: 'token' });
});

