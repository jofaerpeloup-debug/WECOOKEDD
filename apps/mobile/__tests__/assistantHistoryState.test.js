jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../src/api/client', () => ({ api: {} }));
const { createHistoryState, isLiveConversation, mergeMessages, mergeConversations,
  retryableUser, historySessionKey } = require('../src/screens/assistantHistoryState');
it('starts blank without device persistence or a server identity', () => {
  expect(createHistoryState()).toMatchObject({ messages: [], input: '', conversation: null, failedRequest: null });
});
it('prepends older pages, deduplicates by ID and replaces pending rows with server status', () => {
  const first = { id: 'a', sequence: 0, status: 'pending' };
  const result = mergeMessages([first, { id: 'b', sequence: 2 }], [{ ...first, status: 'complete' }, { id: 'c', sequence: 4 }]);
  expect(result).toEqual([{ ...first, status: 'complete' }, { id: 'b', sequence: 2 }, { id: 'c', sequence: 4 }]);
});
it('uses immutable creation order for history, replaces duplicates, filters expired rows', () => {
  const row = (id, createdAt, expiresAt = '2099-01-01') => ({ id, createdAt, expiresAt });
  expect(mergeConversations([row('a', '2026-01-01'), row('c', '2026-01-02')],
    [row('b', '2026-01-02'), row('a', '2026-01-01'), row('expired', '2026-01-03', '2000-01-01')])
    .map(({ id }) => id)).toEqual(['c', 'b', 'a']);
});
it('hides at the exact immutable deadline without extending on activity', () => {
  const value = { expiresAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-13T23:59:59.999Z' };
  const deadline = Date.parse(value.expiresAt);
  expect(isLiveConversation(value, deadline - 1)).toBe(true);
  expect(isLiveConversation(value, deadline)).toBe(false);
  expect(isLiveConversation(value, deadline + 1)).toBe(false);
});
it.each(['pending', 'complete', 'uncertain'])('does not offer failed-turn Retry for %s', (status) => {
  expect(retryableUser([{ id: 'a', role: 'user', status }])).toBeNull();
});
it('offers only the final failed user, with no later send or reply', () => {
  const failed = { id: 'a', role: 'user', status: 'failed' };
  expect(retryableUser([failed])).toBe(failed);
  expect(retryableUser([failed, { id: 'b', role: 'assistant' }])).toBeNull();
  expect(retryableUser([failed, { id: 'b', role: 'user', status: 'complete' }])).toBeNull();
});
it('binds owner, logout, same-owner generation and local session revision', () => {
  const auth = { status: 'authenticated', user: { id: 'a' }, sessionIdentity: { ownerId: 'a', generation: 1, localSessionRevision: 2 } };
  const original = historySessionKey(auth);
  expect(historySessionKey({ ...auth, user: { id: 'b' } })).not.toBe(original);
  expect(historySessionKey({ ...auth, status: 'guest' })).not.toBe(original);
  expect(historySessionKey({ ...auth, sessionIdentity: { ...auth.sessionIdentity, generation: 2 } })).not.toBe(original);
  expect(historySessionKey({ ...auth, sessionIdentity: { ...auth.sessionIdentity, localSessionRevision: 3 } })).not.toBe(original);
});
