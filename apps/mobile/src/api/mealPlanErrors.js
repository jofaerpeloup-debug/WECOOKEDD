import { ApiError } from './client';

export function getMealPlanErrorMessage(err) {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (err.isNetworkError) return 'Can’t reach WeCooked. Check your connection and try again.';
  switch (err.code) {
    case 'MEAL_PLAN_ENTRY_ALREADY_EXISTS': return 'That recipe is already planned for this day.';
    case 'MEAL_PLAN_ENTRY_NOT_FOUND': return 'That planned meal no longer exists.';
    case 'RECIPE_NOT_FOUND': return 'This recipe isn’t available anymore.';
    case 'VALIDATION_ERROR': return err.details?.[0]?.message || 'That meal-plan request wasn’t valid.';
    case 'AUTH_SESSION_INVALID':
    case 'AUTH_TOKEN_INVALID':
    case 'AUTH_TOKEN_MISSING': return 'Your session has expired. Please log in again.';
    default: return err.status >= 500 ? 'WeCooked is having trouble right now. Please try again shortly.' : err.message;
  }
}
