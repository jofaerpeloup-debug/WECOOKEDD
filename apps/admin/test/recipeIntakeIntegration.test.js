import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import React from 'react';
import {
  acceptMetadataSuggestion, applyRecipeIntake, createRecipeIntakeHandlers,
  metadataSuggestionState, parseRecipeIntake,
} from '../src/recipeAuthoring/recipeIntake.js';
import {
  buildStepPatch, createDraftBody, emptyRecipeForm, mutationBody, publishBody,
} from '../src/recipeAuthoring/recipeAuthoringModel.js';
import { initialAuthoringState, recipeAuthoringReducer } from '../src/recipeAuthoring/recipeAuthoringState.js';
import { ingredientCreationPrefill, prepareIngredientResolutionRequest } from '../src/recipeAuthoring/recipeIngredientResolution.js';

const payload = JSON.stringify({
  '@type': 'Recipe', name: 'Chicken Adobo', description: 'Braised chicken.', prepTime: 'PT20M', cookTime: 'PT1H10M',
  recipeYield: '6 people', recipeInstructions: ['Brown the chicken.', 'Simmer until tender.'], recipeIngredient: ['1 kg chicken'],
});

function createHookHarness(hook, props = {}) {
  const slots = [];
  let cursor = 0;
  const nextSlot = (initialValue) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: initialValue };
    return slots[index];
  };
  const dispatcher = {
    useCallback(callback) { cursor += 1; return callback; },
    useEffect() { cursor += 1; },
    useMemo(factory) { cursor += 1; return factory(); },
    useReducer(reducer, initialArg, init) {
      const slot = nextSlot(init ? init(initialArg) : initialArg);
      return [slot.value, (action) => { slot.value = reducer(slot.value, action); }];
    },
    useRef(initialValue) { return nextSlot({ current: initialValue }).value; },
    useState(initialValue) {
      const slot = nextSlot(typeof initialValue === 'function' ? initialValue() : initialValue);
      return [slot.value, (value) => { slot.value = typeof value === 'function' ? value(slot.value) : value; }];
    },
  };
  return () => {
    cursor = 0;
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const previous = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try { return hook(props); }
    finally { internals.ReactCurrentDispatcher.current = previous; }
  };
}

async function loadAuthoringHookWithApi(api) {
  globalThis.__recipeAuthoringIntegrationApi = api;
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/src/recipeApi.js')) {
        return { format: 'module', shortCircuit: true, source: `
          export const createDraft = (...args) => globalThis.__recipeAuthoringIntegrationApi.createDraft(...args);
          export const getRecipe = (...args) => globalThis.__recipeAuthoringIntegrationApi.getRecipe(...args);
          export const publishRecipe = (...args) => globalThis.__recipeAuthoringIntegrationApi.publishRecipe(...args);
          export const updateRecipe = (...args) => globalThis.__recipeAuthoringIntegrationApi.updateRecipe(...args);
          export const uploadRecipeImage = (...args) => globalThis.__recipeAuthoringIntegrationApi.uploadRecipeImage(...args);
        ` };
      }
      if (url.endsWith('/src/apiClient.js')) {
        return { format: 'module', shortCircuit: true, source: `
          export class ApiError extends Error {
            constructor(message, options = {}) { super(message); Object.assign(this, options); }
            get isForbidden() { return this.status === 403; }
            get isNetworkError() { return this.kind === 'network'; }
            get isUnauthorized() { return this.status === 401; }
          }
        ` };
      }
      return nextLoad(url, context);
    },
  });
  try {
    return (await import(`../src/recipeAuthoring/useRecipeAuthoring.js?integration=${Date.now()}`)).default;
  } finally {
    hooks.deregister();
  }
}

