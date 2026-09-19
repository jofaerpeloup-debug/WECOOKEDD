process.env.NODE_ENV = 'test';
process.env.PORT = '4023';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const substitutionRepository = require('../src/modules/substitutions/substitution.repository');
const Substitution = require('../src/modules/substitutions/substitution.model');
const ingredientService = require('../src/modules/ingredients/ingredient.service');
const substitutionService = require('../src/modules/substitutions/substitution.service');
const { AppError } = require('../src/shared/errors/app-error');

const SOURCE_ID = '507f1f77bcf86cd799439011';
const SUBSTITUTE_ID = '507f1f77bcf86cd799439012';
const OTHER_ID = '507f1f77bcf86cd799439013';

function activeIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: true };
}

function inactiveIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: false };
}

test('substitution dependency lookup matches active source or substitute usage and excludes archived relationships', async (t) => {
  let capturedFilter;
  t.mock.method(Substitution, 'exists', async (filter) => {
    capturedFilter = filter;
    return { _id: 'sub1' };
  });

  const exists = await substitutionRepository.hasActiveSubstitutionUsingIngredient(SOURCE_ID);

  assert.equal(exists, true);
  assert.deepEqual(capturedFilter, {
    isActive: true,
    $or: [
      { sourceIngredientId: SOURCE_ID },
      { substituteIngredientId: SOURCE_ID },
    ],
  });
});

test('createSubstitution rejects an identical source/substitute id before touching the repository', async () => {
  await assert.rejects(
    () =>
      substitutionService.createSubstitution({
        sourceIngredientId: SOURCE_ID,
        substituteIngredientId: SOURCE_ID,
        ratio: { sourceAmount: 1, substituteAmount: 1 },
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'SUBSTITUTION_SAME_INGREDIENT');
      return true;
    }
  );
});

test('createSubstitution requires the source ingredient to exist', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => (id === SOURCE_ID ? null : activeIngredient(id)));

  await assert.rejects(
    () =>
      substitutionService.createSubstitution({
        sourceIngredientId: SOURCE_ID,
        substituteIngredientId: SUBSTITUTE_ID,
        ratio: { sourceAmount: 1, substituteAmount: 1 },
      }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'INGREDIENT_NOT_FOUND');
      return true;
    }
  );
});

test('createSubstitution requires the substitute ingredient to exist', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) =>
    id === SUBSTITUTE_ID ? null : activeIngredient(id)
  );

  await assert.rejects(
    () =>
      substitutionService.createSubstitution({
        sourceIngredientId: SOURCE_ID,
        substituteIngredientId: SUBSTITUTE_ID,
        ratio: { sourceAmount: 1, substituteAmount: 1 },
      }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_NOT_FOUND');
      return true;
    }
  );
});

test('createSubstitution rejects an inactive source ingredient', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) =>
    id === SOURCE_ID ? inactiveIngredient(id) : activeIngredient(id)
  );

  await assert.rejects(
    () =>
      substitutionService.createSubstitution({
        sourceIngredientId: SOURCE_ID,
        substituteIngredientId: SUBSTITUTE_ID,
        ratio: { sourceAmount: 1, substituteAmount: 1 },
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('createSubstitution rejects an inactive substitute ingredient', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) =>
    id === SUBSTITUTE_ID ? inactiveIngredient(id) : activeIngredient(id)
  );

  await assert.rejects(
    () =>
      substitutionService.createSubstitution({
        sourceIngredientId: SOURCE_ID,
        substituteIngredientId: SUBSTITUTE_ID,
        ratio: { sourceAmount: 1, substituteAmount: 1 },
      }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('createSubstitution succeeds when both ingredients exist and are active, normalizing contexts', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let capturedArgs;
  t.mock.method(substitutionRepository, 'createSubstitution', async (args) => {
    capturedArgs = args;
    return { _id: 'sub1', ...args };
  });

  await substitutionService.createSubstitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    contexts: ['Baking', 'baking', ' Frying '],
  });

  assert.deepEqual(capturedArgs.contexts, ['Baking', 'Frying']);
});

test('createSubstitution translates a duplicate-pair error into SUBSTITUTION_ALREADY_EXISTS', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  t.mock.method(substitutionRepository, 'createSubstitution', async () => {
    const err = new Error('E11000 duplicate key error index: sourceIngredientId_1_substituteIngredientId_1');
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () =>
      substitutionService.createSubstitution({
        sourceIngredientId: SOURCE_ID,
        substituteIngredientId: SUBSTITUTE_ID,
        ratio: { sourceAmount: 1, substituteAmount: 1 },
      }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'SUBSTITUTION_ALREADY_EXISTS');
      return true;
    }
  );
});

