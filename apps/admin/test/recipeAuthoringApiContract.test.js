import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import React from 'react';

const source = readFileSync(new URL('../src/recipeApi.js', import.meta.url), 'utf8');
test('Staff Portal authoring uses Draft, PATCH, publish, and lifecycle command endpoints', () => {
  assert.match(source, /post\('\/recipes\/drafts'/);
  assert.match(source, /patch\(`\/recipes\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(source, /post\(`\/recipes\/\$\{encodeURIComponent\(id\)\}\/publish`/);
  assert.match(source, /const body = expectedUpdatedAt \? \{ expectedUpdatedAt \} : \{\}/);
  assert.doesNotMatch(source, /export function createRecipe/);
  assert.doesNotMatch(source, /api\.post\('\/recipes',/);
});

test('duplicate review calls the strict saved-Draft endpoint without resolver or source metadata', () => {
  const source = readFileSync(new URL('../src/recipeApi.js', import.meta.url), 'utf8');
  assert.match(source, /api\.post\('\/recipes\/duplicate-check', \{ body: \{ recipeId, expectedUpdatedAt \} \}\)/);
  const duplicateCall = source.match(/export function checkRecipeDuplicates[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(duplicateCall, /sourceUrl|unresolved|resolver|candidate:/);
});

test('actual authoring API client preserves rejected edits, repaired cooking PATCHes, and staff reload with mocked transport', async () => {
  // Only replace Vite's import.meta.env expression for Node; execute the real
  // API client and recipeApi modules against a backend-shaped fetch response.
  const clientSource = readFileSync(new URL('../src/apiClient.js', import.meta.url), 'utf8')
    .replace('import.meta.env.VITE_API_BASE_URL', 'undefined');
  const clientUrl = `data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`;
  const recipeApiUrl = `data:text/javascript;base64,${Buffer.from(source.replace("from './apiClient.js'", `from '${clientUrl}'`)).toString('base64')}`;
  const [{ ApiError, setAuthAdapter }, recipeApi] = await Promise.all([import(clientUrl), import(recipeApiUrl)]);
  const recipeId = '507f1f77bcf86cd799439010';
  const activeId = '507f1f77bcf86cd799439011';
  const inactiveId = '507f1f77bcf86cd799439012';
  const repairedId = '507f1f77bcf86cd799439013';
  let revision = 0;
  let saved = { id: recipeId, title: 'Adobo', publicationStatus: 'draft', isActive: true,
    updatedAt: '2026-10-14T00:00:00.000Z', ingredients: [], cooking: null };
  const calls = [];
  const originalFetch = globalThis.fetch;
  const ok = (recipe) => new Response(JSON.stringify({ success: true, data: { recipe } }), { status: 200 });
  const rejected = () => new Response(JSON.stringify({ success: false, error: {
    code: 'RECIPE_INGREDIENT_INACTIVE', message: 'One or more referenced ingredients are not active.',
  } }), { status: 400 });
  setAuthAdapter({ getAccessToken: () => 'moderator-token', refreshAccessToken: async () => false });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return ok(saved);
    assert.equal(options.method, 'PATCH');
    const body = JSON.parse(options.body);
    assert.equal(body.expectedUpdatedAt, saved.updatedAt);
    if (body.ingredients?.some((row) => row.ingredientId === inactiveId)
      || body.cooking?.spiceAlternatives?.some((alternative) => alternative.ingredients.some((row) => row.ingredientId === inactiveId))) return rejected();
    revision += 1;
    saved = { ...saved, ...body, updatedAt: `2026-10-14T00:00:00.00${revision}Z` };
    delete saved.expectedUpdatedAt;
    if (body.ingredients) saved.ingredients = body.ingredients.map((row) => ({
      ingredient: { id: row.ingredientId, name: 'Chicken' }, quantity: row.quantity, unit: row.unit,
      note: row.note ?? null, optional: row.optional,
    }));
    return ok(saved);
  };
  try {
    await assert.rejects(recipeApi.updateRecipe(recipeId, { ingredients: [{ ingredientId: inactiveId, quantity: 1, unit: 'kg', optional: false }],
      expectedUpdatedAt: saved.updatedAt }), (error) => error instanceof ApiError && error.code === 'RECIPE_INGREDIENT_INACTIVE' && error.details.length === 0);
    assert.equal((await recipeApi.getRecipe(recipeId)).updatedAt, '2026-10-14T00:00:00.000Z');
    await recipeApi.updateRecipe(recipeId, { ingredients: [{ ingredientId: activeId, quantity: 1, unit: 'kg', optional: false }],
      expectedUpdatedAt: saved.updatedAt });

    const cooking = { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [{ spiceLevel: 'hot',
      ingredients: [{ ingredientId: inactiveId, quantity: 2, unit: 'g', optional: false }] }],
    stepTimers: [{ stepOrder: 1, servings: 4, spiceLevel: 'hot', durationSeconds: 90 }] };
    await assert.rejects(recipeApi.updateRecipe(recipeId, { cooking, servings: 4, instructions: ['Simmer chicken.'],
      expectedUpdatedAt: saved.updatedAt }), (error) => error instanceof ApiError && error.code === 'RECIPE_INGREDIENT_INACTIVE' && error.details.length === 0);
    assert.equal((await recipeApi.getRecipe(recipeId)).cooking, null);
    cooking.spiceAlternatives[0].ingredients[0].ingredientId = repairedId;
    const repaired = await recipeApi.updateRecipe(recipeId, { cooking, servings: 4, instructions: ['Simmer chicken.'],
      expectedUpdatedAt: saved.updatedAt });
    assert.deepEqual(repaired.cooking, cooking);
    assert.deepEqual((await recipeApi.getRecipe(recipeId)).cooking, cooking);
    assert.equal(calls.every(({ url, options }) => url.endsWith(`/recipes/${recipeId}`) && options.headers.Authorization === 'Bearer moderator-token'), true);
  } finally {
    globalThis.fetch = originalFetch;
    setAuthAdapter({ getAccessToken: () => null, refreshAccessToken: async () => false });
  }
});

function authoringHookHarness(hook, props) {
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

test('actual authoring handlers defer an alternative, reject inactive ingredients, repair, save, and reload through HTTP', async () => {
  const clientPath = new URL('../src/apiClient.js', import.meta.url);
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url === clientPath.href) {
        return { format: 'module', shortCircuit: true,
          source: readFileSync(clientPath, 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined') };
      }
      return nextLoad(url, context);
    },
  });
  const originalFetch = globalThis.fetch;
  let setAuthAdapter;
  try {
    ({ setAuthAdapter } = await import('../src/apiClient.js'));
    const { default: useRecipeAuthoring } = await import('../src/recipeAuthoring/useRecipeAuthoring.js');
    const recipeId = '507f1f77bcf86cd799439010';
    const baseId = '507f1f77bcf86cd799439011';
    const inactiveId = '507f1f77bcf86cd799439012';
    const activeId = '507f1f77bcf86cd799439013';
    const originalToken = '2026-10-14T00:00:00.000Z';
    const newToken = '2026-10-14T00:00:00.001Z';
    let persisted = { id: recipeId, title: 'Chicken Adobo', description: 'Chicken simmered in vinegar.',
      publicationStatus: 'draft', isActive: true, updatedAt: originalToken,
      ingredients: [],
      instructions: ['Simmer chicken.'], difficulty: 'easy', cookTimeMinutes: 20, servings: null, cooking: null };
    const requests = [];
    const savedCallbacks = [];
    const ok = (data) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
    setAuthAdapter({ getAccessToken: () => 'moderator-token', refreshAccessToken: async () => false });
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      assert.equal(options.headers.Authorization, 'Bearer moderator-token');
      if (url.endsWith(`/ingredients/${activeId}`)) return ok({ ingredient: { id: activeId, name: 'Chili', isActive: true } });
      assert.ok(url.endsWith(`/recipes/${recipeId}`), url);
      if (options.method === 'GET') return ok({ recipe: persisted });
      assert.equal(options.method, 'PATCH');
      const body = JSON.parse(options.body);
      assert.equal(body.expectedUpdatedAt, persisted.updatedAt);
      if (body.cooking.spiceAlternatives[0].ingredients[0].ingredientId === inactiveId) {
        return new Response(JSON.stringify({ success: false, error: {
          code: 'RECIPE_INGREDIENT_INACTIVE', message: 'One or more referenced ingredients are not active.',
        } }), { status: 400 });
      }
      persisted = { ...persisted, ...body, updatedAt: newToken };
      delete persisted.expectedUpdatedAt;
      if (body.ingredients) persisted.ingredients = body.ingredients.map((row) => ({
        ingredient: { id: row.ingredientId, name: 'Chicken' }, quantity: row.quantity,
        unit: row.unit, optional: row.optional,
      }));
      return ok({ recipe: persisted });
    };

    const render = authoringHookHarness(useRecipeAuthoring, { recipe: persisted,
      onSaved: (recipe) => savedCallbacks.push(recipe) });
    let authoring = render();
    await authoring.loadLatest();
    authoring = render();
    assert.equal(authoring.state.currentStep, 'ingredients');
    authoring.change('ingredients', [{ ingredient: { id: baseId, name: 'Chicken' },
      quantity: '1', unit: 'kg', optional: false, note: '' }]);
    authoring = render();

    const alternative = (id, quantity = '2') => ({ schemaVersion: 1, defaultSpiceLevel: 'mild',
      spiceAlternatives: [{ spiceLevel: 'hot', ingredients: [{
        ingredient: { id, name: 'Chili' }, quantity, unit: 'g', optional: false, note: '',
      }] }], stepTimers: [] });
    authoring.change('cooking', alternative(inactiveId, '0'));
    authoring = render();
    assert.equal(await authoring.next(), false, 'invalid Ingredients must block Next');
    authoring = render();
    assert.equal(authoring.state.currentStep, 'ingredients');
    assert.equal(requests.filter(({ options }) => options.method === 'PATCH').length, 0);
    authoring.change('cooking', alternative(inactiveId));
    authoring = render();
    assert.equal(await authoring.next(), true);
    authoring = render();
    assert.equal(authoring.state.currentStep, 'instructions');
    assert.equal(await authoring.next(), true);
    authoring = render();
    assert.equal(authoring.state.currentStep, 'details');
    assert.equal(requests.filter(({ options }) => options.method === 'PATCH').length, 0);
    assert.equal(await authoring.next(), false, 'missing servings must block Review and save');
    authoring = render();
    assert.equal(authoring.state.currentStep, 'details');
    assert.ok(authoring.state.fieldErrors.servings);
    assert.equal(requests.filter(({ options }) => options.method === 'PATCH').length, 0);

    authoring.change('servings', '4');
    authoring = render();
    assert.equal(await authoring.saveCurrent(), false, 'API rejection must prevent save success');
    authoring = render();
    assert.equal(authoring.state.currentStep, 'ingredients');
    assert.equal(authoring.state.fieldErrors.ingredients, 'One or more referenced ingredients are not active.');
    assert.equal(authoring.state.notice, '');
    assert.equal(savedCallbacks.length, 0);
    assert.equal(persisted.cooking, null);
    // The Ingredients section renders this general error above its editable rows.
    assert.match(readFileSync(new URL('../src/recipeAuthoring/RecipeAuthoringSteps.jsx', import.meta.url), 'utf8'),
      /<FieldError message=\{err\(fieldErrors, 'ingredients'\)\} \/>/);

    authoring.change('cooking', alternative(activeId));
    authoring = render();
    assert.equal(await authoring.saveCurrent(), true);
    authoring = render();
    assert.equal(authoring.state.fieldErrors.ingredients, undefined);
    assert.equal(savedCallbacks.length, 1);
    assert.equal(authoring.state.updatedAt, newToken);
    assert.equal(authoring.state.currentStep, 'ingredients');
    const patches = requests.filter(({ options }) => options.method === 'PATCH').map(({ options }) => JSON.parse(options.body));
    assert.equal(patches.length, 2);
    assert.equal(patches[0].cooking.spiceAlternatives[0].ingredients[0].ingredientId, inactiveId);
    assert.deepEqual(patches[1], { ingredients: [{ ingredientId: baseId, quantity: 1, unit: 'kg', optional: false }],
      cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild',
      spiceAlternatives: [{ spiceLevel: 'hot', ingredients: [{ ingredientId: activeId, quantity: 2, unit: 'g', optional: false }] }],
      stepTimers: [] }, servings: 4, expectedUpdatedAt: originalToken });
    assert.equal(await authoring.next(), true);
    authoring = render();
    assert.equal(authoring.state.currentStep, 'instructions');
    assert.equal(await authoring.next(), true);
    authoring = render();
    assert.equal(authoring.state.currentStep, 'details');
    assert.equal(await authoring.next(), true);
    authoring = render();
    assert.equal(authoring.state.currentStep, 'review');
    assert.equal(await authoring.saveCurrent(), true);
    assert.equal(requests.filter(({ options }) => options.method === 'PATCH').length, 2);

    await authoring.loadLatest({ keepStep: true });
    authoring = render();
    assert.equal(authoring.state.currentStep, 'review');
    assert.equal(authoring.state.updatedAt, newToken);
    assert.equal(authoring.state.form.servings, '4');
    assert.equal(authoring.state.form.cooking.spiceAlternatives[0].ingredients[0].ingredient.id, activeId);
    assert.equal(authoring.state.form.cooking.spiceAlternatives[0].ingredients[0].quantity, '2');
  } finally {
    globalThis.fetch = originalFetch;
    setAuthAdapter?.({ getAccessToken: () => null, refreshAccessToken: async () => false });
    hooks.deregister();
  }
});
