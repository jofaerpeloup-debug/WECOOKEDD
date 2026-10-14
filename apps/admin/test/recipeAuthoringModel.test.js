import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStepPatch, createDraftBody, emptyRecipeForm, firstIncompleteStep, formFromRecipe,
  combineDuration, formatDuration, mutationBody, normalizeIngredients, normalizeInstructions,
  parseIngredientQuantity, publicationReadiness, publishBody, splitDuration, statusLabel,
  stepForField, validateStep, normalizeCooking, cookingForMode, cookingSaveDisposition,
} from '../src/recipeAuthoring/recipeAuthoringModel.js';
import { RECIPE_UNITS, UNIT_LABELS } from '../src/recipeOptions.js';

test('Admin exposes the exact canonical 17-unit order and labels', () => {
  const expected = ['g', 'kg', 'lb', 'oz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece', 'clove', 'slice', 'can', 'pack', 'bunch', 'pinch', 'toTaste'];
  assert.deepEqual(RECIPE_UNITS.map(({ value }) => value), expected);
  assert.deepEqual(RECIPE_UNITS.map(({ label }) => label), ['g', 'kg', 'lb', 'oz', 'ml', 'L', 'tsp', 'tbsp', 'cup', 'piece', 'clove', 'slice', 'can', 'pack', 'bunch', 'pinch', 'to taste']);
  assert.equal(UNIT_LABELS.lb, 'lb');
  assert.equal(UNIT_LABELS.oz, 'oz');
});

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

test('title validation uses normalized Unicode-aware rules and exact boundaries', () => {
  const form = emptyRecipeForm();
  const titleError = (title) => { form.title = title; return validateStep(form, 'basics').title; };
  for (const title of ['A', '1', '12', '@@@', '!!', '   ']) assert.ok(titleError(title), title);
  for (const title of ['Ab', 'Chicken Adobo', '7-Minute Egg', 'Fish & Chips', 'Crème brûlée', 'Paksiw #2']) {
    assert.equal(titleError(title), undefined, title);
  }
  assert.equal(titleError(`Ab${'x'.repeat(148)}`), undefined);
  assert.match(titleError(`Ab${'x'.repeat(149)}`), /150/);
  form.title = '  Crème   brûlée  ';
  assert.deepEqual(createDraftBody(form), { title: 'Crème brûlée' });
});

test('instruction validation preserves displayed row indexes and enforces meaningful text', () => {
  const form = emptyRecipeForm();
  form.instructions = ['', 'A', '12', '@@@', 'Mix', 'Añade', 'Add 2 cups of water.', 'Bake at 180°C.'];
  const errors = validateStep(form, 'instructions');
  assert.match(errors['instructions.1'], /at least 3/);
  assert.match(errors['instructions.2'], /at least 3/);
  assert.match(errors['instructions.3'], /contain text/);
  for (const index of [4, 5, 6, 7]) assert.equal(errors[`instructions.${index}`], undefined);

  form.instructions = ['', 'A'.repeat(1000)];
  assert.deepEqual(validateStep(form, 'instructions'), {});
  form.instructions = ['', 'A'.repeat(1001)];
  assert.match(validateStep(form, 'instructions')['instructions.1'], /1000/);
});

test('ingredient quantities parse positive integers, decimals, fractions, and mixed fractions into numbers', () => {
  for (const [input, expected] of [['1/2', 0.5], ['1/4', 0.25], ['3/4', 0.75], ['1 1/2', 1.5], ['2 1/4', 2.25], ['0.5', 0.5], ['2', 2]]) {
    assert.equal(parseIngredientQuantity(input), expected, input);
  }
  for (const input of ['', '0', '-1', '1/0', '1//2', '/', 'word', 'Infinity', '1.5.2']) {
    assert.equal(parseIngredientQuantity(input), null, input);
  }

  const form = emptyRecipeForm();
  const validIngredient = { ingredient: { id: 'i1', name: 'Garlic' }, quantity: '1 1/2', unit: 'g', optional: false, note: '' };
  form.ingredients = [form.ingredients[0], { ...validIngredient, quantity: '0' }];
  assert.equal(validateStep(form, 'ingredients')['ingredients.0.quantity'], undefined);
  assert.match(validateStep(form, 'ingredients')['ingredients.1.quantity'], /positive/);
  form.ingredients = [{ ...validIngredient }];
  assert.deepEqual(validateStep(form, 'ingredients'), {});
  assert.equal(normalizeIngredients(form.ingredients)[0].quantity, 1.5);
  form.ingredients = [{ ...validIngredient, quantity: '', unit: 'toTaste' }];
  assert.deepEqual(validateStep(form, 'ingredients'), {});
  assert.equal('quantity' in normalizeIngredients(form.ingredients)[0], false);
});

