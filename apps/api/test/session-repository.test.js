const test = require('node:test');
const assert = require('node:assert/strict');

const Session = require('../src/modules/sessions/session.model');
const sessionRepository = require('../src/modules/sessions/session.repository');

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

test('revokeAllForUser only counts sessions that are unrevoked and unexpired', async (t) => {
  let capturedFilter;
  t.mock.method(Session, 'updateMany', (filter) => {
    capturedFilter = filter;
    return Promise.resolve({ modifiedCount: 2 });
  });

  const now = new Date();
  const count = await sessionRepository.revokeAllForUser('user-1', now);

  assert.equal(capturedFilter.userId, 'user-1');
  assert.equal(capturedFilter.revokedAt, null);
  assert.deepEqual(capturedFilter.expiresAt, { $gt: now });
  assert.equal(count, 2);
});
