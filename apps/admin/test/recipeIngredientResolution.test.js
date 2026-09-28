import test from 'node:test';
import assert from 'node:assert/strict';

import {
  confirmIngredientResolution, createUnresolvedIngredientQueue, mergeIngredientResolutionResults,
  prepareIngredientResolutionRequest, resolutionConfirmationError,
} from '../src/recipeAuthoring/recipeIngredientResolution.js';
import { emptyRecipeForm } from '../src/recipeAuthoring/recipeAuthoringModel.js';

function resolution(index, kind, parsed = {}, candidates = []) {
  return { index, sourceText: `line-${index}`, parsed: { quantity: null, unit: null, name: null, ...parsed },
    match: { kind, totalCandidates: candidates.length, truncated: false, candidates } };
}

test('request preparation preserves order/duplicates and explains lines outside exact bounds', () => {
  const queue = createUnresolvedIngredientQueue([
    'rice', 'rice', 'x'.repeat(501), ...Array.from({ length: 49 }, (_, index) => `line ${index}`),
  ], 4);
  const request = prepareIngredientResolutionRequest(queue);
  assert.deepEqual(request.lines.slice(0, 2), ['rice', 'rice']);
  assert.equal(request.lines.length, 50);
  assert.deepEqual(request.submitted.slice(0, 2).map(({ queueIndex }) => queueIndex), [0, 1]);
  assert.equal(request.excluded.length, 2);
  assert.match(request.excluded[0].reason, /500 characters/u);
  assert.match(request.excluded[1].reason, /50 source lines/u);
});

test('result merge fills parser hints but never preselects exact, ambiguous, or possible candidates', () => {
  const queue = createUnresolvedIngredientQueue(['rice', 'eggs', 'chicken', 'none', '2 cups'], 1);
  const request = prepareIngredientResolutionRequest(queue);
  const candidate = { ingredient: { id: 'i1', name: 'Rice', category: 'pantry' }, matchedOn: 'name', matchedText: 'Rice' };
  const results = [
    resolution(0, 'exact', { quantity: 1.5, unit: 'cup', name: 'rice' }, [candidate]),
    resolution(1, 'ambiguous', { quantity: 2, name: 'eggs' }, [candidate]),
    resolution(2, 'possible', { name: 'chicken' }, [candidate]),
    resolution(3, 'none', { name: 'none' }), resolution(4, 'unparsed'),
  ];
  const merged = mergeIngredientResolutionResults(queue, request, results);
  assert.deepEqual(merged.map(({ resolution: item }) => item.match.kind), ['exact', 'ambiguous', 'possible', 'none', 'unparsed']);
  assert.equal(merged.every(({ selectedIngredient }) => selectedIngredient === null), true);
  assert.equal(merged[0].quantity, '1.5');
  assert.equal(merged[0].unit, 'cup');
  assert.equal(merged[1].unit, '', 'a bare count must not infer a unit');
});

test('confirmation requires explicit canonical selection and valid quantity/unit', () => {
  const base = { selectedIngredient: null, quantity: '2', unit: '' };
  assert.match(resolutionConfirmationError(base), /canonical/u);
  assert.match(resolutionConfirmationError({ ...base, selectedIngredient: { id: 'i1', name: 'Egg' } }), /unit/u);
  assert.match(resolutionConfirmationError({ ...base, selectedIngredient: { id: 'i1', name: 'Egg' }, unit: 'piece', quantity: '0' }), /positive/u);
  assert.equal(resolutionConfirmationError({ ...base, selectedIngredient: { id: 'i1', name: 'Egg' }, unit: 'piece', quantity: '1 1/2' }), '');
  assert.equal(resolutionConfirmationError({ ...base, selectedIngredient: { id: 'i1', name: 'Salt' }, unit: 'toTaste', quantity: '' }), '');
});

test('pound/ounce parser hints confirm as ordinary canonical authoring rows', () => {
  const cases = [
    { sourceText: '3/4 lb. spaghetti', quantity: 0.75, unit: 'lb', name: 'Spaghetti' },
    { sourceText: '8 OZ pancit canton noodles', quantity: 8, unit: 'oz', name: 'Pancit Canton Noodles' },
  ];
  for (const [index, item] of cases.entries()) {
    const queue = createUnresolvedIngredientQueue([item.sourceText], index + 1);
    const request = prepareIngredientResolutionRequest(queue);
    const merged = mergeIngredientResolutionResults(queue, request, [resolution(0, 'exact', {
      quantity: item.quantity, unit: item.unit, name: item.name.toLowerCase(),
    })]);
    merged[0].selectedIngredient = { id: `i${index + 1}`, name: item.name };
    const result = confirmIngredientResolution(emptyRecipeForm(), merged, 0);
    assert.equal(result.error, '');
    assert.equal(result.form.ingredients[0].quantity, String(item.quantity));
    assert.equal(result.form.ingredients[0].unit, item.unit);
    assert.deepEqual(result.form.ingredients[0].ingredient, { id: `i${index + 1}`, name: item.name });
  }
});

test('confirmation reuses the first truly blank row, persists only the ordinary canonical row, and removes only one duplicate source', () => {
  const queue = createUnresolvedIngredientQueue(['2 eggs', '2 eggs'], 1).map((entry) => ({
    ...entry, selectedIngredient: { id: 'i1', name: 'Egg', category: 'protein', aliases: ['eggs'] }, quantity: '2', unit: 'piece',
    resolution: resolution(0, 'exact'),
  }));
  const result = confirmIngredientResolution(emptyRecipeForm(), queue, 0);
  assert.equal(result.error, '');
  assert.equal(result.queue.length, 1);
  assert.equal(result.queue[0].sourceText, '2 eggs');
  const row = result.form.ingredients[0];
  assert.deepEqual(row.ingredient, { id: 'i1', name: 'Egg' });
  assert.equal(row.quantity, '2');
  assert.equal(row.unit, 'piece');
  assert.equal(row.note, '');
  assert.equal(row.optional, false);
  const serialized = JSON.stringify(result.form);
  for (const forbidden of ['2 eggs', 'exact', 'aliases', 'matchedOn', 'sourceText']) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test('confirmation appends, preserves same-ID uses, enforces 50 rows, and clears quantity for toTaste', () => {
  const existing = Array.from({ length: 49 }, (_, index) => ({
    key: `row-${index}`, ingredient: { id: 'same', name: 'Salt' }, quantity: '', unit: 'toTaste', note: '', optional: false,
  }));
  const queue = [{ key: 'q', sourceText: 'salt to taste', selectedIngredient: { id: 'same', name: 'Salt' }, quantity: '9', unit: 'toTaste' }];
  const added = confirmIngredientResolution({ ...emptyRecipeForm(), ingredients: existing }, queue, 0);
  assert.equal(added.form.ingredients.length, 50);
  assert.equal(added.form.ingredients[49].ingredient.id, 'same');
  assert.equal(added.form.ingredients[49].quantity, '');
  const blocked = confirmIngredientResolution(added.form, queue, 0);
  assert.match(blocked.error, /maximum of 50/u);
});
