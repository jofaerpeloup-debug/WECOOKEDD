import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recipesTabSource = readFileSync(
  new URL('../src/RecipesTab.jsx', import.meta.url),
  'utf8'
).replace(/\r\n/g, '\n');
const recipeApiSource = readFileSync(
  new URL('../src/recipeApi.js', import.meta.url),
  'utf8'
).replace(/\r\n/g, '\n');
const executableRecipeApiSource = recipeApiSource
  .replace(/\/\*\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

const recipesTabComponentSource = sourceBetween(
  recipesTabSource,
  'export default function RecipesTab(',
  '// ---------------------------------------------------------------------------\n// Create / edit modal'
);
const recipeModalSource = recipesTabSource.slice(
  recipesTabSource.indexOf('function RecipeModal(')
);
const recipeFormSource = sourceBetween(
  recipeModalSource,
  '<form onSubmit={submit}>',
  '</form>'
);
const createPayloadSource = sourceBetween(
  recipeModalSource,
  'if (!editing) {',
  '// PATCH:'
);
const editPatchSource = sourceBetween(
  recipeModalSource,
  '// PATCH:',
  'const submit = async (e) => {'
);
const submitSource = sourceBetween(
  recipeModalSource,
  'const submit = async (e) => {',
  'const hasUnavailable ='
);

test('active Add Recipe form renders a clearly labelled create-only confirmation before its actions', () => {
  assert.match(recipesTabComponentSource, /onClick=\{\(\) => setModal\('new'\)\}/);
  assert.match(
    recipesTabComponentSource,
    /\{canWrite && modal && \([\s\S]*<RecipeModal[\s\S]*recipe=\{modal === 'new' \? null : modal\}/
  );

  const confirmation = sourceBetween(
    recipeFormSource,
    '{!editing && (\n            <div className="wc-rcp-confirmation">',
    '{formError && ('
  );
  assert.match(confirmation, /id="confirm-filipino-cuisine"/);
  assert.match(confirmation, /type="checkbox"/);
  assert.match(confirmation, /checked=\{form\.confirmFilipinoCuisine\}/);
  assert.match(
    confirmation,
    /onChange=\{\(e\) => setField\(\{ confirmFilipinoCuisine: e\.target\.checked \}\)\}/
  );
  assert.match(confirmation, /I confirm that this recipe belongs to Filipino cuisine\./);
  assert.match(
    recipesTabSource,
    /\.wc-rcp-confirmation\s*\{[\s\S]*padding:[^;]+;[\s\S]*border:[^;]+;[\s\S]*background:[^;]+;/
  );
  assert.match(
    recipesTabSource,
    /\.wc-rcp-confirmation-label\s*\{[\s\S]*display:\s*flex;/
  );
  assert.ok(
    recipeFormSource.indexOf('wc-rcp-confirmation') < recipeFormSource.indexOf('wc-modal-actions'),
    'confirmation must appear before the final Cancel/Add recipe actions'
  );
});

test('each fresh Add Recipe modal starts unchecked and closing it discards that state', () => {
  assert.match(recipeModalSource, /useState\(\(\) => \(\{[\s\S]*confirmFilipinoCuisine:\s*false,[\s\S]*\}\)\)/);
  assert.match(recipesTabComponentSource, /onClose=\{\(\) => setModal\(null\)\}/);
  assert.match(recipesTabComponentSource, /\{canWrite && modal && \(/);
});

test('unchecked create is rejected inline before upload or create submission can run', () => {
  assert.match(
    recipeModalSource,
    /!editing && form\.confirmFilipinoCuisine !== true[\s\S]*errs\.confirmFilipinoCuisine\s*=\s*[\s\S]*before publishing\./
  );

  const validationIndex = submitSource.indexOf('const errs = validate();');
  const blockedReturnIndex = submitSource.indexOf('return;', validationIndex);
  const uploadIndex = submitSource.indexOf('await uploadRecipeImage(');
  const requestIndex = submitSource.indexOf('await onSubmit(payload, form.isActive);');
  assert.ok(validationIndex >= 0);
  assert.ok(blockedReturnIndex > validationIndex);
  assert.ok(uploadIndex > blockedReturnIndex);
  assert.ok(requestIndex > blockedReturnIndex);
});

test('checked React state flows through the complete create request without hard-coding', () => {
  assert.match(createPayloadSource, /confirmFilipinoCuisine:\s*form\.confirmFilipinoCuisine/);
  assert.match(submitSource, /await onSubmit\(payload, form\.isActive\)/);
  assert.match(recipesTabComponentSource, /if \(modal === 'new'\) await create\(payload\)/);
  assert.match(recipesTabSource, /createRecipe\(values\)/);
  assert.match(recipeApiSource, /confirmFilipinoCuisine,[\s\S]*const body = \{/);
  assert.match(recipeApiSource, /imageAssetId,[\s\S]*confirmFilipinoCuisine,/);
  assert.doesNotMatch(executableRecipeApiSource, /confirmFilipinoCuisine:\s*true/);
});

test('normal edit neither renders nor validates nor sends the create acknowledgement', () => {
  assert.match(recipeFormSource, /\{!editing && \([\s\S]*wc-rcp-confirmation/);
  assert.match(recipeModalSource, /if \(!editing && form\.confirmFilipinoCuisine !== true\)/);
  assert.doesNotMatch(editPatchSource, /confirmFilipinoCuisine/);
});
