import { ApiError } from './apiClient.js';

const STAFF_ERROR_MESSAGES = Object.freeze({
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

export function staffErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!(error instanceof ApiError)) return fallback;
  if (STAFF_ERROR_MESSAGES[error.code]) return STAFF_ERROR_MESSAGES[error.code];
  if (error.isUnauthorized) return 'Your session has expired. Please sign in again.';
  if (error.isForbidden) return 'Your account no longer has permission to do that.';
  return error.message || fallback;
}
