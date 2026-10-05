process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const recipeRepository = require('../src/modules/recipes/recipe.repository');
const ingredientService = require('../src/modules/ingredients/ingredient.service');
const recipeService = require('../src/modules/recipes/recipe.service');
const {
  createDraftSchema,
  createRecipeSchema,
  updateRecipeSchema,
  publishRecipeSchema,
  publishedRecipeBodySchema,
  legacyPublishedRecipeBodySchema,
} = require('../src/modules/recipes/recipe.validation');
const { toPublicRecipe, toStaffRecipe } = require('../src/modules/recipes/recipe.serializer');
const Recipe = require('../src/modules/recipes/recipe.model');

const RECIPE_ID = '507f1f77bcf86cd799439099';
const MODERATOR_ID = '507f1f77bcf86cd799439001';
const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const UPDATED_AT = new Date('2026-09-15T10:00:00.000Z');

function fullRecipe(overrides = {}) {
  return {
    _id: RECIPE_ID,
    title: 'Chicken Adobo',
    description: 'A complete Filipino recipe.',
    difficulty: 'easy',
    prepTimeMinutes: 10,
    cookTimeMinutes: 30,
    servings: 4,
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', optional: false }],
    instructions: ['Simmer until tender.'],
    dietaryTags: [],
    imageUrl: null,
    imageAssetId: null,
    isActive: true,
    publicationStatus: 'draft',
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function publishedBody(overrides = {}) {
  const { _id, isActive, publicationStatus, updatedAt, ...body } = fullRecipe(overrides);
  return body;
}

function populated(recipe) {
  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).map((entry) => ({
      ...entry,
      ingredientId: { _id: INGREDIENT_ID, name: 'Chicken', isActive: true },
    })),
  };
}

test('Draft validation accepts title-only and empty sections but rejects malformed persisted values', () => {
  assert.equal(createDraftSchema.safeParse({ body: { title: 'Draft Adobo' } }).success, true);
  assert.equal(createDraftSchema.safeParse({ body: { title: 'Draft', ingredients: [], instructions: [] } }).success, true);
  assert.equal(
    createDraftSchema.safeParse({
      body: { title: 'Draft', ingredients: [{ ingredientId: 'bad', quantity: 1, unit: 'kg' }] },
    }).success,
    false
  );
  assert.equal(createDraftSchema.safeParse({ body: { title: 'Draft', instructions: [' '] } }).success, false);
});

test('new-write title validation normalizes whitespace and enforces Unicode-aware product rules', () => {
  const parseTitle = (title) => createDraftSchema.safeParse({ body: { title } });
  for (const title of ['A', '1', '12', '@@@', '!!', '   ']) {
    assert.equal(parseTitle(title).success, false, title);
  }
  for (const title of ['Ab', 'Chicken Adobo', '7-Minute Egg', 'Fish & Chips', 'Crème brûlée', 'Paksiw #2']) {
    assert.equal(parseTitle(title).success, true, title);
  }
  const normalized = parseTitle('  Crème   brûlée  ');
  assert.equal(normalized.success, true);
  assert.equal(normalized.data.body.title, 'Crème brûlée');
  assert.equal(parseTitle(`Ab${'x'.repeat(148)}`).success, true);
  assert.equal(parseTitle(`Ab${'x'.repeat(149)}`).success, false);
  assert.equal(updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { title: '7' } }).success, false);
});

test('new-write instruction validation is Unicode-aware for instructions and structured steps', () => {
  const draftInstructions = (instructions) => createDraftSchema.safeParse({ body: { title: 'Ab', instructions } });
  const draftSteps = (steps) => createDraftSchema.safeParse({ body: { title: 'Ab', steps } });
  assert.equal(draftInstructions([]).success, true);
  for (const text of ['A', '12', '@@', '   ', '@@@']) {
    assert.equal(draftInstructions([text]).success, false, text);
    assert.equal(draftSteps([{ order: 1, text }]).success, false, `step: ${text}`);
  }
  for (const text of ['Mix', 'Añade', 'Add 2 cups of water.', 'Bake at 180°C.']) {
    assert.equal(draftInstructions([text]).success, true, text);
    assert.equal(draftSteps([{ order: 1, text }]).success, true, `step: ${text}`);
  }
  assert.equal(draftInstructions(['A'.repeat(1000)]).success, true);
  assert.equal(draftInstructions(['A'.repeat(1001)]).success, false);

  const complete = publishedBody();
  assert.equal(publishedRecipeBodySchema.safeParse({ ...complete, instructions: [] }).success, false);
  assert.equal(publishedRecipeBodySchema.safeParse({ ...complete, instructions: ['Mix'] }).success, true);
});

