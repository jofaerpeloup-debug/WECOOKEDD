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
    AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
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

let mockUuid = 0;
const mockSend = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-' + String(++mockUuid).padStart(12, '0') }));
const conversation = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', version: 0 };

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let currentView;

function renderAssistant(route, navigation = { goBack: jest.fn(), setParams: jest.fn() }) {
  currentView = render(<AssistantScreen navigation={navigation} route={route} />);
  return currentView;
}

it('consumes one bounded route prompt exactly once through the normal send path', async () => {
  const request = deferred();
  mockSend.mockReturnValue(request.promise);
  const route = { params: { initialPrompt: '  Help me use dragon fruit  ' } };
  const navigation = { goBack: jest.fn(), setParams: jest.fn() };
  const view = renderAssistant(route, navigation);

  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  expect(navigation.setParams).toHaveBeenCalledWith({ initialPrompt: undefined });
  expect(mockSend).toHaveBeenCalledWith('/assistant/conversations/aaaaaaaaaaaaaaaaaaaaaaaa/messages', {
    body: { requestId: expect.any(String), expectedVersion: 0, content: 'Help me use dragon fruit' },
  });
  expect(view.getAllByText('Help me use dragon fruit')).toHaveLength(1);

  view.rerender(<AssistantScreen navigation={navigation} route={route} />);
  fireEvent.press(view.getByLabelText('Clear conversation'));
  view.rerender(<AssistantScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));

  await settle(request, 'resolve', 'Late old answer');
  expect(view.queryByText('Late old answer')).toBeNull();
});

async function submitTypedQuestion(question) {
  fireEvent.changeText(currentView.getByLabelText('Question for Chef Assistant'), question);
  fireEvent.press(currentView.getByLabelText('Send question'));
  await act(async () => {});
}

async function settle(deferredRequest, method, value) {
  await act(async () => {
    deferredRequest[method](method === 'resolve' ? { reply: value } : value);
    await deferredRequest.promise.catch(() => undefined);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  api.post.mockImplementation((path, { body }) => {
    if (path === '/assistant/conversations') return Promise.resolve({ conversation });
    return Promise.resolve(mockSend(path, { body })).then((data) => ({
      conversation: { ...conversation, version: 2 }, requestId: body.requestId,
      userMessage: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'user', content: body.content, sequence: 0, createdAt: conversation.createdAt, status: 'complete' },
      assistantMessage: { id: 'cccccccccccccccccccccccc', role: 'assistant', content: data.reply, sequence: 1, createdAt: conversation.createdAt },
    }));
  });
  api.get.mockResolvedValue({ conversations: [], pageInfo: { hasMore: false, nextCursor: null } });
  mockAuth = { status: 'authenticated', user: { id: 'user-a' } };
});

afterEach(() => {
  cleanup();
});

it('mounts a successful send with one user bubble, one API call, and one reply', async () => {
  const request = deferred();
  mockSend.mockReturnValue(request.promise);
  renderAssistant();

  await submitTypedQuestion('  What can I make with lentils?  ');

  expect(currentView.getAllByText('What can I make with lentils?')).toHaveLength(1);
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  expect(mockSend).toHaveBeenCalledWith('/assistant/conversations/aaaaaaaaaaaaaaaaaaaaaaaa/messages', {
    body: { requestId: expect.any(String), expectedVersion: 0, content: 'What can I make with lentils?' },
  });

  await settle(request, 'resolve', 'Make lentil soup.');

  expect(currentView.getAllByText('What can I make with lentils?')).toHaveLength(1);
  expect(currentView.getAllByText('Make lentil soup.')).toHaveLength(1);
});

it('keeps a rapid double send single-flight with one request and one user bubble', async () => {
  mockSend.mockReturnValue(new Promise(() => {}));
  renderAssistant();
  fireEvent.changeText(currentView.getByLabelText('Question for Chef Assistant'), 'One question');
  const send = currentView.getByLabelText('Send question');

  act(() => {
    send.props.onPress();
    send.props.onPress();
  });

  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  expect(currentView.getAllByText('One question')).toHaveLength(1);
});

