const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  AUDIT_CONNECTION_OPTIONS,
  RECIPE_PROJECTION,
  SUBSTITUTION_PROJECTION,
  INGREDIENT_PROJECTION,
  parseArgs,
  classifyPublicationStatus,
  classifyActivity,
  buildPublishedValidationInput,
  readCatalogSnapshot,
  classifyRecipe,
  classifySubstitution,
  summarizeFindings,
  normalizeIngredientName,
  classifyIngredientAliasCollisions,
  summarizeIngredientAliasCollisions,
  classifyCatalogSnapshot,
  formatHumanReport,
  formatJsonReport,
  determineExitCode,
  runCatalogAuditCommand,
  executeCatalogAuditCli,
} = require('../scripts/audit-catalog-consistency');
const { publishedRecipeBodySchema } = require('../src/modules/recipes/recipe.validation');

const RECIPE_ID = '507f1f77bcf86cd799439010';
const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const OTHER_INGREDIENT_ID = '507f191e810c19729de860ea';
const SUBSTITUTION_ID = '507f1f77bcf86cd799439013';

function validRecipe(overrides = {}) {
  return {
    _id: RECIPE_ID,
    title: 'Chicken Adobo',
    description: 'A complete Filipino recipe.',
    difficulty: 'easy',
    prepTimeMinutes: 10,
    cookTimeMinutes: 30,
    servings: 4,
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', optional: false }],
    instructions: ['Cook until tender.'],
    dietaryTags: [],
    imageUrl: null,
    imageAssetId: null,
    isActive: true,
    publicationStatus: 'published',
    ...overrides,
  };
}

function legacyRecipe(overrides = {}) {
  const recipe = validRecipe(overrides);
  delete recipe.publicationStatus;
  return recipe;
}

function ingredient(id = INGREDIENT_ID, isActive = true, name = 'Chicken') {
  return { _id: id, name, isActive };
}

function ingredientMap(items = [ingredient()]) {
  return new Map(items.map((item) => [String(item._id), item]));
}

function substitution(overrides = {}) {
  return {
    _id: SUBSTITUTION_ID,
    isActive: true,
    sourceIngredientId: INGREDIENT_ID,
    substituteIngredientId: OTHER_INGREDIENT_ID,
    ...overrides,
  };
}

function snapshot({ recipes = [], substitutions = [], ingredients = [], ingredientCount = ingredients.length } = {}) {
  return {
    recipes,
    substitutions,
    ingredients,
    counts: { recipes: recipes.length, substitutions: substitutions.length, ingredients: ingredientCount },
  };
}

function codes(findings) {
  return findings.map((finding) => finding.code);
}

function relationshipFinding(recipe, ingredients) {
  return classifyRecipe(recipe, ingredientMap(ingredients))
    .find((finding) => finding.code === 'RECIPE_INGREDIENT_MISSING' || finding.code === 'RECIPE_INGREDIENT_INACTIVE');
}

function memoryWriter() {
  let value = '';
  return { write(chunk) { value += chunk; }, value() { return value; } };
}

test('publication lifecycle classifier distinguishes absence, valid values, and invalid explicit values', () => {
  assert.equal(classifyPublicationStatus({}), 'LEGACY_PUBLISHED');
  assert.equal(classifyPublicationStatus({ publicationStatus: 'published' }), 'PUBLISHED');
  assert.equal(classifyPublicationStatus({ publicationStatus: 'draft' }), 'DRAFT');
  assert.equal(classifyPublicationStatus({ publicationStatus: null }), 'INVALID_PUBLICATION_STATUS');
  assert.equal(classifyPublicationStatus({ publicationStatus: '' }), 'INVALID_PUBLICATION_STATUS');
  assert.equal(classifyPublicationStatus({ publicationStatus: 'publshed' }), 'INVALID_PUBLICATION_STATUS');
});

test('activity classifier accepts only exact booleans', () => {
  assert.equal(classifyActivity(true), 'ACTIVE');
  assert.equal(classifyActivity(false), 'ARCHIVED');
  for (const invalid of [undefined, null, 0, 1, 'true']) {
    assert.equal(classifyActivity(invalid), 'INVALID_ACTIVITY_STATE');
  }
});