test('blank-only application fills safe local fields and never creates canonical ingredient data', () => {
  const original = {
    ...emptyRecipeForm(), imageUrl: 'https://wecooked.test/existing.jpg', difficulty: 'medium',
    region: 'visayas', category: 'ulam', dietaryTags: ['vegetarian'],
  };
  const outcome = applyRecipeIntake(original, parseRecipeIntake(payload));
  assert.deepEqual(outcome.form, {
    ...original, title: 'Chicken Adobo', description: 'Braised chicken.', prepTimeMinutes: '20',
    cookTimeHours: '1', cookTimeMinutePart: '10', servings: '6',
    instructions: ['Brown the chicken.', 'Simmer until tender.'],
  });
  assert.deepEqual(outcome.applied.map(({ field }) => field), ['title', 'description', 'servings', 'prepTimeMinutes', 'cookTimeMinutes', 'instructions']);
  assert.equal(outcome.form.ingredients, original.ingredients);
  assert.equal(JSON.stringify(outcome.form).includes('1 kg chicken'), false);
  for (const field of ['imageUrl', 'difficulty', 'region', 'category', 'dietaryTags']) {
    assert.equal(outcome.form[field], original[field], field);
  }
});

test('application preserves every meaningful conflict and reports skipped fields', () => {
  const original = {
    ...emptyRecipeForm(), title: 'My title', description: 'Mine', prepTimeMinutes: '5', servings: '2',
    cookTimeHours: '0', cookTimeMinutePart: '', instructions: ['', 'Keep this step.'],
  };
  const outcome = applyRecipeIntake(original, parseRecipeIntake(payload));
  assert.equal(outcome.form, original);
  assert.deepEqual(outcome.skipped.map(({ field }) => field), ['title', 'description', 'servings', 'prepTimeMinutes', 'cookTimeMinutes', 'instructions']);
});

test('rejected yields neither fill nor clear servings while other valid pasted fields still apply', () => {
  for (const servings of ['', '8']) {
    const original = { ...emptyRecipeForm(), servings };
    const parsed = parseRecipeIntake(JSON.stringify({
      '@type': 'Recipe', name: 'Safe title', recipeYield: '12 cookies',
    }));
    const outcome = applyRecipeIntake(original, parsed);
    assert.equal(parsed.values.servings, undefined);
    assert.deepEqual(parsed.invalid.map(({ field }) => field), ['recipeYield']);
    assert.equal(outcome.form.servings, servings);
    assert.equal(outcome.form.title, 'Safe title');
    assert.equal(outcome.applied.some(({ field }) => field === 'servings'), false);
    assert.equal(outcome.skipped.some(({ field }) => field === 'servings'), false);
  }
});

test('accepted pasted yields fill only blank servings and preserve Moderator-entered servings', () => {
  const parsed = parseRecipeIntake(JSON.stringify({ '@type': 'Recipe', recipeYield: 'Serves 6' }));
  const blank = applyRecipeIntake(emptyRecipeForm(), parsed);
  assert.equal(blank.form.servings, '6');
  assert.deepEqual(blank.applied, [{ field: 'servings' }]);

  const existing = { ...emptyRecipeForm(), servings: '8' };
  const preserved = applyRecipeIntake(existing, parsed);
  assert.equal(preserved.form, existing);
  assert.deepEqual(preserved.skipped, [{ field: 'servings', reason: 'Existing value preserved.' }]);
});

test('cooking time requires both fields blank while all-blank instruction rows may be replaced', () => {
  const original = { ...emptyRecipeForm(), cookTimeHours: '', cookTimeMinutePart: '0', instructions: ['', '  '] };
  const outcome = applyRecipeIntake(original, parseRecipeIntake(payload));
  assert.equal(outcome.form.cookTimeHours, '');
  assert.equal(outcome.form.cookTimeMinutePart, '0');
  assert.deepEqual(outcome.form.instructions, ['Brown the chicken.', 'Simmer until tender.']);
  assert.ok(outcome.skipped.some(({ field }) => field === 'cookTimeMinutes'));
});

test('parser failure causes no mutation', () => {
  const original = emptyRecipeForm();
  const outcome = applyRecipeIntake(original, parseRecipeIntake('{'));
  assert.equal(outcome.form, original);
  assert.deepEqual(outcome, { form: original, applied: [], skipped: [] });
});

test('unsupported and unresolved intake values remain non-applying', () => {
  const original = emptyRecipeForm();
  const parsed = parseRecipeIntake(JSON.stringify({
    '@graph': [{ '@type': 'Recipe', name: 'Safe title', recipeIngredient: ['1 kg chicken'] }],
    image: 'https://example.test/external.jpg',
  }));
  const outcome = applyRecipeIntake(original, parsed);
  assert.equal(outcome.form.title, 'Safe title');
  assert.equal(outcome.form.imageUrl, null);
  assert.equal(outcome.form.ingredients, original.ingredients);
  assert.equal(JSON.stringify(outcome.form).includes('external.jpg'), false);
  assert.equal(JSON.stringify(outcome.form).includes('1 kg chicken'), false);
});

