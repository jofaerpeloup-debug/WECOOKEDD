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
const sessionService = require('../src/modules/sessions/session.service');
const { hashPassword, comparePassword } = require('../src/shared/security/password');
const { hashPasswordResetToken } = require('../src/shared/security/password-reset-token');
const { AppError } = require('../src/shared/errors/app-error');

const ACTING_ADMIN_ID = '507f1f77bcf86cd799439001';
const TARGET_USER_ID = '507f1f77bcf86cd799439002';

function fakeUser(overrides = {}) {
  return {
    _id: TARGET_USER_ID,
    name: 'Target',
    email: 'target@example.com',
    role: 'user',
    status: 'active',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

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

test('social identity lookup is a thin provider/subject repository wrapper', async (t) => {
  let captured;
  t.mock.method(userRepository, 'findByAuthIdentity', async (...args) => {
    captured = args;
    return fakeUser();
  });
  await userService.getUserByAuthIdentity('google', 'stable-subject');
  assert.deepEqual(captured, ['google', 'stable-subject']);
});

test('social email lookup normalizes before delegating', async (t) => {
  let captured;
  t.mock.method(userRepository, 'findByEmail', async (email) => {
    captured = email;
    return null;
  });
  await userService.getUserByEmail('  ADA@Example.com ');
  assert.equal(captured, 'ada@example.com');
});

test('social creation normalizes email and forwards only the explicit B4.0 fields', async (t) => {
  let captured;
  t.mock.method(userRepository, 'createSocialUser', async (args) => {
    captured = args;
    return fakeUser();
  });
  const authIdentity = { provider: 'google', subject: 'stable-subject', linkedAt: new Date() };
  await userService.createSocialUser({
    name: 'Ada',
    email: ' ADA@Example.com ',
    emailVerified: true,
    authIdentity,
  });
  assert.deepEqual(captured, {
    name: 'Ada',
    email: 'ada@example.com',
    emailVerified: true,
    authIdentity,
  });
  assert.equal('passwordHash' in captured, false);
  assert.equal('role' in captured, false);
  assert.equal('status' in captured, false);
});

test('social linking is a thin user-id/identity repository wrapper', async (t) => {
  let captured;
  t.mock.method(userRepository, 'linkAuthIdentity', async (...args) => {
    captured = args;
    return fakeUser();
  });
  const identity = { provider: 'google', subject: 'stable-subject', linkedAt: new Date() };
  await userService.linkAuthIdentity(TARGET_USER_ID, identity);
  assert.deepEqual(captured, [TARGET_USER_ID, identity]);
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

test('verifyCredentials returns null (never throws) for a provider-only user with no passwordHash', async (t) => {
  // Google-only signups never get a passwordHash (see createSocialUser) —
  // the field is simply absent, not an empty string. A previous bug here
  // called bcrypt.compare(password, undefined), which throws
  // "Illegal arguments: string, undefined" and surfaced as a 500.
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => ({
    _id: 'user-1',
    email: 'google-only@example.com',
    passwordHash: undefined,
    role: 'user',
    status: 'active',
    authIdentities: [{ provider: 'google', subject: 'sub-1', linkedAt: new Date() }],
  }));

  const user = await userService.verifyCredentials('google-only@example.com', 'whatever');
  assert.equal(user, null);
});

test('verifyCredentials returns null for a user whose passwordHash is an empty/blank string', async (t) => {
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => ({
    _id: 'user-1',
    email: 'blank-hash@example.com',
    passwordHash: '   ',
    role: 'user',
    status: 'active',
  }));

  const user = await userService.verifyCredentials('blank-hash@example.com', 'whatever');
  assert.equal(user, null);
});

test('verifyCredentials never rejects/throws for any credential combination (no internal error leaks)', async (t) => {
  const passwordHash = await hashPassword('correct-password');
  const cases = [
    { label: 'unknown email', mockUser: null, password: 'whatever' },
    { label: 'wrong password', mockUser: { passwordHash }, password: 'wrong-password' },
    { label: 'provider-only user', mockUser: { passwordHash: undefined }, password: 'whatever' },
    { label: 'suspended user, correct password', mockUser: { passwordHash, status: 'suspended' }, password: 'correct-password' },
  ];

  for (const { mockUser, password } of cases) {
    t.mock.method(userRepository, 'findByEmailWithPassword', async () =>
      mockUser
        ? {
            _id: 'user-1',
            email: 'target@example.com',
            role: 'user',
            status: 'active',
            ...mockUser,
          }
        : null
    );
    await assert.doesNotReject(() => userService.verifyCredentials('target@example.com', password));
  }
});

test('getUserById delegates to the repository', async (t) => {
  t.mock.method(userRepository, 'findById', async (id) => ({ _id: id }));
  const user = await userService.getUserById('user-1');
  assert.equal(user._id, 'user-1');
});

// ---------------------------------------------------------------------------
// listUsers
// ---------------------------------------------------------------------------

test('listUsers builds the filter field-by-field and regex-escapes the search', async (t) => {
  let captured;
  t.mock.method(userRepository, 'findMany', async (args) => {
    captured = args;
    return [fakeUser()];
  });
  t.mock.method(userRepository, 'countByFilter', async () => 1);

  const result = await userService.listUsers({
    search: 'a.b+c',
    role: 'admin',
    status: 'active',
    sort: 'nameAsc',
    page: 2,
    limit: 20,
  });

  assert.deepEqual(captured.filter.role, 'admin');
  assert.deepEqual(captured.filter.status, 'active');
  assert.equal(captured.filter.$or.length, 2);
  // Metacharacters are escaped — the source is a literal-substring pattern.
  assert.equal(captured.filter.$or[0].name.source, 'a\\.b\\+c');
  assert.equal(captured.filter.$or[0].name.flags.includes('i'), true);
  assert.deepEqual(captured.sort, { name: 1, _id: 1 });
  assert.equal(captured.skip, 20); // (page 2 - 1) * limit 20
  assert.equal(captured.limit, 20);
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
});

test('listUsers omits role/status/$or from the filter when not supplied', async (t) => {
  let captured;
  t.mock.method(userRepository, 'findMany', async (args) => {
    captured = args;
    return [];
  });
  t.mock.method(userRepository, 'countByFilter', async () => 0);

  await userService.listUsers({ sort: 'newest', page: 1, limit: 20 });

  assert.deepEqual(captured.filter, {});
  assert.deepEqual(captured.sort, { createdAt: -1, _id: -1 });
  assert.equal(captured.skip, 0);
});

// ---------------------------------------------------------------------------
// adminUpdateUser — target resolution & self-protection
// ---------------------------------------------------------------------------

test('adminUpdateUser throws USER_NOT_FOUND when the target does not exist', async (t) => {
  t.mock.method(userRepository, 'findById', async () => null);

  await assert.rejects(
    () =>
      userService.adminUpdateUser({
        actingUserId: ACTING_ADMIN_ID,
        targetUserId: TARGET_USER_ID,
        patch: { status: 'suspended' },
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'USER_NOT_FOUND');
      return true;
    }
  );
});

// Defense in depth: adminUpdateUser is exported and directly callable. Even if
// an internal caller bypasses updateUserSchema and passes a `role` key, the
// service builds a status-only $set — `role` never reaches the repository.
test('adminUpdateUser ignores a role key in patch and writes ONLY status', async (t) => {
  t.mock.method(userRepository, 'findById', async () =>
    fakeUser({ role: 'user', status: 'active' })
  );
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id, ...update.$set });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { role: 'admin', status: 'active' },
  });

  assert.deepEqual(capturedUpdate, { $set: { status: 'active' } });
  assert.equal('role' in capturedUpdate.$set, false);
});

