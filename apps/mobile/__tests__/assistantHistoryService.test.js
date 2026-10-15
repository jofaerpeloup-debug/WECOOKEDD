jest.mock('../src/api/client', () => ({ api: { post: jest.fn(), get: jest.fn(), del: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') }));
const { api } = require('../src/api/client');
const service = require('../src/api/assistantHistoryService');
const parent = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z', expiresAt: '2026-11-14T00:00:00.000Z', version: 2 };
const pageInfo = { hasMore: false, nextCursor: null };
const userMessage = { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'user', content: 'Lentils', sequence: 0, createdAt: parent.createdAt, status: 'complete' };
const assistantMessage = { id: 'cccccccccccccccccccccccc', role: 'assistant', content: 'Soup', sequence: 1, createdAt: parent.createdAt };
beforeEach(() => jest.clearAllMocks());
it('uses authenticated CRUD paths, explicit pagination, and safe wire projections', async () => {
  api.post.mockResolvedValue({ conversation: { ...parent, userId: 'private' } });
  expect(await service.createConversation('create-key')).toEqual(parent);
  expect(api.post).toHaveBeenCalledWith('/assistant/conversations', { body: { requestId: 'create-key' } });
  api.get.mockResolvedValue({ conversations: [parent], pageInfo });
  expect(await service.listConversations('opaque')).toEqual({ conversations: [parent], pageInfo });
  expect(api.get).toHaveBeenLastCalledWith('/assistant/conversations', { query: { limit: 20, cursor: 'opaque' } });
  api.get.mockResolvedValue({ conversation: parent, messages: [userMessage, assistantMessage], pageInfo });
  await expect(service.openConversation(parent.id, 'older')).resolves.toMatchObject({ messages: [userMessage, assistantMessage] });
  expect(api.get).toHaveBeenLastCalledWith(`/assistant/conversations/${parent.id}`, { query: { limit: 20, cursor: 'older' } });
  api.del.mockResolvedValue({ deleted: true });
  await service.deleteConversation(parent.id);
  expect(api.del).toHaveBeenCalledWith(`/assistant/conversations/${parent.id}`);
});
it.each([{ content: 'Lentils' }, { retryOf: userMessage.id }])('sends only strict fields and preserves attempt identity: %p', async (variant) => {
  const body = { requestId: 'send-key', expectedVersion: 0, ...variant };
  api.post.mockResolvedValue({ conversation: parent, requestId: body.requestId, userMessage, assistantMessage });
  await expect(service.sendConversationMessage(parent.id, { ...body, messages: ['forged'], userId: 'forged' }))
    .resolves.toEqual({ conversation: parent, requestId: body.requestId, userMessage, assistantMessage });
  expect(api.post).toHaveBeenCalledWith(`/assistant/conversations/${parent.id}/messages`, { body });
  expect(api.post).toHaveBeenCalledTimes(1);
});
it.each([undefined, {}, { conversation: { ...parent, expiresAt: 'bad' } },
  { conversation: { ...parent, version: -1 } }])('rejects malformed create responses: %p', async (value) => {
  api.post.mockResolvedValue(value);
  await expect(service.createConversation('key')).rejects.toMatchObject({ code: 'ASSISTANT_MALFORMED_RESPONSE' });
});
it.each([
  { conversation: parent, messages: [{ ...userMessage, status: 'invented' }], pageInfo },
  { conversation: parent, messages: [], pageInfo: { hasMore: true, nextCursor: null } },
  { conversation: { ...parent, id: 'dddddddddddddddddddddddd' }, messages: [], pageInfo },
])('rejects invalid Open data without exposing a transcript: %p', async (data) => {
  api.get.mockResolvedValue(data);
  await expect(service.openConversation(parent.id)).rejects.toMatchObject({ code: 'ASSISTANT_MALFORMED_RESPONSE' });
});
it.each([
  { requestId: 'wrong' }, { assistantMessage: { ...assistantMessage, content: '' } },
  { assistantMessage: { ...assistantMessage, sequence: 5 } }, { userMessage: { ...userMessage, status: 'pending' } },
])('rejects mismatched or incomplete Send results: %p', async (override) => {
  api.post.mockResolvedValue({ conversation: parent, requestId: 'key', userMessage, assistantMessage, ...override });
  await expect(service.sendConversationMessage(parent.id, { requestId: 'key', expectedVersion: 0, content: 'Lentils' }))
    .rejects.toMatchObject({ code: 'ASSISTANT_MALFORMED_RESPONSE' });
});
it('propagates server and transport failures without retries or fallback', async () => {
  const failure = new Error('offline');
  api.post.mockRejectedValue(failure);
  await expect(service.sendConversationMessage(parent.id, { requestId: 'key', expectedVersion: 0, content: 'Lentils' })).rejects.toBe(failure);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.get).not.toHaveBeenCalled();
});
