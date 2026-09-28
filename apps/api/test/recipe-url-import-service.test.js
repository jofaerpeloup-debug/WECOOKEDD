process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecipeUrlImportService } = require('../src/modules/recipes/recipe-url-import.service');

test('returns only final source URL and the raw extracted candidate', async () => {
  const candidate = { '@type': 'Recipe', name: 'Adobo', unsupported: { retained: true } };
  const service = createRecipeUrlImportService({
    fetchPage: async (url) => ({ sourceUrl: `${url}/final`, html: '<bounded html>' }),
    extractCandidate: async (markup) => {
      assert.equal(markup, '<bounded html>');
      return candidate;
    },
  });
  assert.deepEqual(await service('https://example.com'), {
    sourceUrl: 'https://example.com/final',
    candidate,
  });
});

test('global single-flight gate rejects a concurrent import and releases after success', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = createRecipeUrlImportService({
    fetchPage: async () => { await blocked; return { sourceUrl: 'https://example.com', html: 'x' }; },
    extractCandidate: async () => ({ '@type': 'Recipe' }),
  });
  const first = service('https://example.com');
  await assert.rejects(() => service('https://example.org'), (error) => error.statusCode === 503 && error.code === 'RECIPE_IMPORT_BUSY');
  release();
  await first;
  await assert.doesNotReject(() => service('https://example.net'));
});

test('global single-flight gate releases after failure', async () => {
  let fail = true;
  const service = createRecipeUrlImportService({
    fetchPage: async () => {
      if (fail) { fail = false; throw new Error('safe test failure'); }
      return { sourceUrl: 'https://example.com', html: 'x' };
    },
    extractCandidate: async () => ({ '@type': 'Recipe' }),
  });
  await assert.rejects(() => service('https://example.com'));
  await assert.doesNotReject(() => service('https://example.com'));
});