test('adminUpdateUser throws 400 VALIDATION_ERROR when patch has no supported writable field', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ role: 'user', status: 'active' }));
  let updated = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updated = true;
    return fakeUser();
  });

  await assert.rejects(
    () =>
      userService.adminUpdateUser({
        actingUserId: ACTING_ADMIN_ID,
        targetUserId: TARGET_USER_ID,
        patch: { role: 'admin' },
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
  assert.equal(updated, false);
});

test('adminUpdateUser rejects self-suspension with ADMIN_CANNOT_MODIFY_SELF', async (t) => {
  t.mock.method(userRepository, 'findById', async () =>
    fakeUser({ _id: ACTING_ADMIN_ID, role: 'admin', status: 'active' })
  );

  await assert.rejects(
    () =>
      userService.adminUpdateUser({
        actingUserId: ACTING_ADMIN_ID,
        targetUserId: ACTING_ADMIN_ID,
        patch: { status: 'suspended' },
      }),
    (err) => {
      assert.equal(err.code, 'ADMIN_CANNOT_MODIFY_SELF');
      return true;
    }
  );
});

test('adminUpdateUser self-protection is not bypassable by re-casing the target id', async (t) => {
  // Same ObjectId, upper-cased hex — ObjectId.isValid() accepts it and it
  // resolves to the same document, but a naive string compare would miss it.
  const selfUpper = ACTING_ADMIN_ID.toUpperCase();
  t.mock.method(userRepository, 'findById', async () =>
    fakeUser({ _id: ACTING_ADMIN_ID, role: 'admin', status: 'active' })
  );
  let updated = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updated = true;
    return fakeUser();
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);

  await assert.rejects(
    () =>
      userService.adminUpdateUser({
        actingUserId: ACTING_ADMIN_ID,
        targetUserId: selfUpper,
        patch: { status: 'suspended' },
      }),
    (err) => {
      assert.equal(err.code, 'ADMIN_CANNOT_MODIFY_SELF');
      return true;
    }
  );
  assert.equal(updated, false);
});

