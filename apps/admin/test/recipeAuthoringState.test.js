import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUnsavedChanges, ingredientErrorFields, initialAuthoringState, recipeAuthoringReducer, resolveBasicsImageUpload,
} from '../src/recipeAuthoring/recipeAuthoringState.js';
import { buildStepPatch, cookingSaveDisposition, publicationReadiness } from '../src/recipeAuthoring/recipeAuthoringModel.js';
import { ingredientCreationPrefill } from '../src/recipeAuthoring/recipeIngredientResolution.js';

test('reducer tracks dirty state, save token replacement, conflict, and close confirmation', () => {
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'title', value: 'Draft' });
  assert.equal(hasUnsavedChanges(state), true);
  state = recipeAuthoringReducer(state, { type: 'ASK_CLOSE' });
  assert.equal(state.closeConfirmation, true);
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', recipe: { id: 'r1', title: 'Draft', publicationStatus: 'draft', isActive: true, updatedAt: 'new-token' }, step: 'basics', preserveWorking: true });
  assert.equal(state.updatedAt, 'new-token');
  assert.equal(hasUnsavedChanges(state), false);
  state = recipeAuthoringReducer(state, { type: 'CONFLICT' });
  assert.equal(state.status, 'conflict');
});

test('step changes reset acknowledgement and content changes on Review invalidate it', () => {
  let state = initialAuthoringState();
  state = { ...state, currentStep: 'review', publishAcknowledged: true };
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'title', value: 'Changed' });
  assert.equal(state.publishAcknowledged, false);
  state = recipeAuthoringReducer({ ...state, publishAcknowledged: true }, { type: 'SET_STEP', step: 'details' });
  assert.equal(state.publishAcknowledged, false);
});

test('cooking edits remain dirty until an authoritative save or reload and retain conflict protection', () => {
  const recipe = { id: 'r1', title: 'Adobo', publicationStatus: 'draft', isActive: true, updatedAt: 'revision-1',
    cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [], stepTimers: [] } };
  let state = initialAuthoringState({ recipe });
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'cooking', value: {
    ...state.form.cooking, defaultSpiceLevel: 'hot',
  } });
  assert.equal(hasUnsavedChanges(state), true);
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', recipe: {
    ...recipe, updatedAt: 'revision-2', cooking: { ...recipe.cooking, defaultSpiceLevel: 'hot' },
  }, step: 'ingredients', cookingSaved: true, preserveWorking: true });
  assert.equal(state.form.cooking.defaultSpiceLevel, 'hot');
  assert.equal(state.saved.cooking.defaultSpiceLevel, 'hot');
  assert.equal(state.updatedAt, 'revision-2');
  assert.equal(hasUnsavedChanges(state), false);
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'cooking', value: null });
  assert.equal(hasUnsavedChanges(state), true);
  state = recipeAuthoringReducer(state, { type: 'CONFLICT' });
  assert.equal(state.conflict, true);
  state = recipeAuthoringReducer(state, { type: 'LOAD_SUCCESS', recipe: { ...recipe, updatedAt: 'revision-3' }, keepStep: true });
  assert.equal(state.conflict, false);
  assert.equal(state.form.cooking.defaultSpiceLevel, 'mild');
  assert.equal(hasUnsavedChanges(state), false);
});

test('one atomic cooking PATCH adopts server values for dependent base fields', () => {
  const recipe = { id: 'r1', title: 'Adobo', publicationStatus: 'draft', isActive: true, updatedAt: 'one',
    servings: 4, instructions: ['Simmer.'], cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [], stepTimers: [] } };
  let state = initialAuthoringState({ recipe });
  state = { ...state, form: { ...state.form, servings: '6', instructions: ['Boil.'], cooking: {
    ...state.form.cooking, stepTimers: [{ stepOrder: '1', servings: '6', spiceLevel: 'mild', durationSeconds: '90' }],
  } } };
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', recipe: {
    ...recipe, updatedAt: 'two', servings: 6, instructions: ['Boil.'], cooking: {
      ...recipe.cooking, stepTimers: [{ stepOrder: 1, servings: 6, spiceLevel: 'mild', durationSeconds: 90 }],
    },
  }, step: 'ingredients', cookingSaved: true, savedFields: ['cooking', 'instructions', 'servings'], preserveWorking: true });
  assert.equal(state.form.servings, '6');
  assert.deepEqual(state.form.instructions, ['Boil.']);
  assert.equal(state.form.cooking.stepTimers[0].durationSeconds, '90');
  assert.equal(hasUnsavedChanges(state), false);
});