test('published validation adapter selects schema fields, converts ObjectIds, and does not mutate source', () => {
  const objectId = new mongoose.Types.ObjectId(INGREDIENT_ID);
  const source = validRecipe({
    ingredients: [{ ingredientId: objectId, quantity: null, unit: 'toTaste', note: null, optional: true, _id: 'metadata' }],
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'private-attribution',
    __v: 4,
  });
  const input = buildPublishedValidationInput(source);
  assert.equal(input.ingredients[0].ingredientId, INGREDIENT_ID);
  assert.deepEqual(Object.keys(input.ingredients[0]).sort(), ['ingredientId', 'note', 'optional', 'quantity', 'unit']);
  for (const excluded of ['_id', 'createdAt', 'updatedAt', 'createdBy', '__v', 'isActive', 'publicationStatus']) {
    assert.equal(Object.hasOwn(input, excluded), false);
  }
  assert.ok(source.ingredients[0].ingredientId instanceof mongoose.Types.ObjectId);
  assert.equal(source.ingredients[0]._id, 'metadata');
  assert.equal(publishedRecipeBodySchema.safeParse(input).success, true);
});

test('recipe relationships follow the complete lifecycle and optionality severity matrix', () => {
  const cases = [
    ['active Published required active', validRecipe(), [ingredient()], undefined, undefined],
    ['active Published required inactive', validRecipe(), [ingredient(INGREDIENT_ID, false)], 'ERROR', 'RECIPE_INGREDIENT_INACTIVE'],
    ['active Published required missing', validRecipe(), [], 'ERROR', 'RECIPE_INGREDIENT_MISSING'],
    ['active Published optional inactive', validRecipe({ ingredients: [{ ingredientId: INGREDIENT_ID, unit: 'toTaste', optional: true }] }), [ingredient(INGREDIENT_ID, false)], 'WARNING', 'RECIPE_INGREDIENT_INACTIVE'],
    ['active Published optional missing', validRecipe({ ingredients: [{ ingredientId: INGREDIENT_ID, unit: 'toTaste', optional: true }] }), [], 'WARNING', 'RECIPE_INGREDIENT_MISSING'],
    ['active legacy required inactive', legacyRecipe(), [ingredient(INGREDIENT_ID, false)], 'ERROR', 'RECIPE_INGREDIENT_INACTIVE'],
    ['active legacy optional inactive', legacyRecipe({ ingredients: [{ ingredientId: INGREDIENT_ID, unit: 'toTaste', optional: true }] }), [ingredient(INGREDIENT_ID, false)], 'WARNING', 'RECIPE_INGREDIENT_INACTIVE'],
    ['active Draft inactive', validRecipe({ publicationStatus: 'draft' }), [ingredient(INGREDIENT_ID, false)], 'WARNING', 'RECIPE_INGREDIENT_INACTIVE'],
    ['active Draft missing', validRecipe({ publicationStatus: 'draft' }), [], 'WARNING', 'RECIPE_INGREDIENT_MISSING'],
    ['archived Published inactive', validRecipe({ isActive: false }), [ingredient(INGREDIENT_ID, false)], 'WARNING', 'RECIPE_INGREDIENT_INACTIVE'],
    ['archived Published missing', validRecipe({ isActive: false }), [], 'WARNING', 'RECIPE_INGREDIENT_MISSING'],
    ['archived Draft inactive', validRecipe({ isActive: false, publicationStatus: 'draft' }), [ingredient(INGREDIENT_ID, false)], 'INFO', 'RECIPE_INGREDIENT_INACTIVE'],
    ['archived Draft missing', validRecipe({ isActive: false, publicationStatus: 'draft' }), [], 'INFO', 'RECIPE_INGREDIENT_MISSING'],
  ];
  for (const [label, recipe, ingredients, severity, code] of cases) {
    const finding = relationshipFinding(recipe, ingredients);
    assert.equal(finding?.severity, severity, label);
    assert.equal(finding?.code, code, label);
  }
});