test('new-write prep and cook time boundaries enforce optional prep and 3-minute cooking minimum', () => {
  const params = { recipeId: RECIPE_ID };
  for (const value of [0, -1, 1.5, 101]) {
    assert.equal(updateRecipeSchema.safeParse({ params, body: { servings: value } }).success, false, `servings ${value}`);
  }
  for (const value of [1, 100]) {
    assert.equal(updateRecipeSchema.safeParse({ params, body: { servings: value } }).success, true, `servings ${value}`);
  }
  assert.equal(createDraftSchema.safeParse({ body: { title: 'Draft' } }).success, true);
  for (const value of [0, -1, 1.5, 1441, '1']) assert.equal(updateRecipeSchema.safeParse({ params, body: { prepTimeMinutes: value } }).success, false, `prep ${value}`);
  for (const value of [1, 1440]) assert.equal(updateRecipeSchema.safeParse({ params, body: { prepTimeMinutes: value } }).success, true, `prep ${value}`);
  for (const value of [0, 1, 2, -1, 1.5, 1441, '3']) assert.equal(updateRecipeSchema.safeParse({ params, body: { cookTimeMinutes: value } }).success, false, `cook ${value}`);
  for (const value of [3, 60, 90, 1440]) assert.equal(updateRecipeSchema.safeParse({ params, body: { cookTimeMinutes: value } }).success, true, `cook ${value}`);

  const withoutPrep = publishedBody({ prepTimeMinutes: undefined });
  assert.equal(publishedRecipeBodySchema.safeParse(withoutPrep).success, true);
  assert.equal(publishedRecipeBodySchema.safeParse({ ...withoutPrep, cookTimeMinutes: undefined }).success, false);
  assert.equal(publishedRecipeBodySchema.safeParse({ ...withoutPrep, cookTimeMinutes: 2 }).success, false);
  assert.equal(publishedRecipeBodySchema.safeParse({ ...withoutPrep, cookTimeMinutes: 3 }).success, true);

  const ingredientBody = (quantity, unit = 'g') => ({
    title: 'Ab',
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity, unit }],
  });
  for (const quantity of [0, -1]) {
    assert.equal(createDraftSchema.safeParse({ body: ingredientBody(quantity) }).success, false, `quantity ${quantity}`);
  }
  assert.equal(createDraftSchema.safeParse({ body: ingredientBody(0.25) }).success, true);
  assert.equal(createDraftSchema.safeParse({ body: ingredientBody(undefined, 'toTaste') }).success, true);
  assert.equal(createDraftSchema.safeParse({ body: ingredientBody(1, 'toTaste') }).success, false);
});

test('legacy completeness accepts stored zero times and optional prep for consumer visibility', async (t) => {
  const legacy = publishedBody({ prepTimeMinutes: 0, cookTimeMinutes: 0 });
  assert.equal(legacyPublishedRecipeBodySchema.safeParse(legacy).success, true);
  assert.equal(publishedRecipeBodySchema.safeParse(legacy).success, false);

  let current = populated(fullRecipe({ prepTimeMinutes: 0, cookTimeMinutes: 0 }));
  delete current.publicationStatus;
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => current);
  assert.ok(await recipeService.findUsableRecipeById(RECIPE_ID));

  current = populated(fullRecipe({ prepTimeMinutes: undefined, cookTimeMinutes: 3, publicationStatus: 'published' }));
  assert.ok(await recipeService.findUsableRecipeById(RECIPE_ID));
});

test('ingredient API remains numeric and preserves decimals and toTaste semantics', () => {
  const ingredientBody = (quantity, unit = 'g') => ({
    title: 'Ab',
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity, unit }],
  });
  for (const quantity of [0, -1]) {
    assert.equal(createDraftSchema.safeParse({ body: ingredientBody(quantity) }).success, false, `quantity ${quantity}`);
  }
  assert.equal(createDraftSchema.safeParse({ body: ingredientBody(0.25) }).success, true);
  assert.equal(createDraftSchema.safeParse({ body: ingredientBody(undefined, 'toTaste') }).success, true);
  assert.equal(createDraftSchema.safeParse({ body: ingredientBody(1, 'toTaste') }).success, false);
});

