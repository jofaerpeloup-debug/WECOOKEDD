jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    constructor(message, opts = {}) {
      super(message);
      Object.assign(this, { code: 'UNKNOWN', status: 0, details: [], kind: 'api' }, opts);
    }
  }
  return { ApiError };
});

const { ApiError } = require('../src/api/client');
const { getReviewErrorMessage } = require('../src/api/reviewErrors');

it('maps REVIEW_COOK_REQUIRED to the exact safe truthful message', () => {
  const error = new ApiError('unsafe transport text', {
    status: 409,
    code: 'REVIEW_COOK_REQUIRED',
  });

  expect(getReviewErrorMessage(error)).toBe(
    'Complete this recipe in WeCooked before rating or reviewing it.'
  );
});

it('does not use physical-verification or proof language', () => {
  const message = getReviewErrorMessage(new ApiError('x', { code: 'REVIEW_COOK_REQUIRED', status: 409 }));
  expect(message).not.toMatch(/verified|proof|confirmed real/i);
});
