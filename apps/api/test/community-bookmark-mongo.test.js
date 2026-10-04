process.env.NODE_ENV = 'test';
process.env.PORT = '4040';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'comm5-live-mongo-test-secret-at-least-32-chars';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');

const { createApp } = require('../src/app');
const User = require('../src/modules/users/user.model');
const Session = require('../src/modules/sessions/session.model');
const CommunityPost = require('../src/modules/community/community-post.model');
const CommunityPostBookmark = require('../src/modules/community/community-post-bookmark.model');
const { signAccessToken } = require('../src/shared/security/access-token');

function isolatedUri() {
  const uri = process.env.COMMUNITY_BOOKMARK_MONGO_URI;
  assert.ok(uri, 'COMMUNITY_BOOKMARK_MONGO_URI is required for the isolated live-Mongo gate.');
  const databaseName = uri.split(/[?#]/, 1)[0].split('/').pop();
  assert.match(databaseName, /comm5/i, 'Live-Mongo database name must contain "comm5".');
  assert.match(databaseName, /test/i, 'Live-Mongo database name must contain "test".');
  assert.doesNotMatch(databaseName, /^wecooked(-|_)?prod(uction)?$/i);
  return { uri, databaseName };
}

test('real Mongo enforces bookmark uniqueness and both physical indexes', async (t) => {
  const { uri, databaseName } = isolatedUri();
  const userId = new mongoose.Types.ObjectId();
  const sessionId = new mongoose.Types.ObjectId();
  const postId = new mongoose.Types.ObjectId();
  t.diagnostic(`isolated Mongo database: ${databaseName}`);
  await mongoose.connect(uri);
  try {
    await CommunityPostBookmark.syncIndexes();
    const indexes = await CommunityPostBookmark.collection.indexes();
    assert.ok(indexes.find((index) => index.unique === true
      && index.key.userId === 1 && index.key.postId === 1));
    assert.ok(indexes.find((index) => Object.keys(index.key).length === 1 && index.key.postId === 1));
    await User.create({
      _id: userId,
      name: 'COMM5 User',
      email: `comm5-${userId}@example.com`,
      passwordHash: 'not-used-by-this-test',
    });
    await Session.create({
      _id: sessionId,
      userId,
      refreshTokenHash: `comm5-${sessionId}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await CommunityPost.create({ _id: postId, authorId: userId, caption: 'COMM5 isolated test' });
    const token = signAccessToken({ userId: String(userId), sessionId: String(sessionId), role: 'user' });
    const app = createApp();
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(app)
      .post(`/api/v1/community/posts/${postId}/bookmarks`)
      .set('Authorization', `Bearer ${token}`)));
    responses.forEach((response) => {
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { success: true, data: { bookmarked: true } });
    });
    assert.equal(await CommunityPostBookmark.countDocuments({ userId, postId }), 1);
  } finally {
    await Promise.all([
      CommunityPostBookmark.deleteMany({ userId, postId }),
      CommunityPost.deleteMany({ _id: postId }),
      Session.deleteMany({ _id: sessionId }),
      User.deleteMany({ _id: userId }),
    ]).catch(() => undefined);
    await mongoose.disconnect();
  }
});