test('Apply blank fields never accepts metadata suggestions', () => {
  const original = emptyRecipeForm();
  const parsed = parseRecipeIntake(JSON.stringify({
    '@type': 'Recipe', name: 'Safe title', recipeCategory: 'Dinner',
    suitableForDiet: ['VeganDiet', 'GlutenFreeDiet'],
  }));
  const outcome = applyRecipeIntake(original, parsed);
  assert.equal(outcome.form.title, 'Safe title');
  assert.equal(outcome.form.category, '');
  assert.deepEqual(outcome.form.dietaryTags, []);
  assert.deepEqual(outcome.applied, [{ field: 'title' }]);
});

test('metadata acceptance is explicit, click-time guarded, category-preserving, and dietary append-once', () => {
  const metadata = parseRecipeIntake(JSON.stringify({
    '@type': 'Recipe', recipeCategory: 'Dinner',
    suitableForDiet: ['VeganDiet', 'GlutenFreeDiet'],
  })).metadata;
  const category = metadata.find(({ field }) => field === 'category');
  const vegan = metadata.find(({ value }) => value === 'vegan');
  const glutenFree = metadata.find(({ value }) => value === 'glutenFree');
  let form = { ...emptyRecipeForm(), dietaryTags: ['vegetarian'] };
  const changes = [];
  const change = (field, value) => { changes.push([field, value]); form = { ...form, [field]: value }; };

  assert.equal(metadataSuggestionState(form, category), 'eligible');
  assert.deepEqual(acceptMetadataSuggestion({ form, suggestion: category, change }), {
    status: 'accepted', changed: true, field: 'category', value: 'dinner',
  });
  assert.equal(form.category, 'dinner');
  assert.equal(metadataSuggestionState(form, category, true), 'accepted');
  assert.deepEqual(acceptMetadataSuggestion({ form, suggestion: category, change }), {
    status: 'already-selected', changed: false,
  });

  assert.equal(acceptMetadataSuggestion({ form, suggestion: vegan, change }).changed, true);
  assert.deepEqual(form.dietaryTags, ['vegetarian', 'vegan']);
  assert.deepEqual(acceptMetadataSuggestion({ form, suggestion: vegan, change }), {
    status: 'already-selected', changed: false,
  });
  assert.equal(acceptMetadataSuggestion({ form, suggestion: glutenFree, change }).changed, true);
  assert.deepEqual(form.dietaryTags, ['vegetarian', 'vegan', 'glutenFree']);

  const manualCategory = { ...emptyRecipeForm(), category: 'lunch' };
  assert.deepEqual(acceptMetadataSuggestion({ form: manualCategory, suggestion: category, change }), {
    status: 'existing-preserved', changed: false,
  });
  assert.equal(manualCategory.category, 'lunch');
  assert.deepEqual(changes, [
    ['category', 'dinner'],
    ['dietaryTags', ['vegetarian', 'vegan']],
    ['dietaryTags', ['vegetarian', 'vegan', 'glutenFree']],
  ]);
});

test('source replacement replaces metadata suggestions and clears prior application state', () => {
  let preview = null;
  let application = { applied: [{ field: 'title' }] };
  const dependencies = {
    form: emptyRecipeForm(), preview, change() {},
    setPreview(value) { preview = value; },
    setApplication(value) { application = value; },
  };
  createRecipeIntakeHandlers({
    ...dependencies,
    input: JSON.stringify({ '@type': 'Recipe', recipeCategory: 'Dinner', suitableForDiet: 'VeganDiet' }),
  }).previewInput();
  assert.deepEqual(preview.metadata.filter(({ status }) => status === 'suggested').map(({ value }) => value), ['dinner', 'vegan']);

  createRecipeIntakeHandlers({
    ...dependencies,
    input: JSON.stringify({ '@type': 'Recipe', recipeCategory: 'Lunch', suitableForDiet: 'GlutenFreeDiet' }),
  }).previewInput();
  assert.deepEqual(preview.metadata.filter(({ status }) => status === 'suggested').map(({ value }) => value), ['lunch', 'glutenFree']);
  assert.equal(application, null);
});

