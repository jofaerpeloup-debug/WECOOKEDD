process.env.NODE_ENV = 'test';
process.env.PORT = '4040';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const communityRepository = require('../src/modules/community/community.repository');
const communityLikeRepository = require('../src/modules/community/community-like.repository');
const communityCommentRepository = require('../src/modules/community/community-comment.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const USER_A = '507f1f77bcf86cd799439001';
const SESSION_A = '507f1f77bcf86cd799439002';
const USER_B = '507f1f77bcf86cd799439003';
const SESSION_B = '507f1f77bcf86cd799439004';
const ADMIN = '507f1f77bcf86cd799439005';
const SESSION_ADMIN = '507f1f77bcf86cd799439006';
const POST_A = '507f1f77bcf86cd799439011';
const POST_B = '507f1f77bcf86cd799439012';
const POST_C = '507f1f77bcf86cd799439013';
const POST_D = '507f1f77bcf86cd799439014';
const POST_E = '507f1f77bcf86cd799439015';
const RECIPE_ID = '507f1f77bcf86cd799439021';
const INGREDIENT_ID = '507f1f77bcf86cd799439022';
const COMMENT_A = '507f1f77bcf86cd799439031';
const COMMENT_B = '507f1f77bcf86cd799439032';
const COMMENT_C = '507f1f77bcf86cd799439033';
const CREATED_AT = new Date('2026-09-13T08:00:00.000Z');

function tokenFor({ id, sessionId, role = 'user' }) {
  return signAccessToken({ userId: id, sessionId, role });
}

function mockAuth(t, { id = USER_A, sessionId = SESSION_A, role = 'user', name = 'User A' } = {}) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: sessionId,
    userId: id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: id,
    name,
    email: 'private@example.com',
    role,
    status: 'active',
  }));
  return `Bearer ${tokenFor({ id, sessionId, role })}`;
}

function fakePost(overrides = {}) {
  return {
    _id: POST_A,
    authorId: USER_A,
    caption: 'Dinner is ready.',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function fakeRecipe(overrides = {}) {
  return {
    _id: RECIPE_ID,
    title: 'Chicken Adobo',
    description: 'A complete Filipino braised chicken recipe.',
    imageUrl: 'https://example.com/adobo.jpg',
    region: null,
    category: null,
    difficulty: 'easy',
    prepTimeMinutes: 10,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [
      {
        ingredientId: { _id: INGREDIENT_ID, name: 'Chicken', isActive: true },
        quantity: 1,
        unit: 'kg',
        optional: false,
      },
    ],
    instructions: ['Cook.'],
    dietaryTags: [],
    isActive: true,
    ...overrides,
  };
}

function fakeComment(overrides = {}) {
  return {
    _id: COMMENT_A,
    postId: POST_A,
    authorId: USER_A,
    body: 'Looks delicious.',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function mockPublicAuthors(t, authors = [{ _id: USER_A, name: 'User A' }]) {
  t.mock.method(userRepository, 'findPublicByIds', async () => authors);
}

function mockEmptyLikeMetadata(t) {
  t.mock.method(communityLikeRepository, 'getMetadataForPosts', async () => []);
  t.mock.method(communityCommentRepository, 'getCountsForPosts', async () => []);
}

function mockAuthDirectory(t) {
  const identities = [
    { id: USER_A, sessionId: SESSION_A, role: 'user', name: 'User A' },
    { id: USER_B, sessionId: SESSION_B, role: 'user', name: 'User B' },
    { id: ADMIN, sessionId: SESSION_ADMIN, role: 'admin', name: 'Admin' },
  ];
  t.mock.method(sessionRepository, 'findActiveById', async (sessionId) => {
    const identity = identities.find((entry) => entry.sessionId === String(sessionId));
    return identity ? { _id: identity.sessionId, userId: identity.id, revokedAt: null } : null;
  });
  t.mock.method(userRepository, 'findById', async (userId) => {
    const identity = identities.find((entry) => entry.id === String(userId));
    return identity
      ? { _id: identity.id, name: identity.name, email: 'private@example.com', role: identity.role, status: 'active' }
      : null;
  });
  return Object.fromEntries(
    identities.map((identity) => [identity.id, `Bearer ${tokenFor(identity)}`])
  );
}

test('all Community routes reject unauthenticated requests', async () => {
  const responses = await Promise.all([
    request(app).get('/api/v1/community/posts'),
    request(app).post('/api/v1/community/posts').send({ caption: 'Hello' }),
    request(app).delete(`/api/v1/community/posts/${POST_A}`),
    request(app).post(`/api/v1/community/posts/${POST_A}/likes`),
    request(app).delete(`/api/v1/community/posts/${POST_A}/likes`),
    request(app).get(`/api/v1/community/posts/${POST_A}/comments`),
    request(app).post(`/api/v1/community/posts/${POST_A}/comments`).send({ body: 'Hello' }),
    request(app).delete(`/api/v1/community/comments/${COMMENT_A}`),
  ]);
  responses.forEach((response) => assert.equal(response.status, 401));
});

test('authenticated text-only create trims edges, preserves line breaks, and derives author', async (t) => {
  const auth = mockAuth(t);
  mockPublicAuthors(t);
  let created;
  t.mock.method(communityRepository, 'createPost', async (doc) => {
    created = doc;
    return fakePost({ ...doc });
  });

  const response = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth)
    .send({ caption: '  Line one\nLine two  ' });

  assert.equal(response.status, 201);
  assert.deepEqual(created, { authorId: USER_A, caption: 'Line one\nLine two' });
  assert.equal(response.body.data.post.caption, 'Line one\nLine two');
  assert.deepEqual(response.body.data.post.author, { id: USER_A, name: 'User A', avatarUrl: null });
  assert.equal(response.body.data.post.recipeAttachment, null);
  assert.equal(response.body.data.post.commentCount, 0);
  assert.equal(response.body.data.post.likeCount, 0);
  assert.equal(response.body.data.post.likedByCurrentUser, false);
  assert.equal(response.body.data.post.isOwner, true);
});

test('create with one usable recipe persists only recipeId and returns a safe summary', async (t) => {
  const auth = mockAuth(t);
  mockPublicAuthors(t);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipe());
  let created;
  t.mock.method(communityRepository, 'createPost', async (doc) => {
    created = doc;
    return fakePost({ ...doc });
  });

  const response = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth)
    .send({ caption: 'Made this!', recipeId: RECIPE_ID });

  assert.equal(response.status, 201);
  assert.deepEqual(created, { authorId: USER_A, caption: 'Made this!', recipeId: RECIPE_ID });
  assert.deepEqual(response.body.data.post.recipeAttachment, {
    isAvailable: true,
    recipe: { id: RECIPE_ID, title: 'Chicken Adobo', imageUrl: 'https://example.com/adobo.jpg' },
  });
  assert.equal('recipeId' in response.body.data.post, false);
  assert.equal('imageUrl' in response.body.data.post, false);
});

test('create rejects whitespace-only and over-2000 captions', async (t) => {
  const auth = mockAuth(t);
  const whitespace = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth)
    .send({ caption: ' \n\t ' });
  const tooLong = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth)
    .send({ caption: 'x'.repeat(2001) });
  assert.equal(whitespace.status, 400);
  assert.equal(tooLong.status, 400);
  assert.equal(whitespace.body.error.code, 'VALIDATION_ERROR');
});

