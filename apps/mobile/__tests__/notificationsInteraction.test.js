const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  class Value {
    constructor(value) { this.value = value; }
    interpolate() { return this.value; }
  }
  return {
    Platform: { OS: 'ios', select: (spec) => spec.ios ?? spec.native ?? spec.default },
    ActivityIndicator: host('ActivityIndicator'),
    Modal: host('Modal'),
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    ScrollView: host('ScrollView'),
    Switch: host('Switch'),
    Text: host('Text'),
    View: host('View'),
    Animated: { Value, View: host('AnimatedView'), timing: () => ({ start() {} }) },
    StyleSheet: {
      create: (styles) => styles,
      absoluteFillObject: {},
      flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333',
      inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sageDeep: '#353', stone: '#a70', error: '#900', overlay: '#0005',
    },
    shadow: { card: {} },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 10 }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));

let mockNotifications;
let mockNavigation;
jest.mock('../src/context/NotificationsContext', () => ({ useNotifications: () => mockNotifications }));
jest.mock('../src/context/NativePushContext', () => ({
  useNativePush: () => ({ status: 'registered', error: null, retry: jest.fn(), openSettings: jest.fn() }),
}));

const { act, cleanup, fireEvent, render } = require('@testing-library/react-native');
const Dropdown = require('../src/components/NotificationsDropdown').default;
const { EMPTY_COPY, actionDestination } = require('../src/components/NotificationsDropdown');
const NotificationsScreen = require('../src/screens/NotificationsScreen').default;
const TopBar = require('../src/components/TopBar').default;

const N1 = '507f1f77bcf86cd799439011';
const N2 = '507f1f77bcf86cd799439012';
const TARGET = '507f1f77bcf86cd799439021';
const ISO = '2026-10-04T01:02:03.000Z';

function row(id = N1, overrides = {}) {
  return {
    id, type: 'savedRecipe', content: { title: `Title ${id}`, body: 'Body' },
    action: { kind: 'none' }, createdAt: ISO, readAt: null, ...overrides,
  };
}

function context(overrides = {}) {
  return {
    ownerId: '507f1f77bcf86cd799439001', generation: 1,
    notifications: [], unreadCount: 0, status: 'ready', error: null, hasMore: false,
    refreshing: false, loadingMore: false, inboxPending: false,
    retry: jest.fn(), reload: jest.fn(), loadMore: jest.fn(),
    markRead: jest.fn(() => Promise.resolve(true)), markAllRead: jest.fn(() => Promise.resolve(true)),
    archiveAll: jest.fn(() => Promise.resolve(true)),
    preferences: { push: true, email: true, suggestions: true, digest: false, reminders: true },
    preferencePending: {}, preferenceError: null, setPreference: jest.fn(),
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockNavigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockNotifications = context();
});
afterEach(() => { cleanup(); jest.useRealTimers(); });

it('renders the exact five canonical controls in order and writes pessimistically through context', () => {
  const view = render(<NotificationsScreen navigation={mockNavigation} />);
  expect(view.getByText('Choose what WeCooked can notify you about.')).toBeOnTheScreen();
  const labels = ['Push Notifications', 'Email Alerts', 'Recipe Suggestions', 'Weekly Digest', 'Cooking Reminders'];
  const expectedValues = [true, true, true, false, true];
  labels.forEach((label, index) => {
    const toggle = view.getByLabelText(label);
    expect(toggle.props.value).toBe(expectedValues[index]);
  });
  fireEvent(view.getByLabelText('Weekly Digest'), 'valueChange', true);
  expect(mockNotifications.setPreference).toHaveBeenCalledWith('digest', true);
  expect(view.getByLabelText('Weekly Digest').props.value).toBe(false);
});

it('preference pending and errors are accessible without disabling unrelated controls', () => {
  mockNotifications = context({ preferencePending: { email: true }, preferenceError: 'Notifications are unavailable.' });
  const view = render(<NotificationsScreen navigation={mockNavigation} />);
  expect(view.getByLabelText('Email Alerts').props.disabled).toBe(true);
  expect(view.getByLabelText('Push Notifications').props.disabled).toBe(false);
  expect(view.getByRole('alert')).toHaveTextContent('Notifications are unavailable.');
});