test('recipe missing and inactive relationships use distinct stable codes', () => {
  assert.equal(relationshipFinding(validRecipe(), []).code, 'RECIPE_INGREDIENT_MISSING');
  assert.equal(
    relationshipFinding(validRecipe(), [ingredient(INGREDIENT_ID, false)]).code,
    'RECIPE_INGREDIENT_INACTIVE'
  );
});

test('effective-Published structure is classified by activity and Drafts are not Published-validated', () => {
  const malformed = { description: undefined };
  const active = classifyRecipe(validRecipe(malformed), ingredientMap());
  const archived = classifyRecipe(validRecipe({ ...malformed, isActive: false }), ingredientMap());
  const draft = classifyRecipe(validRecipe({ ...malformed, publicationStatus: 'draft' }), ingredientMap());
  assert.equal(active.find((item) => item.code === 'RECIPE_PUBLISHED_STRUCTURE_INVALID').severity, 'ERROR');
  assert.equal(archived.find((item) => item.code === 'RECIPE_PUBLISHED_STRUCTURE_INVALID').severity, 'WARNING');
  assert.equal(codes(draft).includes('RECIPE_PUBLISHED_STRUCTURE_INVALID'), false);
});

test('invalid explicit publication state emits one lifecycle error and no fabricated relationship findings', () => {
  const findings = classifyRecipe(
    validRecipe({ publicationStatus: null, ingredients: [{ ingredientId: 'missing', unit: 'toTaste' }] }),
    new Map()
  );
  assert.deepEqual(codes(findings), ['RECIPE_PUBLICATION_STATUS_INVALID']);
  assert.equal(findings[0].severity, 'ERROR');
});

test('invalid Recipe activity state is an error and prevents lifecycle-dependent classification', () => {
  const findings = classifyRecipe(validRecipe({ isActive: 'yes' }), new Map());
  assert.deepEqual(codes(findings), ['RECIPE_ACTIVITY_STATE_INVALID']);
});

test('healthy legacy Recipe reports lifecycle debt while relationships use Published semantics', () => {
  const healthy = classifyRecipe(legacyRecipe(), ingredientMap());
  assert.deepEqual(codes(healthy), ['RECIPE_LEGACY_PUBLICATION_STATUS']);
  assert.equal(healthy[0].severity, 'INFO');
  const broken = classifyRecipe(legacyRecipe(), ingredientMap([ingredient(INGREDIENT_ID, false)]));
  assert.equal(broken.find((item) => item.code === 'RECIPE_INGREDIENT_INACTIVE').severity, 'ERROR');
});

test('Substitution classifications cover active, archived, both sides, and same-ingredient states', () => {
  const activePair = ingredientMap([ingredient(), ingredient(OTHER_INGREDIENT_ID, true, 'Tofu')]);
  assert.deepEqual(classifySubstitution(substitution(), activePair), []);

  const cases = [
    ['active missing source', substitution(), [ingredient(OTHER_INGREDIENT_ID)], 'SUBSTITUTION_SOURCE_INGREDIENT_MISSING', 'ERROR'],
    ['active inactive source', substitution(), [ingredient(INGREDIENT_ID, false), ingredient(OTHER_INGREDIENT_ID)], 'SUBSTITUTION_SOURCE_INGREDIENT_INACTIVE', 'ERROR'],
    ['active missing substitute', substitution(), [ingredient()], 'SUBSTITUTION_SUBSTITUTE_INGREDIENT_MISSING', 'ERROR'],
    ['active inactive substitute', substitution(), [ingredient(), ingredient(OTHER_INGREDIENT_ID, false)], 'SUBSTITUTION_SUBSTITUTE_INGREDIENT_INACTIVE', 'ERROR'],
    ['archived missing source', substitution({ isActive: false }), [ingredient(OTHER_INGREDIENT_ID)], 'SUBSTITUTION_SOURCE_INGREDIENT_MISSING', 'WARNING'],
    ['archived inactive substitute', substitution({ isActive: false }), [ingredient(), ingredient(OTHER_INGREDIENT_ID, false)], 'SUBSTITUTION_SUBSTITUTE_INGREDIENT_INACTIVE', 'WARNING'],
  ];
  for (const [label, record, ingredients, code, severity] of cases) {
    const finding = classifySubstitution(record, ingredientMap(ingredients)).find((item) => item.code === code);
    assert.equal(finding?.severity, severity, label);
  }

  const both = classifySubstitution(substitution(), new Map());
  assert.equal(both.length, 2);
  assert.deepEqual(new Set(codes(both)), new Set([
    'SUBSTITUTION_SOURCE_INGREDIENT_MISSING',
    'SUBSTITUTION_SUBSTITUTE_INGREDIENT_MISSING',
  ]));

  const sameActive = classifySubstitution(
    substitution({ substituteIngredientId: INGREDIENT_ID }),
    ingredientMap()
  );
  assert.equal(sameActive.find((item) => item.code === 'SUBSTITUTION_SAME_INGREDIENT').severity, 'ERROR');
  const sameArchived = classifySubstitution(
    substitution({ isActive: false, substituteIngredientId: INGREDIENT_ID }),
    ingredientMap()
  );
  assert.equal(sameArchived.find((item) => item.code === 'SUBSTITUTION_SAME_INGREDIENT').severity, 'WARNING');
});

