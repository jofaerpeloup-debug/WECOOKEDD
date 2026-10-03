process.env.NODE_ENV = 'test';
process.env.PORT = '4040';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'comm4-live-mongo-test-secret-at-least-32-chars';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');

const { createApp } = require('../src/app');
const User = require('../src/modules/users/user.model');
const Session = require('../src/modules/sessions/session.model');
const CommunityFollow = require('../src/modules/community/community-follow.model');
const { signAccessToken } = require('../src/shared/security/access-token');

function isolatedUri() {
  const uri = process.env.COMMUNITY_FOLLOW_MONGO_URI;
  assert.ok(uri, 'COMMUNITY_FOLLOW_MONGO_URI is required for the isolated live-Mongo gate.');
  const databaseName = uri.split(/[?#]/, 1)[0].split('/').pop();
  assert.match(databaseName, /comm4/i, 'Live-Mongo database name must contain "comm4".');
  assert.match(databaseName, /test/i, 'Live-Mongo database name must contain "test".');
  assert.doesNotMatch(databaseName, /^wecooked(-|_)?prod(uction)?$/i);
  return { uri, databaseName };
}

test('real Mongo unique index makes concurrent follow API requests idempotent with one row', async (t) => {
  const { uri, databaseName } = isolatedUri();
  const followerId = new mongoose.Types.ObjectId();
  const followedUserId = new mongoose.Types.ObjectId();
  const sessionId = new mongoose.Types.ObjectId();
  t.diagnostic(`isolated Mongo database: ${databaseName}`);

  await mongoose.connect(uri);
  try {
    await CommunityFollow.syncIndexes();
    const indexes = await CommunityFollow.collection.indexes();
    const uniquePair = indexes.find((index) => index.unique === true
      && index.key.followerId === 1 && index.key.followedUserId === 1);
    assert.ok(uniquePair, 'physical unique followerId/followedUserId index is required');

    await Promise.all([
      User.create({
        _id: followerId,
        name: 'COMM4 Follower',
        email: `comm4-follower-${followerId}@example.com`,
        passwordHash: 'not-used-by-this-test',
      }),
      User.create({
        _id: followedUserId,
        name: 'COMM4 Target',
        email: `comm4-target-${followedUserId}@example.com`,
        passwordHash: 'not-used-by-this-test',
      }),
    ]);
    await Session.create({
      _id: sessionId,
      userId: followerId,
      refreshTokenHash: `comm4-${sessionId}`,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const token = signAccessToken({
      userId: String(followerId),
      sessionId: String(sessionId),
      role: 'user',
    });
    const app = createApp();
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(app)
      .post(`/api/v1/community/users/${followedUserId}/follow`)
      .set('Authorization', `Bearer ${token}`)));

    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { success: true, data: { following: true } });
    }
    assert.equal(await CommunityFollow.countDocuments({ followerId, followedUserId }), 1);
  } finally {
    await Promise.all([
      CommunityFollow.deleteMany({ followerId, followedUserId }),
      Session.deleteMany({ _id: sessionId }),
      User.deleteMany({ _id: { $in: [followerId, followedUserId] } }),
    ]).catch(() => undefined);
    await mongoose.disconnect();
  }
});