test('create accepts exactly 2000 caption characters', async (t) => {
  const auth = mockAuth(t);
  mockPublicAuthors(t);
  t.mock.method(communityRepository, 'createPost', async (doc) => fakePost(doc));

  const response = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth)
    .send({ caption: 'x'.repeat(2000) });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.post.caption.length, 2000);
});

test('create rejects malformed or missing recipes', async (t) => {
  const auth = mockAuth(t);
  const malformed = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth)
    .send({ caption: 'Post', recipeId: 'bad-id' });
  assert.equal(malformed.status, 400);

  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);
  const missing = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth)
    .send({ caption: 'Post', recipeId: RECIPE_ID });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'RECIPE_NOT_FOUND');
});

test('create rejects archived or otherwise unusable recipes', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () =>
    fakeRecipe({ isActive: false })
  );

  const response = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth)
    .send({ caption: 'Post', recipeId: RECIPE_ID });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('create rejects every forbidden ownership/media/aggregate field', async (t) => {
  const auth = mockAuth(t);
  const forbidden = [
    'authorId', 'userId', 'ownerId', 'imageUrl', 'image', 'avatar', 'author',
    'likes', 'likeCount', 'comments', 'commentCount', 'role', 'createdAt', 'updatedAt',
    'unexpected',
  ];
  for (const field of forbidden) {
    const response = await request(app)
      .post('/api/v1/community/posts')
      .set('Authorization', auth)
      .send({ caption: 'Post', [field]: field.endsWith('Count') ? 1 : 'forbidden' });
    assert.equal(response.status, 400, field);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR', field);
  }
});

