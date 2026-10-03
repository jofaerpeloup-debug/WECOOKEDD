jest.mock('../src/api/client', () => ({ api: { patch: jest.fn(), post: jest.fn(), del: jest.fn() } }));
const { api } = require('../src/api/client');
const { updateProfile, uploadAvatar, resetAvatar } = require('../src/api/profileService');

class TestFormData { constructor() { this.parts = []; } append(...args) { this.parts.push(args); } }
beforeEach(() => { jest.clearAllMocks(); global.FormData = TestFormData; });

it('allowlists only frozen PATCH fields and preference leaves', async () => {
  api.patch.mockResolvedValue({ user: { id: 'u1' } });
  await updateProfile({ name: 'Ada', bio: 'Cook', cookingLevel: 'advanced', avatarUrl: 'never', role: 'admin', preferences: { dietaryPreferences: [], allergies: ['nuts'], notifications: { enabled: false }, extra: true } });
  expect(api.patch).toHaveBeenCalledWith('/users/me', { body: { name: 'Ada', bio: 'Cook', cookingLevel: 'advanced', preferences: { dietaryPreferences: [], allergies: ['nuts'], notifications: { enabled: false } } } });
});

it('multipart contains exactly one image part with picker file data', async () => {
  api.post.mockResolvedValue({ user: { id: 'u1', avatarUrl: 'https://cdn/a.webp' } });
  await uploadAvatar({ uri: 'file://a.png', fileName: 'a.png', mimeType: 'image/png', assetId: 'never' });
  const body = api.post.mock.calls[0][1].body;
  expect(body.parts).toEqual([['image', { uri: 'file://a.png', name: 'a.png', type: 'image/png' }]]);
});

it('reset sends no body, identity, URL, or asset id', async () => {
  api.del.mockResolvedValue({ user: { id: 'u1', avatarUrl: null } });
  await resetAvatar();
  expect(api.del).toHaveBeenCalledWith('/users/me/avatar');
});