test('legacy completeness remains permissive while every new complete-recipe write uses the new rules', () => {
  const legacy = publishedBody({ title: 'A', instructions: ['Go'] });
  assert.equal(legacyPublishedRecipeBodySchema.safeParse(legacy).success, true);
  assert.equal(publishedRecipeBodySchema.safeParse(legacy).success, false);
  assert.equal(createRecipeSchema.safeParse({
    body: { ...legacy, confirmFilipinoCuisine: true },
  }).success, false);
});

test('Recipe model declares independent publication metadata without a legacy-changing default and additive indexes', () => {
  const publication = Recipe.schema.path('publicationStatus');
  assert.deepEqual(publication.options.enum, ['draft', 'published']);
  assert.equal(publication.options.default, undefined);
  for (const field of ['createdBy', 'updatedBy', 'publishedBy']) {
    assert.equal(Recipe.schema.path(field).options.ref, 'User');
  }
  assert.equal(Recipe.schema.path('publishedAt').instance, 'Date');
  const indexes = Recipe.schema.indexes().map(([spec]) => spec);
  assert.ok(indexes.some((spec) => spec.isActive === 1 && spec.publicationStatus === 1 && spec.createdAt === -1));
  assert.equal(indexes.some((spec) => spec.publishedAt === -1), false);
  assert.ok(indexes.some((spec) => spec.publicationStatus === 1 && spec.isActive === 1 && spec.updatedAt === -1));
});

test('generic PATCH rejects lifecycle and server-owned attribution mass assignment', () => {
  for (const field of ['publicationStatus', 'isActive', 'createdBy', 'updatedBy', 'publishedBy', 'publishedAt', 'nutritionProvenance', 'nutritionAcceptedAt']) {
    assert.equal(
      updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { [field]: field === 'isActive' ? false : 'x' } }).success,
      false,
      field
    );
  }
  assert.equal(
    updateRecipeSchema.safeParse({
      params: { recipeId: RECIPE_ID },
      body: { expectedUpdatedAt: UPDATED_AT.toISOString() },
    }).success,
    false
  );
});

test('PATCH validation strictly permits null only for Draft-optional scalar clears', () => {
  const params = { recipeId: RECIPE_ID };
  for (const field of ['description', 'difficulty', 'prepTimeMinutes', 'cookTimeMinutes', 'servings']) {
    assert.equal(updateRecipeSchema.safeParse({ params, body: { [field]: null } }).success, true, field);
  }
  for (const [field, value] of [
    ['title', null],
    ['ingredients', null],
    ['instructions', null],
    ['dietaryTags', null],
    ['publicationStatus', null],
    ['updatedBy', null],
  ]) {
    assert.equal(updateRecipeSchema.safeParse({ params, body: { [field]: value } }).success, false, field);
  }
});

test('publish validation requires explicit Filipino-cuisine confirmation', () => {
  const params = { recipeId: RECIPE_ID };
  assert.equal(publishRecipeSchema.safeParse({ params, body: {} }).success, false);
  assert.equal(publishRecipeSchema.safeParse({ params, body: { confirmFilipinoCuisine: false } }).success, false);
  assert.equal(publishRecipeSchema.safeParse({ params, body: { confirmFilipinoCuisine: true } }).success, true);
});

test('createDraft explicitly stores Draft state and server-owned creator/updater attribution', async (t) => {
  let persisted;
  t.mock.method(recipeRepository, 'createRecipe', async (doc) => {
    persisted = doc;
    return populated(doc);
  });

  await recipeService.createDraft({ title: '  Draft   Adobo  ', ingredients: [], instructions: [] }, { actorId: MODERATOR_ID });

  assert.equal(persisted.title, 'Draft Adobo');
  assert.equal(persisted.publicationStatus, 'draft');
  assert.equal(persisted.isActive, true);
  assert.equal(persisted.createdBy, MODERATOR_ID);
  assert.equal(persisted.updatedBy, MODERATOR_ID);
  assert.deepEqual(persisted.ingredients, []);
  assert.deepEqual(persisted.instructions, []);
});