test('global feed paginates, preserves repository order, and returns safe authors/viewer likes', async (t) => {
  const auth = mockAuth(t);
  const posts = [
    fakePost(),
    fakePost({ _id: POST_B, authorId: USER_B, caption: 'Other user', createdAt: new Date('2026-09-12') }),
  ];
  let paginationArgs;
  t.mock.method(communityRepository, 'findMany', async (args) => {
    paginationArgs = args;
    return posts;
  });
  t.mock.method(communityRepository, 'countPosts', async () => 22);
  mockPublicAuthors(t, [
    { _id: USER_A, name: 'User A', email: 'secret-a@example.com', role: 'admin' },
    { _id: USER_B, name: 'User B', authIdentities: [{ subject: 'secret' }] },
  ]);
  t.mock.method(communityLikeRepository, 'getMetadataForPosts', async () => [
    { _id: POST_A, likeCount: 3, likedByCurrentUser: true },
  ]);
  t.mock.method(communityCommentRepository, 'getCountsForPosts', async () => [
    { _id: POST_A, commentCount: 7 },
  ]);

  const response = await request(app)
    .get('/api/v1/community/posts?page=2&limit=2')
    .set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(paginationArgs, { skip: 2, limit: 2 });
  assert.deepEqual(response.body.data.pagination, { page: 2, limit: 2, total: 22, totalPages: 11 });
  assert.deepEqual(response.body.data.posts.map((post) => post.id), [POST_A, POST_B]);
  assert.deepEqual(response.body.data.posts[0].author, { id: USER_A, name: 'User A', avatarUrl: null });
  assert.equal(JSON.stringify(response.body).includes('secret-a@example.com'), false);
  assert.equal(JSON.stringify(response.body).includes('authIdentities'), false);
  assert.equal(JSON.stringify(response.body).includes('role'), false);
  assert.equal(response.body.data.posts[0].likeCount, 3);
  assert.equal(response.body.data.posts[0].likedByCurrentUser, true);
  assert.equal(response.body.data.posts[0].commentCount, 7);
  assert.equal(response.body.data.posts[1].likeCount, 0);
  assert.equal(response.body.data.posts[1].commentCount, 0);
  assert.equal(response.body.data.posts[1].isOwner, false);
});

test('the same global feed derives ownership and liked state independently for Users A and B', async (t) => {
  const auth = mockAuthDirectory(t);
  const posts = [fakePost(), fakePost({ _id: POST_B, authorId: USER_B })];
  t.mock.method(communityRepository, 'findMany', async () => posts);
  t.mock.method(communityRepository, 'countPosts', async () => posts.length);
  mockPublicAuthors(t, [
    { _id: USER_A, name: 'User A', email: 'secret-a@example.com', role: 'admin', status: 'active' },
    { _id: USER_B, name: 'User B', email: 'secret-b@example.com', authIdentities: ['secret'] },
  ]);
  t.mock.method(communityLikeRepository, 'getMetadataForPosts', async (_ids, viewerId) => [
    { _id: POST_A, likeCount: 1, likedByCurrentUser: String(viewerId) === USER_A },
  ]);
  t.mock.method(communityCommentRepository, 'getCountsForPosts', async () => []);

  const asA = await request(app).get('/api/v1/community/posts').set('Authorization', auth[USER_A]);
  const asB = await request(app).get('/api/v1/community/posts').set('Authorization', auth[USER_B]);

  assert.equal(asA.status, 200);
  assert.equal(asB.status, 200);
  assert.deepEqual(asA.body.data.posts.map((post) => post.id), [POST_A, POST_B]);
  assert.deepEqual(asB.body.data.posts.map((post) => post.id), [POST_A, POST_B]);
  assert.deepEqual(asA.body.data.posts.map((post) => post.isOwner), [true, false]);
  assert.deepEqual(asB.body.data.posts.map((post) => post.isOwner), [false, true]);
  assert.equal(asA.body.data.posts[0].likedByCurrentUser, true);
  assert.equal(asB.body.data.posts[0].likedByCurrentUser, false);
  for (const response of [asA, asB]) {
    for (const post of response.body.data.posts) {
      assert.deepEqual(Object.keys(post.author).sort(), ['avatarUrl', 'id', 'name']);
    }
  }
});