test('getSubstitutionById returns a usable substitution for a non-admin caller', async (t) => {
  t.mock.method(substitutionRepository, 'findByIdWithIngredients', async () => ({
    _id: 'sub1',
    isActive: true,
    sourceIngredientId: activeIngredient(SOURCE_ID),
    substituteIngredientId: activeIngredient(SUBSTITUTE_ID),
  }));

  const substitution = await substitutionService.getSubstitutionById('sub1', { isAdmin: false });
  assert.equal(substitution._id, 'sub1');
});

test('getSubstitutionById hides a substitution referencing an archived ingredient from a non-admin caller', async (t) => {
  t.mock.method(substitutionRepository, 'findByIdWithIngredients', async () => ({
    _id: 'sub1',
    isActive: true,
    sourceIngredientId: inactiveIngredient(SOURCE_ID),
    substituteIngredientId: activeIngredient(SUBSTITUTE_ID),
  }));

  await assert.rejects(
    () => substitutionService.getSubstitutionById('sub1', { isAdmin: false }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'SUBSTITUTION_NOT_FOUND');
      return true;
    }
  );
});

test('getSubstitutionById allows an admin to see an archived substitution', async (t) => {
  t.mock.method(substitutionRepository, 'findByIdWithIngredients', async () => ({
    _id: 'sub1',
    isActive: false,
    sourceIngredientId: activeIngredient(SOURCE_ID),
    substituteIngredientId: activeIngredient(SUBSTITUTE_ID),
  }));

  const substitution = await substitutionService.getSubstitutionById('sub1', { isAdmin: true });
  assert.equal(substitution.isActive, false);
});

