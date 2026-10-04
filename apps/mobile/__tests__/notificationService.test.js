jest.mock('../src/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, options = {}) { super(message); Object.assign(this, options); }
  },
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));

const { api } = require('../src/api/client');
const service = require('../src/api/notificationService');

const ID = '507f1f77bcf86cd799439011';
const TARGET = '507f1f77bcf86cd799439012';
const ISO = '2026-10-04T01:02:03.000Z';

function row(overrides = {}) {
  return {
    id: ID,
    type: 'savedRecipe',
    content: { title: 'Saved', body: 'Your recipe was saved.' },
    action: { kind: 'recipe', recipeId: TARGET },
    createdAt: ISO,
    readAt: null,
    ...overrides,
  };
}

function page(overrides = {}) {
  return {
    notifications: [row()],
    unreadCount: 1,
    pageInfo: { nextCursor: null, hasMore: false },
    ...overrides,
  };
}

function publicUser(overrides = {}) {
  return {
    id: '507f1f77bcf86cd799439001', name: 'Ada', email: 'ada@example.com', avatarUrl: null,
    bio: '', cookingLevel: 'beginner', role: 'user', status: 'active',
    preferences: {
      dietaryPreferences: [], allergies: [],
      notifications: { enabled: true, push: true, email: true, suggestions: true, digest: false, reminders: true },
    },
    authIdentities: [], emailVerified: true, createdAt: ISO, updatedAt: ISO,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

it('uses exact inbox paths, methods, query, and anchored bodies', async () => {
  api.get.mockResolvedValue(page());
  api.patch.mockImplementation((path) => Promise.resolve(path.endsWith('/read')
    ? { notification: row({ readAt: ISO }), unreadCount: 0 }
    : path === '/notifications/read-all' ? { unreadCount: 0 } : { user: publicUser() }));
  api.post.mockResolvedValue({ unreadCount: 0 });
  await service.listNotifications({ limit: 20, cursor: 'opaque' });
  await service.markNotificationRead(ID);
  await service.markAllNotificationsRead(ID);
  await service.archiveAllNotifications(ID);
  expect(api.get).toHaveBeenCalledWith('/notifications', { query: { limit: 20, cursor: 'opaque' } });
  expect(api.patch).toHaveBeenCalledWith(`/notifications/${ID}/read`, { body: {} });
  expect(api.patch).toHaveBeenCalledWith('/notifications/read-all', { body: { throughNotificationId: ID } });
  expect(api.post).toHaveBeenCalledWith('/notifications/archive-all', { body: { throughNotificationId: ID } });
});

it.each([
  ['missing page key', (() => { const value = page(); delete value.unreadCount; return value; })()],
  ['extra page key', { ...page(), recipientId: TARGET }],
  ['mistyped unread count', page({ unreadCount: '1' })],
  ['negative unread count', page({ unreadCount: -1 })],
  ['duplicate row id', page({ notifications: [row(), row()] })],
  ['malformed action', page({ notifications: [row({ action: { kind: 'recipe', route: 'Admin' } })] })],
  ['extra notification field', page({ notifications: [row({ eventKey: 'secret' })] })],
  ['bad pagination pair', page({ pageInfo: { nextCursor: null, hasMore: true } })],
  ['cursor when complete', page({ pageInfo: { nextCursor: 'x', hasMore: false } })],
  ['older row before newer row', page({ notifications: [
    row({ createdAt: '2026-10-04T01:02:02.000Z' }),
    row({ id: TARGET }),
  ] })],
  ['equal-time ids in ascending order', page({ notifications: [
    row(),
    row({ id: TARGET }),
  ] })],
])('rejects malformed 2xx list payload: %s', async (_, payload) => {
  api.get.mockResolvedValue(payload);
  await expect(service.listNotifications()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
});

it.each([
  { kind: 'none' },
  { kind: 'recipe', recipeId: TARGET },
  { kind: 'communityPost', postId: TARGET },
  { kind: 'mealPlan', entryId: TARGET },
])('accepts only a complete allowlisted action %#', async (action) => {
  api.get.mockResolvedValue(page({ notifications: [row({ action })] }));
  await expect(service.listNotifications()).resolves.toEqual(expect.objectContaining({ unreadCount: 1 }));
});

it('rejects malformed read/count 2xx payloads rather than treating them as success', async () => {
  api.patch.mockResolvedValueOnce({ notification: row() });
  await expect(service.markNotificationRead(ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  api.patch.mockResolvedValueOnce({ unreadCount: 0, extra: true });
  await expect(service.markAllNotificationsRead(ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  api.post.mockResolvedValue({ unreadCount: '0' });
  await expect(service.archiveAllNotifications(ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('rejects a well-shaped read response bound to a different notification id', async () => {
  api.patch.mockResolvedValue({ notification: row({ id: TARGET, readAt: ISO }), unreadCount: 0 });
  await expect(service.markNotificationRead(ID)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
    status: 502,
  });
});

it('accepts complete list ordering by createdAt desc then id desc', async () => {
  api.get.mockResolvedValue(page({ notifications: [
    row({ id: TARGET }),
    row(),
    row({ id: '507f1f77bcf86cd799439010', createdAt: '2026-10-04T01:02:02.000Z' }),
  ] }));
  await expect(service.listNotifications()).resolves.toEqual(expect.objectContaining({ unreadCount: 1 }));
});

it('writes one canonical preference leaf and strictly validates the full authoritative user', async () => {
  api.patch.mockResolvedValue({ user: publicUser({ preferences: {
    dietaryPreferences: [], allergies: [],
    notifications: { enabled: false, push: false, email: true, suggestions: true, digest: false, reminders: true },
  } }) });
  await expect(service.updateNotificationPreference('push', false)).resolves.toEqual(expect.objectContaining({ id: '507f1f77bcf86cd799439001' }));
  expect(api.patch).toHaveBeenCalledWith('/users/me', {
    body: { preferences: { notifications: { push: false } } },
  });

  const malformed = publicUser();
  malformed.preferences.notifications.enabled = false;
  api.patch.mockResolvedValue({ user: malformed });
  await expect(service.updateNotificationPreference('email', false)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('rejects unsupported/non-Boolean preference input before transport', async () => {
  await expect(service.updateNotificationPreference('enabled', true)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  await expect(service.updateNotificationPreference('push', 'yes')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(api.patch).not.toHaveBeenCalled();
});