test('ingredient API rejection stays visible for unprofiled defaults and ambiguous alternative failures', () => {
  const error = { code: 'RECIPE_INGREDIENT_INACTIVE', message: 'One or more referenced ingredients are not active.', details: [] };
  let state = initialAuthoringState({ recipe: { id: '507f1f77bcf86cd799439010', title: 'Adobo',
    publicationStatus: 'draft', isActive: true, updatedAt: '2026-10-14T00:00:00.000Z' } });
  assert.deepEqual(ingredientErrorFields(error, state.form), { ingredients: error.message });
  state = recipeAuthoringReducer(state, { type: 'SET_STEP', step: 'ingredients' });
  state = recipeAuthoringReducer(state, { type: 'SET_ERRORS', fieldErrors: ingredientErrorFields(error, state.form), message: error.message });
  assert.equal(state.currentStep, 'ingredients');
  assert.equal(state.fieldErrors.ingredients, error.message);
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'ingredients', value: [{
    ingredient: { id: '507f1f77bcf86cd799439011', name: 'Chicken' }, quantity: '1', unit: 'kg', optional: false, note: '',
  }] });
  assert.equal(state.fieldErrors.ingredients, undefined);

  const withAlternative = { ...state.form, cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild',
    spiceAlternatives: [{ spiceLevel: 'hot', ingredients: [] }], stepTimers: [] } };
  assert.deepEqual(ingredientErrorFields(error, withAlternative), { ingredients: error.message });
  const detailed = { ...error, details: [{ field: 'cooking.spiceAlternatives.0.ingredients.0.ingredientId', message: 'Choose an active Ingredient.' }] };
  assert.deepEqual(ingredientErrorFields(detailed, withAlternative), {
    'cooking.spiceAlternatives.0.ingredients.0.ingredientId': 'Choose an active Ingredient.',
  });
  state = recipeAuthoringReducer({ ...state, form: withAlternative }, { type: 'SET_ERRORS',
    fieldErrors: ingredientErrorFields(detailed, withAlternative), message: detailed.message });
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'cooking', value: {
    ...withAlternative.cooking, spiceAlternatives: [{ spiceLevel: 'hot', ingredients: [{
      ingredient: { id: '507f1f77bcf86cd799439012', name: 'Chili' }, quantity: '2', unit: 'g', optional: false, note: '',
    }] }],
  } });
  assert.equal(Object.keys(state.fieldErrors).some((field) => field.startsWith('cooking.')), false);
});

