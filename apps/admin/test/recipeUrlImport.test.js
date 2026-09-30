import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { applyRecipeIntake } from '../src/recipeAuthoring/recipeIntake.js';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const vite = await createServer({
  root: adminRoot,
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true },
  ssr: { external: ['@wecooked/contracts'] },
});

const [
  { default: RecipesTab },
  { default: RecipeAuthoringSteps, IngredientResolutionPanel, requestIngredientResolutions },
  { emptyRecipeForm },
  { getCatalogPolicy },
] = await Promise.all([
  vite.ssrLoadModule('/src/RecipesTab.jsx'),
  vite.ssrLoadModule('/src/recipeAuthoring/RecipeAuthoringSteps.jsx'),
  vite.ssrLoadModule('/src/recipeAuthoring/recipeAuthoringModel.js'),
  vite.ssrLoadModule('/src/portalPolicy.js'),
]);

after(() => vite.close());

test('recipeApi submits the URL through the shared authenticated API client', async () => {
  const source = readFileSync(new URL('../src/recipeApi.js', import.meta.url), 'utf8');
  assert.match(source, /export function importRecipeUrl\(url\)/u);
  assert.match(source, /api\.post\('\/recipes\/import-url', \{ body: \{ url \} \}\)/u);
});

async function loadHelper() {
  return import(`../src/recipeAuthoring/recipeUrlImport.js?test=${Date.now()}-${Math.random()}`);
}

test('raw server candidate is serialized into the sole M27 parser and retains its preview categories', async () => {
  const request = async () => ({
    sourceUrl: 'https://example.com/final',
    candidate: {
      '@type': 'Recipe',
      name: 'Chicken Adobo',
      prepTime: 'not-a-duration',
      recipeIngredient: ['1 kg chicken'],
      remoteOnlyField: true,
    },
  });
  const helper = await loadHelper();
  const result = await helper.importRecipeUrlForPreview('https://example.com/start', {
    request,
  });
  assert.equal(result.sourceUrl, 'https://example.com/final');
  assert.equal(JSON.parse(result.input).remoteOnlyField, true);
  assert.deepEqual(result.preview.mapped.map(({ field }) => field), ['title']);
  assert.deepEqual(result.preview.invalid.map(({ field }) => field), ['prepTime']);
  assert.deepEqual(result.preview.unsupported.map(({ field }) => field), ['remoteOnlyField']);
  assert.deepEqual(result.preview.unresolved[0].values, ['1 kg chicken']);
});

test('URL candidates use the sole parser for identical safe and rejected yield classifications', async () => {
  const helper = await loadHelper();
  for (const [recipeYield, servings, invalid] of [
    ['Makes 100 servings', 100, []],
    ['12 cookies', undefined, ['recipeYield']],
  ]) {
    const result = await helper.importRecipeUrlForPreview('https://example.com/recipe', {
      request: async () => ({
        sourceUrl: 'https://example.com/final',
        candidate: { '@type': 'Recipe', name: 'Imported recipe', recipeYield },
      }),
    });
    assert.equal(result.preview.values.servings, servings, recipeYield);
    assert.deepEqual(result.preview.invalid.map(({ field }) => field), invalid, recipeYield);

    const blank = applyRecipeIntake(emptyRecipeForm(), result.preview);
    assert.equal(blank.form.servings, servings == null ? '' : String(servings), recipeYield);
    const existing = { ...emptyRecipeForm(), servings: '8' };
    const preserved = applyRecipeIntake(existing, result.preview);
    assert.equal(preserved.form.servings, '8', recipeYield);
    assert.deepEqual(
      preserved.skipped.filter(({ field }) => field === 'servings'),
      servings == null ? [] : [{ field: 'servings', reason: 'Existing value preserved.' }],
      recipeYield,
    );
  }
});

test('URL import handler exposes loading, safe error, retry, and success without any save call', async () => {
  const calls = { import: 0, create: 0, patch: 0, publish: 0, upload: 0 };
  const request = async () => {
    calls.import += 1;
    if (calls.import === 1) throw new Error('Safe API error');
    return {
      sourceUrl: 'https://example.com/final',
      candidate: { '@type': 'Recipe', name: 'Retry success', recipeIngredient: ['salt'] },
    };
  };
  const helper = await loadHelper();
  const states = [];
  let input = '';
  let preview = null;
  let application = 'old';
  const handlers = helper.createRecipeUrlImportHandlers({
    url: 'https://example.com/start',
    request,
    setInput(value) { input = value; },
    setPreview(value) { preview = value; },
    setApplication(value) { application = value; },
    setUrlImport(value) { states.push(value); },
  });

  assert.deepEqual(await handlers.importFromUrl(), { error: 'Safe API error' });
  assert.deepEqual(states.slice(-2).map(({ status }) => status), ['loading', 'error']);
  const succeeded = await handlers.importFromUrl();
  assert.equal(succeeded.sourceUrl, 'https://example.com/final');
  assert.deepEqual(states.slice(-2).map(({ status }) => status), ['loading', 'success']);
  assert.equal(JSON.parse(input).name, 'Retry success');
  assert.equal(preview.values.title, 'Retry success');
  assert.deepEqual(preview.unresolved[0].values, ['salt']);
  assert.equal(application, null);
  assert.deepEqual(calls, { import: 2, create: 0, patch: 0, publish: 0, upload: 0 });
});

