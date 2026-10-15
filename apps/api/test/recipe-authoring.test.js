process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const readline = require('node:readline/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

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
const Ingredient = require('../src/modules/ingredients/ingredient.model');
const mongoose = require('mongoose');
const { assertCommandTarget } = require('../scripts/migrate-recipe-ranking-index');

const RECIPE_ID = '507f1f77bcf86cd799439099';
const MODERATOR_ID = '507f1f77bcf86cd799439001';
const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const UPDATED_AT = new Date('2026-09-15T10:00:00.000Z');
const atlasExecFile = promisify(execFile);
const QA_PROJECT_ID = '6acb1e1905708eb667a03f01';
const QA_CLUSTER_NAME = 'wecooked-rank1-qa';
const AUTHORING_APPROVAL_REFERENCE = 'RANK1-QA-AUTHORING-001';
let approvedAuthoringLiveRun = null;
const ACTIONS = Object.freeze({
  recipes: ['find', 'insert', 'update', 'remove', 'createIndex', 'listIndexes'],
  reviews: ['find', 'insert', 'update', 'remove'],
  ingredients: ['find', 'insert', 'remove'],
});

function mongoHosts(value, protocol, allowCredentials = false) {
  assert.ok(typeof value === 'string' && value.startsWith(`${protocol}://`),
    'Atlas connection string is missing or malformed');
  const authority = value.slice(protocol.length + 3).split(/[/?#]/, 1)[0];
  assert.ok(authority && (allowCredentials || !authority.includes('@')),
    'Atlas connection string must contain host names without credentials');
  const hosts = (allowCredentials ? authority.slice(authority.lastIndexOf('@') + 1) : authority)
    .toLowerCase().split(',');
  assert.ok(hosts.every((host) => /^[a-z0-9.-]+(?::\d+)?$/.test(host)),
    'Atlas connection string has malformed host names');
  return hosts.sort();
}

function assertAtlasEvidence(configuration, uri, evidence) {
  assert.ok(Number.isFinite(evidence?.retrievedAt)
    && evidence.retrievedAt <= Date.now()
    && Date.now() - evidence.retrievedAt <= 30000,
  'Fresh Atlas API evidence is required');
  const atlas = evidence.cluster;
  assert.equal(configuration.atlasProjectId, QA_PROJECT_ID,
    'Configured Atlas project differs from the approved QA project');
  assert.equal(atlas?.groupId, QA_PROJECT_ID, 'Atlas API project differs from the approved QA project');
  assert.equal(atlas.name, QA_CLUSTER_NAME, 'Atlas API cluster differs from the approved QA cluster');
  assert.equal(atlas.mongoDBVersion, configuration.serverVersion,
    'Atlas API server version differs from the reviewed target');
  assert.equal(atlas.featureCompatibilityVersion, configuration.requiredFcv,
    'Atlas API FCV is missing or differs from required FCV');
  const atlasHosts = mongoHosts(atlas.connectionStrings?.standard, 'mongodb');
  const selectedProtocol = uri.startsWith('mongodb+srv://') ? 'mongodb+srv' : 'mongodb';
  const selectedHosts = mongoHosts(uri, selectedProtocol, true);
  const expectedHosts = selectedProtocol === 'mongodb+srv'
    ? mongoHosts(atlas.connectionStrings?.standardSrv, 'mongodb+srv') : atlasHosts;
  assert.deepEqual(selectedHosts, expectedHosts,
    'Selected Mongo URI hosts differ from the authenticated Atlas cluster');
  return atlasHosts;
}

async function getFreshAtlasEvidence() {
  let stdout;
  try {
    ({ stdout } = await atlasExecFile('atlas', ['api', 'clusters', 'getCluster',
      '--version', '2024-08-05', '--groupId', QA_PROJECT_ID,
      '--clusterName', QA_CLUSTER_NAME, '--output', 'json'],
    { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }));
    return { cluster: JSON.parse(stdout), retrievedAt: Date.now() };
  } catch {
    throw Object.assign(new Error('Fresh authenticated Atlas API evidence is unavailable.'),
      { code: 'RANK1_ATLAS_EVIDENCE_UNAVAILABLE' });
  }
}

function assertAuthoringLiveMode({ mode = process.env.RECIPE_RANKING_MONGO_RUN,
  uri = process.env.RECIPE_RANKING_MONGO_URI,
  path = process.env.RECIPE_RANKING_MONGO_PREFLIGHT_FILE } = {}) {
  if (!mode && !uri && !path) return;
  assert.ok(['ranking', 'ranking-failure', 'authoring'].includes(mode),
    'RECIPE_RANKING_MONGO_RUN must select ranking, ranking-failure, or authoring');
}

function requireAuthoringTargetConfiguration({
  uri = process.env.RECIPE_RANKING_MONGO_URI,
  path = process.env.RECIPE_RANKING_MONGO_PREFLIGHT_FILE,
  configuration: suppliedConfiguration,
  mode = process.env.RECIPE_RANKING_MONGO_RUN,
} = {}) {
  assertAuthoringLiveMode({ mode, uri, path });
  assert.equal(mode, 'authoring', 'This file runs only authoring physical proof');
  assert.ok(uri, 'RECIPE_RANKING_MONGO_URI is required for requested physical proof');
  const selectedDatabase = assertCommandTarget(uri, { apply: true });
  assert.ok(!/failure/i.test(selectedDatabase),
    'Authoring proof cannot use the failure-injection database');
  assert.ok(path, 'RANK1 target configuration file is required');
  let configuration;
  try {
    configuration = suppliedConfiguration || JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Invalid RANK1 target configuration file.');
  }
  assert.ok(configuration && typeof configuration === 'object' && !Array.isArray(configuration),
    'RANK1 target configuration must be an object');
  const allowedFields = ['atlasProjectId', 'connectedDatabase', 'normalDatabase', 'failureDatabase',
    'deploymentIdentity', 'serverVersion',
    'requiredFcv', 'authenticatedUser', 'effectiveGrants'];
  assert.ok(Object.keys(configuration).every((field) => allowedFields.includes(field)),
    'Target configuration cannot contain local approval or unverified evidence metadata');
  assert.ok(/^[a-f\d]{24}$/i.test(configuration.atlasProjectId || ''),
    'Expected Atlas QA project ID is required');
  assert.equal(configuration.atlasProjectId, QA_PROJECT_ID,
    'Configured Atlas project differs from the approved QA project');
  assert.equal(configuration.connectedDatabase, selectedDatabase,
    'Configured database differs from the selected database');
  assert.ok(typeof configuration.normalDatabase === 'string'
    && /rank1/i.test(configuration.normalDatabase)
    && /(test|isolated)/i.test(configuration.normalDatabase)
    && !/failure/i.test(configuration.normalDatabase)
    && typeof configuration.failureDatabase === 'string'
    && /rank1/i.test(configuration.failureDatabase)
    && /(test|isolated)/i.test(configuration.failureDatabase)
    && /failure/i.test(configuration.failureDatabase)
    && configuration.normalDatabase !== configuration.failureDatabase,
  'Distinct normal and failure RANK1 test databases are required');
  assert.equal(selectedDatabase, configuration.normalDatabase,
    'Selected database does not match the configured normal database');
  const identity = configuration.deploymentIdentity;
  assert.ok(identity && typeof identity === 'object' && !Array.isArray(identity),
    'Expected deployment identity is required');
  assert.ok(Object.keys(identity).every((field) => ['setName', 'hosts', 'me'].includes(field))
    && (identity.setName === null || typeof identity.setName === 'string')
    && Array.isArray(identity.hosts) && identity.hosts.every((host) => typeof host === 'string' && host)
    && (identity.me === null || typeof identity.me === 'string')
    && (identity.hosts.length > 0 || identity.me),
  'Expected deployment identity must identify a connected host or replica set');
  assert.ok(/^\d+\.\d+\.\d+/.test(configuration.serverVersion || ''),
    'Expected server version is required');
  assert.ok(/^\d+\.\d+$/.test(configuration.requiredFcv || ''),
    'Required FCV must be specified as major.minor');
  assert.ok(configuration.authenticatedUser && typeof configuration.authenticatedUser.user === 'string'
    && configuration.authenticatedUser.user && typeof configuration.authenticatedUser.db === 'string'
    && configuration.authenticatedUser.db,
  'Expected authenticated user is required');
  assert.ok(JSON.stringify(configuration.effectiveGrants)
    === JSON.stringify([{ database: 'admin', role: 'rank1_normal_role' }]),
  'Expected grants must contain only the normal RANK1 custom role');
  return configuration;
}

async function requireAuthoringExternalApproval(configuration,
  { input = process.stdin, output = process.stdout, ask } = {}) {
  // Manual checkpoint: obtain human approval in an external change record. Independently inspect
  // the Atlas QA project/deployment, both isolated databases, custom user/role, empty fixtures,
  // nutrition prerequisite and writer freeze before an interactive TTY run. Keep approval outside
  // local JSON/ENV. Answers are operator declarations, not cryptographic authorization; connected
  // identity, privileges and server FCV still gate fixture writes.
  if (!input.isTTY || !output.isTTY) {
    throw Object.assign(new Error('Interactive operator approval is required before Mongo connection.'),
      { code: 'RANK1_EXTERNAL_APPROVAL_REQUIRED' });
  }
  const terminal = ask ? null : readline.createInterface({ input, output });
  const question = ask || ((prompt) => terminal.question(prompt));
  try {
    const record = (await question('External human approval record reference: ')).trim();
    const project = (await question('Approved isolated Atlas QA project ID: ')).trim();
    assert.ok(record && project, 'External approval reference and QA project declaration are required');
    assert.equal(record, AUTHORING_APPROVAL_REFERENCE,
      'Authoring approval reference differs from the separate external record');
    assert.equal(project, configuration.atlasProjectId,
      'Declared QA project differs from the intended Atlas project');
    const operations = Object.entries(ACTIONS)
      .map(([collection, actions]) => `${collection}:${actions.join(',')}`).join(';');
    const declaration = `${project} ${configuration.connectedDatabase} authoring `
      + `rank1_normal_role ${operations}`;
    assert.equal((await question(`Type exactly "${declaration}" to confirm project, database, `
      + 'mode and permitted operations: ')).trim(), declaration,
    'Operator declaration does not match the intended QA target and operations');
    return { record, project };
  } finally {
    terminal?.close();
  }
}

function assertAuthoringConnectedTarget(configuration,
  { databaseName, hello, build, status, atlasHosts }) {
  assert.equal(databaseName, configuration.connectedDatabase,
    'Connected database differs from target configuration');
  const connectedIdentity = {
    setName: hello.setName || null,
    hosts: [...(hello.hosts || [])].sort(),
    me: hello.me || null,
  };
  const expectedIdentity = {
    ...configuration.deploymentIdentity,
    hosts: [...configuration.deploymentIdentity.hosts].sort(),
  };
  assert.ok(JSON.stringify(connectedIdentity) === JSON.stringify(expectedIdentity),
    'Connected deployment identity differs from target configuration');
  assert.deepEqual(connectedIdentity.hosts, atlasHosts,
    'Connected replica hosts differ from the authenticated Atlas cluster');
  assert.equal(build.version, configuration.serverVersion,
    'Runtime server version differs from target configuration');
  assert.ok(JSON.stringify(status.authInfo?.authenticatedUsers)
    === JSON.stringify([configuration.authenticatedUser]),
  'Authenticated user differs from target configuration');
  const privileges = status.authInfo?.authenticatedUserPrivileges;
  const roles = status.authInfo?.authenticatedUserRoles;
  assert.ok(JSON.stringify(roles?.map(({ db, role }) => ({ database: db, role })))
    === JSON.stringify(configuration.effectiveGrants),
  'Authenticated roles differ from expected grants');
  assert.ok(Array.isArray(privileges) && privileges.length > 0,
    'Effective credential privileges must be inspectable');
  assert.ok(privileges.every(({ resource }) => resource?.db === configuration.connectedDatabase
    && resource?.anyResource !== true && resource?.cluster !== true
    && Object.hasOwn(ACTIONS, resource?.collection)),
  'Credential has broad, protected-database or unapproved-collection privileges');
  const granted = Object.fromEntries(Object.keys(ACTIONS).map((collection) => [collection, new Set()]));
  for (const { resource, actions } of privileges) {
    assert.ok(Array.isArray(actions) && actions.length > 0
      && actions.every((action) => ACTIONS[resource.collection].includes(action)),
    'Credential has an unapproved collection action');
    for (const action of actions) granted[resource.collection].add(action);
  }
  for (const [collection, actions] of Object.entries(ACTIONS)) {
    assert.ok(actions.every((action) => granted[collection].has(action)),
      `Credential lacks required ${collection} actions`);
  }
}

async function connectForAuthoringPhysicalProof({
  uri = process.env.RECIPE_RANKING_MONGO_URI,
  path = process.env.RECIPE_RANKING_MONGO_PREFLIGHT_FILE,
  configuration: suppliedConfiguration, mode = process.env.RECIPE_RANKING_MONGO_RUN,
  connect = (...args) => mongoose.connect(...args),
  connection = mongoose.connection, disconnect = () => mongoose.disconnect(),
  collections = { recipes: Recipe.collection, ingredients: Ingredient.collection },
  approvalOptions, fetchAtlasEvidence = getFreshAtlasEvidence, onStage = () => {},
} = {}) {
  const configuration = requireAuthoringTargetConfiguration({ uri, path,
    configuration: suppliedConfiguration, mode });
  if (approvalOptions) {
    await requireAuthoringExternalApproval(configuration, approvalOptions);
  } else {
    assert.ok(approvedAuthoringLiveRun
      && approvedAuthoringLiveRun.uri === uri
      && approvedAuthoringLiveRun.path === path
      && approvedAuthoringLiveRun.configuration === JSON.stringify(configuration),
    'Interactive operator approval for this exact RANK1 authoring target is required before Mongo connection');
  }
  onStage('approval bound');
  const atlasHosts = assertAtlasEvidence(configuration, uri, await fetchAtlasEvidence());
  onStage('fresh Atlas identity verified');
  try {
    await connect(uri, { autoIndex: false, autoCreate: false });
  } catch {
    throw new Error('Isolated Mongo connection failed.');
  }
  onStage('Mongo connected');
  try {
    const admin = connection.db.admin();
    const [hello, build, status] = await Promise.all([
      admin.command({ hello: 1 }),
      admin.command({ buildInfo: 1 }),
      admin.command({ connectionStatus: 1, showPrivileges: true }),
    ]);
    assertAuthoringConnectedTarget(configuration, {
      databaseName: connection.db.databaseName, hello, build, status, atlasHosts,
    });
    assert.equal(await collections.recipes.countDocuments({}), 0,
      'Physical proof requires an empty disposable Recipe collection');
    assert.equal(await collections.ingredients.countDocuments({}), 0,
      'Physical proof requires an empty disposable Ingredient collection');
    onStage('connected grants and empty fixtures verified');
  } catch (error) {
    await disconnect();
    throw error;
  }
}

test.before(async () => {
  if (process.env.RECIPE_RANKING_MONGO_RUN !== 'authoring') return;
  // Human input is outside the physical test's 60-second database-operation budget.
  const uri = process.env.RECIPE_RANKING_MONGO_URI;
  const path = process.env.RECIPE_RANKING_MONGO_PREFLIGHT_FILE;
  const configuration = requireAuthoringTargetConfiguration({ uri, path, mode: 'authoring' });
  await requireAuthoringExternalApproval(configuration);
  approvedAuthoringLiveRun = { uri, path, configuration: JSON.stringify(configuration) };
});

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

test('consumer detail/usability fail closed for incomplete legacy and explicit Published records', async (t) => {
  let current = populated(fullRecipe());
  delete current.publicationStatus;
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => current);

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

test('consumer list emits exact eligibility before the shared count/page facet', async (t) => {
  let pipeline;
  t.mock.method(Recipe, 'aggregate', async (emitted) => {
    pipeline = emitted;
    return [{ items: [], total: [] }];
  });
  t.mock.method(Recipe, 'populate', async (rows) => rows);
  const result = await recipeService.listRecipes({
    status: 'active', page: 2, limit: 2, sort: 'newest', isAdmin: false,
  });
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);

  function assertEligibility(stages) {
    const facetIndex = stages.findIndex((stage) => stage.$facet);
    const completenessIndex = stages.findIndex((stage) => stage.$match?.$expr?.$and);
    const requiredIndex = stages.findIndex((stage) => stage.$set?._requiredIngredientIds);
    const lookupIndex = stages.findIndex((stage) => stage.$lookup?.as === '_activeRequiredIngredients');
    const activeMatchIndex = stages.findIndex((stage, index) =>
      index > lookupIndex && stage.$match?.$expr?.$eq
    );
    assert.equal(facetIndex, stages.length - 1);
    assert.deepEqual(stages[0].$match.$and[0].$or, [
      { publicationStatus: 'published' },
      { publicationStatus: { $exists: false } },
    ]);
    assert.equal(stages[0].$match.isActive, true);
    for (const index of [completenessIndex, requiredIndex, lookupIndex, activeMatchIndex]) {
      assert.ok(index > 0 && index < facetIndex, 'eligibility must precede both facet branches');
    }
    assert.ok(completenessIndex < requiredIndex && requiredIndex < lookupIndex && lookupIndex < activeMatchIndex);
    // Completeness must remain in the database before the shared count/page facet.
    const terms = stages[completenessIndex].$match.$expr.$and;
    const termFor = (path) => terms.find((term) => JSON.stringify(term).includes(JSON.stringify(path)));
    for (const path of [
      '$title', '$description', '$difficulty', '$prepTimeMinutes', '$cookTimeMinutes',
      '$servings', '$ingredients', '$instructions', '$dietaryTags', '$imageUrl',
      '$imageAssetId', '$nutrition', '$nutritionProvenance',
    ]) {
      assert.ok(termFor(path), `missing completeness predicate for ${path}`);
    }
    assert.match(JSON.stringify(termFor('$imageUrlIsPublicHttps')), /imageUrlIsPublicHttps/);
    assert.match(JSON.stringify(termFor('$nutritionSourceUrlIsPublicHttps')), /nutritionSourceUrlIsPublicHttps/);
    assert.match(JSON.stringify(termFor('$nutritionProvenance.acceptedBy')), /acceptedBy/);
    assert.match(JSON.stringify(termFor('$nutritionProvenance.acceptedAt')), /acceptedAt/);
    assert.deepEqual(stages[lookupIndex].$lookup.pipeline[0].$match.$expr, {
      $and: [
        { $in: ['$_id', '$$requiredIds'] },
        { $eq: ['$isActive', true] },
      ],
    });
    assert.deepEqual(stages[activeMatchIndex].$match.$expr, {
      $eq: [
        { $size: '$_activeRequiredIngredients' },
        { $size: '$_requiredIngredientIds' },
      ],
    });
    assert.deepEqual(stages[facetIndex].$facet.total, [{ $count: 'value' }]);
    assert.deepEqual(stages[facetIndex].$facet.items.slice(0, 3), [
      { $sort: { createdAt: -1, _id: 1 } }, { $skip: 2 }, { $limit: 2 },
    ]);
  }

  assertEligibility(pipeline);
  const withoutCompleteness = structuredClone(pipeline);
  withoutCompleteness.splice(withoutCompleteness.findIndex((stage) => stage.$match?.$expr?.$and), 1);
  assert.throws(() => assertEligibility(withoutCompleteness));
  const afterPaging = structuredClone(pipeline);
  afterPaging.push(afterPaging.splice(afterPaging.findIndex((stage) => stage.$match?.$expr?.$and), 1)[0]);
  assert.throws(() => assertEligibility(afterPaging));
  const weakened = structuredClone(pipeline);
  const lookup = weakened.find((stage) => stage.$lookup?.as === '_activeRequiredIngredients');
  lookup.$lookup.pipeline[0].$match.$expr.$and[1].$eq[1] = false;
  assert.throws(() => assertEligibility(weakened));
});

test('authoring Mongo selector and target configuration fail closed', async () => {
  assertAuthoringLiveMode();
  const uri = 'mongodb://qa.example.test:27017/wecooked-rank1-isolated';
  const configuration = {
    atlasProjectId: QA_PROJECT_ID,
    connectedDatabase: 'wecooked-rank1-isolated',
    normalDatabase: 'wecooked-rank1-isolated',
    failureDatabase: 'wecooked-rank1-failure-test',
    deploymentIdentity: { setName: 'qa-replica', hosts: ['qa.example.test:27017'], me: null },
    serverVersion: '8.0.0',
    requiredFcv: '8.0',
    authenticatedUser: { user: 'rank1-qa', db: 'admin' },
    effectiveGrants: [{ database: 'admin', role: 'rank1_normal_role' }],
  };
  assert.throws(() => assertAuthoringLiveMode({ mode: '', uri }), /RECIPE_RANKING_MONGO_RUN/);
  assert.throws(() => assertAuthoringLiveMode({ mode: 'authorng', uri }), /RECIPE_RANKING_MONGO_RUN/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'ranking', uri }),
    /only authoring physical proof/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri: '', path: '' }),
    /RECIPE_RANKING_MONGO_URI/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri, path: '' }),
    /configuration file/);
  assert.doesNotThrow(() => requireAuthoringTargetConfiguration({
    mode: 'authoring', uri, path: 'synthetic', configuration,
  }));
  let connections = 0;
  await assert.rejects(() => connectForAuthoringPhysicalProof({ uri, path: 'synthetic',
    configuration, mode: 'authoring', connect: () => { connections += 1; },
    approvalOptions: { input: { isTTY: false }, output: { isTTY: false } },
  }), { code: 'RANK1_EXTERNAL_APPROVAL_REQUIRED' });
  await assert.rejects(() => connectForAuthoringPhysicalProof({ uri, path: 'synthetic',
    configuration, mode: 'authorng', connect: () => { connections += 1; },
  }), /RECIPE_RANKING_MONGO_RUN/);
  assert.equal(connections, 0, 'No approval or invalid mode must prevent connection');
  const previousApproval = approvedAuthoringLiveRun;
  try {
    approvedAuthoringLiveRun = null;
    await assert.rejects(() => connectForAuthoringPhysicalProof({ uri, path: 'synthetic',
      configuration, mode: 'authoring', connect: () => { connections += 1; },
    }), /Interactive operator approval for this exact RANK1 authoring target/);
    approvedAuthoringLiveRun = { uri, path: 'synthetic',
      configuration: JSON.stringify(configuration) };
    let atlasReads = 0;
    await assert.rejects(() => connectForAuthoringPhysicalProof({ uri, path: 'synthetic',
      configuration, mode: 'authoring',
      fetchAtlasEvidence: async () => { atlasReads += 1; throw new Error('synthetic Atlas stop'); },
      connect: () => { connections += 1; },
    }), /synthetic Atlas stop/);
    assert.equal(atlasReads, 1, 'Bound approval permits a fresh Atlas check');
    await assert.rejects(() => connectForAuthoringPhysicalProof({ uri, path: 'changed-path',
      configuration, mode: 'authoring', connect: () => { connections += 1; },
    }), /Interactive operator approval for this exact RANK1 authoring target/);
    assert.equal(connections, 0, 'Unapproved targets must never connect');
  } finally {
    approvedAuthoringLiveRun = previousApproval;
  }
  await assert.rejects(() => requireAuthoringExternalApproval(configuration,
    { input: { isTTY: false }, output: { isTTY: false } }),
  { code: 'RANK1_EXTERNAL_APPROVAL_REQUIRED' });
  const declared = await requireAuthoringExternalApproval(configuration, {
    input: { isTTY: true }, output: { isTTY: true },
    ask: async (prompt) => {
      if (prompt.startsWith('External')) return AUTHORING_APPROVAL_REFERENCE;
      if (prompt.startsWith('Approved')) return configuration.atlasProjectId;
      return prompt.match(/Type exactly "([^"]+)"/)[1];
    },
  });
  assert.deepEqual(declared, { record: AUTHORING_APPROVAL_REFERENCE,
    project: configuration.atlasProjectId });
  await assert.rejects(() => requireAuthoringExternalApproval(configuration, {
    input: { isTTY: true }, output: { isTTY: true },
    ask: async (prompt) => prompt.startsWith('External') ? 'TAP version 13'
      : prompt.startsWith('Approved') ? configuration.atlasProjectId
        : prompt.match(/Type exactly "([^"]+)"/)[1],
  }), /Authoring approval reference differs/);
  await assert.rejects(() => requireAuthoringExternalApproval(configuration, {
    input: { isTTY: true }, output: { isTTY: true }, ask: async () => '',
  }), /External approval reference/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration, reviewedBy: 'self',
      evidence: { deployment: 'external' } } }), /cannot contain local approval/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration, fcv: '8.0', writerFreezeActive: true } }),
  /unverified evidence metadata/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration, connectedDatabase: 'rank1-other-test' } }),
  /Configured database differs/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration,
      normalDatabase: 'wecooked-rank1-other-test' } }),
  /configured normal database/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration,
      failureDatabase: configuration.normalDatabase } }),
  /Distinct normal and failure/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration, deploymentIdentity: 'dedicated-qa' } }),
  /Expected deployment identity/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration, requiredFcv: undefined } }),
  /Required FCV/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration,
      atlasProjectId: '0123456789abcdef01234567' } }), /approved QA project/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration,
      effectiveGrants: [{ database: configuration.connectedDatabase, role: 'readWrite' }] } }),
  /normal RANK1 custom role/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring', uri,
    path: 'synthetic', configuration: { ...configuration,
      effectiveGrants: [{ database: configuration.connectedDatabase, role: 'rank1_normal_role' }] } }),
  /normal RANK1 custom role/);
  assert.throws(() => requireAuthoringTargetConfiguration({ mode: 'authoring',
    uri: 'mongodb://127.0.0.1/wecooked-rank1-failure-test', path: 'synthetic', configuration }),
  /cannot use the failure-injection database/);
  const runtime = {
    databaseName: configuration.connectedDatabase,
    hello: { setName: 'qa-replica', hosts: ['qa.example.test:27017'] },
    build: { version: '8.0.0' },
    status: { authInfo: {
      authenticatedUsers: [{ user: 'rank1-qa', db: 'admin' }],
      authenticatedUserRoles: [{ db: 'admin', role: 'rank1_normal_role' }],
      authenticatedUserPrivileges: Object.entries(ACTIONS).map(([collection, actions]) => ({
        resource: { db: configuration.connectedDatabase, collection }, actions,
      })),
    } },
    atlasHosts: ['qa.example.test:27017'],
  };
  assert.doesNotThrow(() => assertAuthoringConnectedTarget(configuration, runtime));
  assert.throws(() => assertAuthoringConnectedTarget(configuration, { ...runtime,
    status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserRoles: [{ db: configuration.connectedDatabase, role: 'rank1_normal_role' }],
    } },
  }), /Authenticated roles differ/);
  assert.throws(() => assertAuthoringConnectedTarget(configuration, { ...runtime,
    databaseName: 'wecooked-production',
  }), /Connected database differs/);
  assert.throws(() => assertAuthoringConnectedTarget(configuration, { ...runtime,
    hello: { ...runtime.hello, setName: 'shared-replica' },
  }), /Connected deployment identity differs/);
  assert.throws(() => assertAuthoringConnectedTarget(configuration, { ...runtime,
    status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserRoles: [{ db: 'wecooked-production', role: 'rank1_normal_role' }],
    } },
  }), /Authenticated roles differ/);
  assert.throws(() => assertAuthoringConnectedTarget(configuration, { ...runtime,
    status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserPrivileges: [{ resource: { db: 'wecooked-production', collection: 'recipes' },
        actions: ['insert'] }],
    } },
  }), /broad, protected-database/);
  assert.throws(() => assertAuthoringConnectedTarget(configuration, { ...runtime,
    atlasHosts: ['other.example.test:27017'] }), /Connected replica hosts differ/);
  assert.throws(() => assertAuthoringConnectedTarget(configuration, { ...runtime,
    status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserPrivileges: [{ resource: { db: configuration.connectedDatabase,
        collection: '' }, actions: ['find'] }],
    } },
  }), /broad, protected-database/);
  assert.throws(() => assertAuthoringConnectedTarget(configuration, { ...runtime,
    status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserPrivileges: runtime.status.authInfo.authenticatedUserPrivileges.map(
        (privilege) => privilege.resource.collection === 'reviews'
          ? { ...privilege, actions: [...privilege.actions, 'createIndex'] } : privilege),
    } },
  }), /unapproved collection action/);
  const approvalOptions = { input: { isTTY: true }, output: { isTTY: true },
    ask: async (prompt) => prompt.startsWith('External') ? AUTHORING_APPROVAL_REFERENCE
      : prompt.startsWith('Approved') ? configuration.atlasProjectId
        : prompt.match(/Type exactly "([^"]+)"/)[1] };
  const atlas = { groupId: QA_PROJECT_ID, name: QA_CLUSTER_NAME,
    mongoDBVersion: '8.0.0', featureCompatibilityVersion: '8.0',
    connectionStrings: { standard: 'mongodb://qa.example.test:27017/',
      standardSrv: 'mongodb+srv://qa.example.test/' } };
  const evidence = { cluster: atlas, retrievedAt: Date.now() };
  assert.deepEqual(assertAtlasEvidence(configuration, uri, evidence), runtime.atlasHosts);
  assert.deepEqual(assertAtlasEvidence(configuration,
    'mongodb+srv://user:encoded%40password@qa.example.test/wecooked-rank1-isolated', evidence),
  runtime.atlasHosts);
  const wrongHostRuntime = { ...runtime,
    hello: { ...runtime.hello, hosts: ['other.example.test:27017'] } };
  assert.throws(() => assertAuthoringConnectedTarget({ ...configuration,
    deploymentIdentity: { ...configuration.deploymentIdentity,
      hosts: ['other.example.test:27017'] } }, wrongHostRuntime),
  /Connected replica hosts differ/);
  for (const [badEvidence, message] of [
    [{ ...evidence, retrievedAt: Date.now() - 31000 }, /Fresh Atlas API evidence/],
    [{ ...evidence, cluster: { ...atlas, groupId: '0123456789abcdef01234567' } },
      /Atlas API project differs/],
    [{ ...evidence, cluster: { ...atlas, name: 'other-cluster' } },
      /Atlas API cluster differs/],
    [{ ...evidence, cluster: { ...atlas, mongoDBVersion: '8.0.1' } },
      /Atlas API server version differs/],
    [{ ...evidence, cluster: { ...atlas, featureCompatibilityVersion: undefined } },
      /Atlas API FCV is missing/],
    [{ ...evidence, cluster: { ...atlas, connectionStrings: {
      ...atlas.connectionStrings, standard: 'mongodb://other.example.test:27017/',
    } } }, /Selected Mongo URI hosts differ/],
  ]) {
    let connected = 0;
    await assert.rejects(() => connectForAuthoringPhysicalProof({ uri, path: 'synthetic',
      configuration, mode: 'authoring', approvalOptions,
      fetchAtlasEvidence: async () => badEvidence,
      connect: async () => { connected += 1; },
    }), message);
    assert.equal(connected, 0, 'Bad Atlas evidence must prevent Mongo connection');
  }
  let unavailableConnections = 0;
  await assert.rejects(() => connectForAuthoringPhysicalProof({ uri, path: 'synthetic',
    configuration, mode: 'authoring', approvalOptions,
    fetchAtlasEvidence: async () => { throw Object.assign(new Error('API unavailable'),
      { code: 'RANK1_ATLAS_EVIDENCE_UNAVAILABLE' }); },
    connect: async () => { unavailableConnections += 1; },
  }), { code: 'RANK1_ATLAS_EVIDENCE_UNAVAILABLE' });
  assert.equal(unavailableConnections, 0);
  for (const [badRuntime, message] of [
    [{ ...runtime, databaseName: 'wecooked-production' }, /Connected database differs/],
    [{ ...runtime, status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserRoles: [{ db: configuration.connectedDatabase, role: 'readWrite' }],
    } } }, /Authenticated roles differ/],
    [{ ...runtime, status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserPrivileges: [{ resource: { db: configuration.connectedDatabase,
        collection: '' }, actions: ['find'] }],
    } } }, /broad, protected-database/],
    [{ ...runtime, build: { version: '8.0.1' } }, /Runtime server version differs/],
  ]) {
    let fixtureReads = 0;
    const fakeCollection = { countDocuments: () => { fixtureReads += 1; return 0; } };
    const fakeConnection = { db: { databaseName: badRuntime.databaseName,
      admin: () => ({ command: async (command) => {
        assert.ok(!command.getParameter, 'M0 preflight must not require getParameter');
        return command.hello ? badRuntime.hello : command.buildInfo ? badRuntime.build
          : badRuntime.status;
      } }) } };
    await assert.rejects(() => connectForAuthoringPhysicalProof({ uri, path: 'synthetic',
      configuration, mode: 'authoring', approvalOptions,
      fetchAtlasEvidence: async () => evidence,
      connect: async () => { connections += 1; }, connection: fakeConnection,
      disconnect: async () => {}, collections: { recipes: fakeCollection,
        ingredients: fakeCollection },
    }), message);
    assert.equal(fixtureReads, 0, 'Connected checks precede fixture access and writes');
  }
});

