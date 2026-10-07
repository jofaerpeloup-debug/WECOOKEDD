process.env.NODE_ENV = 'test';
process.env.PORT = '4098';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/shared/security/access-token');
const sessionRepository = require('../src/modules/sessions/session.repository');
const userRepository = require('../src/modules/users/user.repository');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const ingredientRepository = require('../src/modules/ingredients/ingredient.repository');
const substitutionRepository = require('../src/modules/substitutions/substitution.repository');
const applicationRepository = require('../src/modules/moderator-applications/moderator-application.repository');
const auditLogRepository = require('../src/modules/audit/audit-log.repository');

const app = createApp();
const ADMIN_ID = '507f1f77bcf86cd799439501';
const SESSION_ID = '507f1f77bcf86cd799439502';
const TARGET_USER_ID = '507f1f77bcf86cd799439503';
const RECIPE_ID = '507f1f77bcf86cd799439504';
const INGREDIENT_ID = '507f1f77bcf86cd799439505';
const MODERATOR_ID = '507f1f77bcf86cd799439506';
const MODERATOR_SESSION_ID = '507f1f77bcf86cd799439507';

const adminToken = signAccessToken({
  userId: ADMIN_ID,
  role: 'admin',
  sessionId: SESSION_ID,
});

const moderatorToken = signAccessToken({
  userId: MODERATOR_ID,
  role: 'moderator',
  sessionId: MODERATOR_SESSION_ID,
});

function mockAdminAuth(t) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: SESSION_ID,
    userId: ADMIN_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: ADMIN_ID,
    role: 'admin',
    status: 'active',
  }));
}

function mockModeratorAuth(t) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: MODERATOR_SESSION_ID,
    userId: MODERATOR_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: MODERATOR_ID,
    role: 'moderator',
    status: 'active',
  }));
}

function authenticated(builder) {
  return builder.set('Authorization', `Bearer ${adminToken}`);
}

function authenticatedModerator(builder) {
  return builder.set('Authorization', `Bearer ${moderatorToken}`);
}

function assertValidationError(response) {
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
}

function failIfCalled(name) {
  return async () => {
    throw new Error(`${name} must not receive an operator-shaped request value`);
  };
}

test('admin user filters reject bracketed Mongo operators before query construction', async (t) => {
  mockAdminAuth(t);
  t.mock.method(userRepository, 'findMany', failIfCalled('userRepository.findMany'));
  t.mock.method(userRepository, 'countByFilter', failIfCalled('userRepository.countByFilter'));

  const response = await authenticated(
    request(app).get('/api/v1/users?search%5B%24regex%5D=.*')
  );

  assertValidationError(response);
});

test('recipe filters reject bracketed Mongo operators before query construction', async (t) => {
  mockAdminAuth(t);
  t.mock.method(recipeRepository, 'findMany', failIfCalled('recipeRepository.findMany'));
  t.mock.method(recipeRepository, 'countByFilter', failIfCalled('recipeRepository.countByFilter'));

  const response = await authenticated(
    request(app).get('/api/v1/recipes?maxPrepTimeMinutes%5B%24gt%5D=0')
  );

  assertValidationError(response);
});

test('DISC6 recipe filters reject operator-shaped values before query construction', async (t) => {
  mockAdminAuth(t);
  t.mock.method(recipeRepository, 'findMany', failIfCalled('recipeRepository.findMany'));
  t.mock.method(recipeRepository, 'countByFilter', failIfCalled('recipeRepository.countByFilter'));

  for (const query of [
    'dietaryTags%5B%24all%5D=vegan',
    'totalTimeBucket%5B%24gt%5D=60',
    'dietaryTags=%24ne',
    'totalTimeBucket=%24expr',
  ]) {
    const response = await authenticated(request(app).get(`/api/v1/recipes?${query}`));
    assertValidationError(response);
  }
});

test('catalog list filters reject bracketed Mongo operators before query construction', async (t) => {
  mockAdminAuth(t);
  t.mock.method(ingredientRepository, 'findMany', failIfCalled('ingredientRepository.findMany'));
  t.mock.method(ingredientRepository, 'countByFilter', failIfCalled('ingredientRepository.countByFilter'));

  const response = await authenticated(
    request(app).get('/api/v1/ingredients?category%5B%24ne%5D=produce')
  );

  assertValidationError(response);
});

test('substitution filters reject bracketed Mongo operators before query construction', async (t) => {
  mockAdminAuth(t);
  t.mock.method(substitutionRepository, 'findMany', failIfCalled('substitutionRepository.findMany'));
  t.mock.method(
    substitutionRepository,
    'countByFilter',
    failIfCalled('substitutionRepository.countByFilter')
  );

  const response = await authenticated(
    request(app).get('/api/v1/substitutions?context%5B%24regex%5D=.*')
  );

  assertValidationError(response);
});

test('staff filters reject bracketed Mongo operators before query construction', async (t) => {
  mockAdminAuth(t);
  t.mock.method(
    applicationRepository,
    'findManyForAdmin',
    failIfCalled('applicationRepository.findManyForAdmin')
  );
  t.mock.method(
    applicationRepository,
    'countByStatus',
    failIfCalled('applicationRepository.countByStatus')
  );

  const response = await authenticated(
    request(app).get('/api/v1/staff/moderator-applications?status%5B%24ne%5D=pending')
  );

  assertValidationError(response);
});

test('audit filters reject bracketed Mongo operators before query construction', async (t) => {
  mockAdminAuth(t);
  t.mock.method(auditLogRepository, 'findMany', failIfCalled('auditLogRepository.findMany'));
  t.mock.method(
    auditLogRepository,
    'countByFilter',
    failIfCalled('auditLogRepository.countByFilter')
  );

  const response = await authenticated(
    request(app).get('/api/v1/admin/audit-logs?actorUserId%5B%24ne%5D=')
  );

  assertValidationError(response);
});

test('recipe updates reject nested operator objects before lookup or update', async (t) => {
  mockModeratorAuth(t);
  t.mock.method(recipeRepository, 'findRawById', failIfCalled('recipeRepository.findRawById'));
  t.mock.method(recipeRepository, 'updateById', failIfCalled('recipeRepository.updateById'));

  const response = await authenticatedModerator(
    request(app)
      .patch(`/api/v1/recipes/${RECIPE_ID}`)
      .send({ title: { $where: 'return true' } })
  );

  assertValidationError(response);
});

test('catalog updates reject nested operator objects before lookup or update', async (t) => {
  mockModeratorAuth(t);
  t.mock.method(ingredientRepository, 'findById', failIfCalled('ingredientRepository.findById'));
  t.mock.method(ingredientRepository, 'updateById', failIfCalled('ingredientRepository.updateById'));

  const response = await authenticatedModerator(
    request(app)
      .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
      .send({ name: { $ne: null } })
  );

  assertValidationError(response);
});

test('admin user updates reject operator objects without performing a target lookup', async (t) => {
  let findByIdCalls = 0;
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: SESSION_ID,
    userId: ADMIN_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => {
    findByIdCalls += 1;
    return { _id: ADMIN_ID, role: 'admin', status: 'active' };
  });
  t.mock.method(
    userRepository,
    'updateStatusIfCurrent',
    failIfCalled('userRepository.updateStatusIfCurrent')
  );

  const response = await authenticated(
    request(app)
      .patch(`/api/v1/users/${TARGET_USER_ID}`)
      .send({ status: { $ne: 'suspended' } })
  );

  assertValidationError(response);
  assert.equal(findByIdCalls, 1, 'only authenticate may load a user');
});