test('adminUpdateUser allows a harmless self no-op (status stays active)', async (t) => {
  t.mock.method(userRepository, 'findById', async () =>
    fakeUser({ _id: ACTING_ADMIN_ID, role: 'admin', status: 'active' })
  );
  t.mock.method(userRepository, 'updateById', async (id, update) =>
    fakeUser({ _id: id, role: 'admin', status: update.$set.status })
  );
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);

  const result = await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: ACTING_ADMIN_ID,
    patch: { status: 'active' },
  });
  assert.equal(result.status, 'active');
});

// ---------------------------------------------------------------------------
// adminUpdateUser — session / status transition ordering
// ---------------------------------------------------------------------------

function trackOrder(t, { updateResult = fakeUser(), revoke = async () => 0 } = {}) {
  const order = [];
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    order.push('update');
    return { ...updateResult, _id: id, ...update.$set };
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async (userId) => {
    order.push('revoke');
    return revoke(userId);
  });
  return order;
}

test('active -> active (no-op status) does not revoke sessions', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'active' }));
  const order = trackOrder(t);

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { status: 'active' },
  });

  assert.deepEqual(order, ['update']);
});

test('active -> suspended persists status THEN revokes sessions (order matters)', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'active' }));
  const order = trackOrder(t);

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { status: 'suspended' },
  });

  assert.deepEqual(order, ['update', 'revoke']);
});

test('suspended -> active revokes sessions FIRST, THEN persists active (order matters)', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'suspended' }));
  const order = trackOrder(t);

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { status: 'active' },
  });

  assert.deepEqual(order, ['revoke', 'update']);
});

test('suspended -> active: if revocation fails, the user is NOT reactivated', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'suspended' }));
  let updateCalled = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updateCalled = true;
    return fakeUser({ status: 'active' });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    throw new Error('session store unavailable');
  });

  await assert.rejects(
    () =>
      userService.adminUpdateUser({
        actingUserId: ACTING_ADMIN_ID,
        targetUserId: TARGET_USER_ID,
        patch: { status: 'active' },
      }),
    /session store unavailable/
  );
  assert.equal(updateCalled, false, 'status must not be flipped to active when revocation failed');
});

test('active -> suspended: if revocation fails, the status update already happened (no rollback)', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'active' }));
  let updateCalled = false;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    updateCalled = true;
    return fakeUser({ _id: id, ...update.$set });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    throw new Error('session store unavailable');
  });

  await assert.rejects(
    () =>
      userService.adminUpdateUser({
        actingUserId: ACTING_ADMIN_ID,
        targetUserId: TARGET_USER_ID,
        patch: { status: 'suspended' },
      }),
    /session store unavailable/
  );
  assert.equal(updateCalled, true, 'suspension is persisted before the revoke attempt');
});