test('invalid Substitution activity is an error with no guessed relationship severity', () => {
  const findings = classifySubstitution(substitution({ isActive: null }), new Map());
  assert.deepEqual(codes(findings), ['SUBSTITUTION_ACTIVITY_STATE_INVALID']);
  assert.equal(findings[0].severity, 'ERROR');
});

test('two findings on one Substitution count as two errors and one affected document', () => {
  const findings = classifySubstitution(substitution(), new Map());
  assert.deepEqual(summarizeFindings(findings), {
    errors: 2,
    warnings: 0,
    info: 0,
    affectedDocuments: 1,
  });
});

test('classification ordering is deterministic across input order', () => {
  const recipes = [
    validRecipe({ _id: 'b', title: 'B' }),
    validRecipe({ _id: 'a', title: 'A', isActive: false, publicationStatus: 'draft' }),
  ];
  const substitutions = [substitution({ _id: 'z' }), substitution({ _id: 'y', isActive: false })];
  const first = classifyCatalogSnapshot(snapshot({ recipes, substitutions }), 'test');
  const second = classifyCatalogSnapshot(snapshot({
    recipes: [...recipes].reverse(),
    substitutions: [...substitutions].reverse(),
  }), 'test');
  assert.deepEqual(first.findings, second.findings);
});

test('alias normalization is string-only and uses exact case and Unicode-whitespace folding', () => {
  assert.equal(normalizeIngredientName('  Green\u00a0\tONION  '), 'green onion');
  assert.equal(normalizeIngredientName(''), undefined);
  assert.equal(normalizeIngredientName(' \n\t '), undefined);
  assert.equal(normalizeIngredientName(42), undefined);
  assert.equal(normalizeIngredientName('jalapeño!'), 'jalapeño!');
});

test('alias-to-canonical, self-alias, and statuses expose only frozen participant fields', () => {
  const collisions = classifyIngredientAliasCollisions([
    { _id: 'a', name: 'Green Onion', aliases: ['  SCALLION\u00a0 '], isActive: true, category: 'produce' },
    { _id: 'b', name: 'Scallion', aliases: [], isActive: false, allergenTags: ['secret'] },
    { _id: 'c', name: 'Garlic', aliases: [' garlic '], isActive: 'corrupt', privateField: 'hidden' },
  ]);
  assert.deepEqual(collisions.map((item) => [item.normalizedValue, item.collisionType]), [
    ['garlic', 'SELF_ALIAS_TO_CANONICAL'],
    ['scallion', 'ALIAS_TO_CANONICAL'],
  ]);
  assert.deepEqual(collisions[1].participants, [
    {
      ingredientId: 'a',
      canonicalName: 'Green Onion',
      status: 'active',
      source: 'alias',
      sourceValue: '  SCALLION\u00a0 ',
      sourceIndex: 0,
    },
    {
      ingredientId: 'b',
      canonicalName: 'Scallion',
      status: 'archived',
      source: 'canonical',
      sourceValue: 'Scallion',
    },
  ]);
  assert.equal(collisions[0].participants[0].status, 'unknown');
  for (const collision of collisions) {
    assert.deepEqual(Object.keys(collision).sort(), ['collisionType', 'normalizedValue', 'participants']);
    for (const participant of collision.participants) {
      const expected = participant.source === 'alias'
        ? ['canonicalName', 'ingredientId', 'source', 'sourceIndex', 'sourceValue', 'status']
        : ['canonicalName', 'ingredientId', 'source', 'sourceValue', 'status'];
      assert.deepEqual(Object.keys(participant).sort(), expected);
    }
  }
});