test('ordinary Details PATCH contains only metadata accepted into local form state', () => {
  const saved = emptyRecipeForm();
  let working = emptyRecipeForm();
  const suggestions = parseRecipeIntake(JSON.stringify({
    '@type': 'Recipe', recipeCategory: 'Dinner',
    suitableForDiet: ['VeganDiet', 'GlutenFreeDiet', 'LowLactoseDiet'],
    recipeCuisine: 'Ilocano',
  })).metadata;
  const change = (field, value) => { working = { ...working, [field]: value }; };
  acceptMetadataSuggestion({
    form: working, suggestion: suggestions.find(({ value }) => value === 'dinner'), change,
  });
  acceptMetadataSuggestion({
    form: working, suggestion: suggestions.find(({ value }) => value === 'vegan'), change,
  });

  const body = mutationBody(buildStepPatch(saved, working, 'details'), 'details-token');
  assert.equal(body.category, 'dinner');
  assert.deepEqual(body.dietaryTags, ['vegan']);
  assert.equal(Object.hasOwn(body, 'region'), false);
  assert.equal(JSON.stringify(body).includes('glutenFree'), false);
  assert.equal(JSON.stringify(body).includes('LowLactoseDiet'), false);
  assert.equal(JSON.stringify(body).includes('Ilocano'), false);
});

test('actual Preview and Apply handlers only update local allowlisted form fields', () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error('Unexpected network request'); };
  let preview = null;
  let application = null;
  const form = emptyRecipeForm();
  const changes = [];
  const metadataPayload = JSON.stringify({
    ...JSON.parse(payload), recipeCategory: 'Dinner', suitableForDiet: 'VeganDiet',
  });
  const dependencies = {
    input: metadataPayload, form, preview, change: (field, value) => changes.push([field, value]),
    setPreview: (value) => { preview = value; }, setApplication: (value) => { application = value; },
  };
  let applyChanges;
  try {
    const previewOutcome = createRecipeIntakeHandlers(dependencies).previewInput();
    assert.equal(preview, previewOutcome);
    assert.equal(application, null);
    const handlers = createRecipeIntakeHandlers({ ...dependencies, preview });
    handlers.applyPreview();
    applyChanges = [...changes];
    handlers.acceptSuggestion(preview.metadata.find(({ field }) => field === 'category'));
    handlers.acceptSuggestion(preview.metadata.find(({ value }) => value === 'vegan'));
  } finally { globalThis.fetch = originalFetch; }

  assert.equal(networkCalls, 0, 'Preview/Apply/acceptance must not invoke generic fetch or any API operation backed by it');
  assert.deepEqual(applyChanges.map(([field]) => field), [
    'title', 'description', 'servings', 'prepTimeMinutes', 'cookTimeHours', 'cookTimeMinutePart', 'instructions',
  ]);
  assert.deepEqual(application.applied.map(({ field }) => field), [
    'title', 'description', 'servings', 'prepTimeMinutes', 'cookTimeMinutes', 'instructions',
  ]);
  assert.equal(applyChanges.some(([field]) => ['ingredients', 'imageUrl', 'difficulty', 'region', 'category', 'dietaryTags'].includes(field)), false);
  assert.deepEqual(changes.slice(applyChanges.length), [['category', 'dinner'], ['dietaryTags', ['vegan']]]);
});