test('a role key alongside status: suspended is stripped — repository sees status only, normal suspend ordering', async (t) => {
  t.mock.method(userRepository, 'findById', async () =>
    fakeUser({ role: 'admin', status: 'active' })
  );
  let capturedUpdate;
  const order = [];
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    order.push('update');
    capturedUpdate = update.$set;
    return fakeUser({ _id: id, ...update.$set });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    order.push('revoke');
    return 2;
  });

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { role: 'user', status: 'suspended' },
  });

  assert.deepEqual(capturedUpdate, { status: 'suspended' });
  assert.equal('role' in capturedUpdate, false);
  assert.deepEqual(order, ['update', 'revoke']);
});

test('a role key alongside status: active on a suspended user is stripped — status only, revoke-first ordering', async (t) => {
  t.mock.method(userRepository, 'findById', async () =>
    fakeUser({ role: 'user', status: 'suspended' })
  );
  let capturedUpdate;
  const order = [];
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    order.push('update');
    capturedUpdate = update.$set;
    return fakeUser({ _id: id, ...update.$set });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    order.push('revoke');
    return 1;
  });

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { role: 'admin', status: 'active' },
  });

  assert.deepEqual(capturedUpdate, { status: 'active' });
  assert.equal('role' in capturedUpdate, false);
  assert.deepEqual(order, ['revoke', 'update']);
});

test('adminUpdateUser throws USER_NOT_FOUND when the target is deleted between read and write', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'active' }));
  t.mock.method(userRepository, 'updateById', async () => null);
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);

  await assert.rejects(
    () =>
      userService.adminUpdateUser({
        actingUserId: ACTING_ADMIN_ID,
        targetUserId: TARGET_USER_ID,
        patch: { status: 'suspended' },
      }),
    (err) => {
      assert.equal(err.code, 'USER_NOT_FOUND');
      return true;
    }
  );
});
// ---------------------------------------------------------------------------
// updateOwnProfile  (self-profile, PATCH /api/v1/users/me)
// ---------------------------------------------------------------------------

const SELF_ID = '507f1f77bcf86cd799439077';

test('updateOwnProfile passes the exact caller id to the repository and returns its result', async (t) => {
  let capturedId;
  const doc = fakeUser({ _id: SELF_ID, name: 'Updated' });
  t.mock.method(userRepository, 'updateById', async (id) => {
    capturedId = id;
    return doc;
  });

  const result = await userService.updateOwnProfile({ userId: SELF_ID, patch: { name: 'Updated' } });

  assert.equal(capturedId, SELF_ID);
  assert.equal(result, doc);
});

test('updateOwnProfile name-only patch sets ONLY name in $set', async (t) => {
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id });
  });

  await userService.updateOwnProfile({ userId: SELF_ID, patch: { name: 'Solo' } });

  assert.deepEqual(capturedUpdate, { $set: { name: 'Solo' } });
});

test('updateOwnProfile allergies-only patch sets ONLY preferences.allergies (dot path, siblings untouched)', async (t) => {
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id });
  });

  await userService.updateOwnProfile({
    userId: SELF_ID,
    patch: { preferences: { allergies: ['Peanuts'] } },
  });

  assert.deepEqual(capturedUpdate, { $set: { 'preferences.allergies': ['Peanuts'] } });
  assert.equal('preferences' in capturedUpdate.$set, false);
  assert.equal('preferences.dietaryPreferences' in capturedUpdate.$set, false);
  assert.equal('preferences.notifications.enabled' in capturedUpdate.$set, false);
});

test('updateOwnProfile dietaryPreferences-only patch sets ONLY preferences.dietaryPreferences', async (t) => {
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id });
  });

  await userService.updateOwnProfile({
    userId: SELF_ID,
    patch: { preferences: { dietaryPreferences: ['Vegan', 'Vegan'] } },
  });

  assert.deepEqual(capturedUpdate, {
    $set: { 'preferences.dietaryPreferences': ['Vegan', 'Vegan'] },
  });
});

test('updateOwnProfile notifications-only patch sets ONLY preferences.notifications.enabled (false preserved)', async (t) => {
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id });
  });

  await userService.updateOwnProfile({
    userId: SELF_ID,
    patch: { preferences: { notifications: { enabled: false } } },
  });

  assert.deepEqual(capturedUpdate, { $set: { 'preferences.notifications.enabled': false } });
});

