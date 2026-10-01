import { ApiError } from './client';
import { MALFORMED_ASSISTANT_RESPONSE } from './assistantService';

export const ASSISTANT_ERROR_MESSAGES = Object.freeze({
  notConfigured: 'Chef Assistant is not available yet. Please try again later.',
  temporary: 'Chef Assistant is temporarily unavailable. Please try again.',
  rateLimited: 'Too many requests were made. Please try again later.',
  invalid: 'Chef Assistant could not process that request. Please revise it and try again.',
  generic: 'Chef Assistant could not complete that request. Please try again.',
});

export function getAssistantError(error) {
  if (error?.code === MALFORMED_ASSISTANT_RESPONSE) {
    return { message: ASSISTANT_ERROR_MESSAGES.generic, retryable: true };
  }

  if (!(error instanceof ApiError)) {
    return { message: ASSISTANT_ERROR_MESSAGES.generic, retryable: true };
  }

  if (error.isNetworkError) {
    return { message: ASSISTANT_ERROR_MESSAGES.temporary, retryable: true };
  }

  switch (error.code) {
    case 'ASSISTANT_NOT_CONFIGURED':
      return { message: ASSISTANT_ERROR_MESSAGES.notConfigured, retryable: true };
    case 'ASSISTANT_UNAVAILABLE':
    case 'ASSISTANT_TIMEOUT':
      return { message: ASSISTANT_ERROR_MESSAGES.temporary, retryable: true };
    case 'RATE_LIMIT_EXCEEDED':
      return { message: ASSISTANT_ERROR_MESSAGES.rateLimited, retryable: true };
    case 'VALIDATION_ERROR':
      return { message: ASSISTANT_ERROR_MESSAGES.invalid, retryable: false };
    default:
      if (error.status === 400) {
        return { message: ASSISTANT_ERROR_MESSAGES.invalid, retryable: false };
      }
      if (error.status >= 500) {
        return { message: ASSISTANT_ERROR_MESSAGES.temporary, retryable: true };
      }
      return { message: ASSISTANT_ERROR_MESSAGES.generic, retryable: true };
  }
}
