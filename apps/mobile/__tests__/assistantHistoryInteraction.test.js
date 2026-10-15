const fs = require('fs');
const path = require('path');
const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) =>
    React.forwardRef(({ children, ...props }, ref) =>
      React.createElement(name, { ...props, ref }, children)
    );
  const ScrollView = React.forwardRef(({ children, ...props }, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToEnd: jest.fn() }), []);
    return React.createElement('RCTScrollView', props, children);
  });

  return {
    AppState: { addEventListener: jest.fn((_event, callback) => { mockResume = callback; return { remove: jest.fn() }; }) },
    ActivityIndicator: host('ActivityIndicator'),
    KeyboardAvoidingView: host('View'),
    Platform: { OS: 'ios', select: (spec) => spec?.ios ?? spec?.default },
    Pressable: host('View'),
    ScrollView,
    StyleSheet: {
      create: (styles) => styles,
      flatten: (style) =>
        Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cream: '#fff',
      creamDeep: '#eee',
      paper: '#fff',
      ink: '#111',
      inkSoft: '#333',
      inkFaint: '#666',
      hairline: '#ccc',
      onAccent: '#fff',
      sagePale: '#efe',
      sageDeep: '#353',
      error: '#900',
      errorBg: '#fee',
    },
  }),
}));

let mockResume;
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-' + String(++mockUuid).padStart(12, '0') }));
const baseConversation = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', version: 0 };

jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    constructor(message, options = {}) {
      super(message);
      Object.assign(this, { code: 'UNKNOWN', status: 0, kind: 'api' }, options);
    }

    get isNetworkError() {
      return this.kind === 'network';
    }
  }
  return { ApiError, api: { post: jest.fn(), get: jest.fn(), del: jest.fn() } };
});

let mockAuth = { status: 'authenticated', user: { id: 'user-a' } };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));

const {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} = require('@testing-library/react-native');
const { ApiError, api } = require('../src/api/client');
const AssistantScreen = require('../src/screens/AssistantScreen').default;

const A = baseConversation;
const B = { ...A, id: 'dddddddddddddddddddddddd', createdAt: '2026-10-14T00:00:00.000Z' };
const ROOT = '/assistant/conversations';
const pageInfo = { hasMore: false, nextCursor: null };
const userRow = (content = 'Saved question', status = 'complete') => ({ id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  role: 'user', content, status, sequence: 0, createdAt: A.createdAt });
const answerRow = (content = 'Saved answer') => ({ id: 'cccccccccccccccccccccccc', role: 'assistant',
  content, sequence: 1, createdAt: A.createdAt });
const opened = (conversation = A, messages = [userRow(), answerRow()], paging = pageInfo) => ({ conversation, messages, pageInfo: paging });
const success = (body, conversation = A) => ({ conversation: { ...conversation, version: 2 }, requestId: body.requestId,
  userMessage: userRow(body.content || 'Saved question'), assistantMessage: answerRow('Fresh answer') });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => {}); }