test('Admin validation and payload normalization preserve only canonical lb/oz values', () => {
  for (const unit of ['lb', 'oz']) {
    const form = emptyRecipeForm();
    form.ingredients = [{ ingredient: { id: 'i1', name: 'Noodles' }, quantity: '3/4', unit, optional: false, note: '' }];
    assert.deepEqual(validateStep(form, 'ingredients'), {}, unit);
    assert.deepEqual(normalizeIngredients(form.ingredients), [{ ingredientId: 'i1', quantity: 0.75, unit, optional: false }]);
  }
  for (const unit of ['lbs', 'pound', 'oz.', 'ounce', 'LB', 'OZ']) {
    const form = emptyRecipeForm();
    form.ingredients = [{ ingredient: { id: 'i1', name: 'Noodles' }, quantity: '1', unit, optional: false, note: '' }];
    assert.match(validateStep(form, 'ingredients')['ingredients.0.unit'], /valid unit/u, unit);
  }
});

test('prep time is optional but supplied values must be whole minutes from 1 to 1440', () => {
  const form = emptyRecipeForm();
  const errorFor = (field, value) => { form[field] = value; return validateStep(form, 'details')[field]; };
  for (const value of ['0', '-1', '1.5', '101']) assert.ok(errorFor('servings', value), value);
  for (const value of ['1', '100']) assert.equal(errorFor('servings', value), undefined, value);
  for (const value of ['0', '-1', '1.5', '1441', 'abc']) assert.ok(errorFor('prepTimeMinutes', value), value);
  for (const value of ['', '1', '1440']) assert.equal(errorFor('prepTimeMinutes', value), undefined, value);
  assert.equal(validateStep(form, 'details', { published: true }).prepTimeMinutes, undefined);
});

test('cooking time uses hours and minutes, enforces total boundaries, and hydrates totals', () => {
  assert.equal(combineDuration('1', '30'), 90);
  assert.equal(combineDuration('0', '3'), 3);
  assert.equal(combineDuration('24', '0'), 1440);
  assert.equal(combineDuration('24', '1'), 1441);
  for (const pair of [['-1', '0'], ['1.5', '0'], ['1e1', '0'], ['1', '60'], ['1', '-1'], ['x', '3']]) assert.equal(combineDuration(...pair), null);
  assert.deepEqual(splitDuration(90), { hours: '1', minutes: '30' });
  assert.deepEqual(splitDuration(60), { hours: '1', minutes: '0' });

  const form = emptyRecipeForm();
  assert.equal(validateStep(form, 'details').cookTimeMinutes, undefined);
  assert.match(validateStep(form, 'details', { published: true }).cookTimeMinutes, /required/);
  for (const [hours, minutes] of [['0', '0'], ['0', '1'], ['0', '2'], ['24', '1'], ['1', '60']]) {
    form.cookTimeHours = hours; form.cookTimeMinutePart = minutes;
    assert.ok(validateStep(form, 'details').cookTimeMinutes, `${hours}h ${minutes}m`);
  }
  for (const [hours, minutes] of [['0', '3'], ['1', '0'], ['1', '30'], ['24', '0']]) {
    form.cookTimeHours = hours; form.cookTimeMinutePart = minutes;
    assert.equal(validateStep(form, 'details').cookTimeMinutes, undefined, `${hours}h ${minutes}m`);
  }
  const hydrated = formFromRecipe({ title: 'Adobo', cookTimeMinutes: 90 });
  assert.equal(hydrated.cookTimeHours, '1');
  assert.equal(hydrated.cookTimeMinutePart, '30');
  assert.equal(formatDuration(90), '1 hr 30 min');
  assert.equal(formatDuration(60), '1 hr');
  assert.equal(formatDuration(45), '45 min');
});

