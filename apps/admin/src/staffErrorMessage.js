import { ApiError } from './apiClient.js';

const STAFF_ERROR_MESSAGES = Object.freeze({
  AUTH_INVALID_CREDENTIALS: 'Invalid email or password.',
  AUTH_PASSWORD_CHANGE_UNAVAILABLE: 'Password change is not available for this account.',
  AUTH_PASSWORD_RESET_TOKEN_INVALID:
    'This reset link is invalid, expired, or has already been used.',
  MODERATOR_APPLICATION_PASSWORD_REQUIRED:
    'A WeCooked password is required to apply. Provider-only accounts are not eligible yet.',
  MODERATOR_APPLICATION_NOT_ELIGIBLE:
    'This account is not currently eligible to apply for Moderator access.',
  MODERATOR_APPLICATION_ALREADY_PENDING:
    'A Moderator application is already pending. Refresh your status to continue.',
  MODERATOR_APPLICATION_REAPPLY_COOLDOWN:
    'Your previous Moderator application was recently reviewed. You can apply again after the 24-hour reapplication cooldown.',
  MODERATOR_APPLICATION_HISTORY_INVALID:
    "We can't process another Moderator application right now. Please try again later or contact an administrator.",
  MODERATOR_APPLICATION_EMAIL_UNVERIFIED:
    'The applicant must verify their email before approval.',
  MODERATOR_APPLICATION_NOT_PENDING:
    'This application is no longer pending. The list has been refreshed.',
  MODERATOR_TARGET_INVALID:
    'This person is no longer a current Moderator. The list has been refreshed.',
});

export function staffFieldErrors(error, allowedFields = []) {
  if (!(error instanceof ApiError)) return {};

  const allowed = new Set(allowedFields);
  const accountErrorField = {
    AUTH_CURRENT_PASSWORD_INVALID: 'currentPassword',
    NEW_PASSWORD_SAME_AS_CURRENT: 'newPassword',
  }[error.code];
  if (accountErrorField && allowed.has(accountErrorField)) {
    return { [accountErrorField]: [error.message] };
  }
  if (error.code !== 'VALIDATION_ERROR') return {};

  const fieldErrors = {};
  for (const detail of error.details) {
    const field = typeof detail?.field === 'string' ? detail.field : '';
    const message = typeof detail?.message === 'string' ? detail.message.trim() : '';
    if (!allowed.has(field) || !message) continue;
    if (!fieldErrors[field]) fieldErrors[field] = [];
    if (!fieldErrors[field].includes(message)) fieldErrors[field].push(message);
  }
  return fieldErrors;
}

export function staffErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!(error instanceof ApiError)) return fallback;
  if (STAFF_ERROR_MESSAGES[error.code]) return STAFF_ERROR_MESSAGES[error.code];
  if (error.isUnauthorized) return 'Your session has expired. Please sign in again.';
  if (error.isForbidden) return 'Your account no longer has permission to do that.';
  return error.message || fallback;
}
