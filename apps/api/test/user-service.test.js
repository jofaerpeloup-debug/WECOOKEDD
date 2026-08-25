process.env.NODE_ENV = 'test';
process.env.PORT = '4013';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const userRepository = require('../src/modules/users/user.repository');
const userService = require('../src/modules/users/user.service');
const { hashPassword } = require('../src/shared/security/password');
const { AppError } = require('../src/shared/errors/app-error');

test('registerUser normalizes the email, hashes the password, and delegates to the repository', async (t) => {
  let capturedArgs;
  t.mock.method(userRepository, 'createUser', async (args) => {
    capturedArgs = args;
    return { _id: 'user-1', ...args, role: 'user', status: 'active' };
  });

  const user = await userService.registerUser({
    name: 'Ada',
    email: '  Ada@Example.com  ',
    password: 'a-good-password',
  });

  assert.equal(capturedArgs.email, 'ada@example.com');
  assert.notEqual(capturedArgs.passwordHash, 'a-good-password');
  assert.match(capturedArgs.passwordHash, /^\$2[aby]\$/);
  assert.equal(user.role, 'user');
});

test('registerUser translates a MongoDB duplicate-key error into USER_EMAIL_ALREADY_EXISTS', async (t) => {
  t.mock.method(userRepository, 'createUser', async () => {
    const err = new Error('E11000 duplicate key error collection: wecooked.users index: email_1');
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () => userService.registerUser({ name: 'Ada', email: 'ada@example.com', password: 'a-good-password' }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'USER_EMAIL_ALREADY_EXISTS');
      return true;
    }
  );
});

test('registerUser rethrows unrelated repository errors as-is', async (t) => {
  t.mock.method(userRepository, 'createUser', async () => {
    throw new Error('unexpected database failure');
  });

  await assert.rejects(
    () => userService.registerUser({ name: 'Ada', email: 'ada@example.com', password: 'a-good-password' }),
    /unexpected database failure/
  );
});

test('verifyCredentials returns the user when the password matches', async (t) => {
  const passwordHash = await hashPassword('correct-password');
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => ({
    _id: 'user-1',
    email: 'ada@example.com',
    passwordHash,
    role: 'user',
    status: 'active',
  }));

  const user = await userService.verifyCredentials('ada@example.com', 'correct-password');
  assert.ok(user);
  assert.equal(user.email, 'ada@example.com');
});

test('verifyCredentials returns null for a wrong password', async (t) => {
  const passwordHash = await hashPassword('correct-password');
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => ({
    _id: 'user-1',
    email: 'ada@example.com',
    passwordHash,
    role: 'user',
    status: 'active',
  }));

  const user = await userService.verifyCredentials('ada@example.com', 'wrong-password');
  assert.equal(user, null);
});

test('verifyCredentials returns null for an unknown email (same result shape as wrong password)', async (t) => {
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => null);

  const user = await userService.verifyCredentials('nobody@example.com', 'whatever');
  assert.equal(user, null);
});

test('getUserById delegates to the repository', async (t) => {
  t.mock.method(userRepository, 'findById', async (id) => ({ _id: id }));
  const user = await userService.getUserById('user-1');
  assert.equal(user._id, 'user-1');
});