test('updateOwnProfile passes an empty allergies array through as [] (clear)', async (t) => {
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id });
  });

  await userService.updateOwnProfile({
    userId: SELF_ID,
    patch: { preferences: { allergies: [] } },
  });

  assert.deepEqual(capturedUpdate, { $set: { 'preferences.allergies': [] } });
});

test('updateOwnProfile combined patch emits every supplied dot-path and nothing else', async (t) => {
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id });
  });

  await userService.updateOwnProfile({
    userId: SELF_ID,
    patch: {
      name: 'Full',
      preferences: {
        dietaryPreferences: ['Halal'],
        allergies: ['Soy'],
        notifications: { enabled: true },
      },
    },
  });

  assert.deepEqual(capturedUpdate, {
    $set: {
      name: 'Full',
      'preferences.dietaryPreferences': ['Halal'],
      'preferences.allergies': ['Soy'],
      'preferences.notifications.enabled': true,
    },
  });
});

test('updateOwnProfile keeps duplicate preference entries (no dedupe at the service layer)', async (t) => {
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id });
  });

  await userService.updateOwnProfile({
    userId: SELF_ID,
    patch: { preferences: { dietaryPreferences: ['Vegan', 'Vegan', 'vegan'] } },
  });

  assert.deepEqual(capturedUpdate.$set['preferences.dietaryPreferences'], ['Vegan', 'Vegan', 'vegan']);
});

test('updateOwnProfile throws 401 AUTH_SESSION_INVALID when the user no longer exists', async (t) => {
  t.mock.method(userRepository, 'updateById', async () => null);

  await assert.rejects(
    () => userService.updateOwnProfile({ userId: SELF_ID, patch: { name: 'Ghost' } }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.code, 'AUTH_SESSION_INVALID');
      return true;
    }
  );
});

test('updateOwnProfile propagates an unexpected repository error unchanged', async (t) => {
  t.mock.method(userRepository, 'updateById', async () => {
    throw new Error('db exploded');
  });

  await assert.rejects(
    () => userService.updateOwnProfile({ userId: SELF_ID, patch: { name: 'x' } }),
    /db exploded/
  );
});

test('updateOwnProfile never calls the session service', async (t) => {
  const revoke = t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);
  t.mock.method(userRepository, 'updateById', async (id) => fakeUser({ _id: id }));

  await userService.updateOwnProfile({
    userId: SELF_ID,
    patch: { name: 'Quiet', preferences: { notifications: { enabled: false } } },
  });

  assert.equal(revoke.mock.callCount(), 0);
});

// ---------------------------------------------------------------------------
// changePassword  (self-service, POST /api/v1/auth/change-password)
// ---------------------------------------------------------------------------

const PW_USER_ID = '507f1f77bcf86cd799439088';

async function fakePasswordUser(currentPassword, overrides = {}) {
  return {
    _id: PW_USER_ID,
    email: 'admin@example.com',
    role: 'admin',
    status: 'active',
    passwordHash: await hashPassword(currentPassword),
    ...overrides,
  };
}

test('changePassword: happy path — loads by authenticated id, verifies current, persists a bcrypt hash of the new password', async (t) => {
  let lookupId;
  t.mock.method(userRepository, 'findByIdWithPassword', async (id) => {
    lookupId = id;
    return fakePasswordUser('current-secret');
  });
  let writeArgs;
  t.mock.method(userRepository, 'replacePasswordById', async (id, passwordHash) => {
    writeArgs = { id, passwordHash };
    return { matchedCount: 1, modifiedCount: 1 };
  });

  await userService.changePassword({
    userId: PW_USER_ID,
    currentPassword: 'current-secret',
    newPassword: 'brand-new-secret',
  });

  assert.equal(lookupId, PW_USER_ID);
  assert.equal(writeArgs.id, PW_USER_ID);
  // Repository receives a bcrypt hash, never the plaintext.
  assert.notEqual(writeArgs.passwordHash, 'brand-new-secret');
  assert.match(writeArgs.passwordHash, /^\$2[aby]\$/);
  assert.equal(await comparePassword('brand-new-secret', writeArgs.passwordHash), true);
});