test('User A creates, User B creates later, and both posts appear globally newest-first', async (t) => {
  const auth = mockAuthDirectory(t);
  const authors = [
    { _id: USER_A, name: 'User A' },
    { _id: USER_B, name: 'User B' },
  ];
  const posts = [];
  t.mock.method(userRepository, 'findPublicByIds', async (ids) =>
    authors.filter((author) => ids.map(String).includes(String(author._id)))
  );
  t.mock.method(communityRepository, 'createPost', async (doc) => {
    const isA = String(doc.authorId) === USER_A;
    const post = fakePost({
      ...doc,
      _id: isA ? POST_A : POST_B,
      createdAt: new Date(isA ? '2026-09-13T08:00:00.000Z' : '2026-09-13T09:00:00.000Z'),
    });
    posts.push(post);
    return post;
  });
  t.mock.method(communityRepository, 'findMany', async ({ skip, limit }) =>
    [...posts]
      .sort((left, right) => right.createdAt - left.createdAt || String(right._id).localeCompare(String(left._id)))
      .slice(skip, skip + limit)
  );
  t.mock.method(communityRepository, 'countPosts', async () => posts.length);
  mockEmptyLikeMetadata(t);

  const createdByA = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth[USER_A])
    .send({ caption: 'A cooked first' });
  const createdByB = await request(app)
    .post('/api/v1/community/posts')
    .set('Authorization', auth[USER_B])
    .send({ caption: 'B cooked later' });
  const viewedByB = await request(app)
    .get('/api/v1/community/posts')
    .set('Authorization', auth[USER_B]);

  assert.equal(createdByA.status, 201);
  assert.equal(createdByB.status, 201);
  assert.deepEqual(viewedByB.body.data.posts.map((post) => post.caption), [
    'B cooked later',
    'A cooked first',
  ]);
  assert.deepEqual(viewedByB.body.data.posts.map((post) => post.isOwner), [true, false]);
  assert.deepEqual(Object.keys(viewedByB.body.data.posts[1].author).sort(), ['avatarUrl', 'id', 'name']);
});

test('feed safely preserves a post whose author can no longer be hydrated', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(communityRepository, 'findMany', async () => [
    fakePost({ authorId: USER_B, caption: 'Orphaned author, preserved post' }),
  ]);
  t.mock.method(communityRepository, 'countPosts', async () => 1);
  mockPublicAuthors(t, []);
  mockEmptyLikeMetadata(t);

  const response = await request(app).get('/api/v1/community/posts').set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.posts.length, 1);
  assert.equal(response.body.data.posts[0].caption, 'Orphaned author, preserved post');
  assert.equal(response.body.data.posts[0].author, null);
  assert.equal(response.body.data.posts[0].isOwner, false);
});

test('stable pagination has deterministic page boundaries and no duplicate ids', async (t) => {
  const auth = mockAuth(t);
  const ordered = [POST_E, POST_D, POST_C, POST_B, POST_A].map((id) =>
    fakePost({ _id: id, createdAt: CREATED_AT })
  );
  t.mock.method(communityRepository, 'findMany', async ({ skip, limit }) => ordered.slice(skip, skip + limit));
  t.mock.method(communityRepository, 'countPosts', async () => ordered.length);
  mockPublicAuthors(t);
  mockEmptyLikeMetadata(t);

  const page1 = await request(app).get('/api/v1/community/posts?page=1&limit=2').set('Authorization', auth);
  const page2 = await request(app).get('/api/v1/community/posts?page=2&limit=2').set('Authorization', auth);
  const page3 = await request(app).get('/api/v1/community/posts?page=3&limit=2').set('Authorization', auth);
  const ids = [...page1.body.data.posts, ...page2.body.data.posts, ...page3.body.data.posts]
    .map((post) => post.id);

  assert.deepEqual(ids, [POST_E, POST_D, POST_C, POST_B, POST_A]);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(page1.body.data.pagination, { page: 1, limit: 2, total: 5, totalPages: 3 });
  assert.deepEqual(page3.body.data.pagination, { page: 3, limit: 2, total: 5, totalPages: 3 });
});

test('feed reports later-archived recipe attachment unavailable without dropping the post', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(communityRepository, 'findMany', async () => [fakePost({ recipeId: RECIPE_ID })]);
  t.mock.method(communityRepository, 'countPosts', async () => 1);
  mockPublicAuthors(t);
  mockEmptyLikeMetadata(t);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipe({ isActive: false }));

  const response = await request(app).get('/api/v1/community/posts').set('Authorization', auth);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.posts[0].recipeAttachment, {
    isAvailable: false,
    recipe: null,
  });
});

