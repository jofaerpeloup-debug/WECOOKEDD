const OBJECT_ID = /^[0-9a-f]{24}$/;

export function actionDestination(action) {
  if (action?.kind === 'recipe' && OBJECT_ID.test(action.recipeId)) {
    return ['RecipeDetail', { recipeSource: 'api', recipeId: action.recipeId }];
  }
  if (action?.kind === 'communityPost' && OBJECT_ID.test(action.postId)) {
    return ['MainTabs', { screen: 'Community', params: { postId: action.postId } }];
  }
  if (action?.kind === 'mealPlan' && OBJECT_ID.test(action.entryId)) {
    return ['MealPlan', { entryId: action.entryId }];
  }
  return null;
}

export function validNativeNotificationData(data) {
  return !!data && typeof data === 'object' && !Array.isArray(data)
    && Object.keys(data).sort().join('|') === ['kind', 'notificationId', 'version'].sort().join('|')
    && data.version === 1 && data.kind === 'notification' && OBJECT_ID.test(data.notificationId);
}