it('bell label/dot use authoritative unread count and opening shows the real dropdown', () => {
  mockNotifications = context({ unreadCount: 3, notifications: [row()], status: 'ready' });
  const view = render(<TopBar mode="brand" />);
  fireEvent.press(view.getByLabelText('Notifications, 3 unread'));
  expect(view.getByRole('header', { name: 'Notifications' })).toBeOnTheScreen();
  expect(view.getByLabelText('Unread')).toBeOnTheScreen();
});

it('dropdown distinguishes loading, unavailable/retry, empty, and pagination states', () => {
  mockNotifications = context({ status: 'loading' });
  const view = render(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  expect(view.getByLabelText('Loading notifications')).toBeOnTheScreen();

  mockNotifications = context({ status: 'error', error: 'Notifications are unavailable.' });
  view.rerender(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  fireEvent.press(view.getByLabelText('Retry notifications'));
  expect(mockNotifications.retry).toHaveBeenCalledTimes(1);

  mockNotifications = context({ notifications: [], status: 'ready' });
  view.rerender(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  expect(view.getByText(EMPTY_COPY)).toBeOnTheScreen();

  mockNotifications = context({ notifications: [row()], hasMore: true });
  view.rerender(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  const list = view.getByLabelText('Notifications list');
  expect(list.props.refreshControl.props.refreshing).toBe(false);
  list.props.refreshControl.props.onRefresh();
  expect(mockNotifications.reload).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('Load more notifications'));
  expect(mockNotifications.loadMore).toHaveBeenCalledTimes(1);
});

it('opening, refreshing, changing callbacks and repeated renders never bulk-read', () => {
  const bulkCalls = [];
  mockNotifications = context({ notifications: [row(N2), row(N1)], markAllRead: jest.fn((id) => { bulkCalls.push(id); }) });
  const onClose = jest.fn();
  const view = render(<Dropdown visible onClose={onClose} topOffset={20} navigation={mockNavigation} />);
  for (let index = 0; index < 4; index += 1) {
    mockNotifications = context({
      notifications: [row(N2), row(N1)],
      markAllRead: jest.fn((id) => { bulkCalls.push(id); }),
    });
    view.rerender(<Dropdown visible onClose={onClose} topOffset={20} navigation={mockNavigation} />);
  }
  act(() => jest.runOnlyPendingTimers());
  expect(bulkCalls).toEqual([]);
  expect(view.getAllByLabelText('Unread')).toHaveLength(2);
  view.rerender(<Dropdown visible={false} onClose={onClose} topOffset={20} navigation={mockNavigation} />);
  act(() => jest.runOnlyPendingTimers());
  expect(bulkCalls).toEqual([]);
});

it('Clear archives only through the newest currently observed row', async () => {
  mockNotifications = context({ notifications: [row(N2), row(N1)] });
  const view = render(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  await act(async () => fireEvent.press(view.getByLabelText('Clear notifications')));
  expect(mockNotifications.archiveAll).toHaveBeenCalledWith(N2);
});

it('Settings closes then navigates; supported actions use only the fixed local map', () => {
  const onClose = jest.fn();
  mockNotifications = context({ notifications: [row(N1, { action: { kind: 'recipe', recipeId: TARGET } })] });
  const view = render(<Dropdown visible onClose={onClose} topOffset={20} navigation={mockNavigation} />);
  fireEvent.press(view.getByLabelText('Notification settings'));
  expect(onClose).toHaveBeenCalled();
  expect(mockNavigation.navigate).toHaveBeenCalledWith('Notifications');

  mockNavigation.navigate.mockClear();
  fireEvent.press(view.getByLabelText(`Title ${N1}. Body`));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('RecipeDetail', { recipeSource: 'api', recipeId: TARGET });
  expect(actionDestination({ kind: 'arbitrary', route: 'Admin', url: 'https://evil.test' })).toBeNull();
});

it('marks an unread notification without a route using its exact server ID', () => {
  mockNotifications = context({ notifications: [row(N1)] });
  const view = render(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  fireEvent.press(view.getByLabelText(`Mark notification as read: Title ${N1}`));
  expect(mockNotifications.markRead).toHaveBeenCalledWith(N1);
  expect(mockNavigation.navigate).not.toHaveBeenCalled();

  mockNotifications = context({ notifications: [row(N1, { readAt: ISO })] });
  view.rerender(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  expect(view.queryByLabelText(`Mark notification as read: Title ${N1}`)).toBeNull();
  expect(view.getByLabelText('Read')).toBeOnTheScreen();
});

it('a failed exact-ID read stays unread with visible error and never triggers bulk read', async () => {
  const request = deferred();
  const markRead = jest.fn(() => request.promise);
  const bulkCalls = [];
  mockNotifications = context({ notifications: [row(N1)], markRead, markAllRead: jest.fn((id) => { bulkCalls.push(id); }) });
  const view = render(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  fireEvent.press(view.getByLabelText(`Mark notification as read: Title ${N1}`));
  expect(markRead).toHaveBeenCalledWith(N1);
  mockNotifications = context({
    notifications: [row(N1)], pendingReads: { [N1]: true }, markRead,
    markAllRead: jest.fn((id) => { bulkCalls.push(id); }),
  });
  view.rerender(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  expect(view.getByLabelText(`Mark notification as read: Title ${N1}`).props.accessibilityState.busy).toBe(true);
  expect(view.getByLabelText(`Mark notification as read: Title ${N1}`).props.disabled).toBe(true);
  await act(async () => request.resolve(false));
  mockNotifications = context({
    notifications: [row(N1)], error: 'Notifications are unavailable. Please retry.', markRead,
    markAllRead: jest.fn((id) => { bulkCalls.push(id); }),
  });
  view.rerender(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  act(() => jest.runOnlyPendingTimers());
  expect(view.getByLabelText('Unread')).toBeOnTheScreen();
  expect(view.getByText('Notifications are unavailable. Please retry.')).toBeOnTheScreen();
  expect(bulkCalls).toEqual([]);
});

it('a successful exact-ID read is shown only after server state refreshes', async () => {
  const request = deferred();
  const markRead = jest.fn(() => request.promise);
  const bulkCalls = [];
  mockNotifications = context({ notifications: [row(N1)], markRead, markAllRead: jest.fn((id) => { bulkCalls.push(id); }) });
  const view = render(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  fireEvent.press(view.getByLabelText(`Mark notification as read: Title ${N1}`));
  expect(view.getByLabelText('Unread')).toBeOnTheScreen();
  await act(async () => request.resolve(true));
  expect(view.getByLabelText('Unread')).toBeOnTheScreen();
  for (let index = 0; index < 3; index += 1) {
    mockNotifications = context({
      notifications: [row(N1, { readAt: ISO })], markRead: jest.fn(),
      markAllRead: jest.fn((id) => { bulkCalls.push(id); }),
    });
    view.rerender(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  }
  act(() => jest.runOnlyPendingTimers());
  expect(view.getByLabelText('Read')).toBeOnTheScreen();
  expect(view.queryByLabelText(`Mark notification as read: Title ${N1}`)).toBeNull();
  expect(markRead).toHaveBeenCalledTimes(1);
  expect(bulkCalls).toEqual([]);
});

it('an old account read completion cannot change the displayed account', async () => {
  const oldRequest = deferred();
  const oldRead = jest.fn(() => oldRequest.promise);
  mockNotifications = context({ notifications: [row(N1)], markRead: oldRead });
  const view = render(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  fireEvent.press(view.getByLabelText(`Mark notification as read: Title ${N1}`));
  mockNotifications = context({ ownerId: '507f1f77bcf86cd799439002', generation: 2, notifications: [row(N2)] });
  view.rerender(<Dropdown visible onClose={jest.fn()} topOffset={20} navigation={mockNavigation} />);
  await act(async () => oldRequest.resolve(true));
  expect(view.getByLabelText(`Mark notification as read: Title ${N2}`)).toBeOnTheScreen();
  expect(view.queryByText(`Title ${N1}`)).toBeNull();
  expect(view.getByLabelText('Unread')).toBeOnTheScreen();
  expect(mockNotifications.markAllRead).not.toHaveBeenCalled();
});