test('a post with an unavailable recipe remains likeable and owner-deletable without recipe snapshots', async (t) => {
  const auth = mockAuth(t);
  const post = fakePost({ recipeId: RECIPE_ID });
  let likesDeleted = false;
  t.mock.method(communityRepository, 'findMany', async () => [post]);
  t.mock.method(communityRepository, 'countPosts', async () => 1);
  t.mock.method(communityRepository, 'findById', async () => post);
  t.mock.method(communityRepository, 'deleteOwnedById', async () => post);
  mockPublicAuthors(t);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipe({ isActive: false }));
  t.mock.method(communityLikeRepository, 'getMetadataForPosts', async () => []);
  t.mock.method(communityCommentRepository, 'getCountsForPosts', async () => []);
  t.mock.method(communityLikeRepository, 'createLike', async (relation) => relation);
  t.mock.method(communityLikeRepository, 'countByPost', async () => 1);
  t.mock.method(communityLikeRepository, 'deleteByPostId', async () => {
    likesDeleted = true;
    return { deletedCount: 1 };
  });
  t.mock.method(communityCommentRepository, 'deleteByPostId', async () => ({ deletedCount: 0 }));

  const feed = await request(app).get('/api/v1/community/posts').set('Authorization', auth);
  const like = await request(app).post(`/api/v1/community/posts/${POST_A}/likes`).set('Authorization', auth);
  const deleted = await request(app).delete(`/api/v1/community/posts/${POST_A}`).set('Authorization', auth);

  assert.deepEqual(feed.body.data.posts[0].recipeAttachment, { isAvailable: false, recipe: null });
  assert.equal(JSON.stringify(feed.body).includes('Chicken Adobo'), false);
  assert.equal(JSON.stringify(feed.body).includes('adobo.jpg'), false);
  assert.deepEqual(like.body.data, { liked: true, likeCount: 1 });
  assert.equal(deleted.status, 200);
  assert.equal(likesDeleted, true);
});

test('feed validates page/limit and rejects client-controlled query fields', async (t) => {
  const auth = mockAuth(t);
  for (const query of ['page=0', 'limit=101', `userId=${USER_B}`, 'sort=oldest']) {
    const response = await request(app)
      .get(`/api/v1/community/posts?${query}`)
      .set('Authorization', auth);
    assert.equal(response.status, 400, query);
  }
});

test('owner delete scopes ownership and removes likes without touching recipe', async (t) => {
  const auth = mockAuth(t);
  let deleteArgs;
  let cleanupId;
  let recipeLookup = false;
  t.mock.method(communityRepository, 'deleteOwnedById', async (...args) => {
    deleteArgs = args;
    return fakePost({ recipeId: RECIPE_ID });
  });
  t.mock.method(communityLikeRepository, 'deleteByPostId', async (id) => {
    cleanupId = String(id);
    return { deletedCount: 2 };
  });
  let commentCleanupId;
  t.mock.method(communityCommentRepository, 'deleteByPostId', async (id) => {
    commentCleanupId = String(id);
    return { deletedCount: 3 };
  });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => {
    recipeLookup = true;
    return null;
  });

  const response = await request(app)
    .delete(`/api/v1/community/posts/${POST_A}`)
    .set('Authorization', auth);
  assert.equal(response.status, 200);
  assert.deepEqual(deleteArgs, [POST_A, USER_A]);
  assert.equal(cleanupId, POST_A);
  assert.equal(commentCleanupId, POST_A);
  assert.equal(recipeLookup, false);
});

test('non-owner and normal admin receive the same not-found result on owner delete', async (t) => {
  const auth = mockAuth(t, { id: ADMIN, sessionId: SESSION_ADMIN, role: 'admin', name: 'Admin' });
  let authorId;
  t.mock.method(communityRepository, 'deleteOwnedById', async (_postId, owner) => {
    authorId = owner;
    return null;
  });
  const response = await request(app)
    .delete(`/api/v1/community/posts/${POST_A}`)
    .set('Authorization', auth);
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COMMUNITY_POST_NOT_FOUND');
  assert.equal(authorId, ADMIN);
});

