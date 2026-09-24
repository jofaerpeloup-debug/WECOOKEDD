import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveRecipeAndRefresh,
  createDraftAndRefresh,
  publishRecipeAndRefresh,
  restoreRecipeAndRefresh,
  updateRecipeAndRefresh,
} from '../src/recipeCatalogMutations.js';

const recipe = { id: 'recipe-1', title: 'Adobo', updatedAt: 'v2' };

async function expectMutationRefresh(run, expectedArgs) {
  const calls = [];
  const mutate = async (...args) => {
    calls.push(['mutate', ...args]);
    return recipe;
  };
  const refresh = (updated) => calls.push(['refresh', updated]);

  assert.equal(await run(refresh, mutate), recipe);
  assert.deepEqual(calls, [['mutate', ...expectedArgs], ['refresh', recipe]]);
}

test('create invalidates the recipe catalog after the mutation succeeds', async () => {
  const body = { title: 'Adobo' };
  await expectMutationRefresh(
    (refresh, mutate) => createDraftAndRefresh(body, refresh, mutate),
    [body],
  );
});

test('update invalidates the recipe catalog after the mutation succeeds', async () => {
  const body = { title: 'New title', expectedUpdatedAt: 'v1' };
  await expectMutationRefresh(
    (refresh, mutate) => updateRecipeAndRefresh('recipe-1', body, refresh, mutate),
    ['recipe-1', body],
  );
});

test('publish invalidates the recipe catalog after the mutation succeeds', async () => {
  const body = { confirmFilipinoCuisine: true, expectedUpdatedAt: 'v1' };
  await expectMutationRefresh(
    (refresh, mutate) => publishRecipeAndRefresh('recipe-1', body, refresh, mutate),
    ['recipe-1', body],
  );
});

test('archive invalidates the recipe catalog after the mutation succeeds', async () => {
  await expectMutationRefresh(
    (refresh, mutate) => archiveRecipeAndRefresh('recipe-1', 'v1', refresh, mutate),
    ['recipe-1', 'v1'],
  );
});

test('restore invalidates the recipe catalog after the mutation succeeds', async () => {
  await expectMutationRefresh(
    (refresh, mutate) => restoreRecipeAndRefresh('recipe-1', 'v1', refresh, mutate),
    ['recipe-1', 'v1'],
  );
});

test('draft creation invalidates immediately even when later upload or PATCH work fails', async () => {
  const events = [];
  const created = await createDraftAndRefresh(
    { title: 'Adobo' },
    () => events.push('refresh'),
    async () => {
      events.push('create');
      return recipe;
    },
  );

  await assert.rejects(async () => {
    events.push('upload-or-patch');
    throw new Error('later failure');
  }, /later failure/);

  assert.equal(created, recipe);
  assert.deepEqual(events, ['create', 'refresh', 'upload-or-patch']);
});

test('failed mutations do not report a catalog refresh', async () => {
  let refreshes = 0;
  await assert.rejects(
    createDraftAndRefresh({}, () => { refreshes += 1; }, async () => { throw new Error('failed'); }),
    /failed/,
  );
  assert.equal(refreshes, 0);
});