test('consumer eligibility hides Drafts while preserving otherwise-usable legacy recipes', async (t) => {
  const draft = populated(fullRecipe());
  let current = draft;
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => current);

  assert.equal(await recipeService.findUsableRecipeById(RECIPE_ID), null);
  await assert.rejects(() => recipeService.getRecipeById(RECIPE_ID, { isAdmin: false }), { code: 'RECIPE_NOT_FOUND' });

  current = { ...draft };
  delete current.publicationStatus;
  assert.ok(await recipeService.findUsableRecipeById(RECIPE_ID));

  current = populated(fullRecipe({ title: 'A', instructions: ['Go'] }));
  delete current.publicationStatus;
  assert.ok(await recipeService.findUsableRecipeById(RECIPE_ID));
});

test('service normalization enforces new title and instruction rules even without request middleware', async (t) => {
  let existing = fullRecipe({ ingredients: [], instructions: [] });
  let update;
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(recipeRepository, 'updateById', async (id, operations) => {
    update = operations;
    return { ...existing, ...operations.$set };
  });
  await assert.rejects(() => recipeService.createDraft({ title: '1' }, { actorId: MODERATOR_ID }), { code: 'RECIPE_INCOMPLETE' });
  await assert.rejects(
    () => recipeService.updateRecipe(RECIPE_ID, { instructions: ['12'] }, { actorId: MODERATOR_ID }),
    { code: 'RECIPE_INCOMPLETE' }
  );
  await assert.rejects(
    () => recipeService.updateRecipe(RECIPE_ID, { prepTimeMinutes: 0 }, { actorId: MODERATOR_ID }),
    { code: 'RECIPE_INCOMPLETE' }
  );
  await assert.rejects(
    () => recipeService.updateRecipe(RECIPE_ID, { cookTimeMinutes: 2 }, { actorId: MODERATOR_ID }),
    { code: 'RECIPE_INCOMPLETE' }
  );

  existing = fullRecipe({ title: 'A', instructions: ['Go'], publicationStatus: 'published' });
  await recipeService.updateRecipe(RECIPE_ID, { description: 'Legacy recipe repair.' }, { actorId: MODERATOR_ID });
  assert.equal(update.$set.description, 'Legacy recipe repair.');
});

test('consumer list/detail/usability fail closed for incomplete legacy and explicit Published records', async (t) => {
  let current = populated(fullRecipe());
  delete current.publicationStatus;
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => current);
  t.mock.method(recipeRepository, 'findMany', async () => [current]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  async function assertConsumerVisibility(visible) {
    const usable = await recipeService.findUsableRecipeById(RECIPE_ID);
    if (visible) {
      assert.ok(usable);
      assert.ok(await recipeService.getRecipeById(RECIPE_ID, { isAdmin: false }));
    } else {
      assert.equal(usable, null);
      await assert.rejects(
        () => recipeService.getRecipeById(RECIPE_ID, { isAdmin: false }),
        { code: 'RECIPE_NOT_FOUND' }
      );
    }
    const listed = await recipeService.listRecipes({
      status: 'active', page: 1, limit: 20, sort: 'newest', isAdmin: false,
    });
    assert.equal(listed.items.length, visible ? 1 : 0);
  }

  await assertConsumerVisibility(true);

  for (const malformed of [
    { description: '   ' },
    { difficulty: undefined },
    { instructions: [] },
    { instructions: undefined },
    { publicationStatus: 'published', description: undefined },
    { publicationStatus: 'draft' },
    { publicationStatus: 'published', isActive: false },
  ]) {
    current = populated(fullRecipe(malformed));
    if (!Object.hasOwn(malformed, 'publicationStatus')) delete current.publicationStatus;
    await assertConsumerVisibility(false);
  }
});

test('consumer list query requests Published-or-legacy records while staff can inspect Drafts', async (t) => {
  const draft = populated(fullRecipe());
  const seen = [];
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => {
    seen.push(filter);
    return [draft];
  });
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const consumer = await recipeService.listRecipes({ status: 'active', page: 1, limit: 20, sort: 'newest', isAdmin: false });
  const staff = await recipeService.listRecipes({ status: 'active', page: 1, limit: 20, sort: 'newest', isAdmin: true });

  assert.deepEqual(consumer.items, []);
  assert.equal(staff.items.length, 1);
  assert.deepEqual(seen[0].$and[0].$or, [
    { publicationStatus: 'published' },
    { publicationStatus: { $exists: false } },
  ]);
  assert.equal(seen[1].$and, undefined);
});