test('changePassword: a local-plus-social user remains eligible because the hash exists', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () =>
    fakePasswordUser('current-secret', {
      authIdentities: [{ provider: 'google', subject: 'stable-subject' }],
    })
  );
  const write = t.mock.method(userRepository, 'replacePasswordById', async () => ({
    matchedCount: 1,
  }));

  await userService.changePassword({
    userId: PW_USER_ID,
    currentPassword: 'current-secret',
    newPassword: 'brand-new-secret',
  });

  assert.equal(write.mock.callCount(), 1);
});

test('changePassword: the repository write receives exactly (id, passwordHash) and no plaintext field', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => fakePasswordUser('current-secret'));
  let allArgs;
  t.mock.method(userRepository, 'replacePasswordById', async (...args) => {
    allArgs = args;
    return { matchedCount: 1 };
  });

  await userService.changePassword({
    userId: PW_USER_ID,
    currentPassword: 'current-secret',
    newPassword: 'brand-new-secret',
  });

  assert.equal(allArgs.length, 2);
  assert.equal(allArgs[0], PW_USER_ID);
  assert.equal(typeof allArgs[1], 'string');
  assert.equal(allArgs.includes('brand-new-secret'), false);
  assert.equal(allArgs.includes('current-secret'), false);
});

test('changePassword: wrong current password → 400 AUTH_CURRENT_PASSWORD_INVALID, nothing persisted', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => fakePasswordUser('current-secret'));
  let written = false;
  t.mock.method(userRepository, 'replacePasswordById', async () => {
    written = true;
    return { matchedCount: 1 };
  });

  await assert.rejects(
    () =>
      userService.changePassword({
        userId: PW_USER_ID,
        currentPassword: 'not-the-current-password',
        newPassword: 'brand-new-secret',
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'AUTH_CURRENT_PASSWORD_INVALID');
      return true;
    }
  );
  assert.equal(written, false);
});

test('changePassword: new password equal to current → 400 NEW_PASSWORD_SAME_AS_CURRENT, nothing persisted', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => fakePasswordUser('current-secret'));
  let written = false;
  t.mock.method(userRepository, 'replacePasswordById', async () => {
    written = true;
    return { matchedCount: 1 };
  });

  await assert.rejects(
    () =>
      userService.changePassword({
        userId: PW_USER_ID,
        currentPassword: 'current-secret',
        newPassword: 'current-secret',
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'NEW_PASSWORD_SAME_AS_CURRENT');
      return true;
    }
  );
  assert.equal(written, false);
});

test('changePassword: user no longer exists → 401 AUTH_SESSION_INVALID', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => null);

  await assert.rejects(
    () =>
      userService.changePassword({
        userId: PW_USER_ID,
        currentPassword: 'current-secret',
        newPassword: 'brand-new-secret',
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.code, 'AUTH_SESSION_INVALID');
      return true;
    }
  );
});

test('changePassword: social-only account without a hash → 400 AUTH_PASSWORD_CHANGE_UNAVAILABLE', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => ({
    _id: PW_USER_ID,
    email: 'admin@example.com',
    role: 'admin',
    status: 'active',
    authIdentities: [{ provider: 'google', subject: 'stable-subject' }],
    passwordHash: undefined,
  }));

  await assert.rejects(
    () =>
      userService.changePassword({
        userId: PW_USER_ID,
        currentPassword: 'whatever',
        newPassword: 'brand-new-secret',
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'AUTH_PASSWORD_CHANGE_UNAVAILABLE');
      return true;
    }
  );
});

test('changePassword: account with an empty hash → 400 AUTH_PASSWORD_CHANGE_UNAVAILABLE', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => ({
    _id: PW_USER_ID,
    authIdentities: [],
    passwordHash: '   ',
  }));

  await assert.rejects(
    () =>
      userService.changePassword({
        userId: PW_USER_ID,
        currentPassword: 'whatever',
        newPassword: 'brand-new-secret',
      }),
    (err) => {
      assert.equal(err.code, 'AUTH_PASSWORD_CHANGE_UNAVAILABLE');
      return true;
    }
  );
});

