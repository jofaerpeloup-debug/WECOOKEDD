process.env.NODE_ENV = 'test';
process.env.PORT = '4021';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const ingredientRepository = require('../src/modules/ingredients/ingredient.repository');
const Ingredient = require('../src/modules/ingredients/ingredient.model');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const substitutionRepository = require('../src/modules/substitutions/substitution.repository');
const ingredientService = require('../src/modules/ingredients/ingredient.service');
const { AppError } = require('../src/shared/errors/app-error');

function mockDependencies(t, { recipe = false, substitution = false } = {}) {
  t.mock.method(recipeRepository, 'hasActiveConsumerRecipeUsingIngredient', async () => recipe);
  t.mock.method(substitutionRepository, 'hasActiveSubstitutionUsingIngredient', async () => substitution);
}

test('createIngredient normalizes the name (case/whitespace) and delegates to the repository', async (t) => {
  let capturedArgs;
  t.mock.method(ingredientRepository, 'createIngredient', async (args) => {
    capturedArgs = args;
    return { _id: 'ing1', ...args, isActive: true };
  });

  await ingredientService.createIngredient({
    name: '  Brown   Sugar  ',
    category: 'sweetener',
  });

  assert.equal(capturedArgs.name, 'Brown   Sugar');
  assert.equal(capturedArgs.normalizedName, 'brown sugar');
});

test('createIngredient trims aliases, collapses whitespace, and drops case-insensitive duplicates', async (t) => {
  let capturedArgs;
  t.mock.method(ingredientRepository, 'createIngredient', async (args) => {
    capturedArgs = args;
    return { _id: 'ing1', ...args, isActive: true };
  });

  await ingredientService.createIngredient({
    name: 'Sugar',
    category: 'sweetener',
    aliases: ['  Caster Sugar ', 'caster sugar', 'Superfine Sugar'],
  });

  assert.deepEqual(capturedArgs.aliases, ['Caster Sugar', 'Superfine Sugar']);
});

test('createIngredient deduplicates allergenTags', async (t) => {
  let capturedArgs;
  t.mock.method(ingredientRepository, 'createIngredient', async (args) => {
    capturedArgs = args;
    return { _id: 'ing1', ...args, isActive: true };
  });

  await ingredientService.createIngredient({
    name: 'Milk',
    category: 'dairy',
    allergenTags: ['milk', 'milk'],
  });

  assert.deepEqual(capturedArgs.allergenTags, ['milk']);
});

test('createIngredient translates a MongoDB duplicate-key error into INGREDIENT_ALREADY_EXISTS', async (t) => {
  t.mock.method(ingredientRepository, 'createIngredient', async () => {
    const err = new Error('E11000 duplicate key error index: normalizedName_1');
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () => ingredientService.createIngredient({ name: 'Butter', category: 'dairy' }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'INGREDIENT_ALREADY_EXISTS');
      return true;
    }
  );
});

test('createIngredient rethrows unrelated repository errors as-is', async (t) => {
  t.mock.method(ingredientRepository, 'createIngredient', async () => {
    throw new Error('unexpected database failure');
  });

  await assert.rejects(
    () => ingredientService.createIngredient({ name: 'Butter', category: 'dairy' }),
    /unexpected database failure/
  );
});

test('findIngredientById delegates to the repository and returns null for a missing ingredient (no throw)', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async () => null);
  const result = await ingredientService.findIngredientById('missing');
  assert.equal(result, null);
});

test('updateByIdIfActiveState ties an Ingredient update to the observed isActive value', async (t) => {
  let captured;
  t.mock.method(Ingredient, 'findOneAndUpdate', (filter, update, options) => {
    captured = { filter, update, options };
    return { _id: 'ing1', isActive: false };
  });

  await ingredientRepository.updateByIdIfActiveState(
    'ing1',
    true,
    { $set: { name: 'Updated Name', isActive: false } },
    { runValidators: true }
  );

  assert.deepEqual(captured.filter, { _id: 'ing1', isActive: true });
  assert.deepEqual(captured.update, { $set: { name: 'Updated Name', isActive: false } });
  assert.deepEqual(captured.options, { returnDocument: 'after', runValidators: true });
});

test('getIngredientById returns an active ingredient for a non-admin caller', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async () => ({ _id: 'ing1', isActive: true }));
  const ingredient = await ingredientService.getIngredientById('ing1', { isAdmin: false });
  assert.equal(ingredient._id, 'ing1');
});

