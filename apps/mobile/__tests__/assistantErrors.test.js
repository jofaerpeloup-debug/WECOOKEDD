jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    constructor(message, opts = {}) {
      super(message);
      Object.assign(this, { code: 'UNKNOWN', status: 0, details: [], kind: 'api' }, opts);
    }

    get isNetworkError() {
      return this.kind === 'network';
    }
  }
  return { ApiError };
});

const { ApiError } = require('../src/api/client');
const {
  AssistantServiceError,
} = require('../src/api/assistantService');
const {
  ASSISTANT_ERROR_MESSAGES,
  getAssistantError,
} = require('../src/api/assistantErrors');

it('truthfully maps an unconfigured Assistant without exposing server text', () => {
  const error = new ApiError('unsafe internal detail', {
    code: 'ASSISTANT_NOT_CONFIGURED',
    status: 503,
  });
  expect(getAssistantError(error)).toEqual({
    message: ASSISTANT_ERROR_MESSAGES.notConfigured,
    retryable: true,
  });
  expect(getAssistantError(error).message).not.toContain('unsafe internal detail');
});

it.each([
  ['ASSISTANT_UNAVAILABLE', 503],
  ['ASSISTANT_TIMEOUT', 504],
  ['UNKNOWN_SERVER_FAILURE', 500],
])('maps %s to a safe temporary failure', (code, status) => {
  expect(getAssistantError(new ApiError('raw', { code, status }))).toEqual({
    message: ASSISTANT_ERROR_MESSAGES.temporary,
    retryable: true,
  });
});

it('maps network failures to a safe temporary failure', () => {
  const error = new ApiError('raw network detail', {
    code: 'NETWORK_ERROR',
    kind: 'network',
  });
  expect(getAssistantError(error)).toEqual({
    message: ASSISTANT_ERROR_MESSAGES.temporary,
    retryable: true,
  });
});

it('maps rate limiting, validation, malformed success, and unknown failures safely', () => {
  expect(
    getAssistantError(
      new ApiError('raw', { code: 'RATE_LIMIT_EXCEEDED', status: 429 })
    )
  ).toEqual({ message: ASSISTANT_ERROR_MESSAGES.rateLimited, retryable: true });
  expect(
    getAssistantError(new ApiError('raw', { code: 'VALIDATION_ERROR', status: 400 }))
  ).toEqual({ message: ASSISTANT_ERROR_MESSAGES.invalid, retryable: false });
  expect(getAssistantError(new AssistantServiceError())).toEqual({
    message: ASSISTANT_ERROR_MESSAGES.generic,
    retryable: true,
  });
  expect(getAssistantError(new Error('raw'))).toEqual({
    message: ASSISTANT_ERROR_MESSAGES.generic,
    retryable: true,
  });
});

it('treats every generic HTTP 400 validation failure as non-retryable', () => {
  expect(getAssistantError(new ApiError('raw', { code: 'OTHER_400', status: 400 }))).toEqual({
    message: ASSISTANT_ERROR_MESSAGES.invalid,
    retryable: false,
  });
});