test('alias-to-alias and duplicate-within-Ingredient keep stored occurrences and indexes', () => {
  const collisions = classifyIngredientAliasCollisions([
    { _id: 'a', name: 'Green Onion', aliases: ['Spring Onion', ' spring\t onion '], isActive: true },
    { _id: 'b', name: 'Welsh Onion', aliases: ['SPRING ONION'], isActive: false },
  ]);
  assert.deepEqual(collisions.map((item) => item.collisionType), [
    'ALIAS_TO_ALIAS',
    'DUPLICATE_ALIASES_WITHIN_INGREDIENT',
  ]);
  assert.deepEqual(collisions[0].participants.map((item) => [item.ingredientId, item.sourceIndex]), [
    ['a', 1],
    ['a', 0],
    ['b', 0],
  ]);
  assert.deepEqual(collisions[1].participants.map((item) => [item.ingredientId, item.sourceIndex]), [
    ['a', 1],
    ['a', 0],
  ]);
});

test('three-way overlap emits explicit non-pairwise types in deterministic order', () => {
  const ingredients = [
    { _id: 'c', name: 'Welsh Onion', aliases: ['scallion'], isActive: true },
    { _id: 'b', name: 'Scallion', aliases: [], isActive: false },
    { _id: 'a', name: 'Green Onion', aliases: ['Scallion'], isActive: true },
    { _id: 'z', name: 'Unrelated', aliases: ['other'], isActive: true },
  ];
  const first = classifyIngredientAliasCollisions(ingredients);
  const second = classifyIngredientAliasCollisions([...ingredients].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => item.collisionType), ['ALIAS_TO_CANONICAL', 'ALIAS_TO_ALIAS']);
  assert.deepEqual(first.map((item) => item.participants.map((participant) => participant.ingredientId)), [
    ['a', 'b', 'c'],
    ['a', 'c'],
  ]);
});

test('unrelated, empty, and non-string aliases produce no collisions', () => {
  assert.deepEqual(classifyIngredientAliasCollisions([
    { _id: 'a', name: 'Garlic', aliases: ['Ajo', '', 42], isActive: true },
    { _id: 'b', name: 'Onion', aliases: ['Cebolla', '   '], isActive: true },
  ]), []);
});

test('collision summary counts records by fixed type and distinct affected Ingredients', () => {
  const collisions = classifyIngredientAliasCollisions([
    { _id: 'a', name: 'Green Onion', aliases: ['scallion', 'spring onion', ' SPRING  ONION '], isActive: true },
    { _id: 'b', name: 'Scallion', aliases: ['spring onion'], isActive: false },
  ]);
  assert.deepEqual(summarizeIngredientAliasCollisions(collisions), {
    total: 3,
    affectedIngredients: 2,
    byType: {
      ALIAS_TO_CANONICAL: 1,
      ALIAS_TO_ALIAS: 1,
      SELF_ALIAS_TO_CANONICAL: 0,
      DUPLICATE_ALIASES_WITHIN_INGREDIENT: 1,
    },
  });
});