test('getIngredientById hides an archived ingredient from a non-admin caller behind 404', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async () => ({ _id: 'ing1', isActive: false }));

  await assert.rejects(
    () => ingredientService.getIngredientById('ing1', { isAdmin: false }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'INGREDIENT_NOT_FOUND');
      return true;
    }
  );
});

test('getIngredientById allows an admin to retrieve an archived ingredient', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async () => ({ _id: 'ing1', isActive: false }));
  const ingredient = await ingredientService.getIngredientById('ing1', { isAdmin: true });
  assert.equal(ingredient.isActive, false);
});

test('getIngredientById throws INGREDIENT_NOT_FOUND when nothing matches', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async () => null);
  await assert.rejects(
    () => ingredientService.getIngredientById('missing', { isAdmin: true }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_NOT_FOUND');
      return true;
    }
  );
});

test('listIngredients rejects status=inactive for a non-admin caller', async (t) => {
  await assert.rejects(
    () =>
      ingredientService.listIngredients({
        status: 'inactive',
        page: 1,
        limit: 20,
        sort: 'nameAsc',
        isAdmin: false,
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
});

test('listIngredients rejects status=all for a non-admin caller', async (t) => {
  await assert.rejects(() =>
    ingredientService.listIngredients({
      status: 'all',
      page: 1,
      limit: 20,
      sort: 'nameAsc',
      isAdmin: false,
    })
  );
});

test('listIngredients allows an admin to request status=all', async (t) => {
  let capturedFilter;
  t.mock.method(ingredientRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(ingredientRepository, 'countByFilter', async () => 0);

  await ingredientService.listIngredients({
    status: 'all',
    page: 1,
    limit: 20,
    sort: 'nameAsc',
    isAdmin: true,
  });

  assert.equal('isActive' in capturedFilter, false);
});

test('listIngredients defaults to filtering isActive: true for status=active', async (t) => {
  let capturedFilter;
  t.mock.method(ingredientRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(ingredientRepository, 'countByFilter', async () => 0);

  await ingredientService.listIngredients({
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'nameAsc',
    isAdmin: false,
  });

  assert.equal(capturedFilter.isActive, true);
});

test('listIngredients applies category and allergen filters', async (t) => {
  let capturedFilter;
  t.mock.method(ingredientRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(ingredientRepository, 'countByFilter', async () => 0);

  await ingredientService.listIngredients({
    status: 'active',
    category: 'dairy',
    allergen: 'milk',
    page: 1,
    limit: 20,
    sort: 'nameAsc',
    isAdmin: false,
  });

  assert.equal(capturedFilter.category, 'dairy');
  assert.equal(capturedFilter.allergenTags, 'milk');
});

test('listIngredients builds an escaped case-insensitive regex for search across name and aliases', async (t) => {
  let capturedFilter;
  t.mock.method(ingredientRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(ingredientRepository, 'countByFilter', async () => 0);

  await ingredientService.listIngredients({
    status: 'active',
    search: 'sug.ar+',
    page: 1,
    limit: 20,
    sort: 'nameAsc',
    isAdmin: false,
  });

  assert.equal(capturedFilter.$or.length, 2);
  const namePattern = capturedFilter.$or[0].name;
  assert.ok(namePattern instanceof RegExp);
  // The regex-special characters in the search text must be escaped, so
  // they're matched literally rather than as wildcard/quantifier syntax.
  assert.equal(namePattern.test('Sugar'), false);
  assert.equal(namePattern.test('sug.ar+'), true);
});

test('listIngredients paginates using skip derived from page/limit', async (t) => {
  let capturedArgs;
  t.mock.method(ingredientRepository, 'findMany', async (args) => {
    capturedArgs = args;
    return [];
  });
  t.mock.method(ingredientRepository, 'countByFilter', async () => 45);

  const result = await ingredientService.listIngredients({
    status: 'active',
    page: 3,
    limit: 10,
    sort: 'nameAsc',
    isAdmin: false,
  });

  assert.equal(capturedArgs.skip, 20);
  assert.equal(capturedArgs.limit, 10);
  assert.equal(result.total, 45);
});

test('updateIngredient recomputes normalizedName when name changes', async (t) => {
  let capturedUpdate;
  t.mock.method(ingredientRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, isActive: true };
  });

  await ingredientService.updateIngredient('ing1', { name: '  Caster   Sugar ' });

  assert.equal(capturedUpdate.$set.name, 'Caster   Sugar');
  assert.equal(capturedUpdate.$set.normalizedName, 'caster sugar');
});

test('updateIngredient only sets fields present in the patch', async (t) => {
  let capturedUpdate;
  t.mock.method(ingredientRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, isActive: true };
  });

  await ingredientService.updateIngredient('ing1', { isActive: true });

  assert.deepEqual(Object.keys(capturedUpdate.$set), ['isActive']);
});

test('updateIngredient throws INGREDIENT_NOT_FOUND when no document matches', async (t) => {
  t.mock.method(ingredientRepository, 'updateById', async () => null);

  await assert.rejects(
    () => ingredientService.updateIngredient('missing', { name: 'X' }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_NOT_FOUND');
      assert.equal(err.statusCode, 404);
      return true;
    }
  );
});

test('updateIngredient translates a duplicate-key error into INGREDIENT_ALREADY_EXISTS', async (t) => {
  t.mock.method(ingredientRepository, 'updateById', async () => {
    const err = new Error('E11000 duplicate key error index: normalizedName_1');
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () => ingredientService.updateIngredient('ing1', { name: 'Butter' }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_ALREADY_EXISTS');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

// Concrete rename-collision scenario: Ingredient A = "Brown Sugar",
// Ingredient B = "Caster Sugar" already exists. Renaming A to a
// differently-cased/whitespaced string that normalizes to the same value as
// B's normalizedName must (a) send the exact same normalizedName createIngredient
// would compute for "Caster Sugar", and (b) surface the resulting unique-index
// collision as the same stable 409 as a duplicate on create — proving update
// normalization and create normalization are not two independently
// maintained implementations that could drift apart.
test('updateIngredient renaming "Brown Sugar" to a variant of "Caster Sugar" computes the identical normalizedName a fresh create of "Caster Sugar" would, and a collision with the existing B is reported as INGREDIENT_ALREADY_EXISTS', async (t) => {
  let capturedCreateArgs;
  t.mock.method(ingredientRepository, 'createIngredient', async (args) => {
    capturedCreateArgs = args;
    return { _id: 'ingB', ...args, isActive: true };
  });
  await ingredientService.createIngredient({ name: 'Caster Sugar', category: 'sweetener' });

  let capturedUpdate;
  t.mock.method(ingredientRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    // Simulates MongoDB's unique index on normalizedName rejecting the
    // update because it now collides with Ingredient B's stored value.
    const err = new Error('E11000 duplicate key error index: normalizedName_1 dup key: { normalizedName: "caster sugar" }');
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () => ingredientService.updateIngredient('ingA', { name: '  CASTER   SUGAR  ' }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_ALREADY_EXISTS');
      assert.equal(err.statusCode, 409);
      assert.equal(err.message.includes('E11000'), false);
      assert.equal(err.message.includes('normalizedName_1'), false);
      return true;
    }
  );

  // The normalizedName the update path computed and sent to Mongo is
  // exactly what create would have computed for "Caster Sugar" — this is
  // *why* the unique index would actually catch the collision in a real
  // database, not just why the mocked error happens to match.
  assert.equal(capturedUpdate.$set.normalizedName, capturedCreateArgs.normalizedName);
  assert.equal(capturedUpdate.$set.normalizedName, 'caster sugar');
});

test('archiveIngredient allows an unused active Ingredient to be archived', async (t) => {
  let archivedId;
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, isActive: true }));
  mockDependencies(t);
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async (id, expectedIsActive, update) => {
    archivedId = id;
    assert.equal(expectedIsActive, true);
    return { _id: id, ...update.$set };
  });

  const ingredient = await ingredientService.archiveIngredient('ing1');
  assert.equal(archivedId, 'ing1');
  assert.equal(ingredient.isActive, false);
});

test('archiveIngredient throws INGREDIENT_NOT_FOUND when no document matches', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async () => null);

  await assert.rejects(
    () => ingredientService.archiveIngredient('missing'),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_NOT_FOUND');
      return true;
    }
  );
});

for (const { label, recipe, substitution, details } of [
  {
    label: 'an active Published Recipe required usage',
    recipe: true,
    substitution: false,
    details: { recipe: true, substitution: false },
  },
  {
    label: 'an active Published Recipe optional usage',
    recipe: true,
    substitution: false,
    details: { recipe: true, substitution: false },
  },
  {
    label: 'an active legacy consumer-visible Recipe usage',
    recipe: true,
    substitution: false,
    details: { recipe: true, substitution: false },
  },
  {
    label: 'an active Substitution source usage',
    recipe: false,
    substitution: true,
    details: { recipe: false, substitution: true },
  },
  {
    label: 'an active Substitution substitute usage',
    recipe: false,
    substitution: true,
    details: { recipe: false, substitution: true },
  },
]) {
  test(`archiveIngredient rejects ${label} without calling the mutation repository`, async (t) => {
    t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, isActive: true }));
    mockDependencies(t, { recipe, substitution });
    let mutationCalled = false;
    t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async () => {
      mutationCalled = true;
      return null;
    });

    await assert.rejects(
      () => ingredientService.archiveIngredient('ing1'),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'INGREDIENT_HAS_ACTIVE_DEPENDENCIES');
        assert.deepEqual(err.details, details);
        return true;
      }
    );
    assert.equal(mutationCalled, false);
  });
}

