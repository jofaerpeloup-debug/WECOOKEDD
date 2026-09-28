import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

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
  { default: RecipeAuthoringSteps },
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
  assert.match(steps, /onImport=\{importFromUrl\}/u);
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