function findElement(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
  for (const child of children) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

test('React URL import controls render and wire idle, loading, error, and success behavior', async () => {
  const helper = await loadHelper();
  const changes = [];
  let imports = 0;
  const render = (urlImport, url = 'https://example.com/recipe', busy = false) => {
    const props = {
      url,
      urlImport,
      busy,
      onUrlChange: (value) => changes.push(value),
      onImport: () => { imports += 1; },
    };
    return {
      tree: helper.RecipeUrlImportControls(props),
      html: renderToStaticMarkup(helper.RecipeUrlImportControls(props)),
    };
  };

  const idle = render({ status: 'idle', sourceUrl: '', error: '' });
  assert.match(idle.html, />Import URL<\/button>/u);
  const input = findElement(idle.tree, 'input');
  const button = findElement(idle.tree, 'button');
  assert.equal(input.props.id, 'recipe-url-import');
  assert.equal(input.props.name, 'recipeUrl');
  assert.match(idle.html, /<input id="recipe-url-import" name="recipeUrl" type="url"/u);
  input.props.onChange({ target: { value: 'https://example.org/next' } });
  button.props.onClick();
  assert.deepEqual(changes, ['https://example.org/next']);
  assert.equal(imports, 1);

  const loading = render({ status: 'loading', sourceUrl: '', error: '' });
  assert.match(loading.html, /disabled=""[^>]*>Importing…<\/button>/u);
  assert.match(loading.html, /<input[^>]*disabled=""/u);

  const failed = render({ status: 'error', sourceUrl: '', error: 'Safe API error' });
  assert.match(failed.html, /role="alert">Safe API error<\/div>/u);
  assert.match(failed.html, />Retry import<\/button>/u);

  const sourceUrl = 'https://example.com/final?recipe=1';
  const succeeded = render({ status: 'success', sourceUrl, error: '' });
  assert.match(succeeded.html, /role="status"/u);
  assert.match(succeeded.html, /href="https:\/\/example\.com\/final\?recipe=1"/u);
  assert.match(succeeded.html, /nothing has been saved/u);

  const empty = render({ status: 'idle', sourceUrl: '', error: '' }, '   ');
  assert.equal(findElement(empty.tree, 'button').props.disabled, true);
});

test('UI keeps URL import preview-only and source-display-only', () => {
  const steps = readFileSync(new URL('../src/recipeAuthoring/RecipeAuthoringSteps.jsx', import.meta.url), 'utf8');
  const helper = readFileSync(new URL('../src/recipeAuthoring/recipeUrlImport.js', import.meta.url), 'utf8');
  assert.match(steps, /<RecipeUrlImportControls/u);
  assert.match(steps, /onImport=\{handleUrlImport\}/u);
  assert.match(steps, /const result = await importFromUrl\(\)/u);
  assert.match(steps, /setUnresolvedFromPreview\(result\.preview\)/u);
  assert.match(steps, /!state\.recipeId && <RecipeIntake/u);
  assert.match(helper, /parseRecipeIntake\(input\)/u);
  assert.doesNotMatch(helper, /createDraft|updateRecipe|publishRecipe|uploadRecipeImage/u);
});

test('rendered authority state gives Moderator URL import access and Admin no write entry point', () => {
  const moderatorPolicy = getCatalogPolicy('moderator');
  const adminPolicy = getCatalogPolicy('admin');
  const moderatorCatalog = renderToStaticMarkup(createElement(RecipesTab, {
    canWrite: moderatorPolicy.canWriteCatalog,
    canUploadRecipeImage: moderatorPolicy.canUploadRecipeImage,
  }));
  const adminCatalog = renderToStaticMarkup(createElement(RecipesTab, {
    canWrite: adminPolicy.canWriteCatalog,
    canUploadRecipeImage: adminPolicy.canUploadRecipeImage,
  }));
  const moderatorAuthoring = renderToStaticMarkup(createElement(RecipeAuthoringSteps, {
    canUploadRecipeImage: moderatorPolicy.canUploadRecipeImage,
    authoring: {
      state: {
        form: emptyRecipeForm(), currentStep: 'basics', fieldErrors: {}, recipeId: null,
        unresolvedIngredients: [], ingredientResolutionStatus: 'idle', ingredientResolutionError: '',
      },
      change() {},
      selectedFile: null,
      setSelectedFile() {},
      previewUrl: '',
      readiness: {},
      setStep() {},
      busy: false,
      dispatch() {},
    },
  }));

  assert.equal(moderatorCatalog.includes('Add recipe</button>'), true);
  assert.equal(moderatorAuthoring.includes('>Import URL</button>'), true);
  assert.equal(moderatorAuthoring.includes('Public recipe URL'), true);
  assert.equal(adminCatalog.includes('>Read-only</span>'), true);
  assert.equal(adminCatalog.includes('Add recipe</button>'), false);
  assert.equal(adminCatalog.includes('>Import URL</button>'), false);
});

function resolutionEntry(kind, index, candidates = [], truncated = false) {
  return {
    key: `source-1-${index}`, sourceText: `${kind} source`, selectedIngredient: null, quantity: '', unit: '',
    resolution: {
      index, sourceText: `${kind} source`, parsed: { quantity: null, unit: null, name: `${kind} source` },
      match: { kind, totalCandidates: truncated ? 12 : candidates.length, truncated, candidates },
    },
  };
}

function findElementMatching(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
  for (const child of children) {
    const match = findElementMatching(child, predicate);
    if (match) return match;
  }
  return null;
}

test('rendered resolver covers every classification, truncation, manual fallback, and no preselection', () => {
  const candidate = (id, name) => ({
    ingredient: { id, name, category: 'pantry' }, matchedOn: 'name', matchedText: name,
  });
  const state = {
    unresolvedIngredients: [
      resolutionEntry('exact', 0, [candidate('1', 'Rice')]),
      resolutionEntry('ambiguous', 1, [candidate('2', 'Egg'), candidate('3', 'Egg substitute')]),
      resolutionEntry('possible', 2, [candidate('4', 'Chicken breast')], true),
      resolutionEntry('none', 3), resolutionEntry('unparsed', 4),
    ],
    ingredientResolutionStatus: 'idle', ingredientResolutionError: '', ingredientResolutionGeneration: 1,
  };
  const html = renderToStaticMarkup(createElement(IngredientResolutionPanel, { state, dispatch() {}, busy: false }));
  for (const label of ['exact', 'ambiguous', 'possible', 'none', 'unparsed']) {
    assert.match(html, new RegExp(`Classification: <strong>${label}</strong>`, 'u'));
  }
  assert.match(html, /Exact catalog match/u);
  assert.match(html, /Ambiguous exact matches/u);
  assert.match(html, /Possible catalog matches/u);
  assert.match(html, /More matches exist than are shown/u);
  assert.equal((html.match(/No suggested catalog candidate/g) || []).length, 2);
  assert.equal((html.match(/type="radio"/g) || []).length, 4);
  assert.doesNotMatch(html, /type="radio"[^>]*checked/u);
  for (const kind of ['exact', 'ambiguous', 'possible', 'none', 'unparsed']) {
    assert.match(html, new RegExp(`aria-label="Manual catalog Ingredient for ${kind} source"`, 'u'));
  }
});

test('rendered resolver exposes loading lock plus safe error and retry states', () => {
  const entry = resolutionEntry('exact', 0, [{
    ingredient: { id: '1', name: 'Rice', category: 'pantry' }, matchedOn: 'name', matchedText: 'Rice',
  }]);
  const base = { unresolvedIngredients: [entry], ingredientResolutionGeneration: 1 };
  const loading = renderToStaticMarkup(createElement(IngredientResolutionPanel, {
    state: { ...base, ingredientResolutionStatus: 'loading', ingredientResolutionError: '' }, dispatch() {}, busy: false,
  }));
  assert.match(loading, /Finding matches/u);
  assert.match(loading, /type="radio"[^>]*disabled/u);
  assert.match(loading, /aria-label="Manual catalog Ingredient for exact source"[^>]*disabled/u);
  assert.match(loading, /<label>Quantity<input[^>]*disabled/u);
  assert.match(loading, /<label>Unit<select[^>]*disabled/u);
  assert.match(loading, /Confirm ingredient<\/button>/u);
  assert.match(loading, /<button[^>]*disabled=""[^>]*>Confirm ingredient<\/button>/u);

  const failed = renderToStaticMarkup(createElement(IngredientResolutionPanel, {
    state: { ...base, ingredientResolutionStatus: 'idle', ingredientResolutionError: 'Safe resolver error' }, dispatch() {}, busy: false,
  }));
  assert.match(failed, /role="alert">Safe resolver error/u);
  assert.match(failed, /Retry catalog matches/u);
});

test('manual picker selection dispatches the canonical Ingredient through the rendered panel handler', async () => {
  const { initialAuthoringState, recipeAuthoringReducer } = await vite.ssrLoadModule('/src/recipeAuthoring/recipeAuthoringState.js');
  let state = recipeAuthoringReducer(initialAuthoringState(), {
    type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['unmatched source'],
  });
  const dispatch = (action) => { state = recipeAuthoringReducer(state, action); };
  const panel = IngredientResolutionPanel({ state, dispatch, busy: false });
  const picker = findElementMatching(panel, (element) => element.props?.ariaLabel === 'Manual catalog Ingredient for unmatched source');
  assert.ok(picker, 'the rendered resolution row must expose its manual Ingredient picker');

  picker.props.onChange({ id: 'ingredient-1', name: 'Rice' });

  assert.deepEqual(state.unresolvedIngredients[0].selectedIngredient, { id: 'ingredient-1', name: 'Rice' });
});

test('resolver request failure is safe and a retry can succeed for the same generation', async () => {
  const { initialAuthoringState, recipeAuthoringReducer } = await vite.ssrLoadModule('/src/recipeAuthoring/recipeAuthoringState.js');
  let state = recipeAuthoringReducer(initialAuthoringState(), {
    type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['1 cup rice'],
  });
  const dispatch = (action) => { state = recipeAuthoringReducer(state, action); };
  await requestIngredientResolutions({
    queue: state.unresolvedIngredients, generation: state.ingredientResolutionGeneration, dispatch,
    request: async () => { throw new Error('Catalog temporarily unavailable'); },
  });
  assert.equal(state.ingredientResolutionStatus, 'idle');
  assert.equal(state.ingredientResolutionError, 'Catalog temporarily unavailable');
  const failed = renderToStaticMarkup(createElement(IngredientResolutionPanel, { state, dispatch, busy: false }));
  assert.match(failed, /role="alert">Catalog temporarily unavailable/u);
  assert.match(failed, /Retry catalog matches/u);

  await requestIngredientResolutions({
    queue: state.unresolvedIngredients, generation: state.ingredientResolutionGeneration, dispatch,
    request: async () => [{
      index: 0, sourceText: '1 cup rice', parsed: { quantity: 1, unit: 'cup', name: 'rice' },
      match: { kind: 'exact', totalCandidates: 1, truncated: false, candidates: [] },
    }],
  });
  assert.equal(state.ingredientResolutionStatus, 'idle');
  assert.equal(state.ingredientResolutionError, '');
  assert.equal(state.unresolvedIngredients[0].resolution.match.kind, 'exact');
  assert.equal(state.unresolvedIngredients[0].quantity, '1');
  assert.equal(state.unresolvedIngredients[0].unit, 'cup');
});

test('in-flight resolver locks entry mutation until its response attaches to the original line', async () => {
  const { initialAuthoringState, recipeAuthoringReducer } = await vite.ssrLoadModule('/src/recipeAuthoring/recipeAuthoringState.js');
  let state = recipeAuthoringReducer(initialAuthoringState(), {
    type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['1 cup rice'],
  });
  let settle;
  const deferred = new Promise((resolve) => { settle = resolve; });
  const dispatch = (action) => { state = recipeAuthoringReducer(state, action); };
  const pending = requestIngredientResolutions({
    queue: state.unresolvedIngredients, generation: state.ingredientResolutionGeneration, dispatch,
    request: () => deferred,
  });
  assert.equal(state.ingredientResolutionStatus, 'loading');

  dispatch({ type: 'UPDATE_INGREDIENT_RESOLUTION', index: 0, patch: {
    selectedIngredient: { id: 'wrong', name: 'Wrong' }, quantity: '9', unit: 'kg',
  } });
  dispatch({ type: 'CONFIRM_INGREDIENT_RESOLUTION', index: 0 });
  assert.equal(state.unresolvedIngredients.length, 1);
  assert.equal(state.unresolvedIngredients[0].selectedIngredient, null);
  assert.equal(state.form.ingredients[0].ingredient, null);

  settle([{ index: 0, sourceText: '1 cup rice', parsed: { quantity: 1, unit: 'cup', name: 'rice' },
    match: { kind: 'exact', totalCandidates: 1, truncated: false, candidates: [] } }]);
  await pending;
  assert.equal(state.ingredientResolutionStatus, 'idle');
  assert.equal(state.unresolvedIngredients[0].sourceText, '1 cup rice');
  assert.equal(state.unresolvedIngredients[0].resolution.match.kind, 'exact');
  assert.equal(state.unresolvedIngredients[0].selectedIngredient, null);
  assert.equal(state.unresolvedIngredients[0].quantity, '1');
  assert.equal(state.unresolvedIngredients[0].unit, 'cup');
});
