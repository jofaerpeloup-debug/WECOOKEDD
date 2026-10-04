function serializeAction(action) {
  if (action?.kind === 'none') return { kind: 'none' };
  if (action?.kind === 'recipe' && action.recipeId) {
    return { kind: 'recipe', recipeId: String(action.recipeId) };
  }
  if (action?.kind === 'communityPost' && action.postId) {
    return { kind: 'communityPost', postId: String(action.postId) };
  }
  if (action?.kind === 'mealPlan' && action.entryId) {
    return { kind: 'mealPlan', entryId: String(action.entryId) };
  }
  return null;
}

function toPublicNotification(notification) {
  return {
    id: String(notification._id),
    type: notification.type,
    content: {
      title: notification.content.title,
      body: notification.content.body,
    },
    action: serializeAction(notification.action),
    createdAt: notification.createdAt,
    readAt: notification.readAt ?? null,
  };
}

module.exports = { serializeAction, toPublicNotification };