test('wizard keeps an unsaved alternative through Details, then saves and reloads the complete profile', () => {
  const recipe = { id: '507f1f77bcf86cd799439010', title: 'Adobo', description: 'Chicken simmered in vinegar.',
    publicationStatus: 'draft', isActive: true, updatedAt: '2026-10-14T00:00:00.000Z', difficulty: 'easy', cookTimeMinutes: 20,
    ingredients: [{ ingredient: { id: '507f1f77bcf86cd799439011', name: 'Chicken' }, quantity: 1, unit: 'kg', optional: false }],
    instructions: ['Simmer chicken.'], cooking: null };
  let state = initialAuthoringState({ recipe });
  state = recipeAuthoringReducer(state, { type: 'SET_STEP', step: 'ingredients' });
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'cooking', value: {
    schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [{ spiceLevel: 'hot', ingredients: [{
      ingredient: { id: '507f1f77bcf86cd799439012', name: 'Chili' }, quantity: '2', unit: 'g', optional: false, note: '',
    }] }], stepTimers: [] } });
  assert.equal(cookingSaveDisposition(state.form, buildStepPatch(state.saved, state.form, 'ingredients'),
    { step: 'ingredients', advance: true }), 'defer');
  state = recipeAuthoringReducer(state, { type: 'SET_STEP', step: 'instructions' });
  assert.equal(cookingSaveDisposition(state.form, buildStepPatch(state.saved, state.form, 'instructions'),
    { step: 'instructions', advance: true }), 'defer');
  state = recipeAuthoringReducer(state, { type: 'SET_STEP', step: 'details' });
  assert.equal(publicationReadiness(state.form).complete, false);
  assert.equal(cookingSaveDisposition(state.form, buildStepPatch(state.saved, state.form, 'details'),
    { step: 'details', advance: true }), 'needsServings');
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'servings', value: '4' });
  const patch = buildStepPatch(state.saved, state.form, 'details');
  assert.equal(cookingSaveDisposition(state.form, patch, { step: 'details', advance: true }), 'save');
  assert.equal(publicationReadiness(state.form).complete, true);
  assert.equal(patch.cooking.spiceAlternatives[0].ingredients[0].ingredientId, '507f1f77bcf86cd799439012');
  const savedRecipe = { ...recipe, updatedAt: '2026-10-14T00:00:00.001Z', servings: patch.servings,
    cooking: patch.cooking };
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', recipe: savedRecipe,
    step: 'details', cookingSaved: true, savedFields: Object.keys(patch), preserveWorking: true });
  state = recipeAuthoringReducer(state, { type: 'SET_STEP', step: 'review' });
  assert.equal(state.currentStep, 'review');
  assert.equal(hasUnsavedChanges(state), false);
  state = recipeAuthoringReducer(state, { type: 'LOAD_SUCCESS', recipe: savedRecipe, keepStep: true });
  assert.equal(state.form.cooking.spiceAlternatives[0].ingredients[0].ingredient.id, '507f1f77bcf86cd799439012');
  assert.equal(state.updatedAt, '2026-10-14T00:00:00.001Z');
});

test('nutrition participates in saved-versus-working Details state and server refresh replacement', () => {
  const nutrition = {
    schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
    carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
  };
  const recipe = {
    id: 'r1', title: 'Draft', publicationStatus: 'draft', isActive: true, updatedAt: 'v1',
    nutrition, nutritionSource: { kind: 'manual', label: 'Panel' },
  };
  let state = initialAuthoringState({ recipe });
  state = recipeAuthoringReducer(state, {
    type: 'CHANGE', field: 'nutrition', value: { ...state.form.nutrition, caloriesKcal: '400' },
  });
  assert.equal(hasUnsavedChanges(state), true);

  state = recipeAuthoringReducer(state, {
    type: 'SAVE_SUCCESS', recipe: { ...recipe, updatedAt: 'v2', nutrition: { ...nutrition, caloriesKcal: 400 } },
    step: 'details', preserveWorking: true,
  });
  assert.equal(state.form.nutrition.caloriesKcal, '400');
  assert.equal(state.saved.nutrition.caloriesKcal, '400');
  assert.equal(state.updatedAt, 'v2');
  assert.equal(hasUnsavedChanges(state), false);
});

test('saving one section preserves unrelated local edits', () => {
  let state = initialAuthoringState({ recipe: { id: 'r1', title: 'Old', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'one' } });
  state = { ...state, form: { ...state.form, title: 'New', difficulty: 'hard' } };
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', recipe: { id: 'r1', title: 'New', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'two' }, step: 'basics', preserveWorking: true });
  assert.equal(state.form.title, 'New');
  assert.equal(state.form.difficulty, 'hard');
  assert.equal(hasUnsavedChanges(state), true);
});

test('no-PATCH SAVE_SUCCESS explicitly preserves the complete working form', () => {
  const recipe = { id: 'r1', title: 'Saved title', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'one' };
  let state = initialAuthoringState({ recipe });
  const saved = state.saved;
  state = { ...state, currentStep: 'ingredients', status: 'saving', form: {
    ...state.form, title: 'Working title', description: 'Working description', prepTimeMinutes: '20',
    cookTimeHours: '1', cookTimeMinutePart: '10', servings: '6', instructions: ['Working instruction.'],
  } };

  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', preserveWorking: true, notice: 'Draft is saved.' });

  assert.equal(state.saved, saved);
  assert.equal(state.updatedAt, 'one');
  assert.equal(state.status, 'idle');
  assert.equal(state.form.title, 'Working title');
  assert.equal(state.form.description, 'Working description');
  assert.equal(state.form.prepTimeMinutes, '20');
  assert.equal(state.form.cookTimeHours, '1');
  assert.equal(state.form.cookTimeMinutePart, '10');
  assert.equal(state.form.servings, '6');
  assert.deepEqual(state.form.instructions, ['Working instruction.']);
  assert.equal(hasUnsavedChanges(state), true);
  assert.equal(publicationReadiness(state.form).sections.details.complete, false, 'other incomplete fields still control completion');
});

