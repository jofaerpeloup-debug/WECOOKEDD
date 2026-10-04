const test = require('node:test');
const assert = require('node:assert/strict');

const CommunityPost = require('../src/modules/community/community-post.model');
const CommunityPostLike = require('../src/modules/community/community-post-like.model');
const communityRepository = require('../src/modules/community/community.repository');
const communityLikeRepository = require('../src/modules/community/community-like.repository');
const CommunityComment = require('../src/modules/community/community-comment.model');
const communityCommentRepository = require('../src/modules/community/community-comment.repository');
const CommunityFollow = require('../src/modules/community/community-follow.model');
const communityFollowRepository = require('../src/modules/community/community-follow.repository');
const CommunityPostBookmark = require('../src/modules/community/community-post-bookmark.model');
const communityBookmarkRepository = require('../src/modules/community/community-bookmark.repository');

function runSavedPipeline(pipeline, bookmarkRows, postRows) {
  let rows = bookmarkRows.map((row) => ({ ...row }));
  for (const stage of pipeline) {
    if (stage.$match) {
      rows = rows.filter((row) => Object.entries(stage.$match)
        .every(([key, value]) => String(row[key]) === String(value)));
    } else if (stage.$lookup) {
      rows = rows.map((row) => ({
        ...row,
        [stage.$lookup.as]: postRows.filter((postRow) =>
          String(postRow[stage.$lookup.foreignField]) === String(row[stage.$lookup.localField])),
      }));
    } else if (stage.$unwind) {
      const key = stage.$unwind.slice(1);
      rows = rows.flatMap((row) => row[key].map((value) => ({ ...row, [key]: value })));
    } else if (stage.$replaceRoot) {
      const key = stage.$replaceRoot.newRoot.slice(1);
      rows = rows.map((row) => row[key]);
    } else if (stage.$sort) {
      const entries = Object.entries(stage.$sort);
      rows.sort((left, right) => {
        for (const [key, direction] of entries) {
          const leftValue = left[key] instanceof Date ? left[key].getTime() : String(left[key]);
          const rightValue = right[key] instanceof Date ? right[key].getTime() : String(right[key]);
          if (leftValue < rightValue) return -1 * direction;
          if (leftValue > rightValue) return direction;
        }
        return 0;
      });
    } else if (stage.$facet) {
      const items = rows.slice(stage.$facet.items[0].$skip,
        stage.$facet.items[0].$skip + stage.$facet.items[1].$limit);
      rows = [{ items, metadata: rows.length ? [{ total: rows.length }] : [] }];
    } else {
      assert.fail(`Unsupported Saved-pipeline stage in behavioral fixture: ${JSON.stringify(stage)}`);
    }
  }
  return rows;
}

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

test('Following repository scopes deterministic post reads and counts to authoritative authors', (t) => {
  const calls = [];
  const query = {
    sort(value) { calls.push(['sort', value]); return this; },
    skip(value) { calls.push(['skip', value]); return this; },
    limit(value) { calls.push(['limit', value]); return this; },
  };
  t.mock.method(CommunityPost, 'find', (filter) => { calls.push(['find', filter]); return query; });
  t.mock.method(CommunityPost, 'countDocuments', (filter) => { calls.push(['count', filter]); return 2; });
  const authorIds = ['a', 'b'];
  assert.equal(communityRepository.findManyByAuthorIds(authorIds, { skip: 10, limit: 5 }), query);
  assert.equal(communityRepository.countPostsByAuthorIds(authorIds), 2);
  assert.deepEqual(calls, [
    ['find', { authorId: { $in: authorIds } }],
    ['sort', { createdAt: -1, _id: -1 }],
    ['skip', 10],
    ['limit', 5],
    ['count', { authorId: { $in: authorIds } }],
  ]);
});

