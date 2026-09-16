import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/apiClient.js';
import { staffErrorMessage } from '../src/staffErrorMessage.js';

test('Moderator reapplication cooldown receives safe useful Staff Portal copy', () => {
  const error = new ApiError('Backend-safe fallback.', {
    code: 'MODERATOR_APPLICATION_REAPPLY_COOLDOWN',
    status: 429,
  });

  assert.equal(
    staffErrorMessage(error),
    'Your previous Moderator application was recently reviewed. You can apply again after the 24-hour reapplication cooldown.'
  );
});

test('Moderator application history-invalid receives safe copy, not a cooldown or success claim', () => {
  const error = new ApiError('Backend-safe fallback.', {
    code: 'MODERATOR_APPLICATION_HISTORY_INVALID',
    status: 409,
  });

  const message = staffErrorMessage(error);
  assert.equal(
    message,
    "We can't process another Moderator application right now. Please try again later or contact an administrator."
  );
  assert.equal(message.toLowerCase().includes('cooldown'), false);
});

test('non-API errors remain sanitized to the caller fallback', () => {
  assert.equal(staffErrorMessage(new Error('internal detail')), 'Something went wrong. Please try again.');
});
