const test = require('node:test');
const assert = require('node:assert/strict');

const CommunityPost = require('../src/modules/community/community-post.model');
const CommunityPostLike = require('../src/modules/community/community-post-like.model');
const CommunityComment = require('../src/modules/community/community-comment.model');
const CommunityFollow = require('../src/modules/community/community-follow.model');

const USER_ID = '507f1f77bcf86cd799439001';
const POST_ID = '507f1f77bcf86cd799439002';
const RECIPE_ID = '507f1f77bcf86cd799439003';

test('CommunityPost has only authorId, caption, optional recipeId, and timestamps', () => {
  const author = CommunityPost.schema.path('authorId');
  const caption = CommunityPost.schema.path('caption');
  const recipe = CommunityPost.schema.path('recipeId');
  assert.equal(author.options.required, true);
  assert.equal(author.options.ref, 'User');
  assert.equal(caption.options.required, true);
  assert.equal(caption.options.trim, true);
  assert.equal(caption.options.maxlength, 2000);
  assert.equal(!!recipe.options.required, false);
  assert.equal(recipe.options.ref, 'Recipe');
  assert.deepEqual(
    Object.keys(CommunityPost.schema.paths).filter((path) => !['_id', '__v'].includes(path)).sort(),
    ['authorId', 'caption', 'createdAt', 'recipeId', 'updatedAt'].sort()
  );
});

test('CommunityPost validates required bounded caption and optional recipe', async () => {
  await assert.rejects(() => new CommunityPost({ authorId: USER_ID }).validate());
  await assert.rejects(() => new CommunityPost({ authorId: USER_ID, caption: '   ' }).validate());
  await assert.rejects(() =>
    new CommunityPost({ authorId: USER_ID, caption: 'x'.repeat(2001) }).validate()
  );
  await assert.doesNotReject(() =>
    new CommunityPost({ authorId: USER_ID, caption: 'x'.repeat(2000) }).validate()
  );
  await assert.doesNotReject(() =>
    new CommunityPost({ authorId: USER_ID, caption: 'Line one\nLine two', recipeId: RECIPE_ID }).validate()
  );
});

test('CommunityPost has the deterministic newest-first feed index', () => {
  const index = CommunityPost.schema
    .indexes()
    .find(([spec]) => spec.createdAt === -1 && spec._id === -1);
  assert.ok(index);
});

test('CommunityPost has the Following author/newest-first access index', () => {
  const index = CommunityPost.schema.indexes().find(([spec]) =>
    spec.authorId === 1 && spec.createdAt === -1 && spec._id === -1);
  assert.ok(index);
});

test('CommunityFollow has exact required refs, createdAt only, self validation, and unique pair index', async () => {
  assert.equal(CommunityFollow.schema.path('followerId').options.required, true);
  assert.equal(CommunityFollow.schema.path('followerId').options.ref, 'User');
  assert.equal(CommunityFollow.schema.path('followedUserId').options.required, true);
  assert.equal(CommunityFollow.schema.path('followedUserId').options.ref, 'User');
  assert.deepEqual(
    Object.keys(CommunityFollow.schema.paths).filter((path) => !['_id', '__v'].includes(path)).sort(),
    ['createdAt', 'followedUserId', 'followerId'].sort()
  );
  await assert.rejects(() => new CommunityFollow({ followerId: USER_ID, followedUserId: USER_ID }).validate());
  await assert.doesNotReject(() => new CommunityFollow({ followerId: USER_ID, followedUserId: POST_ID }).validate());
  const index = CommunityFollow.schema.indexes().find(([spec]) =>
    spec.followerId === 1 && spec.followedUserId === 1);
  assert.ok(index);
  assert.equal(index[1].unique, true);
});

test('CommunityPostLike has required refs, createdAt only, and no aggregate fields', () => {
  assert.equal(CommunityPostLike.schema.path('postId').options.required, true);
  assert.equal(CommunityPostLike.schema.path('postId').options.ref, 'CommunityPost');
  assert.equal(CommunityPostLike.schema.path('userId').options.required, true);
  assert.equal(CommunityPostLike.schema.path('userId').options.ref, 'User');
  assert.deepEqual(
    Object.keys(CommunityPostLike.schema.paths)
      .filter((path) => !['_id', '__v'].includes(path))
      .sort(),
    ['createdAt', 'postId', 'userId'].sort()
  );
  assert.equal(CommunityPostLike.schema.path('likeCount'), undefined);
});

test('CommunityPostLike validates ids and uniquely indexes postId/userId', async () => {
  await assert.rejects(() => new CommunityPostLike({}).validate());
  await assert.doesNotReject(() => new CommunityPostLike({ postId: POST_ID, userId: USER_ID }).validate());
  const index = CommunityPostLike.schema
    .indexes()
    .find(([spec]) => spec.postId === 1 && spec.userId === 1);
  assert.ok(index);
  assert.equal(index[1].unique, true);
});

test('CommunityComment has only bounded body, required refs, createdAt, and deterministic index', async () => {
  assert.equal(CommunityComment.schema.path('postId').options.required, true);
  assert.equal(CommunityComment.schema.path('postId').options.ref, 'CommunityPost');
  assert.equal(CommunityComment.schema.path('authorId').options.required, true);
  assert.equal(CommunityComment.schema.path('authorId').options.ref, 'User');
  assert.equal(CommunityComment.schema.path('body').options.trim, true);
  assert.equal(CommunityComment.schema.path('body').options.minlength, 1);
  assert.equal(CommunityComment.schema.path('body').options.maxlength, 1000);
  assert.deepEqual(
    Object.keys(CommunityComment.schema.paths)
      .filter((path) => !['_id', '__v'].includes(path))
      .sort(),
    ['authorId', 'body', 'createdAt', 'postId'].sort()
  );
  await assert.rejects(() => new CommunityComment({ postId: POST_ID, authorId: USER_ID, body: ' ' }).validate());
  await assert.rejects(() => new CommunityComment({ postId: POST_ID, authorId: USER_ID, body: 'x'.repeat(1001) }).validate());
  await assert.doesNotReject(() => new CommunityComment({ postId: POST_ID, authorId: USER_ID, body: 'Line one\nLine two' }).validate());
  const index = CommunityComment.schema.indexes().find(([spec]) =>
    spec.postId === 1 && spec.createdAt === -1 && spec._id === -1);
  assert.ok(index);
});