async function settle(task, method, value) { await act(async () => { task[method](value); await task.promise.catch(() => {}); }); }
let view, navigation;
function mount(route) {
  navigation = { goBack: jest.fn(), setParams: jest.fn(), addListener: jest.fn(() => jest.fn()) };
  view = render(<AssistantScreen navigation={navigation} route={route} />);
  return view;
}
async function typeSend(text) {
  fireEvent.changeText(view.getByLabelText('Question for Chef Assistant'), text);
  fireEvent.press(view.getByLabelText('Send question'));
  await flush();
}
async function showHistory() { fireEvent.press(view.getByLabelText('History')); await flush(); }
async function openA() {
  await showHistory();
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`));
  await flush();
}
function sendCalls() { return api.post.mock.calls.filter(([path]) => path.endsWith('/messages')); }
beforeEach(() => {
  jest.clearAllMocks();
  api.post.mockReset(); api.get.mockReset(); api.del.mockReset();
  mockAuth = { status: 'authenticated', user: { id: 'user-a' },
    sessionIdentity: { ownerId: 'user-a', generation: 1, localSessionRevision: 1 } };
  api.post.mockImplementation(async (path, { body }) => path === ROOT ? { conversation: A } : success(body, path.includes(B.id) ? B : A));
  api.get.mockImplementation(async (path) => path === ROOT ? { conversations: [A, B], pageInfo } : opened(path.endsWith(B.id) ? B : A));
  api.del.mockResolvedValue({ deleted: true });
});
afterEach(() => { cleanup(); jest.useRealTimers(); });

it('enters a blank draft; blank submit never creates or generates', async () => {
  mount();
  await typeSend('   ');
  expect(api.post).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
  expect(view.queryByText('Saved answer')).toBeNull();
});
it('coalesces rapid New actions, persists an empty chat and sends inside it', async () => {
  const create = deferred(); api.post.mockReturnValueOnce(create.promise);
  mount();
  const button = view.getByLabelText('New Chat');
  act(() => { button.props.onPress(); button.props.onPress(); });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(sendCalls()).toHaveLength(0);
  await settle(create, 'resolve', { conversation: A });
  await typeSend('Lentils');
  expect(api.post.mock.calls.filter(([path]) => path === ROOT)).toHaveLength(1);
  expect(sendCalls()[0][1].body).toEqual({ content: 'Lentils', expectedVersion: 0, requestId: expect.any(String) });
  expect(view.getAllByText('Lentils')).toHaveLength(1);
});
it('replays the same create key after lost response and never adds a user for New', async () => {
  api.post.mockRejectedValueOnce(new ApiError('offline', { kind: 'network' }));
  mount(); fireEvent.press(view.getByLabelText('New Chat')); await flush();
  const original = api.post.mock.calls[0];
  fireEvent.press(view.getByLabelText('Retry last question')); await flush();
  expect(api.post.mock.calls[1]).toEqual(original);
  expect(view.queryByText('YOU')).toBeNull();
});
it('retains create identity and one optimistic question when first-send create fails', async () => {
  api.post.mockRejectedValueOnce(new ApiError('offline', { kind: 'network' }));
  mount(); await typeSend('Question before create');
  const createCall = api.post.mock.calls[0];
  fireEvent.press(view.getByLabelText('Retry last question')); await flush();
  expect(api.post.mock.calls[1]).toEqual(createCall);
  expect(sendCalls()).toHaveLength(1);
  expect(view.getAllByText('Question before create')).toHaveLength(1);
});
it('loads List/Open through the API with no generation and restores after remount', async () => {
  mount(); await openA();
  expect(view.getByText('Saved answer')).toBeOnTheScreen();
  expect(api.post).not.toHaveBeenCalled();
  view.unmount(); mount();
  expect(view.queryByText('Saved answer')).toBeNull();
  await openA(); expect(view.getByText('Saved answer')).toBeOnTheScreen();
  expect(api.post).not.toHaveBeenCalled();
});
it('shows history loading, safe error, retry, empty, and pagination states', async () => {
  const first = deferred(); api.get.mockReturnValueOnce(first.promise);
  mount(); fireEvent.press(view.getByLabelText('History'));
  expect(view.getByLabelText('Loading history')).toBeOnTheScreen();
  await settle(first, 'reject', new Error('raw secret'));
  expect(view.queryByText('raw secret')).toBeNull();
  api.get.mockResolvedValueOnce({ conversations: [], pageInfo });
  fireEvent.press(view.getByLabelText('Retry history')); await flush();
  expect(view.getByText('No saved conversations yet.')).toBeOnTheScreen();
  api.get.mockResolvedValueOnce({ conversations: [A], pageInfo: { hasMore: true, nextCursor: 'list-next' } });
  fireEvent.press(view.getByLabelText('Refresh history')); await flush();
  api.get.mockResolvedValueOnce({ conversations: [A, B], pageInfo });
  fireEvent.press(view.getByLabelText('Load more history')); await flush();
  expect(api.get).toHaveBeenLastCalledWith(ROOT, { query: { limit: 20, cursor: 'list-next' } });
  expect(view.getAllByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)).toHaveLength(1);
});
it('prepends and deduplicates older message pages without another provider request', async () => {
  api.get.mockImplementation(async (path, options) => path === ROOT ? { conversations: [A], pageInfo }
    : options.query.cursor ? opened(A, [userRow('Older question'), answerRow('Older answer')])
      : opened(A, [{ ...userRow('Latest question'), id: 'eeeeeeeeeeeeeeeeeeeeeeee', sequence: 4 },
        { ...answerRow('Latest answer'), id: 'ffffffffffffffffffffffff', sequence: 5 }], { hasMore: true, nextCursor: 'older' }));
  mount(); await openA();
  fireEvent.press(view.getByLabelText('Load older messages')); await flush();
  expect(view.getByText('Older answer')).toBeOnTheScreen();
  expect(view.getByText('Latest answer')).toBeOnTheScreen();
  expect(api.get).toHaveBeenLastCalledWith(`${ROOT}/${A.id}`, { query: { limit: 20, cursor: 'older' } });
  expect(api.post).not.toHaveBeenCalled();
});
it('ignores an older List response and both stale Open successes and failures', async () => {
  const oldList = deferred(); api.get.mockReturnValueOnce(oldList.promise);
  mount(); await showHistory();
  // Close/reopen issues a newer page-one request.
  fireEvent.press(view.getByLabelText('History')); await showHistory();
  await settle(oldList, 'resolve', { conversations: [], pageInfo });
  expect(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)).toBeOnTheScreen();
  const oldOpen = deferred(); api.get.mockReturnValueOnce(oldOpen.promise);
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`));
  fireEvent.press(view.getByLabelText('History')); await flush();
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(B.createdAt).toLocaleString()}`)); await flush();
  await settle(oldOpen, 'resolve', opened(A, [userRow('Late private question')]));
  expect(view.queryByText('Late private question')).toBeNull();
  expect(view.getByText('Saved answer')).toBeOnTheScreen();
});
it.each(['resolve', 'reject'])('ignores stale Open %s after Clear', async (method) => {
  const task = deferred(); mount(); await showHistory(); api.get.mockReturnValueOnce(task.promise);
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`));
  expect(view.getByLabelText('Loading conversation')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Clear conversation'));
  await settle(task, method, method === 'resolve' ? opened() : new Error('late failure'));
  expect(view.queryByText('Saved answer')).toBeNull();
  expect(view.queryByLabelText('Review saved conversation')).toBeNull();
});
it('keeps an Open failure retryable with no automatic send', async () => {
  mount(); await showHistory(); api.get.mockRejectedValueOnce(new Error('unsafe'));
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)); await flush();
  expect(view.queryByText('unsafe')).toBeNull();
  fireEvent.press(view.getByLabelText('Review saved conversation')); await flush();
  expect(view.getByText('Saved answer')).toBeOnTheScreen(); expect(api.post).not.toHaveBeenCalled();
});
it('uses a new retry key and only retryOf after reviewing a known failed turn', async () => {
  api.post.mockImplementation(async (path, { body }) => {
    if (path === ROOT) return { conversation: A };
    if (!body.retryOf) throw new ApiError('private provider detail', { code: 'ASSISTANT_UNAVAILABLE', status: 503 });
    return success(body);
  });
  api.get.mockImplementation(async (path) => path === ROOT ? { conversations: [A], pageInfo }
    : opened({ ...A, version: 2 }, [userRow('Saved question', 'failed')]));
  mount(); await typeSend('Saved question');
  const original = sendCalls()[0][1].body;
  expect(view.queryByText('private provider detail')).toBeNull();
  expect(sendCalls()).toHaveLength(1);
  fireEvent.press(view.getByLabelText('Review saved conversation')); await flush();
  fireEvent.changeText(view.getByLabelText('Question for Chef Assistant'), 'Changed draft');
  fireEvent.press(view.getByLabelText('Retry last question')); await flush();
  const retried = sendCalls()[1][1].body;
  expect(retried).toEqual({ requestId: expect.any(String), expectedVersion: 2, retryOf: userRow().id });
  expect(retried.requestId).not.toBe(original.requestId);
  expect(view.getAllByText('Saved question')).toHaveLength(1);
  expect(view.getByText('Fresh answer')).toBeOnTheScreen();
});
it.each(['ASSISTANT_TIMEOUT', 'ASSISTANT_SEND_UNCERTAIN', 'ASSISTANT_REQUEST_IN_PROGRESS',
  'ASSISTANT_REQUEST_CONFLICT', 'ASSISTANT_CONVERSATION_STALE'])('requires user review for %s without automatic generation retry', async (code) => {
  api.post.mockImplementation(async (path) => {
    if (path === ROOT) return { conversation: A };
    throw new ApiError('unsafe', { code, status: 409 });
  });
  api.get.mockImplementation(async (path) => path === ROOT ? { conversations: [A], pageInfo }
    : opened({ ...A, version: 2 }, [userRow('Saved question', 'uncertain')]));
  mount(); await typeSend('Saved question');
  expect(sendCalls()).toHaveLength(1);
  expect(view.queryByLabelText('Retry last question')).toBeNull();
  fireEvent.press(view.getByLabelText('Review saved conversation')); await flush();
  expect(sendCalls()).toHaveLength(1);
  expect(view.queryByLabelText('Retry last question')).toBeNull();
  expect(view.getByText(/uncertain outcome/)).toBeOnTheScreen();
});
it('keeps a pending restored send blocked until an explicit Open recovers it', async () => {
  api.get.mockImplementation(async (path) => path === ROOT ? { conversations: [A], pageInfo } : opened(A, [userRow('Pending question', 'pending')]));
  mount(); await openA();
  expect(view.getByLabelText('Send question').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Review saved conversation')); await flush();
  expect(api.post).not.toHaveBeenCalled();
});
it('confirms Delete, preserves active history on failure, and clears it only after success', async () => {
  mount(); await openA(); await showHistory();
  const label = `Delete chat ${new Date(A.createdAt).toLocaleString()}`;
  fireEvent.press(view.getByLabelText(label));
  fireEvent.press(view.getByLabelText('Cancel delete')); expect(api.del).not.toHaveBeenCalled();
  api.del.mockRejectedValueOnce(new Error('raw delete detail'));
  fireEvent.press(view.getByLabelText(label)); fireEvent.press(view.getByLabelText('Confirm delete conversation')); await flush();
  expect(view.getByText('Saved answer')).toBeOnTheScreen();
  expect(view.queryByText('raw delete detail')).toBeNull();
  api.get.mockResolvedValueOnce({ conversations: [B], pageInfo });
  fireEvent.press(view.getByLabelText(label)); fireEvent.press(view.getByLabelText('Confirm delete conversation')); await flush();
  expect(view.queryByText('Saved answer')).toBeNull();
  expect(api.del).toHaveBeenLastCalledWith(`${ROOT}/${A.id}`);
  expect(api.post).not.toHaveBeenCalled();
});
it('does not publish a pending reply after Delete', async () => {
  mount(); await openA();
  const send = deferred(); api.post.mockReturnValueOnce(send.promise);
  await typeSend('Later question'); const body = sendCalls()[0][1].body;
  await showHistory();
  fireEvent.press(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`));
  fireEvent.press(view.getByLabelText('Confirm delete conversation')); await flush();
  await settle(send, 'resolve', success(body));
  expect(view.queryByText('Fresh answer')).toBeNull();
  expect(view.queryByText('Later question')).toBeNull();
});
it('clears reopened A when its earlier Delete succeeds and disables Send and retry', async () => {
  mount(); await openA(); await showHistory();
  const deletion = deferred(); api.del.mockReturnValueOnce(deletion.promise);
  fireEvent.press(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`));
  fireEvent.press(view.getByLabelText('Confirm delete conversation'));
  api.get.mockResolvedValueOnce(opened(A, [userRow('Reopened failed question', 'failed')]));
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`));
  await flush();
  expect(view.getByText('Reopened failed question')).toBeOnTheScreen();
  expect(view.getByLabelText('Retry last question')).toBeOnTheScreen();
  const listsBeforeDelete = api.get.mock.calls.filter(([path]) => path === ROOT).length;
  await settle(deletion, 'resolve', { deleted: true });
  expect(view.queryByText('Reopened failed question')).toBeNull();
  expect(view.queryByLabelText('Retry last question')).toBeNull();
  expect(view.getByLabelText('Send question').props.accessibilityState.disabled).toBe(true);
  expect(api.get.mock.calls.filter(([path]) => path === ROOT)).toHaveLength(listsBeforeDelete + 1);
  await showHistory();
  expect(view.queryByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(['resolve', 'reject'])('ignores a reopened A response that arrives after Delete: %s', async (method) => {
  mount(); await openA(); await showHistory();
  const deletion = deferred(); api.del.mockReturnValueOnce(deletion.promise);
  fireEvent.press(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`));
  fireEvent.press(view.getByLabelText('Confirm delete conversation'));
  const reopen = deferred(); api.get.mockReturnValueOnce(reopen.promise);
  const staleOpen = view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`).props.onPress;
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`));
  await settle(deletion, 'resolve', { deleted: true });
  expect(view.getByLabelText('Send question').props.accessibilityState.disabled).toBe(true);
  await settle(reopen, method, method === 'resolve' ? opened(A, [userRow('Late reopened content', 'failed')]) : new Error('late open failure'));
  expect(view.queryByText('Late reopened content')).toBeNull();
  expect(view.queryByLabelText('Retry last question')).toBeNull();
  expect(view.queryByLabelText('Review saved conversation')).toBeNull();
  const reads = api.get.mock.calls.length;
  await act(async () => { await staleOpen(); });
  expect(api.get).toHaveBeenCalledTimes(reads);
  await typeSend('Must not recreate A');
  expect(api.post).not.toHaveBeenCalled();
});
it.each(['resolve', 'reject'])('ignores a send from reopened A that arrives after Delete: %s', async (method) => {
  mount(); await openA(); await showHistory();
  const deletion = deferred(); api.del.mockReturnValueOnce(deletion.promise);
  fireEvent.press(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`));
  fireEvent.press(view.getByLabelText('Confirm delete conversation'));
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)); await flush();
  const send = deferred(); api.post.mockReturnValueOnce(send.promise);
  await typeSend('Reopened send'); const body = sendCalls()[0][1].body;
  const staleSend = view.getByLabelText('Send question').props.onPress;
  await settle(deletion, 'resolve', { deleted: true });
  await settle(send, method, method === 'resolve' ? success(body) : new ApiError('late transport', { kind: 'network' }));
  expect(view.queryByText('Reopened send')).toBeNull(); expect(view.queryByText('Fresh answer')).toBeNull();
  expect(view.queryByLabelText('Retry last question')).toBeNull();
  expect(view.getByLabelText('Send question').props.accessibilityState.disabled).toBe(true);
  act(() => staleSend()); await flush();
  expect(sendCalls()).toHaveLength(1);
});
it('retains Delete across selecting B and preserves the unrelated active transcript', async () => {
  mount(); await openA(); await showHistory();
  const deletion = deferred(); api.del.mockReturnValueOnce(deletion.promise);
  fireEvent.press(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`));
  fireEvent.press(view.getByLabelText('Confirm delete conversation'));
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(B.createdAt).toLocaleString()}`)); await flush();
  await settle(deletion, 'resolve', { deleted: true });
  expect(view.getByText('Saved answer')).toBeOnTheScreen();
  expect(view.getByLabelText('Send question').props.accessibilityState.disabled).toBe(false);
  await showHistory();
  expect(view.queryByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)).toBeNull();
  expect(view.getByLabelText(`Open chat ${new Date(B.createdAt).toLocaleString()}`)).toBeOnTheScreen();
  await typeSend('Question in B');
  expect(sendCalls()[0][0]).toBe(`${ROOT}/${B.id}/messages`);
});
it('retains a reopened transcript and its retry eligibility when Delete fails', async () => {
  mount(); await openA(); await showHistory();
  const deletion = deferred(); api.del.mockReturnValueOnce(deletion.promise);
  fireEvent.press(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`));
  fireEvent.press(view.getByLabelText('Confirm delete conversation'));
  api.get.mockResolvedValueOnce(opened(A, [userRow('Failed turn retained', 'failed')]));
  fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)); await flush();
  await settle(deletion, 'reject', new Error('unsafe delete failure'));
  expect(view.getByText('Failed turn retained')).toBeOnTheScreen();
  expect(view.getByLabelText('Retry last question')).toBeOnTheScreen();
  expect(view.getByLabelText('Send question').props.accessibilityState.disabled).toBe(false);
  await showHistory();
  expect(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`).props.accessibilityState.disabled).toBe(false);
  expect(view.queryByText('unsafe delete failure')).toBeNull();
});
it.each(['create', 'list', 'open', 'delete', 'send'])('discards late %s outcomes across same-owner session replacement', async (operation) => {
  mount();
  const task = deferred();
  let outcome;
  if (operation === 'create') { api.post.mockReturnValueOnce(task.promise); fireEvent.press(view.getByLabelText('New Chat')); outcome = { conversation: A }; }
  if (operation === 'list') { api.get.mockReturnValueOnce(task.promise); fireEvent.press(view.getByLabelText('History')); outcome = { conversations: [A], pageInfo }; }
  if (operation === 'open') { await showHistory(); api.get.mockReturnValueOnce(task.promise); fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)); outcome = opened(); }
  if (operation === 'delete') { await openA(); await showHistory(); api.del.mockReturnValueOnce(task.promise); fireEvent.press(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`)); fireEvent.press(view.getByLabelText('Confirm delete conversation')); outcome = { deleted: true }; }
  if (operation === 'send') { await openA(); api.post.mockReturnValueOnce(task.promise); await typeSend('Session private question'); outcome = success(sendCalls()[0][1].body); }
  mockAuth = { ...mockAuth, sessionIdentity: { ...mockAuth.sessionIdentity, localSessionRevision: 2 } };
  view.rerender(<AssistantScreen navigation={navigation} />);
  expect(view.queryByText('Saved answer')).toBeNull();
  expect(view.queryByText('Session private question')).toBeNull();
  await settle(task, 'resolve', outcome);
  expect(view.queryByText('Saved answer')).toBeNull();
  expect(view.queryByText('Fresh answer')).toBeNull();
  expect(view.queryByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)).toBeNull();
});
it.each(['list', 'open', 'delete', 'send', 'create'])('discards a late %s failure across logout', async (operation) => {
  mount(); const task = deferred();
  if (operation === 'list') { api.get.mockReturnValueOnce(task.promise); fireEvent.press(view.getByLabelText('History')); }
  if (operation === 'open') { await showHistory(); api.get.mockReturnValueOnce(task.promise); fireEvent.press(view.getByLabelText(`Open chat ${new Date(A.createdAt).toLocaleString()}`)); }
  if (operation === 'delete') { await openA(); await showHistory(); api.del.mockReturnValueOnce(task.promise); fireEvent.press(view.getByLabelText(`Delete chat ${new Date(A.createdAt).toLocaleString()}`)); fireEvent.press(view.getByLabelText('Confirm delete conversation')); }
  if (operation === 'send') { await openA(); api.post.mockReturnValueOnce(task.promise); await typeSend('Private'); }
  if (operation === 'create') { api.post.mockReturnValueOnce(task.promise); fireEvent.press(view.getByLabelText('New Chat')); }
  mockAuth = { status: 'guest', user: null, sessionIdentity: { generation: 3 } };
  view.rerender(<AssistantScreen navigation={navigation} />);
  await settle(task, 'reject', new Error('stale secret'));
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.queryByLabelText('Retry last question')).toBeNull();
});
it('clears expired visible history exactly at the deadline without a new create or send', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-13T23:59:59.999Z'));
  const expiring = { ...A, expiresAt: '2026-11-14T00:00:00.000Z' };
  api.get.mockImplementation(async (path) => path === ROOT ? { conversations: [expiring], pageInfo } : opened(expiring));
  mount(); await openA(); expect(view.getByText('Saved answer')).toBeOnTheScreen();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(view.queryByText('Saved answer')).toBeNull();
  expect(view.queryByLabelText('Retry last question')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});
