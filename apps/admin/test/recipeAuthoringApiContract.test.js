import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/recipeApi.js', import.meta.url), 'utf8');
test('Staff Portal authoring uses Draft, PATCH, publish, and lifecycle command endpoints', () => {
  assert.match(source, /post\('\/recipes\/drafts'/);
  assert.match(source, /patch\(`\/recipes\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(source, /post\(`\/recipes\/\$\{encodeURIComponent\(id\)\}\/publish`/);
  assert.match(source, /const body = expectedUpdatedAt \? \{ expectedUpdatedAt \} : \{\}/);
  assert.doesNotMatch(source, /export function createRecipe/);
  assert.doesNotMatch(source, /api\.post\('\/recipes',/);
});
