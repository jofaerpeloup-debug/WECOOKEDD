jest.mock('../src/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), del: jest.fn() },
}));

const { api } = require('../src/api/client');
const {
  createRecipeReview,
  deleteReview,
  getRecipeReviews,
  updateReview,
} = require('../src/api/reviewService');

const review = {
  id: 'review-1',
  rating: 5,
  comment: 'Excellent.',
  author: { id: 'user-1', name: 'Mina' },
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
};

const listPayload = {
  summary: { averageRating: 5, ratingCount: 1 },
  reviews: [review],
  pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
  currentUserReview: review,
};

beforeEach(() => jest.clearAllMocks());

describe('reviewService list contract', () => {
  it('requests the encoded recipe path with only supported query fields', async () => {
    api.get.mockResolvedValue(listPayload);

    await expect(getRecipeReviews('recipe/id', {
      page: 2,
      limit: 20,
      sort: 'newest',
      userId: 'must-not-send',
    })).resolves.toEqual(listPayload);

    expect(api.get).toHaveBeenCalledWith('/recipes/recipe%2Fid/reviews', {
      query: { page: 2, limit: 20, sort: 'newest' },
    });
  });

  it.each([
    ['missing summary', { ...listPayload, summary: undefined }],
    ['non-null average with zero ratings', { ...listPayload, summary: { averageRating: 5, ratingCount: 0 } }],
    ['null average with positive ratings', { ...listPayload, summary: { averageRating: null, ratingCount: 1 } }],
    ['missing reviews', { ...listPayload, reviews: undefined }],
    ['malformed review', { ...listPayload, reviews: [{ ...review, rating: 8 }] }],
    ['missing pagination', { ...listPayload, pagination: null }],
    ['missing current-user authority', (() => { const value = { ...listPayload }; delete value.currentUserReview; return value; })()],
  ])('fails closed for a successful response with %s', async (_label, payload) => {
    api.get.mockResolvedValue(payload);
    await expect(getRecipeReviews('recipe-1')).rejects.toMatchObject({ code: 'INVALID_REVIEW_PAYLOAD' });
  });

  it('accepts a confirmed server empty state without fabricating it', async () => {
    const empty = {
      summary: { averageRating: null, ratingCount: 0 },
      reviews: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      currentUserReview: null,
    };
    api.get.mockResolvedValue(empty);
    await expect(getRecipeReviews('recipe-1')).resolves.toEqual(empty);
  });

  it('accepts a coherent non-empty server summary', async () => {
    const nonEmpty = {
      ...listPayload,
      summary: { averageRating: 4.5, ratingCount: 2 },
    };
    api.get.mockResolvedValue(nonEmpty);
    await expect(getRecipeReviews('recipe-1')).resolves.toEqual(nonEmpty);
  });
});

describe('reviewService mutation contracts', () => {
  it('creates with only rating and optional comment', async () => {
    api.post.mockResolvedValue({ review });
    await expect(createRecipeReview('recipe/id', {
      rating: 5,
      comment: 'Excellent.',
      userId: 'must-not-send',
      author: { name: 'Fake' },
      createdAt: 'must-not-send',
      averageRating: 5,
      hasCooked: true,
      cookStatus: 'complete',
      completedAt: 'must-not-send',
      cookHistoryEventId: 'must-not-send',
    })).resolves.toBe(review);
    expect(api.post).toHaveBeenCalledWith('/recipes/recipe%2Fid/reviews', {
      body: { rating: 5, comment: 'Excellent.' },
    });
  });

  it('updates only rating/comment at the encoded review path', async () => {
    api.patch.mockResolvedValue({ review: { ...review, rating: 3, comment: '' } });
    await updateReview('review/id', {
      rating: 3,
      comment: '',
      userId: 'must-not-send',
      updatedAt: 'must-not-send',
      ratingCount: 99,
    });
    expect(api.patch).toHaveBeenCalledWith('/reviews/review%2Fid', {
      body: { rating: 3, comment: '' },
    });
  });

  it('deletes only the encoded authoritative review id', async () => {
    api.del.mockResolvedValue({ deleted: true });
    await expect(deleteReview('review/id')).resolves.toEqual({ deleted: true });
    expect(api.del).toHaveBeenCalledWith('/reviews/review%2Fid');
  });
});