test('isolated Mongo evaluates mixed consumer eligibility before every page and total', {
  skip: process.env.RECIPE_RANKING_MONGO_RUN !== 'authoring',
  timeout: 60000,
}, async (t) => {
  await connectForAuthoringPhysicalProof({ onStage: stage => t.diagnostic(stage) });
  const activeIngredientId = new mongoose.Types.ObjectId();
  const inactiveIngredientId = new mongoose.Types.ObjectId();
  const ids = Array.from({ length: 14 }, () => new mongoose.Types.ObjectId());
  const base = {
    title: 'Eligible recipe',
    description: 'A complete recipe.',
    difficulty: 'easy',
    cookTimeMinutes: 30,
    servings: 4,
    ingredients: [{ ingredientId: activeIngredientId, quantity: 1, unit: 'kg', optional: false }],
    instructions: ['Cook until ready.'],
    dietaryTags: [],
    imageUrl: null,
    isActive: true,
    publicationStatus: 'published',
  };
  const row = (index, changes = {}) => ({
    ...base, _id: ids[index], createdAt: new Date(Date.UTC(2026, 8, 30 - index)),
    updatedAt: new Date(Date.UTC(2026, 8, 30 - index)), ...changes,
  });
  const legacy = row(3);
  delete legacy.publicationStatus;
  const noDescription = row(9);
  delete noDescription.description;
  const noInstructions = row(10);
  delete noInstructions.instructions;
  const rows = [
    row(0, { publicationStatus: 'draft' }),
    row(1, { description: '   ' }),
    row(2, { ingredients: [{ ingredientId: inactiveIngredientId, quantity: 1, unit: 'kg' }] }),
    legacy,
    row(4, { isActive: false }),
    row(5),
    row(6, { difficulty: undefined }),
    row(7),
    row(8, { instructions: [] }),
    noDescription,
    noInstructions,
    row(11, { imageUrl: 'https://example.com/picture.jpg', imageUrlIsPublicHttps: false }),
    row(12, { imageUrl: 'https://example.com/picture.jpg' }),
    row(13, { imageUrl: 'https://example.com/picture.jpg', imageUrlIsPublicHttps: true }),
  ];
  try {
    await Ingredient.collection.insertMany([
      { _id: activeIngredientId, name: 'Rank1 active fixture', isActive: true },
      { _id: inactiveIngredientId, name: 'Rank1 inactive fixture', isActive: false },
    ]);
    t.diagnostic('Ingredient fixtures inserted');
    await Recipe.collection.insertMany(rows);
    t.diagnostic('Recipe fixtures inserted');
    const readPage = async (page) => {
      const result = await recipeService.listRecipes({
        status: 'active', page, limit: 2, sort: 'newest', isAdmin: false,
      });
      t.diagnostic(`page ${page} resolved`);
      return result;
    };
    const pages = await Promise.all([readPage(1), readPage(2), readPage(3), readPage(4)]);
    assert.deepEqual(pages.map(({ items }) => items.map(({ _id }) => String(_id))), [
      [String(ids[3]), String(ids[5])],
      [String(ids[7]), String(ids[13])],
      [], [],
    ]);
    assert.deepEqual(pages.map(({ total }) => total), [4, 4, 4, 4]);
    assert.deepEqual(pages.map(({ page, limit }) => [page, limit]), [
      [1, 2], [2, 2], [3, 2], [4, 2],
    ]);
  } finally {
    t.diagnostic('fixture cleanup started');
    await Recipe.collection.deleteMany({ _id: { $in: ids } });
    t.diagnostic('Recipe fixtures removed');
    await Ingredient.collection.deleteMany({ _id: { $in: [activeIngredientId, inactiveIngredientId] } });
    t.diagnostic('Ingredient fixtures removed');
    await mongoose.disconnect();
    t.diagnostic('Mongo disconnected');
  }
});