it('replays the exact persistent request without duplicating the user', async () => {
  const first = deferred();
  const retry = deferred();
  mockSend
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(retry.promise);
  renderAssistant();

  await submitTypedQuestion('Use chickpeas');
  const originalRequest = mockSend.mock.calls[0];
  await settle(
    first,
    'reject',
    new ApiError('offline detail', { code: 'NETWORK_ERROR', kind: 'network' })
  );

  fireEvent.press(currentView.getByLabelText('Retry last question'));
  await act(async () => {});
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(mockSend.mock.calls[1]).toEqual(originalRequest);
  expect(currentView.getAllByText('Use chickpeas')).toHaveLength(1);

  await settle(retry, 'resolve', 'Try hummus.');
  expect(currentView.getAllByText('Use chickpeas')).toHaveLength(1);
  expect(currentView.getAllByText('Try hummus.')).toHaveLength(1);
});

it.each([
  ['resolve', 'Late answer'],
  ['reject', new Error('late failure')],
])('ignores an old request %s after Clear', async (method, value) => {
  const request = deferred();
  mockSend.mockReturnValue(request.promise);
  renderAssistant();

  await submitTypedQuestion('Old question');
  fireEvent.press(currentView.getByLabelText('Clear conversation'));
  expect(currentView.queryByText('Old question')).toBeNull();

  await settle(request, method, value);

  expect(currentView.queryByText('Old question')).toBeNull();
  expect(currentView.queryByText('Late answer')).toBeNull();
  expect(
    currentView.queryByText('Chef Assistant could not complete that request. Please try again.')
  ).toBeNull();
});

it.each([
  ['resolve', 'Late answer'],
  ['reject', new Error('late failure')],
])('does not commit an old request %s after unmount', async (method, value) => {
  const request = deferred();
  mockSend.mockReturnValue(request.promise);
  const view = renderAssistant();

  await submitTypedQuestion('Unmounted question');
  view.unmount();
  api.get.mockClear();

  await settle(request, method, value);

  expect(api.get).not.toHaveBeenCalled();
});

it('keeps request A from mutating conversation B after reset', async () => {
  const requestA = deferred();
  const requestB = deferred();
  mockSend
    .mockReturnValueOnce(requestA.promise)
    .mockReturnValueOnce(requestB.promise);
  renderAssistant();

  await submitTypedQuestion('Question A');
  fireEvent.press(currentView.getByLabelText('Clear conversation'));
  await submitTypedQuestion('Question B');

  await settle(requestA, 'resolve', 'Answer A');
  expect(currentView.queryByText('Question A')).toBeNull();
  expect(currentView.queryByText('Answer A')).toBeNull();
  expect(currentView.getAllByText('Question B')).toHaveLength(1);

  await settle(requestB, 'resolve', 'Answer B');
  expect(currentView.getAllByText('Question B')).toHaveLength(1);
  expect(currentView.getAllByText('Answer B')).toHaveLength(1);
});

it('consumes navigation prompt state across a genuine unmount and remount', async () => {
  mockSend.mockReturnValue(new Promise(() => {}));
  let route = { params: { initialPrompt: 'Use celeriac' } };
  const navigation = {
    goBack: jest.fn(),
    setParams: jest.fn((params) => {
      route = { ...route, params: { ...route.params, ...params } };
    }),
  };
  const first = renderAssistant(route, navigation);
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  expect(navigation.setParams).toHaveBeenCalledWith({ initialPrompt: undefined });

  first.unmount();
  renderAssistant(route, navigation);

  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  expect(currentView.queryByText('Use celeriac')).toBeNull();
});

it.each([
  ['success', 'resolve', 'Late account A answer'],
  ['failure', 'reject', new Error('late account A failure')],
])('clears account A and ignores its late request %s after a direct switch to B', async (
  _label,
  method,
  value
) => {
  const accountARequest = deferred();
  const accountBRequest = deferred();
  mockSend
    .mockReturnValueOnce(accountARequest.promise)
    .mockReturnValueOnce(accountBRequest.promise);
  const navigation = { goBack: jest.fn(), setParams: jest.fn() };
  const view = renderAssistant(undefined, navigation);
  await submitTypedQuestion('Account A question');

  mockAuth = { status: 'authenticated', user: { id: 'user-b' } };
  view.rerender(<AssistantScreen navigation={navigation} />);
  await waitFor(() => expect(view.queryByText('Account A question')).toBeNull());
  await submitTypedQuestion('Account B question');

  await settle(accountARequest, method, value);
  expect(view.queryByText('Late account A answer')).toBeNull();
  expect(view.queryByText(/could not complete that request/)).toBeNull();
  expect(view.getAllByText('Account B question')).toHaveLength(1);
  expect(view.getByText('Thinking...')).toBeOnTheScreen();

  await settle(accountBRequest, 'resolve', 'Account B answer');
  expect(view.getAllByText('Account B answer')).toHaveLength(1);
});