test('delete preserves unrelated posts and gives a non-owner the same result as a missing post', async (t) => {
  const auth = mockAuthDirectory(t);
  const posts = new Map([
    [POST_A, fakePost()],
    [POST_B, fakePost({ _id: POST_B, authorId: USER_B })],
  ]);
  const likes = new Set([`${POST_A}:${USER_A}`, `${POST_A}:${USER_B}`, `${POST_B}:${USER_B}`]);
  t.mock.method(communityRepository, 'deleteOwnedById', async (postId, authorId) => {
    const post = posts.get(String(postId));
    if (!post || String(post.authorId) !== String(authorId)) return null;
    posts.delete(String(postId));
    return post;
  });
  t.mock.method(communityLikeRepository, 'deleteByPostId', async (postId) => {
    let deletedCount = 0;
    for (const key of [...likes]) {
      if (key.startsWith(`${postId}:`)) {
        likes.delete(key);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  });
  const comments = new Set([`${POST_A}:${COMMENT_A}`, `${POST_B}:${COMMENT_B}`]);
  t.mock.method(communityCommentRepository, 'deleteByPostId', async (postId) => {
    let deletedCount = 0;
    for (const key of [...comments]) {
      if (key.startsWith(`${postId}:`)) {
        comments.delete(key);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  });

  const forbidden = await request(app).delete(`/api/v1/community/posts/${POST_A}`).set('Authorization', auth[USER_B]);
  const missing = await request(app).delete(`/api/v1/community/posts/${POST_C}`).set('Authorization', auth[USER_B]);
  const deleted = await request(app).delete(`/api/v1/community/posts/${POST_A}`).set('Authorization', auth[USER_A]);

  assert.equal(forbidden.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(forbidden.body.error, missing.body.error);
  assert.equal(deleted.status, 200);
  assert.equal(posts.has(POST_A), false);
  assert.equal(posts.has(POST_B), true);
  assert.deepEqual([...likes], [`${POST_B}:${USER_B}`]);
  assert.deepEqual([...comments], [`${POST_B}:${COMMENT_B}`]);
});

test('delete and like routes reject malformed post ids before repository access', async (t) => {
  const auth = mockAuth(t);
  for (const operation of [
    request(app).delete('/api/v1/community/posts/not-an-id'),
    request(app).post('/api/v1/community/posts/not-an-id/likes'),
    request(app).delete('/api/v1/community/posts/not-an-id/likes'),
  ]) {
    const response = await operation.set('Authorization', auth);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});

test('like is authenticated, server-counted, and scoped to the authenticated user', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(communityRepository, 'findById', async () => fakePost());
  let relation;
  t.mock.method(communityLikeRepository, 'createLike', async (doc) => {
    relation = doc;
    return { _id: 'like', ...doc };
  });
  t.mock.method(communityLikeRepository, 'countByPost', async () => 4);

  const response = await request(app)
    .post(`/api/v1/community/posts/${POST_A}/likes`)
    .set('Authorization', auth);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { liked: true, likeCount: 4 });
  assert.deepEqual(relation, { postId: POST_A, userId: USER_A });
});

test('duplicate-key like race is idempotent success, never a raw 500', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(communityRepository, 'findById', async () => fakePost());
  t.mock.method(communityLikeRepository, 'createLike', async () => {
    const error = new Error('duplicate');
    error.code = 11000;
    throw error;
  });
  t.mock.method(communityLikeRepository, 'countByPost', async () => 1);

  const response = await request(app)
    .post(`/api/v1/community/posts/${POST_A}/likes`)
    .set('Authorization', auth);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { liked: true, likeCount: 1 });
});

test('two users like and unlike independently without duplicate or negative counts', async (t) => {
  const auth = mockAuthDirectory(t);
  const likes = new Set();
  t.mock.method(communityRepository, 'findById', async () => fakePost());
  t.mock.method(communityRepository, 'findMany', async () => [fakePost()]);
  t.mock.method(communityRepository, 'countPosts', async () => 1);
  mockPublicAuthors(t);
  t.mock.method(communityLikeRepository, 'createLike', async ({ postId, userId }) => {
    const key = `${postId}:${userId}`;
    if (likes.has(key)) {
      const error = new Error('duplicate');
      error.code = 11000;
      throw error;
    }
    likes.add(key);
    return { postId, userId };
  });
  t.mock.method(communityLikeRepository, 'deleteByPostAndUser', async (postId, userId) => {
    const key = `${postId}:${userId}`;
    const existed = likes.delete(key);
    return existed ? { postId, userId } : null;
  });
  t.mock.method(communityLikeRepository, 'countByPost', async (postId) =>
    [...likes].filter((key) => key.startsWith(`${postId}:`)).length
  );
  t.mock.method(communityLikeRepository, 'getMetadataForPosts', async (_postIds, viewerId) => [{
    _id: POST_A,
    likeCount: likes.size,
    likedByCurrentUser: likes.has(`${POST_A}:${viewerId}`),
  }]);
  t.mock.method(communityCommentRepository, 'getCountsForPosts', async () => []);

  const mutate = (method, userId) => request(app)[method](`/api/v1/community/posts/${POST_A}/likes`)
    .set('Authorization', auth[userId]);
  const a1 = await mutate('post', USER_A);
  const a2 = await mutate('post', USER_A);
  const b1 = await mutate('post', USER_B);
  const aUnlike = await mutate('delete', USER_A);
  const asB = await request(app).get('/api/v1/community/posts').set('Authorization', auth[USER_B]);
  const bUnlike = await mutate('delete', USER_B);
  const bUnlikeAgain = await mutate('delete', USER_B);

  assert.deepEqual(a1.body.data, { liked: true, likeCount: 1 });
  assert.deepEqual(a2.body.data, { liked: true, likeCount: 1 });
  assert.deepEqual(b1.body.data, { liked: true, likeCount: 2 });
  assert.deepEqual(aUnlike.body.data, { liked: false, likeCount: 1 });
  assert.equal(asB.body.data.posts[0].likedByCurrentUser, true);
  assert.equal(asB.body.data.posts[0].likeCount, 1);
  assert.deepEqual(bUnlike.body.data, { liked: false, likeCount: 0 });
  assert.deepEqual(bUnlikeAgain.body.data, { liked: false, likeCount: 0 });
  assert.equal(likes.size, 0);
});

test('like removes its relation if the post is deleted during the mutation race', async (t) => {
  const auth = mockAuth(t);
  let reads = 0;
  t.mock.method(communityRepository, 'findById', async () => {
    reads += 1;
    return reads === 1 ? fakePost() : null;
  });
  t.mock.method(communityLikeRepository, 'createLike', async () => ({ _id: 'like' }));
  let cleanup;
  t.mock.method(communityLikeRepository, 'deleteByPostAndUser', async (...args) => {
    cleanup = args;
    return { _id: 'like' };
  });

  const response = await request(app)
    .post(`/api/v1/community/posts/${POST_A}/likes`)
    .set('Authorization', auth);
  assert.equal(response.status, 404);
  assert.deepEqual(cleanup, [POST_A, USER_A]);
});

test('unlike removes only the authenticated viewer relation and is idempotent', async (t) => {
  const auth = mockAuth(t, { id: USER_B, sessionId: SESSION_B, name: 'User B' });
  t.mock.method(communityRepository, 'findById', async () => fakePost());
  let relation;
  t.mock.method(communityLikeRepository, 'deleteByPostAndUser', async (...args) => {
    relation = args;
    return null;
  });
  t.mock.method(communityLikeRepository, 'countByPost', async () => 1);

  const response = await request(app)
    .delete(`/api/v1/community/posts/${POST_A}/likes`)
    .set('Authorization', auth);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { liked: false, likeCount: 1 });
  assert.deepEqual(relation, [POST_A, USER_B]);
});

test('like and unlike return controlled not-found for a missing post', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(communityRepository, 'findById', async () => null);
  const like = await request(app)
    .post(`/api/v1/community/posts/${POST_A}/likes`)
    .set('Authorization', auth);
  const unlike = await request(app)
    .delete(`/api/v1/community/posts/${POST_A}/likes`)
    .set('Authorization', auth);
  assert.equal(like.status, 404);
  assert.equal(unlike.status, 404);
  assert.equal(like.body.error.code, 'COMMUNITY_POST_NOT_FOUND');
});