test('consumer list query requests Published-or-legacy records while staff can inspect Drafts', async (t) => {
  const draft = populated(fullRecipe());
  let consumerQuery;
  const staffQueries = [];
  t.mock.method(recipeRepository, 'findConsumerPage', async (query) => {
    consumerQuery = query;
    return { items: [], total: 0 };
  });
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => {
    staffQueries.push(filter);
    return [draft];
  });
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const consumer = await recipeService.listRecipes({ status: 'active', page: 1, limit: 20, sort: 'newest', isAdmin: false });
  const staff = await recipeService.listRecipes({ status: 'active', page: 1, limit: 20, sort: 'newest', isAdmin: true });

  assert.deepEqual(consumer.items, []);
  assert.equal(consumer.total, 0);
  assert.equal(staff.items.length, 1);
  assert.deepEqual(consumerQuery.filter.$and[0].$or, [
    { publicationStatus: 'published' },
    { publicationStatus: { $exists: false } },
  ]);
  assert.deepEqual(consumerQuery.sort, { createdAt: -1, _id: 1 });
  assert.equal(staffQueries[0].$and, undefined);
});

test('newest/oldest retain pre-M20 createdAt ordering while consumer publication filtering remains active', async (t) => {
  const seen = [];
  t.mock.method(recipeRepository, 'findConsumerPage', async ({ filter, sort }) => {
    seen.push({ filter, sort });
    return { items: [], total: 0 };
  });

  await recipeService.listRecipes({ status: 'active', page: 1, limit: 20, sort: 'newest', isAdmin: false });
  await recipeService.listRecipes({ status: 'active', page: 1, limit: 20, sort: 'oldest', isAdmin: false });

  assert.deepEqual(seen[0].sort, { createdAt: -1, _id: 1 });
  assert.deepEqual(seen[1].sort, { createdAt: 1, _id: 1 });
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
  t.mock.method(recipeRepository, 'findRawById', async () => fullRecipe({ isActive: true }));
  t.mock.method(recipeRepository, 'archiveById', async () => populated(fullRecipe({ isActive: false })));
  const archived = await recipeService.archiveRecipe(RECIPE_ID, {}, { actorId: MODERATOR_ID });
  assert.equal(archived.publicationStatus, 'draft');

  recipeRepository.findRawById.mock.mockImplementation(async () => fullRecipe({ isActive: false, ingredients: [], instructions: [] }));
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