test('newest/oldest retain pre-M20 createdAt ordering while consumer publication filtering remains active', async (t) => {
  const seen = [];
  t.mock.method(recipeRepository, 'findMany', async ({ filter, sort }) => {
    seen.push({ filter, sort });
    return [];
  });
  t.mock.method(recipeRepository, 'countByFilter', async () => 0);

  await recipeService.listRecipes({ status: 'active', page: 1, limit: 20, sort: 'newest', isAdmin: false });
  await recipeService.listRecipes({ status: 'active', page: 1, limit: 20, sort: 'oldest', isAdmin: false });

  assert.deepEqual(seen[0].sort, { createdAt: -1 });
  assert.deepEqual(seen[1].sort, { createdAt: 1 });
  assert.ok(seen.every(({ filter }) => filter.$and[0].$or.some((term) => term.publicationStatus === 'published')));
});

test('publish validates completeness and ingredients, then atomically stamps actor and first publication time', async (t) => {
  const firstPublishedAt = new Date('2026-09-16T01:00:00.000Z');
  const existingPublishedAt = new Date('2026-09-01T01:00:00.000Z');
  const draft = fullRecipe({ publishedAt: existingPublishedAt });
  let transition;
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => ({
    candidates: [], candidateUniverseCount: 0, comparedCount: 0, truncated: false,
  }));
  t.mock.method(ingredientService, 'findIngredientById', async () => ({ _id: INGREDIENT_ID, isActive: true }));
  t.mock.method(recipeRepository, 'publishById', async (id, args) => {
    transition = { id, ...args };
    return populated({ ...draft, publicationStatus: 'published', publishedBy: args.actorId, publishedAt: args.publishedAt });
  });

  const result = await recipeService.publishRecipe(
    RECIPE_ID,
    { expectedUpdatedAt: UPDATED_AT.toISOString() },
    { actorId: MODERATOR_ID, now: firstPublishedAt }
  );

  assert.equal(result.publicationStatus, 'published');
  assert.equal(transition.actorId, MODERATOR_ID);
  assert.equal(transition.publishedAt, existingPublishedAt);
  assert.equal(transition.expectedUpdatedAt, UPDATED_AT.toISOString());
});

test('publish rejects an incomplete Draft and optimistic PATCH returns controlled conflict', async (t) => {
  let existing = fullRecipe({ description: undefined });
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  await assert.rejects(() => recipeService.publishRecipe(RECIPE_ID, {}, { actorId: MODERATOR_ID }), { code: 'RECIPE_INCOMPLETE' });

  existing = fullRecipe();
  await assert.rejects(
    () => recipeService.updateRecipe(RECIPE_ID, { title: 'Changed', expectedUpdatedAt: '2026-09-14T10:00:00.000Z' }, { actorId: MODERATOR_ID }),
    { code: 'RECIPE_EDIT_CONFLICT', statusCode: 409 }
  );
});

test('publish applies new title and instruction rules to otherwise complete Drafts', async (t) => {
  let existing = fullRecipe({ title: 'A' });
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  await assert.rejects(() => recipeService.publishRecipe(RECIPE_ID, {}, { actorId: MODERATOR_ID }), { code: 'RECIPE_INCOMPLETE' });

  existing = fullRecipe({ instructions: ['Go'] });
  await assert.rejects(() => recipeService.publishRecipe(RECIPE_ID, {}, { actorId: MODERATOR_ID }), { code: 'RECIPE_INCOMPLETE' });
});

test('Draft partial edits may remain incomplete; Published edits may not empty required arrays', async (t) => {
  let existing = fullRecipe({ ingredients: [], instructions: [] });
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(recipeRepository, 'updateById', async (id, update) => ({ _id: id, ...existing, ...update.$set }));

  const draft = await recipeService.updateRecipe(RECIPE_ID, { description: 'Still drafting.' }, { actorId: MODERATOR_ID });
  assert.equal(draft.description, 'Still drafting.');

  existing = fullRecipe({ publicationStatus: 'published' });
  await assert.rejects(
    () => recipeService.updateRecipe(RECIPE_ID, { instructions: [] }, { actorId: MODERATOR_ID }),
    { code: 'RECIPE_INCOMPLETE' }
  );
});

test('Draft null clears become whitelisted $unset operations and retain the concurrency token', async (t) => {
  const existing = fullRecipe();
  let mutation;
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(recipeRepository, 'updateById', async (id, update, options) => {
    mutation = { id, update, options };
    return populated({ ...existing, description: undefined, difficulty: undefined });
  });

  await recipeService.updateRecipe(RECIPE_ID, {
    description: null,
    difficulty: null,
    expectedUpdatedAt: UPDATED_AT.toISOString(),
  }, { actorId: MODERATOR_ID });

  assert.deepEqual(mutation.update.$unset, { description: '', difficulty: '' });
  assert.equal(mutation.update.$set.updatedBy, MODERATOR_ID);
  assert.equal(mutation.options.expectedUpdatedAt, UPDATED_AT.toISOString());
});