test('production save path preserves JSON-LD values through Draft creation and unchanged Ingredients saves', async () => {
  const calls = [];
  const created = { id: 'draft-1', title: 'Chicken Adobo', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'created-token' };
  const basicsSaved = { ...created, description: 'Braised chicken.', updatedAt: 'basics-token' };
  const useRecipeAuthoring = await loadAuthoringHookWithApi({
    createDraft: async (body) => { calls.push(['create', body]); return created; },
    updateRecipe: async (id, body) => { calls.push(['patch', id, body]); return basicsSaved; },
    getRecipe: async () => { throw new Error('Unexpected reload'); },
    publishRecipe: async () => { throw new Error('Unexpected publish'); },
    uploadRecipeImage: async () => { throw new Error('Unexpected upload'); },
  });
  const renderHook = createHookHarness(useRecipeAuthoring);
  let authoring = renderHook();
  let preview;
  const handlers = createRecipeIntakeHandlers({
    input: payload, form: authoring.state.form, preview,
    change: authoring.change,
    setPreview: (value) => { preview = value; },
    setApplication: () => {},
  });
  handlers.previewInput();
  createRecipeIntakeHandlers({ ...handlers, input: payload, form: authoring.state.form, preview, change: authoring.change,
    setPreview: (value) => { preview = value; }, setApplication: () => {} }).applyPreview();
  authoring = renderHook();
  authoring.dispatch({ type: 'SET_UNRESOLVED_INGREDIENTS', lines: preview.unresolved[0].values });
  authoring = renderHook();

  assert.deepEqual(calls, [], 'Preview and Apply must remain local-only');
  assert.equal(await authoring.saveCurrent(), true);
  authoring = renderHook();
  assert.deepEqual(calls.map(([kind]) => kind), ['create', 'patch']);
  assert.deepEqual(calls[0][1], { title: 'Chicken Adobo' });
  assert.equal(calls[1][2].description, 'Braised chicken.');
  assert.equal(JSON.stringify(calls).includes('1 kg chicken'), false);
  assert.deepEqual(authoring.state.unresolvedIngredients.map(({ sourceText }) => sourceText), ['1 kg chicken']);
  assert.equal(authoring.state.form.title, 'Chicken Adobo');
  assert.equal(authoring.state.form.description, 'Braised chicken.');
  assert.equal(authoring.state.form.prepTimeMinutes, '20');
  assert.equal(authoring.state.form.cookTimeHours, '1');
  assert.equal(authoring.state.form.cookTimeMinutePart, '10');
  assert.equal(authoring.state.form.servings, '6');
  assert.deepEqual(authoring.state.form.instructions, ['Brown the chicken.', 'Simmer until tender.']);

  authoring.setStep('ingredients');
  authoring = renderHook();
  assert.equal(await authoring.saveCurrent(), true);
  authoring = renderHook();
  assert.equal(calls.length, 2, 'unchanged Ingredients Save Draft must not PATCH');
  assert.deepEqual(authoring.state.unresolvedIngredients.map(({ sourceText }) => sourceText), ['1 kg chicken']);
  assert.equal(authoring.state.form.prepTimeMinutes, '20');
  assert.deepEqual(authoring.state.form.instructions, ['Brown the chicken.', 'Simmer until tender.']);

  assert.equal(await authoring.next(), true);
  authoring = renderHook();
  assert.equal(calls.length, 2, 'unchanged Ingredients Next must not PATCH');
  assert.deepEqual(authoring.state.unresolvedIngredients.map(({ sourceText }) => sourceText), ['1 kg chicken']);
  assert.equal(authoring.state.currentStep, 'instructions');
  assert.equal(authoring.state.form.title, 'Chicken Adobo');
  assert.equal(authoring.state.form.description, 'Braised chicken.');
  assert.equal(authoring.state.form.prepTimeMinutes, '20');
  assert.equal(authoring.state.form.cookTimeHours, '1');
  assert.equal(authoring.state.form.cookTimeMinutePart, '10');
  assert.equal(authoring.state.form.servings, '6');
  assert.deepEqual(authoring.state.form.instructions, ['Brown the chicken.', 'Simmer until tender.']);
  delete globalThis.__recipeAuthoringIntegrationApi;
});

