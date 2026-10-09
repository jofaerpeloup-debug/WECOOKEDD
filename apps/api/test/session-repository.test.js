const test = require('node:test');
const assert = require('node:assert/strict');

const Session = require('../src/modules/sessions/session.model');
const sessionRepository = require('../src/modules/sessions/session.repository');

test('Session declares security generation without changing informational timestamp semantics', () => {
  assert.equal(Session.schema.path('securityGeneration').instance, 'Number');
  assert.equal(Session.schema.path('securityGeneration').options.required, true);
  assert.equal(Session.schema.path('securityGeneration').options.min, 0);
  assert.equal(Session.schema.path('securityIssuedAt').instance, 'Date');
  assert.ok(Session.schema.path('createdAt'));
  assert.equal(Session.schema.options.timestamps, true);
});

test('createSession stamps securityIssuedAt with Mongo server time in its atomic upsert', async (t) => {
  let captured;
  const mongoServerTime = new Date('2026-10-08T01:00:00.000Z');
  t.mock.method(Session, 'findOneAndUpdate', (filter, update, options) => {
    captured = { filter, update, options };
    return Promise.resolve({ _id: filter._id, securityIssuedAt: mongoServerTime });
  });

  const result = await sessionRepository.createSession({
    userId: '507f1f77bcf86cd799439011',
    refreshTokenHash: 'digest',
    expiresAt: new Date('2026-11-08T01:00:00.000Z'),
    securityGeneration: 6,
  });

  assert.ok(captured.filter._id);
  assert.deepEqual(captured.update.$currentDate, { securityIssuedAt: true });
  assert.equal('securityIssuedAt' in captured.update.$setOnInsert, false);
  assert.equal('createdAt' in captured.update.$setOnInsert, false);
  assert.equal(captured.update.$setOnInsert.securityGeneration, 6);
  assert.deepEqual(captured.options, {
    upsert: true,
    returnDocument: 'after',
    setDefaultsOnInsert: true,
  });
  assert.equal(result.securityIssuedAt, mongoServerTime);
});

// rotateByHash's concurrency-safety comes entirely from MongoDB's per-document
// atomicity for findOneAndUpdate: of two requests presenting the same current
// hash, only the one MongoDB processes first can match this filter, since it
// replaces refreshTokenHash as part of the same atomic operation. These tests
// verify the filter/update shape rotateByHash sends, without needing a real
// MongoDB server to prove atomicity for us.
test('rotateByHash issues a conditional update keyed on the current hash, revocation, and expiry', async (t) => {
  let capturedFilter;
  let capturedUpdate;
  t.mock.method(Session, 'findOneAndUpdate', (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return Promise.resolve({ _id: 'session-1' });
  });

  const now = new Date();
  await sessionRepository.rotateByHash({ currentHash: 'current-hash', newHash: 'new-hash', now });

  assert.equal(capturedFilter.refreshTokenHash, 'current-hash');
  assert.equal(capturedFilter.revokedAt, null);
  assert.deepEqual(capturedFilter.expiresAt, { $gt: now });
  assert.equal(capturedUpdate.$set.refreshTokenHash, 'new-hash');
  assert.equal(capturedUpdate.$set.lastUsedAt, now);
});

test('rotateByHash resolves null when the current hash no longer matches (already rotated / revoked / expired)', async (t) => {
  t.mock.method(Session, 'findOneAndUpdate', () => Promise.resolve(null));

  const result = await sessionRepository.rotateByHash({
    currentHash: 'stale-hash',
    newHash: 'new-hash',
    now: new Date(),
  });
  assert.equal(result, null);
});

test('findActiveByHash queries by hash, unrevoked, and unexpired — with no side effect', async (t) => {
  let capturedFilter;
  t.mock.method(Session, 'findOne', (filter) => {
    capturedFilter = filter;
    return Promise.resolve({ _id: 'session-1' });
  });

  await sessionRepository.findActiveByHash('some-hash');

  assert.equal(capturedFilter.refreshTokenHash, 'some-hash');
  assert.equal(capturedFilter.revokedAt, null);
  assert.ok(capturedFilter.expiresAt.$gt instanceof Date);
});

test('findActiveByIdsForUser requires the current generation in addition to owner and liveness', async (t) => {
  let capturedFilter;
  let selected;
  t.mock.method(Session, 'find', (filter) => {
    capturedFilter = filter;
    return {
      select(projection) {
        selected = projection;
        return Promise.resolve([{ _id: 'session-1', userId: 'user-1' }]);
      },
    };
  });
  const now = new Date();
  await sessionRepository.findActiveByIdsForUser(['session-1', 'session-2'], 'user-1', 4, now);
  assert.deepEqual(capturedFilter, {
    _id: { $in: ['session-1', 'session-2'] },
    userId: 'user-1',
    revokedAt: null,
    expiresAt: { $gt: now },
    $or: [{ securityGeneration: 4 }],
  });
  assert.equal(selected, '_id userId');
});

test('findActiveByIdsForUser treats a missing legacy generation as generation zero only', async (t) => {
  let capturedFilter;
  t.mock.method(Session, 'find', (filter) => {
    capturedFilter = filter;
    return { select: () => Promise.resolve([]) };
  });
  const now = new Date();
  await sessionRepository.findActiveByIdsForUser(['legacy-session'], 'user-1', 0, now);
  assert.deepEqual(capturedFilter.$or, [
    { securityGeneration: 0 },
    { securityGeneration: { $exists: false } },
  ]);
});

test('a delayed generation cleanup revokes only legacy and older generations', async (t) => {
  let capturedFilter;
  let capturedUpdate;
  t.mock.method(Session, 'updateMany', (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return Promise.resolve({ modifiedCount: 2 });
  });
  const delayedSweepTime = new Date('2026-10-08T01:05:00.000Z');

  const count = await sessionRepository.revokeAllForUserBeforeGeneration(
    'user-1',
    3,
    delayedSweepTime
  );

  assert.equal(count, 2);
  assert.deepEqual(capturedFilter, {
    userId: 'user-1',
    revokedAt: null,
    expiresAt: { $gt: delayedSweepTime },
    $or: [
      { securityGeneration: { $lt: 3 } },
      { securityGeneration: { $exists: false } },
    ],
  });
  assert.deepEqual(capturedUpdate, { $set: { revokedAt: delayedSweepTime } });

  const legacy = {};
  const old = { securityGeneration: 2 };
  const current = { securityGeneration: 3 };
  const newer = { securityGeneration: 4 };
  const matchesSweep = (session) =>
    session.securityGeneration === undefined || session.securityGeneration < 3;
  assert.equal(matchesSweep(legacy), true);
  assert.equal(matchesSweep(old), true);
  assert.equal(matchesSweep(current), false);
  assert.equal(matchesSweep(newer), false);
});