test('snapshot reads the complete active and archived Ingredient catalog with only the frozen projection', async () => {
  const calls = [];
  const recipe = validRecipe();
  const sub = substitution();
  const makeCollection = (label, docs) => ({
    find(filter, options) {
      calls.push({ label, method: 'find', filter, options });
      return { toArray: async () => docs };
    },
  });
  const recipeCollection = makeCollection('recipe', [recipe]);
  const substitutionCollection = makeCollection('substitution', [sub]);
  const ingredientCollection = {
    ...makeCollection('ingredient', [ingredient(), ingredient(OTHER_INGREDIENT_ID, false)]),
    async countDocuments(filter) {
      calls.push({ label: 'ingredient', method: 'countDocuments', filter });
      return 11;
    },
  };
  const shoppingListCollection = new Proxy({}, { get() { throw new Error('Shopping Lists must not be queried'); } });
  const result = await readCatalogSnapshot({
    recipeCollection,
    substitutionCollection,
    ingredientCollection,
    shoppingListCollection,
  });
  assert.deepEqual(result.counts, { recipes: 1, substitutions: 1, ingredients: 11 });
  assert.deepEqual(calls[0], { label: 'recipe', method: 'find', filter: {}, options: { projection: RECIPE_PROJECTION } });
  assert.deepEqual(calls[1], { label: 'substitution', method: 'find', filter: {}, options: { projection: SUBSTITUTION_PROJECTION } });
  const ingredientFind = calls.find((call) => call.label === 'ingredient' && call.method === 'find');
  assert.deepEqual(ingredientFind.filter, {});
  assert.deepEqual(ingredientFind.options, { projection: INGREDIENT_PROJECTION });
  assert.deepEqual(INGREDIENT_PROJECTION, { _id: 1, name: 1, aliases: 1, isActive: 1 });
  assert.equal(result.ingredients[0].isActive, true);
  assert.equal(result.ingredients[1].isActive, false);
  assert.equal(calls.filter((call) => call.label === 'ingredient' && call.method === 'find').length, 1);
});