test('no-PATCH notices are truthful for Draft and Published recipes', async () => {
  const calls = [];
  const useRecipeAuthoring = await loadAuthoringHookWithApi({
    createDraft: async (...args) => { calls.push(['create', ...args]); throw new Error('Unexpected create'); },
    updateRecipe: async (...args) => { calls.push(['patch', ...args]); throw new Error('Unexpected patch'); },
    getRecipe: async (...args) => { calls.push(['get', ...args]); throw new Error('Unexpected reload'); },
    publishRecipe: async (...args) => { calls.push(['publish', ...args]); throw new Error('Unexpected publish'); },
    uploadRecipeImage: async (...args) => { calls.push(['upload', ...args]); throw new Error('Unexpected upload'); },
  });

  for (const publicationStatus of ['draft', 'published']) {
    for (const otherSectionDirty of [false, true]) {
      const recipe = {
        id: `${publicationStatus}-${otherSectionDirty}`, title: 'Saved title', description: 'Saved description',
        publicationStatus, isActive: true, updatedAt: 'saved-token', servings: 4,
      };
      const renderHook = createHookHarness(useRecipeAuthoring, { recipe });
      let authoring = renderHook();
      authoring.dispatch({ type: 'LOAD_SUCCESS', recipe, keepStep: true });
      authoring = renderHook();
      authoring.setStep('basics');
      if (otherSectionDirty) authoring.change('servings', '8');
      authoring = renderHook();

      assert.equal(await authoring.saveCurrent(), true);
      authoring = renderHook();
      assert.equal(calls.length, 0, 'a no-PATCH save must not make an API request');
      assert.equal(authoring.state.form.servings, otherSectionDirty ? '8' : '4');
      assert.equal(authoring.state.notice, otherSectionDirty
        ? 'No changes to save for this step. Other edits remain unsaved.'
        : publicationStatus === 'published' ? 'All changes are saved.' : 'Draft is saved.');
      assert.equal(authoring.dirty, otherSectionDirty);
    }
  }
  delete globalThis.__recipeAuthoringIntegrationApi;
});

test('changing the source cannot replay A or overwrite edited and cleared fields across no-PATCH navigation', async () => {
  const calls = [];
  const created = { id: 'draft-1', title: 'Moderator title', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'created-token' };
  const basicsSaved = { ...created, description: 'Braised chicken.', updatedAt: 'basics-token' };
  const useRecipeAuthoring = await loadAuthoringHookWithApi({
    createDraft: async (body) => { calls.push(['create', body]); return created; },
    updateRecipe: async (id, body) => { calls.push(['patch', id, body]); return basicsSaved; },
    getRecipe: async () => ({
      id: 'draft-1', title: 'Server title', description: 'Server description', prepTimeMinutes: 12,
      publicationStatus: 'draft', isActive: true, updatedAt: 'server-token',
    }),
    publishRecipe: async () => { throw new Error('Unexpected publish'); },
    uploadRecipeImage: async () => { throw new Error('Unexpected upload'); },
  });
  const renderHook = createHookHarness(useRecipeAuthoring);
  let authoring = renderHook();
  let preview = null;
  let application = null;
  const sourceAHandlers = createRecipeIntakeHandlers({
    input: payload, form: authoring.state.form, preview, change: authoring.change,
    setPreview: (value) => { preview = value; }, setApplication: (value) => { application = value; },
  });
  sourceAHandlers.previewInput();
  createRecipeIntakeHandlers({
    input: payload, form: authoring.state.form, preview, change: authoring.change,
    setPreview: (value) => { preview = value; }, setApplication: (value) => { application = value; },
  }).applyPreview();
  authoring = renderHook();
  assert.equal(application.applied.length, 6);

  authoring.change('title', 'Moderator title');
  authoring.change('prepTimeMinutes', '');
  authoring = renderHook();
  const sourceB = JSON.stringify({ '@type': 'Recipe', name: 'Source B', prepTime: 'PT45M' });
  createRecipeIntakeHandlers({
    input: sourceB, form: authoring.state.form, preview, change: authoring.change,
    setPreview: (value) => { preview = value; }, setApplication: (value) => { application = value; },
  }).previewInput();
  authoring = renderHook();

  assert.deepEqual(calls, [], 'changing and previewing source text must remain local-only');
  assert.equal(preview.values.title, 'Source B');
  assert.equal(authoring.state.form.title, 'Moderator title');
  assert.equal(authoring.state.form.prepTimeMinutes, '');

  assert.equal(await authoring.saveCurrent(), true);
  authoring = renderHook();
  assert.deepEqual(calls.map(([kind]) => kind), ['create', 'patch']);
  authoring.setStep('ingredients');
  authoring = renderHook();
  assert.equal(await authoring.next(), true);
  authoring = renderHook();

  assert.equal(calls.length, 2, 'unchanged Ingredients navigation must not PATCH');
  assert.equal(authoring.state.currentStep, 'instructions');
  assert.equal(authoring.state.form.title, 'Moderator title', 'Source A title must not replay');
  assert.equal(authoring.state.form.prepTimeMinutes, '', 'deliberately cleared Source A value must stay cleared');
  assert.deepEqual(authoring.state.form.instructions, ['Brown the chicken.', 'Simmer until tender.']);
  assert.equal(preview.values.title, 'Source B', 'Source B remains preview-only');
  assert.equal(preview.values.prepTimeMinutes, 45, 'Source B preview remains available without applying it');

  authoring.dispatch({ type: 'CONFLICT' });
  authoring = renderHook();
  await authoring.loadLatest({ keepStep: true });
  authoring = renderHook();
  assert.equal(authoring.state.form.title, 'Server title');
  assert.equal(authoring.state.form.description, 'Server description');
  assert.equal(authoring.state.form.prepTimeMinutes, '12');
  assert.equal(authoring.state.form.servings, '');
  assert.deepEqual(authoring.state.form.instructions, ['']);
  delete globalThis.__recipeAuthoringIntegrationApi;
});