it('routes a quick prompt through the normal service and single-flight path', async () => {
  const request = deferred();
  mockSend.mockReturnValue(request.promise);
  renderAssistant();
  const prompt = 'What can I cook fast?';

  const promptButton = currentView.getByLabelText(`Ask: ${prompt}`);
  act(() => {
    promptButton.props.onPress();
    promptButton.props.onPress();
  });

  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  expect(mockSend).toHaveBeenCalledWith('/assistant/conversations/aaaaaaaaaaaaaaaaaaaaaaaa/messages', {
    body: { requestId: expect.any(String), expectedVersion: 0, content: prompt },
  });
  expect(currentView.getAllByText(prompt)).toHaveLength(1);

  await settle(request, 'resolve', 'Make an omelette.');
  expect(currentView.getAllByText('Make an omelette.')).toHaveLength(1);
});

it('renders validation errors without a deterministic Retry action', async () => {
  mockSend.mockRejectedValue(
    new ApiError('unsafe detail', { code: 'VALIDATION_ERROR', status: 400 })
  );
  renderAssistant();

  await submitTypedQuestion('Invalid transcript');

  await waitFor(() => {
    expect(
      currentView.getByText(
        'Chef Assistant could not process that request. Please revise it and try again.'
      )
    ).toBeOnTheScreen();
  });
  expect(currentView.queryByLabelText('Retry last question')).toBeNull();
});

describe('persistent Assistant provider-boundary audit', () => {
  const srcRoot = path.join(__dirname, '..', 'src');
  const expectedFiles = [
    'screens/AssistantScreen.js',
    'screens/assistantState.js',
    'screens/assistantHistoryState.js',
    'api/assistantHistoryService.js',
    'components/AssistantHistoryPanel.js',
    'api/assistantService.js',
    'api/assistantErrors.js',
  ];
  const scannedFiles = expectedFiles.map((file) => ({
    file,
    source: fs.readFileSync(path.join(srcRoot, file), 'utf8'),
  }));
  const forbidden = [
    /EXPO_PUBLIC_OPENAI_/i,
    /api\.openai\.com/i,
    /\b(?:OpenAI|Anthropic|Claude|Gemini|Cohere)\b/i,
    /(?:from\s*|require\s*\(\s*)['"](?:openai|@anthropic-ai\/sdk|@google\/generative-ai|cohere-ai)/i,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\b(?:OPENAI_|ANTHROPIC_|GEMINI_|PROVIDER_)?API_?KEY\b/i,
    /\b(?:OPENAI_|ANTHROPIC_|GEMINI_|PROVIDER_)?MODEL(?:_NAME|_ID)?\b/i,
    /\bAiContext\b/,
    /\bAiSettings\b/,
    /AsyncStorage/,
    /SecureStore|expo-secure-store|localStorage|sessionStorage|expo-file-system/,
    /\bSWAPS\b/,
    /mock(?:Data|Response|Reply|Fallback)|fallback(?:Reply|Response)|providerLogic/i,
  ];

  it('scans every Assistant production file', () => {
    expect(scannedFiles.map(({ file }) => file)).toEqual(expectedFiles);
  });

  it.each(forbidden)('rejects direct provider or persistence behavior matching %s', (pattern) => {
    for (const { file, source } of scannedFiles) {
      expect({ file, match: source.match(pattern)?.[0] }).toEqual({
        file,
        match: undefined,
      });
    }
  });

  it('retains only the shared authenticated WeCooked API call', () => {
    const service = scannedFiles.find(({ file }) => file === 'api/assistantService.js').source;
    expect(service).toMatch(/import \{ api \} from ['"]\.\/client['"]/);
    expect(service).toMatch(/api\.post\(['"]\/assistant\/chat['"]/);
    const persistent = scannedFiles.find(({ file }) => file === 'api/assistantHistoryService.js').source;
    expect(persistent).toContain("const ROOT = '/assistant/conversations'");
    expect(persistent).not.toContain('/assistant/chat');
  });
});