test('Published validation and readiness require all publication fields', () => {
  const form = emptyRecipeForm();
  form.title = 'Adobo';
  let readiness = publicationReadiness(form);
  assert.equal(readiness.complete, false);
  assert.equal(firstIncompleteStep(form), 'basics');
  form.description = 'A Filipino classic.'; form.difficulty = 'easy'; form.cookTimeHours = '0'; form.cookTimeMinutePart = '30'; form.servings = '4';
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

function completeNutritionForm(form) {
  return {
    ...form,
    nutrition: {
      caloriesKcal: '320', proteinGrams: '28', carbohydrateGrams: '12',
      fatGrams: '18', sugarGrams: '3', fiberGrams: '2',
    },
    nutritionSource: { kind: 'manual', label: ' Reviewed laboratory panel ', url: 'https://example.com/panel' },
  };
}

test('authoring nutrition is complete-or-null, finite, nonnegative, and source-backed', () => {
  const unavailable = emptyRecipeForm();
  assert.equal(unavailable.nutrition, null);
  assert.equal(validateStep(unavailable, 'details').nutrition, undefined);

  const valid = completeNutritionForm(unavailable);
  assert.deepEqual(validateStep(valid, 'details'), {});
  for (const [field, value] of [
    ['caloriesKcal', ''], ['proteinGrams', '-1'], ['carbohydrateGrams', 'NaN'],
    ['fatGrams', 'Infinity'], ['sugarGrams', undefined],
  ]) {
    const form = completeNutritionForm(unavailable);
    form.nutrition = { ...form.nutrition, [field]: value };
    assert.ok(validateStep(form, 'details')[`nutrition.${field}`], field);
  }
  const unsourced = completeNutritionForm(unavailable);
  unsourced.nutritionSource = { kind: 'manual', label: '', url: '' };
  assert.ok(validateStep(unsourced, 'details')['nutritionSource.label']);
  const badUrl = completeNutritionForm(unavailable);
  badUrl.nutritionSource.url = 'http://example.com/panel';
  assert.ok(validateStep(badUrl, 'details')['nutritionSource.url']);
});

test('Details diff emits exact numeric v1 nutrition and source, never blank-to-zero filling', () => {
  const saved = emptyRecipeForm();
  const working = completeNutritionForm(saved);
  assert.deepEqual(buildStepPatch(saved, working, 'details'), {
    nutrition: {
      schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
      carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
    },
    nutritionSource: { kind: 'manual', label: 'Reviewed laboratory panel', url: 'https://example.com/panel' },
  });

  const incomplete = completeNutritionForm(saved);
  incomplete.nutrition.caloriesKcal = '';
  assert.equal(buildStepPatch(saved, incomplete, 'details').nutrition.caloriesKcal, null);

  const hydrated = formFromRecipe({
    title: 'Adobo', nutrition: buildStepPatch(saved, working, 'details').nutrition,
    nutritionSource: { kind: 'manual', label: 'Panel' },
  });
  assert.equal(hydrated.nutrition.caloriesKcal, '320');
  assert.equal(hydrated.nutritionSource.label, 'Panel');
  assert.deepEqual(buildStepPatch(hydrated, { ...hydrated, nutrition: null }, 'details'), { nutrition: null });
  assert.equal(stepForField('nutrition.fiberGrams'), 'details');
  assert.equal(stepForField('nutritionSource.label'), 'details');
});

test('staff cooking reload keeps every authored level, canonical usage, and exact timer tuple', () => {
  const id = '507f1f77bcf86cd799439011';
  const recipe = {
    title: 'Adobo', servings: 4,
    ingredients: [{ ingredient: { id, name: 'Chicken' }, quantity: 1, unit: 'kg' }],
    instructions: ['Simmer.'],
    cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [
      { spiceLevel: 'none', ingredients: [{ ingredientId: id, ingredient: { id, name: 'Chicken' }, quantity: 2, unit: 'kg', note: 'trimmed', optional: false }] },
      { spiceLevel: 'medium', ingredients: [{ ingredientId: id, ingredient: { id, name: 'Chicken' }, quantity: null, unit: 'toTaste', optional: true }] },
      { spiceLevel: 'hot', ingredients: [{ ingredientId: id, ingredient: { id, name: 'Chicken' }, quantity: 3, unit: 'kg' }] },
      { spiceLevel: 'extra_hot', ingredients: [{ ingredientId: id, ingredient: { id, name: 'Chicken' }, quantity: 4, unit: 'kg' }] },
    ], stepTimers: [{ stepOrder: 1, servings: 4, spiceLevel: 'hot', durationSeconds: 90 }] },
  };
  const form = formFromRecipe(recipe);
  assert.equal(form.cooking.spiceAlternatives[0].ingredients[0].ingredient.id, id);
  assert.deepEqual(validateStep(form, 'ingredients'), {});
  assert.deepEqual(validateStep(form, 'instructions'), {});
  const payload = normalizeCooking(form.cooking);
  assert.deepEqual(payload.spiceAlternatives.map((entry) => entry.spiceLevel), ['none', 'medium', 'hot', 'extra_hot']);
  assert.deepEqual(payload.stepTimers, recipe.cooking.stepTimers);
  assert.equal(Object.hasOwn(payload.spiceAlternatives[1].ingredients[0], 'quantity'), false);
  assert.deepEqual(buildStepPatch(form, form, 'ingredients'), {});
  assert.deepEqual(buildStepPatch(form, form, 'instructions'), {});
  assert.equal(stepForField('cooking.spiceAlternatives.1.ingredients.0.quantity'), 'ingredients');
  assert.equal(stepForField('cooking.stepTimers.0.stepOrder'), 'instructions');
});

test('spice alternatives must be complete and unique, while timer tuples must match current steps and levels', () => {
  const form = emptyRecipeForm();
  form.servings = '4';
  form.ingredients = [{ ingredient: { id: '507f1f77bcf86cd799439011', name: 'Chicken' }, quantity: '1', unit: 'kg', optional: false, note: '' }];
  form.instructions = ['Simmer.'];
  form.cooking = cookingForMode(null, 'spice');
  form.cooking.spiceAlternatives = [
    { spiceLevel: 'hot', ingredients: [{ ingredient: { id: '507f1f77bcf86cd799439012', name: 'Garlic' }, quantity: '2', unit: 'clove', optional: false, note: '' }] },
    { spiceLevel: 'hot', ingredients: [{ ingredient: null, quantity: '', unit: 'g', optional: false, note: '' }] },
  ];
  assert.match(validateStep(form, 'ingredients')['cooking.spiceAlternatives.1.spiceLevel'], /distinct/);
  assert.match(validateStep(form, 'ingredients')['cooking.spiceAlternatives.1.ingredients'], /complete ingredients/);
  form.cooking.spiceAlternatives.pop();
  form.cooking.stepTimers = [
    { stepOrder: '1', servings: '4', spiceLevel: 'hot', durationSeconds: '90' },
    { stepOrder: '1', servings: '4', spiceLevel: 'hot', durationSeconds: '100' },
  ];
  assert.match(validateStep(form, 'instructions')['cooking.stepTimers.1'], /unique/);
  form.cooking.stepTimers[1].stepOrder = '2';
  assert.match(validateStep(form, 'instructions')['cooking.stepTimers.1.stepOrder'], /whole number/);
  form.cooking.stepTimers[1].stepOrder = '1'; form.cooking.stepTimers[1].spiceLevel = 'none';
  assert.match(validateStep(form, 'instructions')['cooking.stepTimers.1.spiceLevel'], /authored/);
  form.servings = '';
  assert.deepEqual(validateStep(form, 'ingredients'), {});
  assert.match(validateStep(form, 'details').servings, /required/);
});

test('alternative authoring advances through Ingredients and Instructions, then requires servings before Review and save', () => {
  const saved = formFromRecipe({ title: 'Adobo', description: 'Chicken simmered in vinegar.',
    publicationStatus: 'draft', ingredients: [], instructions: [], cooking: null });
  const form = { ...saved, ingredients: [{ ingredient: { id: '507f1f77bcf86cd799439011', name: 'Chicken' },
    quantity: '1', unit: 'kg', optional: false, note: '' }], instructions: ['Simmer chicken.'],
    cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [{ spiceLevel: 'hot',
      ingredients: [{ ingredient: { id: '507f1f77bcf86cd799439012', name: 'Chili' },
        quantity: '2', unit: 'g', optional: false, note: '' }] }], stepTimers: [] } };
  const incomplete = { ...form, cooking: { ...form.cooking, spiceAlternatives: [{ spiceLevel: 'hot',
    ingredients: [{ ...form.cooking.spiceAlternatives[0].ingredients[0], ingredient: null }] }] } };
  assert.match(validateStep(incomplete, 'ingredients')['cooking.spiceAlternatives.0.ingredients.0.ingredientId'], /canonical/);
  assert.deepEqual(validateStep(form, 'ingredients'), {});
  assert.deepEqual(validateStep(form, 'instructions'), {});
  assert.equal(cookingSaveDisposition(form, buildStepPatch(saved, form, 'ingredients'), { step: 'ingredients', advance: true }), 'defer');
  assert.equal(cookingSaveDisposition(form, buildStepPatch(saved, form, 'ingredients'), { step: 'ingredients' }), 'needsServings');
  assert.equal(cookingSaveDisposition(form, buildStepPatch(saved, form, 'instructions'), { step: 'instructions', advance: true }), 'defer');
  assert.equal(cookingSaveDisposition(form, buildStepPatch(saved, form, 'details'), { step: 'details', advance: true }), 'needsServings');
  assert.match(validateStep(form, 'details').servings, /required/);
  assert.equal(publicationReadiness(form).complete, false);
  form.servings = '4'; form.difficulty = 'easy'; form.cookTimeMinutePart = '20';
  assert.deepEqual(validateStep(form, 'details'), {});
  assert.equal(publicationReadiness(form).complete, true);
  const patch = buildStepPatch(saved, form, 'details');
  assert.equal(cookingSaveDisposition(form, patch, { step: 'details', advance: true }), 'save');
  assert.deepEqual(patch.ingredients, [{ ingredientId: '507f1f77bcf86cd799439011', quantity: 1, unit: 'kg', optional: false }]);
  assert.deepEqual(patch.cooking.spiceAlternatives[0].ingredients,
    [{ ingredientId: '507f1f77bcf86cd799439012', quantity: 2, unit: 'g', optional: false }]);
  assert.equal(patch.servings, 4);
  assert.equal(mutationBody(patch, '2026-10-14T00:00:00.000Z').expectedUpdatedAt, '2026-10-14T00:00:00.000Z');
});