test('resumed Draft and Published no-PATCH saves retain unrelated working edits', () => {
  for (const publicationStatus of ['draft', 'published']) {
    let state = initialAuthoringState({ recipe: {
      id: `r-${publicationStatus}`, title: 'Saved title', description: 'Saved description',
      publicationStatus, isActive: true, updatedAt: `${publicationStatus}-token`,
    } });
    state = { ...state, currentStep: 'ingredients', form: {
      ...state.form, prepTimeMinutes: '15', cookTimeHours: '0', cookTimeMinutePart: '45',
      servings: '4', instructions: ['Keep this local edit.'],
    } };
    state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', preserveWorking: true });

    assert.equal(state.publicationStatus, publicationStatus);
    assert.equal(state.updatedAt, `${publicationStatus}-token`);
    assert.equal(state.form.prepTimeMinutes, '15');
    assert.equal(state.form.cookTimeMinutePart, '45');
    assert.equal(state.form.servings, '4');
    assert.deepEqual(state.form.instructions, ['Keep this local edit.']);
    assert.equal(hasUnsavedChanges(state), true);
  }
});

test('real PATCH result remains authoritative for its section and refreshes the server token', () => {
  let state = initialAuthoringState({ recipe: {
    id: 'r1', title: 'Old title', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'old-token',
  } });
  state = { ...state, form: { ...state.form, title: 'Client title', description: 'Local description', servings: '8' } };
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', preserveWorking: true, step: 'basics', recipe: {
    id: 'r1', title: 'Server-normalized title', description: 'Server description',
    publicationStatus: 'draft', isActive: true, updatedAt: 'new-token',
  } });

  assert.equal(state.saved.title, 'Server-normalized title');
  assert.equal(state.form.title, 'Server-normalized title');
  assert.equal(state.form.description, 'Server description');
  assert.equal(state.form.servings, '8');
  assert.equal(state.updatedAt, 'new-token');
  assert.equal(hasUnsavedChanges(state), true);
});

test('authoritative conflict reload discards pending image attachment intent and adopts server truth', () => {
  const abandonedUpload = { url: 'https://images.example/abandoned.jpg', assetId: 'abandoned-asset' };
  const latestRecipe = {
    id: 'r1', title: 'Server title', description: '', imageUrl: 'https://images.example/server.jpg',
    imageAssetId: 'server-asset', publicationStatus: 'draft', isActive: true, updatedAt: 'latest-token',
  };
  let state = initialAuthoringState({
    recipe: { ...latestRecipe, title: 'Old title', imageUrl: 'https://images.example/old.jpg', updatedAt: 'old-token' },
  });
  state = recipeAuthoringReducer(state, { type: 'RETAIN_UPLOAD', image: abandonedUpload });
  state = recipeAuthoringReducer(state, { type: 'CONFLICT' });
  assert.equal(state.retainedUpload, abandonedUpload);
  assert.equal(state.conflict, true);

  state = recipeAuthoringReducer(state, { type: 'LOAD_SUCCESS', recipe: latestRecipe, keepStep: true });

  assert.equal(state.retainedUpload, null);
  assert.equal(state.conflict, false);
  assert.equal(state.status, 'idle');
  assert.equal(state.form.imageUrl, latestRecipe.imageUrl);
  assert.equal(state.saved.imageUrl, latestRecipe.imageUrl);
  assert.notEqual(state.form.imageUrl, abandonedUpload.url);
  assert.equal(state.updatedAt, 'latest-token');
});

