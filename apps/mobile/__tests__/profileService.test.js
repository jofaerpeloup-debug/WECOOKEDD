const mockFiles = new Map();
jest.mock('expo-file-system', () => ({
  File: class MockFile {
    constructor(uri) {
      const metadata = mockFiles.get(uri);
      if (metadata?.throws) throw new Error('unreadable');
      this.uri = uri;
      this.exists = metadata?.exists ?? true;
      this.size = metadata?.size ?? 128;
      this.name = metadata?.name ?? uri.split('/').pop();
      this.type = metadata?.type ?? 'image/jpeg';
    }
    bytes() { return Promise.resolve(new Uint8Array([1])); }
  },
}));
jest.mock('../src/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, options = {}) { super(message); Object.assign(this, options); }
  },
  api: { patch: jest.fn(), post: jest.fn(), del: jest.fn() },
}));
const { api } = require('../src/api/client');
const { File } = require('expo-file-system');
const { updateProfile, uploadAvatar, resetAvatar } = require('../src/api/profileService');

class TestFormData { constructor() { this.parts = []; } append(...args) { this.parts.push(args); } }
beforeEach(() => { jest.clearAllMocks(); mockFiles.clear(); global.FormData = TestFormData; });

it('allowlists only frozen PATCH fields and preference leaves', async () => {
  api.patch.mockResolvedValue({ user: { id: 'u1' } });
  await updateProfile({ name: 'Ada', bio: 'Cook', cookingLevel: 'advanced', avatarUrl: 'never', role: 'admin', preferences: { dietaryPreferences: [], allergies: ['nuts'], notifications: { enabled: false }, extra: true } });
  expect(api.patch).toHaveBeenCalledWith('/users/me', { body: { name: 'Ada', bio: 'Cook', cookingLevel: 'advanced', preferences: { dietaryPreferences: [], allergies: ['nuts'], notifications: { enabled: false } } } });
});

it('multipart contains exactly one image File part and ignores legacy picker file metadata', async () => {
  api.post.mockResolvedValue({ user: { id: 'u1', avatarUrl: 'https://cdn/a.webp' } });
  mockFiles.set('file://safe/a.png', { name: 'a.png', type: 'image/png' });
  await uploadAvatar({ uri: 'file://safe/a.png', fileName: '../../unsafe.jpg', mimeType: 'image/png', assetId: 'never' });
  const { bodyFactory } = api.post.mock.calls[0][1];
  const body = bodyFactory();
  expect(body.parts).toHaveLength(1);
  expect(body.parts[0][0]).toBe('image');
  expect(body.parts[0][1]).toBeInstanceOf(File);
  expect(body.parts[0][1].bytes).toEqual(expect.any(Function));
  expect(body.parts[0][1]).not.toEqual({ uri: 'file://safe/a.png', name: 'a.png', type: 'image/png' });
  expect(api.post).toHaveBeenCalledWith('/users/me/avatar', { bodyFactory: expect.any(Function) });
});

it('rebuilds the File and FormData for each transport attempt', async () => {
  api.post.mockResolvedValue({ user: { id: 'u1' } });
  mockFiles.set('file://safe/a.webp', { name: 'a.webp', type: 'image/webp' });
  await uploadAvatar({ uri: 'file://safe/a.webp' });
  const { bodyFactory } = api.post.mock.calls[0][1];
  const first = bodyFactory();
  const retry = bodyFactory();
  expect(retry).not.toBe(first);
  expect(first.parts).toHaveLength(1);
  expect(retry.parts).toHaveLength(1);
  expect(first.parts[0][0]).toBe('image');
  expect(retry.parts[0][0]).toBe('image');
  expect(retry.parts[0][1]).not.toBe(first.parts[0][1]);
});

it.each([
  ['missing', { exists: false, name: 'a.jpg', type: 'image/jpeg' }, 'AVATAR_FILE_UNREADABLE'],
  ['empty', { size: 0, name: 'a.jpg', type: 'image/jpeg' }, 'AVATAR_FILE_UNREADABLE'],
  ['too large', { size: (5 * 1024 * 1024) + 1, name: 'a.jpg', type: 'image/jpeg' }, 'AVATAR_FILE_TOO_LARGE'],
  ['unsupported', { name: 'a.heic', type: 'image/heic' }, 'AVATAR_FILE_UNSUPPORTED'],
  ['unknown', { name: 'a.bin', type: '' }, 'AVATAR_FILE_UNSUPPORTED'],
  ['mismatched', { name: 'a.png', type: 'image/png' }, 'AVATAR_FILE_UNSUPPORTED'],
])('fails locally for a %s file before calling the API', async (_, metadata, code) => {
  mockFiles.set('file://safe/file', metadata);
  expect(() => uploadAvatar({ uri: 'file://safe/file', mimeType: code === 'AVATAR_FILE_UNSUPPORTED' ? 'image/jpeg' : undefined })).toThrow(expect.objectContaining({ code, kind: 'local' }));
  expect(api.post).not.toHaveBeenCalled();
});

it('reset sends no body, identity, URL, or asset id', async () => {
  api.del.mockResolvedValue({ user: { id: 'u1', avatarUrl: null } });
  await resetAvatar();
  expect(api.del).toHaveBeenCalledWith('/users/me/avatar');
});