it('revalidates on foreground and clears server-expired history with no fallback', async () => {
  mount(); await openA();
  api.get.mockImplementation(async (path) => {
    if (path === ROOT) return { conversations: [], pageInfo };
    throw new ApiError('missing', { code: 'ASSISTANT_CONVERSATION_NOT_FOUND', status: 404 });
  });
  await act(async () => mockResume('active'));
  expect(view.queryByText('Saved answer')).toBeNull();
  expect(view.getByText(/no longer available/)).toBeOnTheScreen();
  expect(api.post).not.toHaveBeenCalled();
});
it('discards a pending result whose server expiry has passed, without resurrecting its content', async () => {
  const send = deferred(); mount();
  api.post.mockImplementation((path) => path === ROOT ? Promise.resolve({ conversation: A }) : send.promise);
  await typeSend('Expiring question'); const body = sendCalls()[0][1].body;
  await settle(send, 'resolve', success(body, { ...A, expiresAt: '2000-01-01T00:00:00.000Z' }));
  expect(view.queryByText('Expiring question')).toBeNull(); expect(view.queryByText('Fresh answer')).toBeNull();
  expect(sendCalls()).toHaveLength(1);
});
it.each(['ASSISTANT_CONVERSATION_NOT_FOUND'])('clears a pending question on opaque %s without recreating', async (code) => {
  api.post.mockImplementation(async (path) => {
    if (path === ROOT) return { conversation: A };
    throw new ApiError('missing', { code, status: 404 });
  });
  mount(); await typeSend('Expired send');
  expect(view.queryByText('Expired send')).toBeNull(); expect(sendCalls()).toHaveLength(1);
  expect(api.post).toHaveBeenCalledTimes(2);
});
it('invalidates a pending reply on navigation blur', async () => {
  const task = deferred(); mount();
  api.post.mockImplementation((path) => path === ROOT ? Promise.resolve({ conversation: A }) : task.promise);
  await typeSend('Leaving question'); const body = sendCalls()[0][1].body;
  act(() => navigation.addListener.mock.calls.find(([event]) => event === 'blur')[1]());
  await settle(task, 'resolve', success(body));
  expect(view.queryByText('Leaving question')).toBeNull(); expect(view.queryByText('Fresh answer')).toBeNull();
});