test('comment list is lazy-page shaped, newest-first from repository, safe, and server-counted', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(communityRepository, 'findById', async () => fakePost());
  let paginationArgs;
  t.mock.method(communityCommentRepository, 'findManyByPostId', async (postId, args) => {
    assert.equal(postId, POST_A);
    paginationArgs = args;
    return [
      fakeComment({ _id: COMMENT_C, authorId: USER_B }),
      fakeComment({ _id: COMMENT_B, authorId: USER_A }),
    ];
  });
  t.mock.method(communityCommentRepository, 'countByPostId', async () => 5);
  mockPublicAuthors(t, [
    { _id: USER_A, name: 'User A', email: 'private-a@example.com', role: 'admin' },
  ]);

  const response = await request(app)
    .get(`/api/v1/community/posts/${POST_A}/comments?page=2&limit=2`)
    .set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(paginationArgs, { skip: 2, limit: 2 });
  assert.equal(response.body.data.commentCount, 5);
  assert.deepEqual(response.body.data.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });
  assert.deepEqual(response.body.data.comments.map((comment) => comment.id), [COMMENT_C, COMMENT_B]);
  assert.equal(response.body.data.comments[0].author, null);
  assert.equal(response.body.data.comments[0].isOwner, false);
  assert.deepEqual(response.body.data.comments[1].author, { id: USER_A, name: 'User A', avatarUrl: null });
  assert.equal(response.body.data.comments[1].isOwner, true);
  assert.deepEqual(Object.keys(response.body.data.comments[1]).sort(), ['author', 'body', 'createdAt', 'id', 'isOwner']);
  assert.equal(JSON.stringify(response.body).includes('private-a@example.com'), false);
});

