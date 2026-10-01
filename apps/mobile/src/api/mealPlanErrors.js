import { ApiError } from './client';

export function getMealPlanErrorState(err) {
  if (!(err instanceof ApiError)) {
    return { kind: 'generic', message: 'Something went wrong. Please try again.' };
  }
  if (err.isNetworkError) {
    return { kind: 'network', message: 'Can’t reach WeCooked. Check your connection and try again.' };
  }
  switch (err.code) {
    case 'MEAL_PLAN_ENTRY_ALREADY_EXISTS':
      return { kind: 'duplicate', message: 'That recipe is already planned for this day. Choose another date.' };
    case 'MEAL_PLAN_ENTRY_STALE':
      return { kind: 'stale', message: 'This planned meal changed. We refreshed your meal plan; review it before moving again.' };
    case 'MEAL_PLAN_ENTRY_NOT_FOUND':
      return { kind: 'notFound', message: 'That planned meal no longer exists. Refresh your meal plan to see the latest state.' };
    case 'RECIPE_NOT_FOUND':
      return { kind: 'notFound', message: 'This recipe isn’t available anymore.' };
    case 'VALIDATION_ERROR':
      return { kind: 'validation', message: err.details?.[0]?.message || 'That meal-plan request wasn’t valid.' };
    case 'AUTH_SESSION_INVALID':
    case 'AUTH_TOKEN_INVALID':
    case 'AUTH_TOKEN_MISSING':
      return { kind: 'auth', message: 'Your session has expired. Please log in again.' };
    default:
      return {
        kind: 'generic',
        message: err.status >= 500
          ? 'WeCooked is having trouble right now. Please try again shortly.'
          : err.message,
      };
  }
}

export function getMealPlanErrorMessage(err) {
  return getMealPlanErrorState(err).message;
}