it('bounds initialPrompt to the existing user limit and consumes it once', async () => {
  const route = { params: { initialPrompt: 'x'.repeat(2100) } };
  mount(route); await flush();
  expect(sendCalls()[0][1].body.content).toHaveLength(2000);
  expect(navigation.setParams).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('Clear conversation'));
  view.rerender(<AssistantScreen navigation={navigation} route={route} />); await flush();
  expect(sendCalls()).toHaveLength(1);
});
it('replays a lost send response with the exact key and body, including an explicit retry', async () => {
  api.get.mockImplementation(async (path) => path === ROOT ? { conversations: [A], pageInfo }
    : opened({ ...A, version: 2 }, [userRow('Saved question', 'failed')]));
  mount(); await openA();
  api.post.mockRejectedValueOnce(new ApiError('offline', { kind: 'network' }));
  fireEvent.press(view.getByLabelText('Retry last question')); await flush();
  const first = sendCalls()[0];
  fireEvent.press(view.getByLabelText('Retry last question')); await flush();
  expect(sendCalls()[1]).toEqual(first);
  expect(first[1].body).toMatchObject({ expectedVersion: 2, retryOf: userRow().id });
  expect(view.getAllByText('Saved question')).toHaveLength(1);
});
it('lets New leave a saved send running while ignoring its late result', async () => {
  mount(); await openA(); const send = deferred(); api.post.mockReturnValueOnce(send.promise);
  await typeSend('Old saved question'); const body = sendCalls()[0][1].body;
  api.post.mockResolvedValueOnce({ conversation: B });
  fireEvent.press(view.getByLabelText('New Chat')); await flush();
  await settle(send, 'resolve', success(body));
  expect(view.queryByText('Old saved question')).toBeNull(); expect(view.queryByText('Fresh answer')).toBeNull();
  expect(api.del).not.toHaveBeenCalled();
  await typeSend('New question');
  expect(sendCalls()[1][0]).toBe(`${ROOT}/${B.id}/messages`);
});
it.each(['resolve', 'reject'])('never dispatches Send from a late create %s after Clear', async (method) => {
  const create = deferred(); api.post.mockReturnValueOnce(create.promise);
  mount(); await typeSend('Waiting for create');
  fireEvent.press(view.getByLabelText('Clear conversation'));
  await settle(create, method, method === 'resolve' ? { conversation: A } : new Error('late create error'));
  expect(view.queryByText('Waiting for create')).toBeNull(); expect(view.queryByRole('alert')).toBeNull();
  expect(sendCalls()).toHaveLength(0);
});
it('drops pending content at the known deadline and ignores a later otherwise valid reply', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-13T23:59:59.999Z'));
  const parent = { ...A, expiresAt: '2026-11-14T00:00:00.000Z' };
  const send = deferred();
  api.post.mockImplementation((path) => path === ROOT ? Promise.resolve({ conversation: parent }) : send.promise);
  mount(); await typeSend('Deadline question'); const body = sendCalls()[0][1].body;
  await act(async () => { jest.advanceTimersByTime(1); });
  await settle(send, 'resolve', success(body));
  expect(view.queryByText('Deadline question')).toBeNull(); expect(view.queryByText('Fresh answer')).toBeNull();
  expect(sendCalls()).toHaveLength(1);
});
it('checks a known expired deadline on resume even if background timers did not run', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-13T23:59:59.999Z'));
  const parent = { ...A, expiresAt: '2026-11-14T00:00:00.000Z' };
  api.get.mockImplementation(async (path) => path === ROOT ? { conversations: [parent], pageInfo } : opened(parent));
  mount(); await openA();
  jest.setSystemTime(new Date(parent.expiresAt));
  await act(async () => mockResume('active'));
  expect(view.queryByText('Saved answer')).toBeNull(); expect(api.post).not.toHaveBeenCalled();
  expect(api.get.mock.calls.filter(([path]) => path === `${ROOT}/${A.id}`)).toHaveLength(1);
});
