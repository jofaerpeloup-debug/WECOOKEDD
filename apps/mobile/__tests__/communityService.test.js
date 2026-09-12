jest.mock('../src/api/client', () => ({ api: { get: jest.fn(), post: jest.fn(), del: jest.fn() } }));

const { api } = require('../src/api/client');
const {
  listCommunityPosts,
  createCommunityPost,
  deleteCommunityPost,
  setCommunityPostLiked,
} = require('../src/api/communityService');

beforeEach(() => jest.clearAllMocks());

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