test('changePassword: replacePasswordById matches no document (deleted mid-request) → 401 AUTH_SESSION_INVALID', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => fakePasswordUser('current-secret'));
  t.mock.method(userRepository, 'replacePasswordById', async () => ({ matchedCount: 0, modifiedCount: 0 }));

  await assert.rejects(
    () =>
      userService.changePassword({
        userId: PW_USER_ID,
        currentPassword: 'current-secret',
        newPassword: 'brand-new-secret',
      }),
    (err) => {
      assert.equal(err.statusCode, 401);
      assert.equal(err.code, 'AUTH_SESSION_INVALID');
      return true;
    }
  );
});

test('changePassword: an unexpected repository persistence error propagates unchanged', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => fakePasswordUser('current-secret'));
  t.mock.method(userRepository, 'replacePasswordById', async () => {
    throw new Error('db exploded');
  });

  await assert.rejects(
    () =>
      userService.changePassword({
        userId: PW_USER_ID,
        currentPassword: 'current-secret',
        newPassword: 'brand-new-secret',
      }),
    /db exploded/
  );
});

test('changePassword: returns nothing (no user object, no hash) on success', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => fakePasswordUser('current-secret'));
  t.mock.method(userRepository, 'replacePasswordById', async () => ({ matchedCount: 1 }));

  const result = await userService.changePassword({
    userId: PW_USER_ID,
    currentPassword: 'current-secret',
    newPassword: 'brand-new-secret',
  });

  assert.equal(result, undefined);
});

test('changePassword: does not revoke sessions itself (AuthService orchestrates that)', async (t) => {
  t.mock.method(userRepository, 'findByIdWithPassword', async () => fakePasswordUser('current-secret'));
  t.mock.method(userRepository, 'replacePasswordById', async () => ({ matchedCount: 1 }));
  const revoke = t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);

  await userService.changePassword({
    userId: PW_USER_ID,
    currentPassword: 'current-secret',
    newPassword: 'brand-new-secret',
  });

  assert.equal(revoke.mock.callCount(), 0);
});

test('preparePasswordReset stores a digest only for an eligible normalized local account', async (t) => {
  const user = await fakePasswordUser('current-secret', { email: 'ada@example.com' });
  let lookupEmail;
  let stored;
  t.mock.method(userRepository, 'findByEmailWithPassword', async (email) => {
    lookupEmail = email;
    return user;
  });
  t.mock.method(
    userRepository,
    'setPasswordResetTokenForEligibleUser',
    async (userId, tokenHash, expiresAt) => {
      stored = { userId, tokenHash, expiresAt };
      return { matchedCount: 1 };
    }
  );
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const result = await userService.preparePasswordReset({
    email: '  ADA@EXAMPLE.COM ',
    tokenHash: 'stored-digest',
    expiresAt,
  });

  assert.equal(lookupEmail, 'ada@example.com');
  assert.deepEqual(stored, { userId: PW_USER_ID, tokenHash: 'stored-digest', expiresAt });
  assert.deepEqual(result, { userId: PW_USER_ID, email: 'ada@example.com' });
});

test('preparePasswordReset returns the same null result for nonexistent, suspended, and social-only accounts', async (t) => {
  const candidates = [
    null,
    await fakePasswordUser('current-secret', { status: 'suspended' }),
    {
      ...(await fakePasswordUser('current-secret')),
      authIdentities: [{ provider: 'google', subject: 'stable-subject' }],
      passwordHash: undefined,
    },
  ];
  let index = 0;
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => candidates[index++]);
  const store = t.mock.method(
    userRepository,
    'setPasswordResetTokenForEligibleUser',
    async () => ({ matchedCount: 1 })
  );

  for (const ignored of candidates) {
    void ignored;
    const result = await userService.preparePasswordReset({
      email: 'ada@example.com',
      tokenHash: 'digest',
      expiresAt: new Date(),
    });
    assert.equal(result, null);
  }
  assert.equal(store.mock.callCount(), 0);
});

test('preparePasswordReset treats an empty hash as generically ineligible', async (t) => {
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => ({
    _id: PW_USER_ID,
    email: 'ada@example.com',
    status: 'active',
    authIdentities: [{ provider: 'google', subject: 'stable-subject' }],
    passwordHash: '   ',
  }));
  const store = t.mock.method(
    userRepository,
    'setPasswordResetTokenForEligibleUser',
    async () => ({ matchedCount: 1 })
  );

  const result = await userService.preparePasswordReset({
    email: 'ada@example.com',
    tokenHash: 'digest',
    expiresAt: new Date(),
  });

  assert.equal(result, null);
  assert.equal(store.mock.callCount(), 0);
});

