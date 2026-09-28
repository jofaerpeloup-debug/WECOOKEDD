process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_JSONLD_BYTES,
  extractRecipeJsonLd,
} = require('../src/modules/recipes/recipe-jsonld-extractor');

function html(...scripts) {
  return `<!doctype html><html><head>${scripts.map((body) => `<script type="application/ld+json; charset=utf-8">${body}</script>`).join('')}</head><body><script>globalThis.executed = true</script><img src="https://never-requested.test/a.jpg"><style>body{color:red}</style></body></html>`;
}

async function rejectsCode(markup, code) {
  await assert.rejects(() => extractRecipeJsonLd(markup), (error) => error.code === code);
}

test('extracts one raw Recipe from direct, array, and @graph documents without executing page content', async () => {
  globalThis.executed = false;
  const direct = { '@type': 'Recipe', name: 'Adobo', unknownRemoteField: { retained: true } };
  assert.deepEqual(await extractRecipeJsonLd(html(JSON.stringify(direct))), direct);
  assert.deepEqual(
    await extractRecipeJsonLd(html(JSON.stringify([{ '@type': 'Organization' }, { '@type': ['Thing', 'Recipe'], name: 'Sinigang' }]))),
    { '@type': ['Thing', 'Recipe'], name: 'Sinigang' }
  );
  assert.deepEqual(
    await extractRecipeJsonLd(html(JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Recipe', name: 'Kare-kare' }] }))),
    { '@type': 'Recipe', name: 'Kare-kare' }
  );
  assert.equal(globalThis.executed, false);
});

test('combines script blocks, ignores empty and unrelated blocks, and rejects zero or multiple candidates', async () => {
  const one = await extractRecipeJsonLd(html('  ', JSON.stringify({ '@type': 'Organization' }), JSON.stringify({ '@type': 'Recipe', name: 'One' })));
  assert.equal(one.name, 'One');
  await rejectsCode(html(JSON.stringify({ '@type': 'Organization' })), 'RECIPE_IMPORT_NO_RECIPE');
  await rejectsCode(html(JSON.stringify([{ '@type': 'Recipe' }, { '@type': ['Recipe', 'Thing'] }])), 'RECIPE_IMPORT_MULTIPLE_RECIPES');
  await rejectsCode(html(JSON.stringify({ '@type': 'Recipe' }), JSON.stringify({ '@graph': [{ '@type': 'Recipe' }] })), 'RECIPE_IMPORT_MULTIPLE_RECIPES');
});

test('fails closed on every malformed nonblank JSON-LD block, including beside a valid Recipe', async () => {
  await rejectsCode(html('{ nope'), 'RECIPE_IMPORT_JSONLD_INVALID');
  await rejectsCode(html(JSON.stringify({ '@type': 'Recipe' }), '{ nope'), 'RECIPE_IMPORT_JSONLD_INVALID');
});

test('enforces aggregate JSON-LD and serialized candidate byte limits at the exact boundary', async () => {
  const exactText = ' '.repeat(MAX_JSONLD_BYTES - 4) + 'null';
  await rejectsCode(html(exactText), 'RECIPE_IMPORT_NO_RECIPE');
  await rejectsCode(html(`${exactText} `), 'RECIPE_IMPORT_JSONLD_TOO_LARGE');

  const overhead = Buffer.byteLength(JSON.stringify({ '@type': 'Recipe', value: '' }));
  const exactCandidate = { '@type': 'Recipe', value: 'a'.repeat(MAX_JSONLD_BYTES - overhead) };
  assert.equal(Buffer.byteLength(JSON.stringify(exactCandidate)), MAX_JSONLD_BYTES);
  assert.deepEqual(await extractRecipeJsonLd(html(JSON.stringify(exactCandidate))), exactCandidate);

  const oversizedCandidate = { '@type': 'Recipe', value: 'a'.repeat(MAX_JSONLD_BYTES - overhead + 1) };
  const encoded = JSON.stringify(oversizedCandidate);
  await assert.rejects(
    () => extractRecipeJsonLd('<html></html>', { parseHtml: () => ({
      childNodes: [{
        tagName: 'script', attrs: [{ name: 'type', value: 'application/ld+json' }],
        childNodes: [{ nodeName: '#text', value: encoded }],
      }],
    }) }),
    (error) => error.code === 'RECIPE_IMPORT_JSONLD_TOO_LARGE'
  );
});

test('only exact application/ld+json script types are inspected', async () => {
  const candidate = JSON.stringify({ '@type': 'Recipe', name: 'Valid' });
  const markup = `<script type="text/javascript">${candidate}</script><script type="APPLICATION/LD+JSON ; profile=x">${candidate}</script>`;
  assert.equal((await extractRecipeJsonLd(markup)).name, 'Valid');
});