for (const label of [
  'active Draft Recipe-only references',
  'archived Published Recipe-only references',
  'archived Draft Recipe-only references',
  'archived Substitution-only references',
  'Shopping List history-only references',
]) {
  test(`archiveIngredient allows ${label}`, async (t) => {
    t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, isActive: true }));
    mockDependencies(t);
    t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async (id, expectedIsActive, update) => ({
      _id: id,
      ...update.$set,
    }));

    const ingredient = await ingredientService.archiveIngredient('ing1');
    assert.equal(ingredient.isActive, false);
  });
}

test('archiveIngredient preserves already-inactive behavior without dependency checks', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, isActive: false }));
  t.mock.method(recipeRepository, 'hasActiveConsumerRecipeUsingIngredient', async () => {
    assert.fail('Recipe dependencies must not be checked for an already-inactive Ingredient.');
  });
  t.mock.method(substitutionRepository, 'hasActiveSubstitutionUsingIngredient', async () => {
    assert.fail('Substitution dependencies must not be checked for an already-inactive Ingredient.');
  });
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async (id, expectedIsActive, update) => {
    assert.equal(expectedIsActive, false);
    return { _id: id, ...update.$set };
  });

  const ingredient = await ingredientService.archiveIngredient('ing1');
  assert.equal(ingredient.isActive, false);
});

