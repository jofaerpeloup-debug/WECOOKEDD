import { ApiError, api } from './client';

const OBJECT_ID_RE = /^[a-f0-9]{24}$/;
const NOTIFICATION_TYPES = new Set([
  'savedRecipe', 'cookCompleted', 'collectionCreated', 'cookReminder',
  'communityLike', 'communityComment', 'communityFollow',
]);
const PREFERENCE_KEYS = new Set(['push', 'email', 'suggestions', 'digest', 'reminders']);

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exact(value, keys) {
  return record(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function objectId(value) {
  return typeof value === 'string' && OBJECT_ID_RE.test(value);
}

function timestamp(value, nullable = false) {
  if (nullable && value === null) return true;
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function invalidResponse() {
  return new ApiError('The notification response was malformed.', {
    kind: 'api',
    code: 'INVALID_RESPONSE',
    status: 502,
  });
}

function validAction(action) {
  if (exact(action, ['kind']) && action.kind === 'none') return true;
  if (exact(action, ['kind', 'recipeId'])) return action.kind === 'recipe' && objectId(action.recipeId);
  if (exact(action, ['kind', 'postId'])) return action.kind === 'communityPost' && objectId(action.postId);
  if (exact(action, ['kind', 'entryId'])) return action.kind === 'mealPlan' && objectId(action.entryId);
  return false;
}

function validNotification(value) {
  return exact(value, ['id', 'type', 'content', 'action', 'createdAt', 'readAt'])
    && objectId(value.id)
    && NOTIFICATION_TYPES.has(value.type)
    && exact(value.content, ['title', 'body'])
    && typeof value.content.title === 'string'
    && value.content.title.trim() === value.content.title
    && value.content.title.length >= 1 && value.content.title.length <= 120
    && typeof value.content.body === 'string'
    && value.content.body.trim() === value.content.body
    && value.content.body.length >= 1 && value.content.body.length <= 500
    && validAction(value.action)
    && timestamp(value.createdAt)
    && timestamp(value.readAt, true);
}

function validUnreadCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function newestFirst(notifications) {
  return notifications.every((notification, index) => {
    if (index === 0) return true;
    const previous = notifications[index - 1];
    const previousCreatedAt = Date.parse(previous.createdAt);
    const createdAt = Date.parse(notification.createdAt);
    return previousCreatedAt > createdAt
      || (previousCreatedAt === createdAt && previous.id > notification.id);
  });
}

function parseList(data) {
  if (!exact(data, ['notifications', 'unreadCount', 'pageInfo'])
    || !Array.isArray(data.notifications)
    || !data.notifications.every(validNotification)
    || new Set(data.notifications.map((row) => row.id)).size !== data.notifications.length
    || !newestFirst(data.notifications)
    || !validUnreadCount(data.unreadCount)
    || !exact(data.pageInfo, ['nextCursor', 'hasMore'])
    || typeof data.pageInfo.hasMore !== 'boolean'
    || (data.pageInfo.hasMore
      ? typeof data.pageInfo.nextCursor !== 'string' || !data.pageInfo.nextCursor
      : data.pageInfo.nextCursor !== null)) {
    throw invalidResponse();
  }
  return data;
}

function parseRead(data, requestedNotificationId) {
  if (!exact(data, ['notification', 'unreadCount'])
    || !validNotification(data.notification)
    || data.notification.id !== requestedNotificationId
    || !validUnreadCount(data.unreadCount)) throw invalidResponse();
  return data;
}

function parseCount(data) {
  if (!exact(data, ['unreadCount']) || !validUnreadCount(data.unreadCount)) {
    throw invalidResponse();
  }
  return data;
}

function validStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validPublicUser(user) {
  if (!exact(user, [
    'id', 'name', 'email', 'avatarUrl', 'bio', 'cookingLevel', 'role', 'status',
    'preferences', 'authIdentities', 'emailVerified', 'createdAt', 'updatedAt',
  ])) return false;
  const notifications = user.preferences?.notifications;
  return objectId(user.id)
    && typeof user.name === 'string' && !!user.name
    && typeof user.email === 'string' && !!user.email
    && (user.avatarUrl === null || (typeof user.avatarUrl === 'string' && /^https:\/\//i.test(user.avatarUrl)))
    && typeof user.bio === 'string'
    && ['beginner', 'intermediate', 'advanced'].includes(user.cookingLevel)
    && ['user', 'moderator', 'admin'].includes(user.role)
    && ['active', 'suspended'].includes(user.status)
    && exact(user.preferences, ['dietaryPreferences', 'allergies', 'notifications'])
    && validStringArray(user.preferences.dietaryPreferences)
    && validStringArray(user.preferences.allergies)
    && exact(notifications, ['enabled', 'push', 'email', 'suggestions', 'digest', 'reminders'])
    && Object.values(notifications).every((value) => typeof value === 'boolean')
    && notifications.enabled === notifications.push
    && Array.isArray(user.authIdentities)
    && user.authIdentities.every((identity) => exact(identity, ['provider', 'linkedAt'])
      && ['google', 'apple', 'facebook'].includes(identity.provider)
      && timestamp(identity.linkedAt))
    && typeof user.emailVerified === 'boolean'
    && timestamp(user.createdAt)
    && timestamp(user.updatedAt);
}

export function listNotifications({ limit = 20, cursor } = {}) {
  const query = { limit };
  if (cursor) query.cursor = cursor;
  return api.get('/notifications', { query }).then(parseList);
}

export function markNotificationRead(notificationId) {
  return api.patch(`/notifications/${encodeURIComponent(notificationId)}/read`, { body: {} })
    .then((data) => parseRead(data, notificationId));
}

export function markAllNotificationsRead(throughNotificationId) {
  return api.patch('/notifications/read-all', { body: { throughNotificationId } }).then(parseCount);
}

export function archiveAllNotifications(throughNotificationId) {
  return api.post('/notifications/archive-all', { body: { throughNotificationId } }).then(parseCount);
}

export function updateNotificationPreference(key, value) {
  if (!PREFERENCE_KEYS.has(key) || typeof value !== 'boolean') {
    return Promise.reject(new ApiError('A supported Boolean notification preference is required.', {
      kind: 'api', code: 'VALIDATION_ERROR', status: 400,
    }));
  }
  return api.patch('/users/me', {
    body: { preferences: { notifications: { [key]: value } } },
  }).then((data) => {
    if (!exact(data, ['user']) || !validPublicUser(data.user)) throw invalidResponse();
    return data.user;
  });
}

export const notificationServiceValidation = {
  validAction,
  validNotification,
  validPublicUser,
  newestFirst,
  parseList,
  parseRead,
  parseCount,
};