test('recoverable PATCH failure retains an uploaded image and retry does not upload it twice', async () => {
  const selectedFile = { name: 'adobo.jpg' };
  const retainedUpload = { url: 'https://images.example/adobo.jpg', assetId: 'adobo-asset' };
  let uploadCalls = 0;
  const upload = async () => { uploadCalls += 1; return retainedUpload; };

  const firstAttempt = await resolveBasicsImageUpload({ selectedFile, retainedUpload: null, upload });
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'RETAIN_UPLOAD', image: firstAttempt.image });
  state = recipeAuthoringReducer(state, { type: 'SAVE_FAILURE', message: 'Network unavailable.' });
  assert.equal(state.retainedUpload, retainedUpload);

  const retry = await resolveBasicsImageUpload({ selectedFile, retainedUpload: state.retainedUpload, upload });
  assert.equal(retry.image, retainedUpload);
  assert.equal(retry.uploadedNow, false);
  assert.equal(uploadCalls, 1);
});

test('unresolved source state survives navigation, Draft creation, no-PATCH, and unrelated PATCH but clears on authoritative load', () => {
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['1 cup rice', '2 eggs'] });
  const generation = state.ingredientResolutionGeneration;
  assert.equal(hasUnsavedChanges(state), true);
  state = recipeAuthoringReducer(state, { type: 'SET_STEP', step: 'ingredients' });
  state = recipeAuthoringReducer(state, { type: 'DRAFT_CREATED', recipe: { id: 'r1', title: '', publicationStatus: 'draft', isActive: true, updatedAt: 'one' } });
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', preserveWorking: true });
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', preserveWorking: true, step: 'details', recipe: { id: 'r1', title: '', publicationStatus: 'draft', isActive: true, updatedAt: 'two' } });
  assert.deepEqual(state.unresolvedIngredients.map(({ sourceText }) => sourceText), ['1 cup rice', '2 eggs']);
  assert.equal(state.ingredientResolutionGeneration, generation);
  state = recipeAuthoringReducer(state, { type: 'LOAD_SUCCESS', recipe: { id: 'r1', title: 'Server', publicationStatus: 'draft', isActive: true, updatedAt: 'three' }, keepStep: true });
  assert.deepEqual(state.unresolvedIngredients, []);
  assert.equal(hasUnsavedChanges(state), false);
});

test('successful source replacement invalidates late resolver responses and may replace with an empty queue', () => {
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['source A'] });
  const generationA = state.ingredientResolutionGeneration;
  const requestA = { lines: ['source A'], submitted: [{ queueIndex: 0, sourceText: 'source A' }], excluded: [] };
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['source B'] });
  state = recipeAuthoringReducer(state, { type: 'INGREDIENT_RESOLUTION_SUCCESS', generation: generationA, request: requestA, resolutions: [] });
  assert.deepEqual(state.unresolvedIngredients.map(({ sourceText }) => sourceText), ['source B']);
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: [] });
  assert.deepEqual(state.unresolvedIngredients, []);
});

test('resolver-entry selection, edits, and confirmation are ignored while a request is loading', () => {
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['1 cup rice'] });
  const request = { lines: ['1 cup rice'], submitted: [{ queueIndex: 0, sourceText: '1 cup rice' }], excluded: [] };
  state = recipeAuthoringReducer(state, {
    type: 'UPDATE_INGREDIENT_RESOLUTION', index: 0,
    patch: { selectedIngredient: { id: 'old', name: 'Old' }, quantity: '1', unit: 'cup' },
  });
  state = recipeAuthoringReducer(state, {
    type: 'INGREDIENT_RESOLUTION_START', generation: state.ingredientResolutionGeneration, request,
  });
  const locked = state;
  state = recipeAuthoringReducer(state, {
    type: 'UPDATE_INGREDIENT_RESOLUTION', index: 0,
    patch: { selectedIngredient: { id: 'new', name: 'Wrong line' }, quantity: '9', unit: 'kg' },
  });
  assert.equal(state, locked);
  state = recipeAuthoringReducer(state, { type: 'CONFIRM_INGREDIENT_RESOLUTION', index: 0 });
  assert.equal(state, locked);
  assert.equal(state.form.ingredients[0].ingredient, null);
  assert.deepEqual(state.unresolvedIngredients[0].selectedIngredient, { id: 'old', name: 'Old' });
});