test('updateIngredient blocks an active-to-inactive PATCH atomically before applying other fields', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, isActive: true }));
  mockDependencies(t, { recipe: true });
  let mutationCalled = false;
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async () => {
    mutationCalled = true;
    return null;
  });

  await assert.rejects(
    () => ingredientService.updateIngredient('ing1', { name: 'Updated Name', isActive: false }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_HAS_ACTIVE_DEPENDENCIES');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
  assert.equal(mutationCalled, false);
});

test('updateIngredient preserves an already-inactive PATCH without dependency checks', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, isActive: false }));
  t.mock.method(recipeRepository, 'hasActiveConsumerRecipeUsingIngredient', async () => {
    assert.fail('Recipe dependencies must not be checked for an already-inactive Ingredient.');
  });
  t.mock.method(substitutionRepository, 'hasActiveSubstitutionUsingIngredient', async () => {
    assert.fail('Substitution dependencies must not be checked for an already-inactive Ingredient.');
  });
  let capturedUpdate;
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async (id, expectedIsActive, update) => {
    assert.equal(expectedIsActive, false);
    capturedUpdate = update;
    return { _id: id, ...update.$set };
  });

  const ingredient = await ingredientService.updateIngredient('ing1', {
    name: 'Updated Name',
    isActive: false,
  });
  assert.equal(ingredient.isActive, false);
  assert.equal(capturedUpdate.$set.name, 'Updated Name');
});