test('timer-only authoring uses null spice and requires exact 1 to 10800 second presets', () => {
  const form = emptyRecipeForm();
  form.instructions = ['Simmer.'];
  form.cooking = cookingForMode(null, 'timers');
  form.cooking.stepTimers = [{ stepOrder: '1', servings: '100', spiceLevel: null, durationSeconds: '10800' }];
  assert.deepEqual(validateStep(form, 'instructions'), {});
  assert.deepEqual(normalizeCooking(form.cooking).stepTimers, [{ stepOrder: 1, servings: 100, spiceLevel: null, durationSeconds: 10800 }]);
  form.cooking.stepTimers[0].durationSeconds = '10801';
  assert.match(validateStep(form, 'instructions')['cooking.stepTimers.0.durationSeconds'], /10800/);
  form.cooking.stepTimers[0].durationSeconds = '60';
  form.cooking.stepTimers[0].spiceLevel = 'hot';
  assert.match(validateStep(form, 'instructions')['cooking.stepTimers.0.spiceLevel'], /authored/);
});

test('profiled dependent PATCHes reaffirm full cooking and preserve expectedUpdatedAt', () => {
  const id = '507f1f77bcf86cd799439011';
  const recipe = { title: 'Adobo', servings: 4, ingredients: [{ ingredient: { id, name: 'Chicken' }, quantity: 1, unit: 'kg' }],
    instructions: ['Simmer.'], cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [], stepTimers: [] } };
  const saved = formFromRecipe(recipe);
  const ingredients = { ...saved, ingredients: [{ ...saved.ingredients[0], quantity: '2' }] };
  assert.deepEqual(buildStepPatch(saved, ingredients, 'ingredients'), { ingredients: [{ ingredientId: id, quantity: 2, unit: 'kg', optional: false }], cooking: recipe.cooking });
  const instructions = { ...saved, instructions: ['Boil.'] };
  assert.deepEqual(buildStepPatch(saved, instructions, 'instructions'), { instructions: ['Boil.'], cooking: recipe.cooking });
  const details = { ...saved, servings: '6' };
  assert.deepEqual(buildStepPatch(saved, details, 'details'), { servings: 6, cooking: recipe.cooking });
  const clear = { ...saved, cooking: null };
  assert.deepEqual(buildStepPatch(saved, clear, 'ingredients'), { cooking: null });
  assert.deepEqual(mutationBody(buildStepPatch(saved, details, 'details'), 'revision'), { servings: 6, cooking: recipe.cooking, expectedUpdatedAt: 'revision' });
  const combined = { ...saved, servings: '6', instructions: ['Boil.'], cooking: {
    ...saved.cooking, stepTimers: [{ stepOrder: '1', servings: '6', spiceLevel: 'mild', durationSeconds: '60' }],
  } };
  assert.deepEqual(buildStepPatch(saved, combined, 'ingredients'), {
    cooking: { ...recipe.cooking, stepTimers: [{ stepOrder: 1, servings: 6, spiceLevel: 'mild', durationSeconds: 60 }] },
    instructions: ['Boil.'], servings: 6,
  });
});