test('preparePasswordReset keeps local-plus-social users eligible when a hash exists', async (t) => {
  const user = await fakePasswordUser('current-secret', {
    email: 'ada@example.com',
    authIdentities: [{ provider: 'google', subject: 'stable-subject' }],
  });
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => user);
  const store = t.mock.method(
    userRepository,
    'setPasswordResetTokenForEligibleUser',
    async () => ({ matchedCount: 1 })
  );

  const result = await userService.preparePasswordReset({
    email: 'ada@example.com',
    tokenHash: 'digest',
    expiresAt: new Date(),
  });

  assert.deepEqual(result, { userId: PW_USER_ID, email: 'ada@example.com' });
  assert.equal(store.mock.callCount(), 1);
});

test('resetPasswordWithToken persists only a bcrypt hash and returns the matched user id', async (t) => {
  let captured;
  t.mock.method(userRepository, 'resetPasswordByTokenHash', async (args) => {
    captured = args;
    return { _id: PW_USER_ID };
  });
  const rawToken = 'A'.repeat(43);

  const result = await userService.resetPasswordWithToken({
    rawToken,
    newPassword: 'brand-new-secret',
  });

  assert.equal(captured.tokenHash, hashPasswordResetToken(rawToken));
  assert.notEqual(captured.passwordHash, 'brand-new-secret');
  assert.equal(await comparePassword('brand-new-secret', captured.passwordHash), true);
  assert.ok(captured.now instanceof Date);
  assert.deepEqual(result, { userId: PW_USER_ID });
});

test('resetPasswordWithToken gives one safe error when the atomic token match loses', async (t) => {
  t.mock.method(userRepository, 'resetPasswordByTokenHash', async () => null);

  await assert.rejects(
    () =>
      userService.resetPasswordWithToken({
        rawToken: 'B'.repeat(43),
        newPassword: 'brand-new-secret',
      }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'AUTH_PASSWORD_RESET_TOKEN_INVALID');
      return true;
    }
  );
});

test('adminUpdateUser atomically clears reset credentials whenever status is suspended', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'active' }));
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id, status: 'suspended' });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 1);

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { status: 'suspended' },
  });

  assert.deepEqual(capturedUpdate.$set, { status: 'suspended' });
  assert.deepEqual(capturedUpdate.$unset, {
    passwordResetTokenHash: 1,
    passwordResetExpiresAt: 1,
  });
  assert.equal('role' in capturedUpdate.$set, false);
});

test('adminUpdateUser suspended-to-suspended retry also clears reset credentials', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'suspended' }));
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id, status: 'suspended' });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { status: 'suspended' },
  });

  assert.deepEqual(capturedUpdate.$unset, {
    passwordResetTokenHash: 1,
    passwordResetExpiresAt: 1,
  });
});

test('a reset credential cleared by suspension cannot revive after reactivation', async (t) => {
  let status = 'active';
  let resetCredentialActive = true;
  const order = [];
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status }));
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    order.push(`update:${update.$set.status}`);
    status = update.$set.status;
    if (update.$unset?.passwordResetTokenHash) {
      resetCredentialActive = false;
    }
    return fakeUser({ _id: id, status });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    order.push(`revoke:${status}`);
    return 1;
  });

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { status: 'suspended' },
  });
  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { status: 'active' },
  });

  assert.equal(resetCredentialActive, false);
  assert.deepEqual(order, [
    'update:suspended',
    'revoke:suspended',
    'revoke:suspended',
    'update:active',
  ]);
});

test('adminUpdateUser active-to-active does not clear reset credentials', async (t) => {
  t.mock.method(userRepository, 'findById', async () => fakeUser({ status: 'active' }));
  let capturedUpdate;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return fakeUser({ _id: id, status: 'active' });
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);

  await userService.adminUpdateUser({
    actingUserId: ACTING_ADMIN_ID,
    targetUserId: TARGET_USER_ID,
    patch: { status: 'active' },
  });

  assert.deepEqual(capturedUpdate, { $set: { status: 'active' } });
});