test('updateIngredient applies one complete active-to-inactive PATCH after both dependency checks pass', async (t) => {
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, isActive: true }));
  let recipeChecks = 0;
  let substitutionChecks = 0;
  t.mock.method(recipeRepository, 'hasActiveConsumerRecipeUsingIngredient', async () => {
    recipeChecks += 1;
    return false;
  });
  t.mock.method(substitutionRepository, 'hasActiveSubstitutionUsingIngredient', async () => {
    substitutionChecks += 1;
    return false;
  });
  let conditionalWrites = 0;
  let captured;
  t.mock.method(
    ingredientRepository,
    'updateByIdIfActiveState',
    async (id, expectedIsActive, update, options) => {
      conditionalWrites += 1;
      captured = { id, expectedIsActive, update, options };
      return { _id: id, ...update.$set };
    }
  );
  t.mock.method(ingredientRepository, 'updateById', async () => {
    assert.fail('A deactivation PATCH must not fall back to an unconditional update.');
  });

  const ingredient = await ingredientService.updateIngredient('ing1', {
    name: 'Updated Name',
    isActive: false,
  });

  assert.equal(recipeChecks, 1);
  assert.equal(substitutionChecks, 1);
  assert.equal(conditionalWrites, 1);
  assert.deepEqual(captured, {
    id: 'ing1',
    expectedIsActive: true,
    update: {
      $set: {
        name: 'Updated Name',
        normalizedName: 'updated name',
        isActive: false,
      },
    },
    options: { runValidators: true },
  });
  assert.equal(ingredient.name, 'Updated Name');
  assert.equal(ingredient.isActive, false);
});

test('updateIngredient reevaluates dependencies when an inactive observation loses to concurrent reactivation', async (t) => {
  const observedStates = [false, true];
  t.mock.method(ingredientRepository, 'findById', async (id) => ({
    _id: id,
    isActive: observedStates.shift(),
  }));
  let recipeChecks = 0;
  let substitutionChecks = 0;
  t.mock.method(recipeRepository, 'hasActiveConsumerRecipeUsingIngredient', async () => {
    recipeChecks += 1;
    return true;
  });
  t.mock.method(substitutionRepository, 'hasActiveSubstitutionUsingIngredient', async () => {
    substitutionChecks += 1;
    return false;
  });
  let conditionalWrites = 0;
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async (id, expectedIsActive) => {
    conditionalWrites += 1;
    assert.equal(expectedIsActive, false);
    return null;
  });
  t.mock.method(ingredientRepository, 'updateById', async () => {
    assert.fail('A lost conditional deactivation must not use an unconditional update.');
  });

  await assert.rejects(
    () => ingredientService.updateIngredient('ing1', { name: 'Updated Name', isActive: false }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_HAS_ACTIVE_DEPENDENCIES');
      return true;
    }
  );

  assert.equal(conditionalWrites, 1);
  assert.equal(recipeChecks, 1);
  assert.equal(substitutionChecks, 1);
});

test('archiveIngredient reevaluates dependencies when an inactive observation loses to concurrent reactivation', async (t) => {
  const observedStates = [false, true];
  t.mock.method(ingredientRepository, 'findById', async (id) => ({
    _id: id,
    isActive: observedStates.shift(),
  }));
  let recipeChecks = 0;
  let substitutionChecks = 0;
  t.mock.method(recipeRepository, 'hasActiveConsumerRecipeUsingIngredient', async () => {
    recipeChecks += 1;
    return false;
  });
  t.mock.method(substitutionRepository, 'hasActiveSubstitutionUsingIngredient', async () => {
    substitutionChecks += 1;
    return true;
  });
  let conditionalWrites = 0;
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async (id, expectedIsActive) => {
    conditionalWrites += 1;
    assert.equal(expectedIsActive, false);
    return null;
  });
  t.mock.method(ingredientRepository, 'updateById', async () => {
    assert.fail('A lost conditional archive must not use an unconditional update.');
  });

  await assert.rejects(
    () => ingredientService.archiveIngredient('ing1'),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_HAS_ACTIVE_DEPENDENCIES');
      return true;
    }
  );

  assert.equal(conditionalWrites, 1);
  assert.equal(recipeChecks, 1);
  assert.equal(substitutionChecks, 1);
});

test('updateIngredient returns a controlled conflict after bounded conditional-write losses without an unconditional fallback', async (t) => {
  let reads = 0;
  t.mock.method(ingredientRepository, 'findById', async (id) => {
    reads += 1;
    return { _id: id, isActive: true };
  });
  mockDependencies(t);
  let conditionalWrites = 0;
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async () => {
    conditionalWrites += 1;
    return null;
  });
  t.mock.method(ingredientRepository, 'updateById', async () => {
    assert.fail('Repeated CAS loss must not fall back to an unconditional update.');
  });

  await assert.rejects(
    () => ingredientService.updateIngredient('ing1', { isActive: false }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'INGREDIENT_EDIT_CONFLICT');
      return true;
    }
  );

  assert.equal(conditionalWrites, 2);
  assert.equal(reads, 3);
});