test('nutrition stays suggestion-only until explicit acceptance and a replacement preview invalidates the prior handoff', () => {
  const nutrition = (calories) => ({
    '@type': 'Recipe',
    nutrition: {
      '@type': 'NutritionInformation', servingSize: '1 serving', calories: `${calories} kcal`,
      proteinContent: '28 g', carbohydrateContent: '12 g', fatContent: '18 g',
      sugarContent: '3 g', fiberContent: '2 g',
    },
  });
  const changes = [];
  let preview = null;
  let application = 'existing';
  const dependencies = {
    form: emptyRecipeForm(), change: (field, value) => changes.push([field, value]),
    setPreview: (value) => { preview = value; },
    setApplication: (value) => { application = value; },
  };
  createRecipeIntakeHandlers({ ...dependencies, input: JSON.stringify(nutrition(100)), preview }).previewInput();
  assert.equal(preview.nutritionSuggestion.nutrition.caloriesKcal, 100);
  assert.deepEqual(changes, []);
  assert.equal(application, null);

  createRecipeIntakeHandlers({ ...dependencies, input: JSON.stringify(nutrition(250)), preview }).previewInput();
  assert.equal(preview.nutritionSuggestion.nutrition.caloriesKcal, 250);
  createRecipeIntakeHandlers({ ...dependencies, input: JSON.stringify(nutrition(250)), preview }).acceptNutrition();
  assert.equal(changes[0][0], 'nutrition');
  assert.equal(changes[0][1].caloriesKcal, '250');
  assert.equal(changes[1][0], 'nutritionSource');
});