test('follow repository owns exact pair mutations and bulk relation reads', async (t) => {
  const calls = [];
  const rows = [{ followedUserId: 'b' }];
  t.mock.method(CommunityFollow, 'create', async (doc) => { calls.push(['create', doc]); return doc; });
  t.mock.method(CommunityFollow, 'findOneAndDelete', (filter) => { calls.push(['delete', filter]); return null; });
  t.mock.method(CommunityFollow, 'find', (filter) => ({
    select(projection) { calls.push(['find', filter, projection]); return Promise.resolve(rows); },
  }));
  await communityFollowRepository.createFollow({ followerId: 'a', followedUserId: 'b' });
  communityFollowRepository.deleteFollow('a', 'b');
  assert.deepEqual(await communityFollowRepository.findFollowedUserIds('a'), ['b']);
  assert.deepEqual(await communityFollowRepository.findFollowedUserIdsAmong('a', ['b', 'c']), ['b']);
  assert.deepEqual(await communityFollowRepository.findFollowedUserIdsAmong('a', []), []);
  assert.deepEqual(calls, [
    ['create', { followerId: 'a', followedUserId: 'b' }],
    ['delete', { followerId: 'a', followedUserId: 'b' }],
    ['find', { followerId: 'a' }, 'followedUserId'],
    ['find', { followerId: 'a', followedUserId: { $in: ['b', 'c'] } }, 'followedUserId'],
  ]);
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

test('bookmark repository scopes pair mutations, cleanup, and bulk metadata', async (t) => {
  const calls = [];
  t.mock.method(CommunityPostBookmark, 'create', async (doc) => { calls.push(['create', doc]); return doc; });
  t.mock.method(CommunityPostBookmark, 'findOneAndDelete', (filter) => { calls.push(['one', filter]); return null; });
  t.mock.method(CommunityPostBookmark, 'deleteMany', (filter) => { calls.push(['many', filter]); return null; });
  t.mock.method(CommunityPostBookmark, 'find', (filter) => ({
    select(projection) { calls.push(['find', filter, projection]); return Promise.resolve([{ postId: 'post' }]); },
  }));
  await communityBookmarkRepository.createBookmark({ postId: 'post', userId: 'user' });
  communityBookmarkRepository.deleteByPostAndUser('post', 'user');
  communityBookmarkRepository.deleteByPostId('post');
  assert.deepEqual(await communityBookmarkRepository.findBookmarkedPostIdsAmong('user', ['post']), ['post']);
  assert.deepEqual(await communityBookmarkRepository.findBookmarkedPostIdsAmong('user', []), []);
  assert.deepEqual(calls, [
    ['create', { postId: 'post', userId: 'user' }],
    ['one', { postId: 'post', userId: 'user' }],
    ['many', { postId: 'post' }],
    ['find', { userId: 'user', postId: { $in: ['post'] } }, 'postId'],
  ]);
});

test('Saved repository joins existing posts, sorts by post chronology, then paginates and totals', async (t) => {
  let pipeline;
  t.mock.method(CommunityPostBookmark, 'aggregate', async (value) => {
    pipeline = value;
    return [{ items: [{ _id: 'post' }], metadata: [{ total: 3 }] }];
  });
  const result = await communityBookmarkRepository.findSavedPosts(
    '507f1f77bcf86cd799439001', { skip: 2, limit: 1 }
  );
  assert.deepEqual(result, { posts: [{ _id: 'post' }], total: 3 });
  assert.equal(String(pipeline[0].$match.userId), '507f1f77bcf86cd799439001');
  assert.equal(pipeline[1].$lookup.localField, 'postId');
  assert.equal(pipeline[1].$lookup.foreignField, '_id');
  assert.deepEqual(pipeline[3], { $replaceRoot: { newRoot: '$post' } });
  assert.deepEqual(pipeline[4], { $sort: { createdAt: -1, _id: -1 } });
  assert.equal(JSON.stringify(pipeline[4]).includes('bookmark'), false);
  assert.deepEqual(pipeline[5], {
    $facet: { items: [{ $skip: 2 }, { $limit: 1 }], metadata: [{ $count: 'total' }] },
  });
});

test('Saved chronology follows post creation even when the older post was bookmarked later', async (t) => {
  const viewerId = '507f1f77bcf86cd799439001';
  const newerPostId = '507f1f77bcf86cd799439012';
  const olderPostId = '507f1f77bcf86cd799439011';
  const posts = [
    { _id: newerPostId, createdAt: new Date('2026-10-03T00:00:00.000Z') },
    { _id: olderPostId, createdAt: new Date('2026-10-01T00:00:00.000Z') },
  ];
  const bookmarks = [
    {
      userId: viewerId,
      postId: newerPostId,
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
    },
    {
      userId: viewerId,
      postId: olderPostId,
      createdAt: new Date('2026-10-04T00:00:00.000Z'),
    },
  ];
  t.mock.method(CommunityPostBookmark, 'aggregate', async (pipeline) =>
    runSavedPipeline(pipeline, bookmarks, posts));

  const result = await communityBookmarkRepository.findSavedPosts(viewerId, { skip: 0, limit: 20 });

  assert.deepEqual(result.posts.map((savedPost) => String(savedPost._id)), [newerPostId, olderPostId]);
  assert.equal(result.total, 2);
  assert.equal(Object.hasOwn(result.posts[0], 'bookmarkCreatedAt'), false);
  assert.equal(Object.hasOwn(result.posts[0], 'postId'), false);
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