test('comment list returns an empty page and controlled missing-post response', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(communityRepository, 'findById', async (postId) =>
    String(postId) === POST_A ? fakePost() : null);
  t.mock.method(communityCommentRepository, 'findManyByPostId', async () => []);
  t.mock.method(communityCommentRepository, 'countByPostId', async () => 0);
  mockPublicAuthors(t, []);

  const empty = await request(app)
    .get(`/api/v1/community/posts/${POST_A}/comments?page=3&limit=20`)
    .set('Authorization', auth);
  const missing = await request(app)
    .get(`/api/v1/community/posts/${POST_B}/comments`)
    .set('Authorization', auth);
  assert.deepEqual(empty.body.data, {
    comments: [],
    commentCount: 0,
    pagination: { page: 3, limit: 20, total: 0, totalPages: 0 },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'COMMUNITY_POST_NOT_FOUND');
});

test('comment create derives identity and post, trims body, and returns authoritative count', async (t) => {
  const auth = mockAuth(t);
  t.mock.method(communityRepository, 'findById', async () => fakePost());
  let created;
  t.mock.method(communityCommentRepository, 'createComment', async (doc) => {
    created = doc;
    return fakeComment(doc);
  });
  t.mock.method(communityCommentRepository, 'countByPostId', async () => 4);
  mockPublicAuthors(t);

  const response = await request(app)
    .post(`/api/v1/community/posts/${POST_A}/comments`)
    .set('Authorization', auth)
    .send({ body: '  Line one\nLine two  ' });
  assert.equal(response.status, 201);
  assert.deepEqual(created, { postId: POST_A, authorId: USER_A, body: 'Line one\nLine two' });
  assert.equal(response.body.data.comment.body, 'Line one\nLine two');
  assert.equal(response.body.data.comment.isOwner, true);
  assert.equal(response.body.data.commentCount, 4);
});

test('comment create removes the just-created row if post deletion wins the race', async (t) => {
  const auth = mockAuth(t);
  let reads = 0;
  t.mock.method(communityRepository, 'findById', async () => {
    reads += 1;
    return reads === 1 ? fakePost() : null;
  });
  t.mock.method(communityCommentRepository, 'createComment', async (doc) => fakeComment(doc));
  let cleanupId;
  t.mock.method(communityCommentRepository, 'deleteById', async (commentId) => {
    cleanupId = String(commentId);
    return fakeComment();
  });

  const response = await request(app)
    .post(`/api/v1/community/posts/${POST_A}/comments`)
    .set('Authorization', auth)
    .send({ body: 'Racing comment' });
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COMMUNITY_POST_NOT_FOUND');
  assert.equal(cleanupId, COMMENT_A);
});

test('comment delete is opaque and owner-only, including for an admin', async (t) => {
  const auth = mockAuthDirectory(t);
  t.mock.method(communityCommentRepository, 'deleteOwnedById', async (commentId, authorId) =>
    String(commentId) === COMMENT_A && String(authorId) === USER_A ? fakeComment() : null);
  t.mock.method(communityCommentRepository, 'countByPostId', async (postId) => {
    assert.equal(String(postId), POST_A);
    return 2;
  });

  const nonOwner = await request(app).delete(`/api/v1/community/comments/${COMMENT_A}`).set('Authorization', auth[USER_B]);
  const admin = await request(app).delete(`/api/v1/community/comments/${COMMENT_A}`).set('Authorization', auth[ADMIN]);
  const missing = await request(app).delete(`/api/v1/community/comments/${COMMENT_B}`).set('Authorization', auth[USER_B]);
  const owner = await request(app).delete(`/api/v1/community/comments/${COMMENT_A}`).set('Authorization', auth[USER_A]);
  assert.equal(nonOwner.status, 404);
  assert.equal(admin.status, 404);
  assert.deepEqual(nonOwner.body.error, missing.body.error);
  assert.equal(nonOwner.body.error.code, 'COMMUNITY_COMMENT_NOT_FOUND');
  assert.deepEqual(owner.body.data, { deleted: true, commentCount: 2 });
});

test('comment routes strictly validate ids, page bounds, and body fields', async (t) => {
  const auth = mockAuth(t);
  const operations = [
    request(app).get('/api/v1/community/posts/not-an-id/comments'),
    request(app).get(`/api/v1/community/posts/${POST_A}/comments?page=0`),
    request(app).get(`/api/v1/community/posts/${POST_A}/comments?limit=101`),
    request(app).get(`/api/v1/community/posts/${POST_A}/comments?sort=oldest`),
    request(app).post(`/api/v1/community/posts/${POST_A}/comments`).send({ body: ' ' }),
    request(app).post(`/api/v1/community/posts/${POST_A}/comments`).send({ body: 'x'.repeat(1001) }),
    request(app).post(`/api/v1/community/posts/${POST_A}/comments`).send({ body: 'Okay', authorId: USER_B }),
    request(app).delete('/api/v1/community/comments/not-an-id'),
  ];
  for (const operation of operations) {
    const response = await operation.set('Authorization', auth);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});
