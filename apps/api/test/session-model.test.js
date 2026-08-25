const test = require('node:test');
const assert = require('node:assert/strict');

const Session = require('../src/modules/sessions/session.model');

test('userId references User, is required, and is indexed', () => {
  const path = Session.schema.path('userId');
  assert.equal(path.options.ref, 'User');
  assert.equal(path.options.required, true);
  assert.equal(path.options.index, true);
});

test('refreshTokenHash is required, uniquely indexed, and excluded from the default projection', () => {
  const path = Session.schema.path('refreshTokenHash');
  assert.equal(path.options.required, true);
  assert.equal(path.options.unique, true);
  assert.equal(path.options.select, false);

  const hashIndex = Session.schema.indexes().find(([spec]) => spec.refreshTokenHash === 1);
  assert.ok(hashIndex, 'expected a unique index on refreshTokenHash');
  assert.equal(hashIndex[1].unique, true);
});

test('expiresAt has a TTL index with expireAfterSeconds: 0 (absolute expiration)', () => {
  const ttlIndex = Session.schema.indexes().find(([spec]) => spec.expiresAt === 1);
  assert.ok(ttlIndex, 'expected an index on expiresAt');
  assert.equal(ttlIndex[1].expireAfterSeconds, 0);
});

test('revokedAt and lastUsedAt default to null', () => {
  const session = new Session({
    userId: '507f1f77bcf86cd799439011',
    refreshTokenHash: 'a-hash',
    expiresAt: new Date(),
  });
  assert.equal(session.revokedAt, null);
  assert.equal(session.lastUsedAt, null);
});