test('failed resolver retry invalidates stale none creation eligibility until a new successful result', () => {
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['1 calamansi', '1 egg'] });
  const generation = state.ingredientResolutionGeneration;
  const request = {
    lines: ['1 calamansi', '1 egg'],
    submitted: [
      { queueIndex: 0, sourceText: '1 calamansi' },
      { queueIndex: 1, sourceText: '1 egg' },
    ],
    excluded: [],
  };
  const none = {
    index: 0, sourceText: '1 calamansi', parsed: { quantity: 1, unit: 'piece', name: 'calamansi' },
    match: { kind: 'none', totalCandidates: 0, truncated: false, candidates: [] },
  };
  const exact = {
    index: 1, sourceText: '1 egg', parsed: { quantity: 1, unit: 'piece', name: 'egg' },
    match: { kind: 'exact', totalCandidates: 1, truncated: false, candidates: [{ ingredient: { id: 'egg-id', name: 'Egg' } }] },
  };
  state = recipeAuthoringReducer(state, {
    type: 'INGREDIENT_RESOLUTION_SUCCESS', generation, request, resolutions: [none, exact],
  });
  assert.ok(ingredientCreationPrefill(state.unresolvedIngredients[0], generation));
  const unrelatedEntry = state.unresolvedIngredients[1];
  const confirmedRecipeForm = state.form;

  state = recipeAuthoringReducer(state, { type: 'INGREDIENT_RESOLUTION_START', generation, request });
  assert.equal(ingredientCreationPrefill(state.unresolvedIngredients[0], generation), null);
  assert.equal(state.unresolvedIngredients[1], unrelatedEntry, 'an unrelated non-none row must be retained');
  assert.equal(state.form, confirmedRecipeForm, 'resolver retry must not change confirmed Recipe state');

  state = recipeAuthoringReducer(state, {
    type: 'INGREDIENT_RESOLUTION_FAILURE', generation, message: 'Catalog temporarily unavailable',
  });
  assert.equal(ingredientCreationPrefill(state.unresolvedIngredients[0], generation), null);
  assert.equal(state.unresolvedIngredients.length, 2);
  assert.equal(state.form, confirmedRecipeForm);

  state = recipeAuthoringReducer(state, { type: 'INGREDIENT_RESOLUTION_START', generation, request });
  state = recipeAuthoringReducer(state, {
    type: 'INGREDIENT_RESOLUTION_SUCCESS', generation, request, resolutions: [none, exact],
  });
  assert.ok(ingredientCreationPrefill(state.unresolvedIngredients[0], generation));
});

test('created Ingredient selection binds only canonical id/name to the same current generation and key without confirming', () => {
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['1 calamansi', '1 calamansi'] });
  const generation = state.ingredientResolutionGeneration;
  const [first, second] = state.unresolvedIngredients;
  const originalForm = state.form;
  state = recipeAuthoringReducer(state, {
    type: 'INGREDIENT_CREATION_SUCCESS', generation, key: first.key,
    ingredient: { id: 'server-id', name: 'Calamansi', category: 'produce', aliases: ['lime'] },
  });
  assert.deepEqual(state.unresolvedIngredients[0].selectedIngredient, { id: 'server-id', name: 'Calamansi' });
  assert.equal(state.unresolvedIngredients[1].selectedIngredient, null);
  assert.equal(state.unresolvedIngredients.length, 2);
  assert.equal(state.form, originalForm, 'creation must not add a Recipe ingredient row');

  const selectedState = state;
  assert.equal(recipeAuthoringReducer(state, {
    type: 'INGREDIENT_CREATION_SUCCESS', generation: generation - 1, key: first.key,
    ingredient: { id: 'stale', name: 'Stale' },
  }), selectedState);
  assert.equal(recipeAuthoringReducer(state, {
    type: 'INGREDIENT_CREATION_SUCCESS', generation, key: 'missing-key',
    ingredient: { id: 'wrong', name: 'Wrong' },
  }), selectedState);
  assert.equal(state.unresolvedIngredients[1].key, second.key);
});
