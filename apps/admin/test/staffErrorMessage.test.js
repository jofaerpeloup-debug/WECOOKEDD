import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root: adminRoot,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
});

const { ApiError } = await server.ssrLoadModule('/src/apiClient.js');
const { staffErrorMessage, staffFieldErrors } = await server.ssrLoadModule('/src/staffErrorMessage.js');

test.after(async () => {
  await server.close();
});

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

test('Staff auth validation details map to matching fields and preserve useful messages', () => {
  const error = new ApiError('Request validation failed.', {
    code: 'VALIDATION_ERROR',
    status: 400,
    details: [
      { field: 'email', message: 'Invalid email address.' },
      { field: 'password', message: 'Password must contain at least one uppercase letter.' },
      { field: 'password', message: 'Password must contain at least one number.' },
      { field: 'name', message: 'Name is required.' },
      { field: 'role', message: 'Unexpected field.' },
      { field: 'password', message: 'Password must contain at least one number.' },
    ],
  });

  assert.deepEqual(staffFieldErrors(error, ['name', 'email', 'password']), {
    email: ['Invalid email address.'],
    password: [
      'Password must contain at least one uppercase letter.',
      'Password must contain at least one number.',
    ],
    name: ['Name is required.'],
  });
  assert.deepEqual(staffFieldErrors(error, ['email', 'password']), {
    email: ['Invalid email address.'],
    password: [
      'Password must contain at least one uppercase letter.',
      'Password must contain at least one number.',
    ],
  });
});

test('unrelated details are ignored and invalid credentials remain generic', () => {
  const unrelated = new ApiError('Request validation failed.', {
    code: 'VALIDATION_ERROR',
    status: 400,
    details: [{ field: 'role', message: 'Unexpected field.' }],
  });
  assert.deepEqual(staffFieldErrors(unrelated, ['name', 'email', 'password']), {});

  const invalidCredentials = new ApiError('Invalid email or password.', {
    code: 'AUTH_INVALID_CREDENTIALS',
    status: 401,
  });
  assert.deepEqual(staffFieldErrors(invalidCredentials, ['email', 'password']), {});
  assert.equal(staffErrorMessage(invalidCredentials), 'Invalid email or password.');
});

test('account credential errors map to the correct fields', () => {
  const currentPassword = new ApiError('Current password is incorrect.', {
    code: 'AUTH_CURRENT_PASSWORD_INVALID',
    status: 400,
  });
  assert.deepEqual(staffFieldErrors(currentPassword, ['currentPassword', 'newPassword']), {
    currentPassword: ['Current password is incorrect.'],
  });

  const samePassword = new ApiError('New password must be different from your current password.', {
    code: 'NEW_PASSWORD_SAME_AS_CURRENT',
    status: 400,
  });
  assert.deepEqual(staffFieldErrors(samePassword, ['currentPassword', 'newPassword']), {
    newPassword: ['New password must be different from your current password.'],
  });
});

test('invalid, expired, and replayed reset tokens receive stable safe copy', () => {
  const error = new ApiError('Password reset token is invalid or expired.', {
    code: 'AUTH_PASSWORD_RESET_TOKEN_INVALID',
    status: 400,
  });
  assert.equal(
    staffErrorMessage(error),
    'This reset link is invalid, expired, or has already been used.',
  );
});
