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
  return { ApiError, api: { post: jest.fn() } };
});

jest.mock('../src/screens/assistantState', () => {
  const actual = jest.requireActual('../src/screens/assistantState');
  return {
    ...actual,
    completeAssistantRequest: jest.fn(actual.completeAssistantRequest),
    failAssistantRequest: jest.fn(actual.failAssistantRequest),
  };
});

const {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} = require('@testing-library/react-native');
const { ApiError, api } = require('../src/api/client');
const {
  completeAssistantRequest,
  failAssistantRequest,
} = require('../src/screens/assistantState');
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

function renderAssistant() {
  currentView = render(<AssistantScreen navigation={{ goBack: jest.fn() }} />);
  return currentView;
}

function submitTypedQuestion(question) {
  fireEvent.changeText(currentView.getByLabelText('Question for Chef Assistant'), question);
  fireEvent.press(currentView.getByLabelText('Send question'));
}

async function settle(deferredRequest, method, value) {
  await act(async () => {
    deferredRequest[method](method === 'resolve' ? { reply: value } : value);
    await deferredRequest.promise.catch(() => undefined);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

it('mounts a successful send with one user bubble, one API call, and one reply', async () => {
  const request = deferred();
  api.post.mockReturnValue(request.promise);
  renderAssistant();

  submitTypedQuestion('  What can I make with lentils?  ');

  expect(currentView.getAllByText('What can I make with lentils?')).toHaveLength(1);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/assistant/chat', {
    body: { messages: [{ role: 'user', content: 'What can I make with lentils?' }] },
  });

  await settle(request, 'resolve', 'Make lentil soup.');

  expect(currentView.getAllByText('What can I make with lentils?')).toHaveLength(1);
  expect(currentView.getAllByText('Make lentil soup.')).toHaveLength(1);
});

it('keeps a rapid double send single-flight with one request and one user bubble', () => {
  api.post.mockReturnValue(new Promise(() => {}));
  renderAssistant();
  fireEvent.changeText(currentView.getByLabelText('Question for Chef Assistant'), 'One question');
  const send = currentView.getByLabelText('Send question');

  act(() => {
    send.props.onPress();
    send.props.onPress();
  });

  expect(api.post).toHaveBeenCalledTimes(1);
  expect(currentView.getAllByText('One question')).toHaveLength(1);
});

it('retries the exact bounded transcript without duplicating the user', async () => {
  const first = deferred();
  const retry = deferred();
  api.post
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(retry.promise);
  renderAssistant();

  submitTypedQuestion('Use chickpeas');
  const originalRequest = api.post.mock.calls[0];
  await settle(
    first,
    'reject',
    new ApiError('offline detail', { code: 'NETWORK_ERROR', kind: 'network' })
  );

  fireEvent.press(currentView.getByLabelText('Retry last question'));
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post.mock.calls[1]).toEqual(originalRequest);
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
  api.post.mockReturnValue(request.promise);
  renderAssistant();

  submitTypedQuestion('Old question');
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
  api.post.mockReturnValue(request.promise);
  const view = renderAssistant();

  submitTypedQuestion('Unmounted question');
  view.unmount();
  completeAssistantRequest.mockClear();
  failAssistantRequest.mockClear();

  await settle(request, method, value);

  expect(completeAssistantRequest).not.toHaveBeenCalled();
  expect(failAssistantRequest).not.toHaveBeenCalled();
});

it('keeps request A from mutating conversation B after reset', async () => {
  const requestA = deferred();
  const requestB = deferred();
  api.post
    .mockReturnValueOnce(requestA.promise)
    .mockReturnValueOnce(requestB.promise);
  renderAssistant();

  submitTypedQuestion('Question A');
  fireEvent.press(currentView.getByLabelText('Clear conversation'));
  submitTypedQuestion('Question B');

  await settle(requestA, 'resolve', 'Answer A');
  expect(currentView.queryByText('Question A')).toBeNull();
  expect(currentView.queryByText('Answer A')).toBeNull();
  expect(currentView.getAllByText('Question B')).toHaveLength(1);

  await settle(requestB, 'resolve', 'Answer B');
  expect(currentView.getAllByText('Question B')).toHaveLength(1);
  expect(currentView.getAllByText('Answer B')).toHaveLength(1);
});

it('routes a quick prompt through the normal service and single-flight path', async () => {
  const request = deferred();
  api.post.mockReturnValue(request.promise);
  renderAssistant();
  const prompt = 'What can I cook fast?';

  fireEvent.press(currentView.getByLabelText(`Ask: ${prompt}`));
  fireEvent.press(currentView.getByLabelText(`Ask: ${prompt}`));

  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/assistant/chat', {
    body: { messages: [{ role: 'user', content: prompt }] },
  });
  expect(currentView.getAllByText(prompt)).toHaveLength(2);

  await settle(request, 'resolve', 'Make an omelette.');
  expect(currentView.getAllByText('Make an omelette.')).toHaveLength(1);
});

it('renders validation errors without a deterministic Retry action', async () => {
  api.post.mockRejectedValue(
    new ApiError('unsafe detail', { code: 'VALIDATION_ERROR', status: 400 })
  );
  renderAssistant();

  submitTypedQuestion('Invalid transcript');

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
    /\bSWAPS\b/,
    /mock(?:Data|Response|Reply|Fallback)|fallback(?:Reply|Response)|providerLogic/i,
  ];

  it('scans exactly all four expected production files', () => {
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
  });
});