test('listSubstitutions rejects status=inactive for a non-admin caller', async () => {
  await assert.rejects(
    () =>
      substitutionService.listSubstitutions({
        status: 'inactive',
        page: 1,
        limit: 20,
        sort: 'newest',
        isAdmin: false,
      }),
    (err) => {
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
});

test('listSubstitutions filters by sourceIngredientId — "what can replace this ingredient?"', async (t) => {
  let capturedFilter;
  t.mock.method(substitutionRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(substitutionRepository, 'countByFilter', async () => 0);

  await substitutionService.listSubstitutions({
    sourceIngredientId: SOURCE_ID,
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'newest',
    isAdmin: false,
  });

  assert.equal(capturedFilter.sourceIngredientId, SOURCE_ID);
});

test('listSubstitutions drops rows whose referenced ingredient is archived when status=active', async (t) => {
  t.mock.method(substitutionRepository, 'findMany', async () => [
    {
      _id: 'sub1',
      isActive: true,
      sourceIngredientId: activeIngredient(SOURCE_ID),
      substituteIngredientId: activeIngredient(SUBSTITUTE_ID),
    },
    {
      _id: 'sub2',
      isActive: true,
      sourceIngredientId: inactiveIngredient(OTHER_ID),
      substituteIngredientId: activeIngredient(SUBSTITUTE_ID),
    },
  ]);
  t.mock.method(substitutionRepository, 'countByFilter', async () => 2);

  const result = await substitutionService.listSubstitutions({
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'newest',
    isAdmin: false,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]._id, 'sub1');
});

test('listSubstitutions does not apply the archived-ingredient trim when an admin requests status=all', async (t) => {
  t.mock.method(substitutionRepository, 'findMany', async () => [
    {
      _id: 'sub2',
      isActive: false,
      sourceIngredientId: inactiveIngredient(OTHER_ID),
      substituteIngredientId: activeIngredient(SUBSTITUTE_ID),
    },
  ]);
  t.mock.method(substitutionRepository, 'countByFilter', async () => 1);

  const result = await substitutionService.listSubstitutions({
    status: 'all',
    page: 1,
    limit: 20,
    sort: 'newest',
    isAdmin: true,
  });

  assert.equal(result.items.length, 1);
});

test('updateSubstitution merges the patch with the existing document to check source !== substitute', async (t) => {
  t.mock.method(substitutionRepository, 'findRawById', async () => ({
    _id: 'sub1',
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    isActive: true,
  }));

  await assert.rejects(
    () => substitutionService.updateSubstitution('sub1', { substituteIngredientId: SOURCE_ID }),
    (err) => {
      assert.equal(err.code, 'SUBSTITUTION_SAME_INGREDIENT');
      return true;
    }
  );
});

test('updateSubstitution revalidates a newly referenced ingredient (exists + active)', async (t) => {
  t.mock.method(substitutionRepository, 'findRawById', async () => ({
    _id: 'sub1',
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    isActive: true,
  }));
  t.mock.method(ingredientService, 'findIngredientById', async (id) => inactiveIngredient(id));

  await assert.rejects(
    () => substitutionService.updateSubstitution('sub1', { substituteIngredientId: OTHER_ID }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('updateSubstitution does not revalidate an ingredient side that is not being changed', async (t) => {
  t.mock.method(substitutionRepository, 'findRawById', async () => ({
    _id: 'sub1',
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    isActive: true,
  }));
  let validatedIds = [];
  t.mock.method(ingredientService, 'findIngredientById', async (id) => {
    validatedIds.push(id);
    return activeIngredient(id);
  });
  t.mock.method(substitutionRepository, 'updateById', async (id, update) => ({ _id: id, ...update.$set }));

  await substitutionService.updateSubstitution('sub1', { notes: 'Just a note update.' });

  assert.deepEqual(validatedIds, []);
});

test('updateSubstitution reactivation revalidates both ingredients even if only one changed', async (t) => {
  t.mock.method(substitutionRepository, 'findRawById', async () => ({
    _id: 'sub1',
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    isActive: false,
  }));
  const validatedIds = [];
  t.mock.method(ingredientService, 'findIngredientById', async (id) => {
    validatedIds.push(id);
    return activeIngredient(id);
  });
  t.mock.method(substitutionRepository, 'updateById', async (id, update) => ({ _id: id, ...update.$set }));

  await substitutionService.updateSubstitution('sub1', { isActive: true });

  assert.deepEqual(validatedIds.sort(), [SOURCE_ID, SUBSTITUTE_ID].sort());
});

test('updateSubstitution rejects reactivation when a referenced ingredient is no longer active', async (t) => {
  t.mock.method(substitutionRepository, 'findRawById', async () => ({
    _id: 'sub1',
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    isActive: false,
  }));
  t.mock.method(ingredientService, 'findIngredientById', async (id) =>
    id === SOURCE_ID ? inactiveIngredient(id) : activeIngredient(id)
  );

  await assert.rejects(
    () => substitutionService.updateSubstitution('sub1', { isActive: true }),
    (err) => {
      assert.equal(err.code, 'INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('updateSubstitution throws SUBSTITUTION_NOT_FOUND when the id does not exist', async (t) => {
  t.mock.method(substitutionRepository, 'findRawById', async () => null);

  await assert.rejects(
    () => substitutionService.updateSubstitution('missing', { notes: 'x' }),
    (err) => {
      assert.equal(err.code, 'SUBSTITUTION_NOT_FOUND');
      assert.equal(err.statusCode, 404);
      return true;
    }
  );
});

test('updateSubstitution translates a duplicate-pair error into SUBSTITUTION_ALREADY_EXISTS', async (t) => {
  t.mock.method(substitutionRepository, 'findRawById', async () => ({
    _id: 'sub1',
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    isActive: true,
  }));
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  t.mock.method(substitutionRepository, 'updateById', async () => {
    const err = new Error('E11000 duplicate key error');
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () => substitutionService.updateSubstitution('sub1', { substituteIngredientId: OTHER_ID }),
    (err) => {
      assert.equal(err.code, 'SUBSTITUTION_ALREADY_EXISTS');
      return true;
    }
  );
});

test('archiveSubstitution sets isActive: false via the repository', async (t) => {
  let archivedId;
  t.mock.method(substitutionRepository, 'archiveById', async (id) => {
    archivedId = id;
    return { _id: id, isActive: false };
  });

  const substitution = await substitutionService.archiveSubstitution('sub1');
  assert.equal(archivedId, 'sub1');
  assert.equal(substitution.isActive, false);
});

test('archiveSubstitution throws SUBSTITUTION_NOT_FOUND when no document matches', async (t) => {
  t.mock.method(substitutionRepository, 'archiveById', async () => null);

  await assert.rejects(
    () => substitutionService.archiveSubstitution('missing'),
    (err) => {
      assert.equal(err.code, 'SUBSTITUTION_NOT_FOUND');
      return true;
    }
  );
});
