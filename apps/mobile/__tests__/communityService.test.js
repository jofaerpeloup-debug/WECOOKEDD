jest.mock('../src/api/client', () => ({ api: { get: jest.fn(), post: jest.fn(), del: jest.fn() } }));

const { api } = require('../src/api/client');
const {
  listCommunityPosts,
  createCommunityPost,
  createCommunityComment,
  deleteCommunityComment,
  deleteCommunityPost,
  listCommunityComments,
  setCommunityPostLiked,
} = require('../src/api/communityService');

beforeEach(() => jest.clearAllMocks());

function publicComment(overrides = {}) {
  return {
    id: 'c1',
    body: 'Hello',
    author: { id: 'u1', name: 'User One' },
    createdAt: '2026-10-03T00:00:00.000Z',
    isOwner: true,
    ...overrides,
  };
}

it('lists only page/limit and preserves the server feed envelope', async () => {
  api.get.mockResolvedValue({ posts: [{ id: 'p1' }], pagination: { page: 2 } });
  await expect(listCommunityPosts({ page: 2, limit: 20, userId: 'never-send', sort: 'oldest' }))
    .resolves.toEqual({ posts: [{ id: 'p1' }], pagination: { page: 2 } });
  expect(api.get).toHaveBeenCalledWith('/community/posts', { query: { page: 2, limit: 20 } });
});

it('creates with caption and optional recipeId only', async () => {
  api.post.mockResolvedValue({ post: { id: 'p1' } });
  await createCommunityPost({
    caption: 'Dinner',
    recipeId: 'r1',
    authorId: 'never-send',
    imageUrl: 'never-send',
    likeCount: 99,
  });
  expect(api.post).toHaveBeenCalledWith('/community/posts', {
    body: { caption: 'Dinner', recipeId: 'r1' },
  });
});

it('omits recipeId for a text-only post', async () => {
  api.post.mockResolvedValue({ post: { id: 'p1' } });
  await createCommunityPost({ caption: 'Text only', recipeId: null });
  expect(api.post).toHaveBeenCalledWith('/community/posts', { body: { caption: 'Text only' } });
});

it('deletes an encoded post id and returns only confirmed success', async () => {
  api.del.mockResolvedValue({ deleted: true });
  await expect(deleteCommunityPost('post/id')).resolves.toBe(true);
  expect(api.del).toHaveBeenCalledWith('/community/posts/post%2Fid');
});

it('uses idempotent POST-like and DELETE-unlike state routes', async () => {
  api.post.mockResolvedValue({ liked: true, likeCount: 4 });
  api.del.mockResolvedValue({ liked: false, likeCount: 3 });
  await expect(setCommunityPostLiked('p1', true)).resolves.toEqual({ liked: true, likeCount: 4 });
  await expect(setCommunityPostLiked('p1', false)).resolves.toEqual({ liked: false, likeCount: 3 });
  expect(api.post).toHaveBeenCalledWith('/community/posts/p1/likes');
  expect(api.del).toHaveBeenCalledWith('/community/posts/p1/likes');
});

it('propagates create, like, and delete failures without fabricating success', async () => {
  const failure = new Error('offline');
  api.post.mockRejectedValue(failure);
  api.del.mockRejectedValue(failure);
  await expect(createCommunityPost({ caption: 'Draft' })).rejects.toBe(failure);
  await expect(setCommunityPostLiked('p1', true)).rejects.toBe(failure);
  await expect(deleteCommunityPost('p1')).rejects.toBe(failure);
});

it('lists comments with encoded post id, page/limit only, and server envelope', async () => {
  api.get.mockResolvedValue({
    comments: [publicComment()],
    commentCount: 8,
    pagination: { page: 2, limit: 3, total: 8, totalPages: 3 },
  });
  await expect(listCommunityComments('post/id', {
    page: 2,
    limit: 20,
    authorId: 'never-send',
    sort: 'oldest',
  })).resolves.toEqual({
    comments: [publicComment()],
    commentCount: 8,
    pagination: { page: 2, limit: 3, total: 8, totalPages: 3 },
  });
  expect(api.get).toHaveBeenCalledWith('/community/posts/post%2Fid/comments', {
    query: { page: 2, limit: 20 },
  });
});

it('creates a comment with body only and preserves authoritative result', async () => {
  api.post.mockResolvedValue({ comment: publicComment(), commentCount: 4 });
  await expect(createCommunityComment('post/id', 'Hello', {
    authorId: 'never-send',
  })).resolves.toEqual({ comment: publicComment(), commentCount: 4 });
  expect(api.post).toHaveBeenCalledWith('/community/posts/post%2Fid/comments', {
    body: { body: 'Hello' },
  });
});

it('deletes an encoded comment id and returns confirmed state/count', async () => {
  api.del.mockResolvedValue({ deleted: true, commentCount: 2 });
  await expect(deleteCommunityComment('comment/id')).resolves.toEqual({
    deleted: true,
    commentCount: 2,
  });
  expect(api.del).toHaveBeenCalledWith('/community/comments/comment%2Fid');
});

it('propagates comment list/create/delete failures', async () => {
  const failure = new Error('offline');
  api.get.mockRejectedValue(failure);
  api.post.mockRejectedValue(failure);
  api.del.mockRejectedValue(failure);
  await expect(listCommunityComments('p1')).rejects.toBe(failure);
  await expect(createCommunityComment('p1', 'Draft')).rejects.toBe(failure);
  await expect(deleteCommunityComment('c1')).rejects.toBe(failure);
});

it.each([
  ['missing comments', { commentCount: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }],
  ['malformed comment', { comments: [{ id: 'c1' }], commentCount: 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }],
  ['malformed author', { comments: [publicComment({ author: { id: 'u1' } })], commentCount: 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }],
  ['malformed pagination', { comments: [], commentCount: 0, pagination: { page: 1 } }],
  ['inconsistent total', { comments: [], commentCount: 2, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }],
  ['inconsistent pages', { comments: [], commentCount: 21, pagination: { page: 1, limit: 20, total: 21, totalPages: 1 } }],
])('rejects a malformed successful comment list: %s', async (_name, response) => {
  api.get.mockResolvedValue(response);
  await expect(listCommunityComments('p1')).rejects.toThrow('Invalid Community comment response.');
});

it.each([
  null,
  {},
  'comment',
  publicComment({ body: '' }),
  publicComment({ body: ' '.repeat(2) }),
  publicComment({ body: 'x'.repeat(1001) }),
  publicComment({ createdAt: null }),
  publicComment({ createdAt: 'not-a-date' }),
  publicComment({ isOwner: 'yes' }),
])('rejects a malformed successful create comment shape', async (comment) => {
  api.post.mockResolvedValue({ comment, commentCount: 1 });
  await expect(createCommunityComment('p1', 'Draft')).rejects.toThrow('Invalid Community comment response.');
});

it('rejects malformed authoritative create/delete counts and delete confirmation', async () => {
  api.post.mockResolvedValue({ comment: publicComment(), commentCount: -1 });
  api.del
    .mockResolvedValueOnce({ deleted: false, commentCount: 0 })
    .mockResolvedValueOnce({ deleted: true, commentCount: 1.5 });
  await expect(createCommunityComment('p1', 'Draft')).rejects.toThrow('Invalid Community comment response.');
  await expect(deleteCommunityComment('c1')).rejects.toThrow('Invalid Community comment response.');
  await expect(deleteCommunityComment('c1')).rejects.toThrow('Invalid Community comment response.');
});