test('production JSX keeps Preview local, queues unresolved source, and gates resolution behind the explicit action', () => {
  const intakeSource = readFileSync(new URL('../src/recipeAuthoring/recipeIntake.js', import.meta.url), 'utf8');
  const stepsSource = readFileSync(new URL('../src/recipeAuthoring/RecipeAuthoringSteps.jsx', import.meta.url), 'utf8');
  const wizardSource = readFileSync(new URL('../src/recipeAuthoring/RecipeAuthoringWizard.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(intakeSource, /fetch\s*\(|createDraft|updateRecipe|publishRecipe|recipeApi/);
  assert.doesNotMatch(stepsSource, /fetch\s*\(|createDraft|updateRecipe|publishRecipe|uploadRecipeImage|recipeApi/);
  assert.ok(stepsSource.includes('!state.recipeId && <RecipeIntake form={form} change={change} busy={busy} dispatch={dispatch} />'));
  assert.ok(stepsSource.includes('createRecipeIntakeHandlers({'));
  assert.ok(stepsSource.includes('input, form, preview, change, setPreview,'));
  assert.ok(stepsSource.includes('setApplication,'));
  assert.ok(stepsSource.includes("type: 'SET_UNRESOLVED_INGREDIENTS'"));
  assert.ok(stepsSource.includes('const result = previewInput();'));
  assert.ok(stepsSource.includes('onClick={handlePreview}>Preview</button>'));
  assert.ok(stepsSource.includes('onClick={applyPreview}>Apply blank fields</button>'));
  assert.ok(stepsSource.includes('onClick={findMatches}'));
  assert.ok(stepsSource.includes('await request(prepared.lines)'));
  assert.ok(stepsSource.indexOf('const result = previewInput();') < stepsSource.indexOf('await request(prepared.lines)'));
  assert.ok(stepsSource.includes("item.location ? `${item.location} ${item.field}` : item.field"));
  assert.ok(wizardSource.includes('onClick={() => saveCurrent()}'));
  assert.ok(wizardSource.includes("state.publicationStatus === 'published' ? 'Save changes' : 'Save Draft'"));
  assert.ok(wizardSource.includes('onClick={publish}'));
  assert.ok(wizardSource.includes("state.publicationStatus === 'draft'"));
});

test('actual intake resolution create-return confirm-save path preserves both explicit mutation boundaries', () => {
  const preview = parseRecipeIntake(payload);
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, {
    type: 'SET_UNRESOLVED_INGREDIENTS', lines: preview.unresolved[0].values,
  });
  const generation = state.ingredientResolutionGeneration;
  const request = prepareIngredientResolutionRequest(state.unresolvedIngredients);
  state = recipeAuthoringReducer(state, {
    type: 'INGREDIENT_RESOLUTION_SUCCESS', generation, request,
    resolutions: [{
      index: 0, sourceText: '1 kg chicken', parsed: { quantity: 1, unit: 'kg', name: 'chicken' },
      match: { kind: 'none', totalCandidates: 0, truncated: false, candidates: [] },
    }],
  });
  const entry = state.unresolvedIngredients[0];
  assert.deepEqual(ingredientCreationPrefill(entry, generation), {
    name: 'chicken', aliases: [], category: '', allergenTags: [],
  });
  assert.equal(state.form.ingredients[0].ingredient, null, 'resolution must not create a Recipe row');

  const returned = { id: 'server-chicken', name: 'Chicken', category: 'protein', aliases: [] };
  state = recipeAuthoringReducer(state, {
    type: 'INGREDIENT_CREATION_SUCCESS', generation, key: entry.key, ingredient: returned,
  });
  assert.deepEqual(state.unresolvedIngredients[0].selectedIngredient, { id: 'server-chicken', name: 'Chicken' });
  assert.equal(state.unresolvedIngredients.length, 1);
  assert.equal(state.form.ingredients[0].ingredient, null, 'successful catalog creation must not auto-confirm');

  state = recipeAuthoringReducer(state, { type: 'CONFIRM_INGREDIENT_RESOLUTION', index: 0 });
  assert.equal(state.unresolvedIngredients.length, 0);
  assert.deepEqual(state.form.ingredients[0], {
    ...state.form.ingredients[0],
    ingredient: { id: 'server-chicken', name: 'Chicken' }, quantity: '1', unit: 'kg', note: '', optional: false,
  });
  assert.deepEqual(mutationBody(buildStepPatch(emptyRecipeForm(), state.form, 'ingredients'), 'token').ingredients, [{
    ingredientId: 'server-chicken', quantity: 1, unit: 'kg', optional: false,
  }]);
});

test('actual Draft, PATCH, and Publish payload builders exclude all transient resolver data', () => {
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['1 cup rice'] });
  state = {
    ...state,
    unresolvedIngredients: state.unresolvedIngredients.map((entry) => ({
      ...entry,
      selectedIngredient: { id: 'i1', name: 'Rice', category: 'pantry', aliases: ['grain'] },
      quantity: '1', unit: 'cup',
      resolution: {
        sourceText: '1 cup rice', parsed: { quantity: 1, unit: 'cup', name: 'rice' },
        match: { kind: 'exact', totalCandidates: 1, truncated: false, candidates: [{ matchedOn: 'alias' }] },
      },
    })),
  };
  state = recipeAuthoringReducer(state, { type: 'CONFIRM_INGREDIENT_RESOLUTION', index: 0 });
  const payloads = [
    createDraftBody(state.form),
    mutationBody(buildStepPatch(state.saved, state.form, 'ingredients'), 'update-token'),
    publishBody('update-token'),
  ];
  assert.deepEqual(payloads[1].ingredients, [{ ingredientId: 'i1', quantity: 1, unit: 'cup', optional: false }]);
  const serializedPayloads = JSON.stringify(payloads);
  for (const forbidden of [
    '1 cup rice', 'sourceText', 'unresolvedIngredients', 'resolution', 'parsed', 'match', 'candidate',
    'totalCandidates', 'matchedOn', 'aliases', 'category',
  ]) {
    assert.equal(serializedPayloads.includes(forbidden), false, forbidden);
  }
});