test('complete Ingredient scan resolves equivalent string and BSON ObjectId relationship keys', () => {
  const storedId = new mongoose.Types.ObjectId(INGREDIENT_ID);
  const recipes = [
    validRecipe({ _id: 'string-first', ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg' }] }),
    validRecipe({ _id: 'object-second', ingredients: [{ ingredientId: storedId, quantity: 1, unit: 'kg' }] }),
  ];
  const report = classifyCatalogSnapshot(snapshot({ recipes, ingredients: [ingredient(storedId)] }), 'unit-test');
  assert.equal(report.findings.filter((finding) => finding.code === 'RECIPE_INGREDIENT_MISSING').length, 0);
});

test('invalid string reference remains printable and retains missing classification', () => {
  const invalidId = 'clearly-not-an-object-id';
  const report = classifyCatalogSnapshot(snapshot({
    recipes: [validRecipe({ ingredients: [{ ingredientId: invalidId, quantity: 1, unit: 'kg' }] })],
  }), 'unit-test');
  const missing = report.findings.find((finding) => finding.code === 'RECIPE_INGREDIENT_MISSING');
  assert.equal(missing.ingredientId, invalidId);
});

test('successful, empty, collision, and failed read paths invoke no write or index mutation', async () => {
  let mutationCalls = 0;
  const readCollection = (docs, readError) => {
    const collection = {
      find() { return { toArray: async () => {
        if (readError) throw readError;
        return docs;
      } }; },
    };
    for (const method of [
      'insertOne', 'insertMany', 'replaceOne', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
      'bulkWrite', 'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes',
    ]) {
      collection[method] = () => { mutationCalls += 1; throw new Error(`${method} invoked`); };
    }
    return collection;
  };
  for (const ingredients of [
    [],
    [ingredient()],
    [
      { ...ingredient(), aliases: ['scallion'] },
      { ...ingredient(OTHER_INGREDIENT_ID, false, 'Scallion'), aliases: [] },
    ],
  ]) {
    const ingredientCollection = readCollection(ingredients);
    ingredientCollection.countDocuments = async () => ingredients.length;
    await readCatalogSnapshot({
      recipeCollection: readCollection([]),
      substitutionCollection: readCollection([]),
      ingredientCollection,
    });
  }
  const failedIngredientCollection = readCollection([], new Error('read failed'));
  failedIngredientCollection.countDocuments = async () => 0;
  await assert.rejects(readCatalogSnapshot({
    recipeCollection: readCollection([]),
    substitutionCollection: readCollection([]),
    ingredientCollection: failedIngredientCollection,
  }), /read failed/);
  assert.equal(mutationCalls, 0);
});

test('human report has stable headings, total counts, finding details, and no sensitive raw fields', () => {
  const report = classifyCatalogSnapshot(snapshot({
    recipes: [validRecipe({ password: 'secret', token: 'private' })],
  }), 'wecooked-dev');
  const output = formatHumanReport(report);
  assert.match(output, /^\[catalog-audit\] database=wecooked-dev mode=read-only/m);
  assert.match(output, /recipes=1 substitutions=0 ingredients=0/);
  assert.match(output, /ERROR \(1 findings \/ 1 documents\)/);
  assert.match(output, /WARNING \(0 findings \/ 0 documents\)\n  none/);
  assert.match(output, /INGREDIENT ALIAS COLLISIONS \(0 collisions \/ 0 ingredients\)/);
  assert.match(output, /ALIAS_TO_CANONICAL=0/);
  assert.match(output, /SUMMARY errors=1 warnings=0 info=0 affectedDocuments=1/);
  assert.doesNotMatch(output, /secret|private|password|token/);
});

test('human collision section is deterministic and bounded to frozen investigation fields', () => {
  const report = classifyCatalogSnapshot(snapshot({ ingredients: [
    { _id: 'a', name: 'Green Onion', aliases: ['Scallion'], isActive: true, secret: 'hidden' },
    { _id: 'b', name: 'Scallion', aliases: [], isActive: false },
  ] }), 'unit-test');
  const output = formatHumanReport(report);
  assert.match(output, /INGREDIENT ALIAS COLLISIONS \(1 collisions \/ 2 ingredients\)/);
  assert.match(output, /value="scallion" type=ALIAS_TO_CANONICAL/);
  assert.match(output, /ingredientId=a canonicalName="Green Onion" status=active source=alias sourceValue="Scallion" sourceIndex=0/);
  assert.match(output, /ingredientId=b canonicalName="Scallion" status=archived source=canonical sourceValue="Scallion"/);
  assert.doesNotMatch(output, /secret|hidden/);
});

test('JSON report is one parseable document with schema, counts, summary, findings, and no human prefix', () => {
  const report = classifyCatalogSnapshot(snapshot({ recipes: [validRecipe()] }), 'wecooked-dev');
  const output = formatJsonReport(report);
  const parsed = JSON.parse(output);
  assert.equal(parsed.tool, 'catalog-consistency-audit');
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.readOnly, true);
  assert.deepEqual(parsed.counts, { recipes: 1, substitutions: 0, ingredients: 0 });
  assert.equal(Array.isArray(parsed.findings), true);
  assert.deepEqual(parsed.ingredientAliasCollisionSummary, {
    total: 0,
    affectedIngredients: 0,
    byType: {
      ALIAS_TO_CANONICAL: 0,
      ALIAS_TO_ALIAS: 0,
      SELF_ALIAS_TO_CANONICAL: 0,
      DUPLICATE_ALIASES_WITHIN_INGREDIENT: 0,
    },
  });
  assert.deepEqual(parsed.ingredientAliasCollisions, []);
  assert.doesNotMatch(output, /\[catalog-audit\]/);
});

test('exit codes are 0 for zero errors or warnings/info only and 1 for errors', () => {
  assert.equal(determineExitCode({ summary: { errors: 0 } }), 0);
  assert.equal(determineExitCode({ summary: { errors: 0, warnings: 3, info: 2 } }), 0);
  assert.equal(determineExitCode({ summary: { errors: 1 } }), 1);
  const collisionOnly = classifyCatalogSnapshot(snapshot({ ingredients: [
    { _id: 'a', name: 'Green Onion', aliases: ['scallion'], isActive: true },
    { _id: 'b', name: 'Scallion', aliases: [], isActive: true },
  ] }));
  assert.equal(collisionOnly.ingredientAliasCollisionSummary.total, 1);
  assert.deepEqual(collisionOnly.findings, []);
  assert.equal(determineExitCode(collisionOnly), 0);
});

test('CLI argument parser accepts only no args or --json', () => {
  assert.deepEqual(parseArgs([]), { json: false });
  assert.deepEqual(parseArgs(['--json']), { json: true });
  assert.throws(() => parseArgs(['--unknown']), { code: 'AUDIT_ARGUMENTS_INVALID' });
  assert.throws(() => parseArgs(['--json', '--unknown']), { code: 'AUDIT_ARGUMENTS_INVALID' });
});

function fakeAuditCollections({ missingIngredient = false, queryError } = {}) {
  return {
    recipeCollection: {
      find() {
        return { toArray: async () => {
          if (queryError) throw queryError;
          return [validRecipe()];
        } };
      },
    },
    substitutionCollection: { find() { return { toArray: async () => [] }; } },
    ingredientCollection: {
      find() { return { toArray: async () => missingIngredient ? [] : [ingredient()] }; },
      countDocuments: async () => missingIngredient ? 0 : 1,
    },
  };
}

test('command disables automatic schema work and disconnects after success and audit ERROR findings', async () => {
  assert.deepEqual(AUDIT_CONNECTION_OPTIONS, { autoIndex: false, autoCreate: false });
  for (const missingIngredient of [false, true]) {
    const calls = [];
    const result = await runCatalogAuditCommand({
      argv: ['--json'],
      loadEnvironment: () => ({ mongodbUri: 'mongodb://example.invalid/test' }),
      connect: async (uri, options) => {
        calls.push({ type: 'connect', uri, options });
        return { connection: { name: 'unit-test-db' } };
      },
      disconnect: async () => calls.push({ type: 'disconnect' }),
      getCollections: () => fakeAuditCollections({ missingIngredient }),
    });
    assert.deepEqual(calls[0], {
      type: 'connect',
      uri: 'mongodb://example.invalid/test',
      options: { autoIndex: false, autoCreate: false },
    });
    assert.equal(calls[1].type, 'disconnect');
    assert.equal(result.exitCode, missingIngredient ? 1 : 0);
  }
});

test('command disconnects on query and formatting failures', async () => {
  for (const failure of ['query', 'format']) {
    let disconnected = 0;
    const options = {
      argv: [],
      loadEnvironment: () => ({ mongodbUri: 'mongodb://example.invalid/test' }),
      connect: async () => ({ connection: { name: 'unit-test-db' } }),
      disconnect: async () => { disconnected += 1; },
      getCollections: () => fakeAuditCollections({ queryError: failure === 'query' ? new Error('query failed') : undefined }),
    };
    if (failure === 'format') options.formatHuman = () => { throw new Error('format failed'); };
    await assert.rejects(runCatalogAuditCommand(options), new RegExp(`${failure} failed`));
    assert.equal(disconnected, 1);
  }
});

test('execution failures use exit 2 and safe human stderr or one safe JSON stdout document', async () => {
  const humanOut = memoryWriter();
  const humanErr = memoryWriter();
  assert.equal(await executeCatalogAuditCli({
    argv: ['--unknown'],
    stdout: humanOut,
    stderr: humanErr,
  }), 2);
  assert.equal(humanOut.value(), '');
  assert.match(humanErr.value(), /could not complete/);
  assert.doesNotMatch(humanErr.value(), /Usage|mongodb|stack/i);

  for (const label of ['connection', 'query']) {
    const stdout = memoryWriter();
    const stderr = memoryWriter();
    const exitCode = await executeCatalogAuditCli({
      argv: ['--json'],
      stdout,
      stderr,
      runCommand: async () => { throw new Error(`${label} mongodb://user:secret@example.invalid`); },
    });
    assert.equal(exitCode, 2);
    assert.equal(stderr.value(), '');
    const parsed = JSON.parse(stdout.value());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, 'AUDIT_EXECUTION_FAILED');
    assert.doesNotMatch(stdout.value(), /mongodb|secret|\[catalog-audit\]/i);
  }
});

test('successful CLI writes exactly one selected report and returns the audit exit code', async () => {
  for (const [argv, output] of [[[], 'human report'], [['--json'], '{"ok":true}']]) {
    const stdout = memoryWriter();
    const stderr = memoryWriter();
    const exitCode = await executeCatalogAuditCli({
      argv,
      stdout,
      stderr,
      runCommand: async () => ({ output, exitCode: 1 }),
    });
    assert.equal(exitCode, 1);
    assert.equal(stdout.value(), `${output}\n`);
    assert.equal(stderr.value(), '');
  }
});