test('Published recipes allow optional prep clears but reject required scalar clears', async (t) => {
  let existing = fullRecipe({ publicationStatus: 'published' });
  let updates = 0;
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(recipeRepository, 'updateById', async () => { updates += 1; return existing; });

  await assert.doesNotReject(
    () => recipeService.updateRecipe(RECIPE_ID, { prepTimeMinutes: null }, { actorId: MODERATOR_ID })
  );
  await assert.rejects(
    () => recipeService.updateRecipe(RECIPE_ID, { description: null }, { actorId: MODERATOR_ID }),
    { code: 'RECIPE_INCOMPLETE' }
  );

  existing = fullRecipe();
  delete existing.publicationStatus;
  await assert.doesNotReject(
    () => recipeService.updateRecipe(RECIPE_ID, { prepTimeMinutes: null }, { actorId: MODERATOR_ID })
  );
  await assert.rejects(
    () => recipeService.updateRecipe(RECIPE_ID, { servings: null }, { actorId: MODERATOR_ID }),
    { code: 'RECIPE_INCOMPLETE' }
  );
  assert.equal(updates, 2);
});

test('archive preserves publication state and Draft restore does not require publish completeness', async (t) => {
  t.mock.method(recipeRepository, 'archiveById', async () => populated(fullRecipe({ isActive: false })));
  const archived = await recipeService.archiveRecipe(RECIPE_ID, {}, { actorId: MODERATOR_ID });
  assert.equal(archived.publicationStatus, 'draft');

  t.mock.method(recipeRepository, 'findRawById', async () => fullRecipe({ isActive: false, ingredients: [], instructions: [] }));
  let restoreArgs;
  t.mock.method(recipeRepository, 'restoreById', async (id, args) => {
    restoreArgs = args;
    return populated(fullRecipe({ isActive: true, ingredients: [], instructions: [] }));
  });
  const restored = await recipeService.restoreRecipe(RECIPE_ID, {}, { actorId: MODERATOR_ID });
  assert.equal(restored.isActive, true);
  assert.equal(restored.publicationStatus, 'draft');
  assert.equal(restoreArgs.expectedUpdatedAt, UPDATED_AT.toISOString());
});

test('restore rejects stale supplied and post-validation concurrent snapshots with controlled conflict', async (t) => {
  const existing = fullRecipe({ isActive: false, ingredients: [], instructions: [] });
  let restoreCalls = 0;
  let restoreArgs;
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(recipeRepository, 'restoreById', async (id, args) => {
    restoreCalls += 1;
    restoreArgs = args;
    return null;
  });

  await assert.rejects(
    () => recipeService.restoreRecipe(
      RECIPE_ID,
      { expectedUpdatedAt: '2026-09-14T10:00:00.000Z' },
      { actorId: MODERATOR_ID }
    ),
    { code: 'RECIPE_EDIT_CONFLICT', statusCode: 409 }
  );
  assert.equal(restoreCalls, 0);

  await assert.rejects(
    () => recipeService.restoreRecipe(RECIPE_ID, {}, { actorId: MODERATOR_ID }),
    { code: 'RECIPE_EDIT_CONFLICT', statusCode: 409 }
  );
  assert.equal(restoreCalls, 1);
  assert.equal(restoreArgs.expectedUpdatedAt, UPDATED_AT.toISOString());
});

test('serializers never expose policy acknowledgement and consumer serialization hides attribution', () => {
  const recipe = populated(fullRecipe({
    createdBy: MODERATOR_ID,
    updatedBy: MODERATOR_ID,
    confirmFilipinoCuisine: true,
  }));
  const consumer = toPublicRecipe(recipe);
  const staff = toStaffRecipe(recipe);
  assert.equal('createdBy' in consumer, false);
  assert.equal('publicationStatus' in consumer, false);
  assert.equal('confirmFilipinoCuisine' in consumer, false);
  assert.equal('confirmFilipinoCuisine' in staff, false);
  assert.equal(staff.createdBy, MODERATOR_ID);
  assert.equal(staff.publicationStatus, 'draft');
});
