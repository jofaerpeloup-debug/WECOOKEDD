const test = require('node:test');
const assert = require('node:assert/strict');

const CommunityPost = require('../src/modules/community/community-post.model');
const CommunityPostLike = require('../src/modules/community/community-post-like.model');
const communityRepository = require('../src/modules/community/community.repository');
const communityLikeRepository = require('../src/modules/community/community-like.repository');
const CommunityComment = require('../src/modules/community/community-comment.model');
const communityCommentRepository = require('../src/modules/community/community-comment.repository');

test('create repository delegates the allowlisted post document to Mongoose', async (t) => {
  const document = { authorId: 'author', caption: 'Persist me', recipeId: 'recipe' };
  let received;
  t.mock.method(CommunityPost, 'create', async (value) => {
    received = value;
    return { _id: 'post', ...value };
  });

  const created = await communityRepository.createPost(document);

  assert.equal(received, document);
  assert.deepEqual(created, { _id: 'post', ...document });
});

test('feed repository applies deterministic newest-first sort and bounded pagination', (t) => {
  const calls = [];
  const query = {
    sort(value) {
      calls.push(['sort', value]);
      return this;
    },
    skip(value) {
      calls.push(['skip', value]);
      return this;
    },
    limit(value) {
      calls.push(['limit', value]);
      return this;
    },
  };
  t.mock.method(CommunityPost, 'find', (filter) => {
    calls.push(['find', filter]);
    return query;
  });

  assert.equal(communityRepository.findMany({ skip: 20, limit: 10 }), query);
  assert.deepEqual(calls, [
    ['find', {}],
    ['sort', { createdAt: -1, _id: -1 }],
    ['skip', 20],
    ['limit', 10],
  ]);
});

test('delete repository scopes the atomic query by both post and author', (t) => {
  let filter;
  t.mock.method(CommunityPost, 'findOneAndDelete', (value) => {
    filter = value;
    return null;
  });
  communityRepository.deleteOwnedById('post', 'author');
  assert.deepEqual(filter, { _id: 'post', authorId: 'author' });
});

test('like repository scopes viewer mutations and post cleanup', (t) => {
  const calls = [];
  t.mock.method(CommunityPostLike, 'findOneAndDelete', (filter) => calls.push(['viewer', filter]));
  t.mock.method(CommunityPostLike, 'deleteMany', (filter) => calls.push(['post', filter]));
  t.mock.method(CommunityPostLike, 'countDocuments', (filter) => calls.push(['count', filter]));

  communityLikeRepository.deleteByPostAndUser('post', 'user');
  communityLikeRepository.deleteByPostId('post');
  communityLikeRepository.countByPost('post');

  assert.deepEqual(calls, [
    ['viewer', { postId: 'post', userId: 'user' }],
    ['post', { postId: 'post' }],
    ['count', { postId: 'post' }],
  ]);
});

test('comment repository delegates bounded creation and deterministic post pagination', async (t) => {
  const document = { postId: 'post', authorId: 'author', body: 'Comment' };
  let created;
  const calls = [];
  const query = {
    sort(value) { calls.push(['sort', value]); return this; },
    skip(value) { calls.push(['skip', value]); return this; },
    limit(value) { calls.push(['limit', value]); return this; },
  };
  t.mock.method(CommunityComment, 'create', async (value) => { created = value; return value; });
  t.mock.method(CommunityComment, 'find', (filter) => { calls.push(['find', filter]); return query; });
  await communityCommentRepository.createComment(document);
  assert.equal(created, document);
  assert.equal(communityCommentRepository.findManyByPostId('post', { skip: 20, limit: 10 }), query);
  assert.deepEqual(calls, [
    ['find', { postId: 'post' }],
    ['sort', { createdAt: -1, _id: -1 }],
    ['skip', 20],
    ['limit', 10],
  ]);
});

test('comment repository keeps ownership atomic and cleanup scopes exact', (t) => {
  const calls = [];
  t.mock.method(CommunityComment, 'findOneAndDelete', (filter) => calls.push(['one', filter]));
  t.mock.method(CommunityComment, 'deleteMany', (filter) => calls.push(['many', filter]));
  t.mock.method(CommunityComment, 'countDocuments', (filter) => calls.push(['count', filter]));
  communityCommentRepository.deleteOwnedById('comment', 'author');
  communityCommentRepository.deleteById('comment');
  communityCommentRepository.deleteByPostId('post');
  communityCommentRepository.countByPostId('post');
  assert.deepEqual(calls, [
    ['one', { _id: 'comment', authorId: 'author' }],
    ['one', { _id: 'comment' }],
    ['many', { postId: 'post' }],
    ['count', { postId: 'post' }],
  ]);
});

test('comment repository aggregates authoritative counts only for requested post ids', async (t) => {
  let pipeline;
  t.mock.method(CommunityComment, 'aggregate', async (value) => {
    pipeline = value;
    return [{ _id: '507f1f77bcf86cd799439002', commentCount: 2 }];
  });
  const result = await communityCommentRepository.getCountsForPosts([
    '507f1f77bcf86cd799439002',
    '507f1f77bcf86cd799439003',
  ]);
  assert.equal(result[0].commentCount, 2);
  assert.deepEqual(pipeline[0].$match.postId.$in.map(String), [
    '507f1f77bcf86cd799439002',
    '507f1f77bcf86cd799439003',
  ]);
  assert.deepEqual(pipeline[1], { $group: { _id: '$postId', commentCount: { $sum: 1 } } });
});
