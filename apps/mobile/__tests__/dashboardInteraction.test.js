const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) =>
    React.forwardRef(({ children, ...props }, ref) =>
      React.createElement(name, { ...props, ref }, children)
    );
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: (styles) => styles,
      flatten: (style) => (Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {}),
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Defs: 'Defs',
  LinearGradient: 'SvgLinearGradient',
  Rect: 'Rect',
  Stop: 'Stop',
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0 }),
}));

let mockNativeNavigation;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNativeNavigation,
}));

jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333',
      inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sagePale: '#efe',
      sageDeep: '#353', error: '#900', white: '#fff', shadow: '#000', overlay: '#0005',
    },
  }),
}));

let mockShopping;
jest.mock('../src/context/ShoppingListContext', () => ({
  useShoppingList: () => mockShopping,
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-a', name: 'Ada Chef' } }),
}));
jest.mock('../src/context/SearchHistoryContext', () => ({
  useSearchHistory: () => ({
    recentSearches: [],
    recordSearch: jest.fn(),
    clearSearchHistory: jest.fn(),
  }),
}));
jest.mock('../src/context/NotificationsContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}));
jest.mock('../src/components/NotificationsDropdown', () => () => null);
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/FavoriteHeart', () => 'FavoriteHeart');
jest.mock('../src/api/recipeService', () => ({ listRecipes: jest.fn() }));
jest.mock('../src/api/recipeErrors', () => ({
  getRecipeErrorMessage: () => 'Recipe request failed.',
}));
jest.mock('../src/api/recipeOptions', () => ({
  difficultyLabel: (value) => value || '',
}));
jest.mock('../src/hooks/useRecipeScreenRefresh', () => jest.fn());

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { listRecipes } = require('../src/api/recipeService');
const TopBar = require('../src/components/TopBar').default;
const DashboardScreen = require('../src/screens/DashboardScreen').default;

const emptyRecipePage = {
  recipes: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
};

const item = (id, isChecked = false, overrides = {}) => ({ id, isChecked, ...overrides });

beforeEach(() => {
  jest.clearAllMocks();
  mockNativeNavigation = { navigate: jest.fn() };
  mockShopping = { items: [], status: 'ready', error: null };
  listRecipes.mockResolvedValue(emptyRecipePage);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

const queryShoppingBadge = (view) =>
  view.queryByTestId('shopping-count-badge', { includeHiddenElements: true });

const getShoppingBadge = (view) =>
  view.getByTestId('shopping-count-badge', { includeHiddenElements: true });

it('keeps Shopping opt-in and preserves default and Saved TopBar controls', () => {
  const saved = jest.fn();
  const view = render(<TopBar mode="brand" onSavedPress={saved} />);
  expect(view.queryByLabelText(/^Shopping list/)).toBeNull();
  fireEvent.press(view.getByLabelText('Saved recipes'));
  expect(saved).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Notifications, 0 unread')).toBeOnTheScreen();

  view.rerender(<TopBar mode="brand" onShoppingPress={jest.fn()} shoppingCount={null} />);
  expect(view.getByLabelText('Shopping list')).toBeOnTheScreen();
  expect(queryShoppingBadge(view)).toBeNull();
});

it('opts only Home into the left, divider-free brand header', () => {
  const view = render(<DashboardScreen navigation={mockNativeNavigation} />);
  const header = view.UNSAFE_getByType(TopBar);
  expect(header.props.variant).toBe('home');
  expect(header.props.transparent).toBe(true);
  expect(header.props.onSavedPress).toEqual(expect.any(Function));
  view.unmount();
});

it('gives only Discover a header role while preserving default titles and back actions', () => {
  const discoverBack = jest.fn();
  const view = render(<TopBar mode="back" title="Search" variant="discover" onBack={discoverBack} />);
  expect(view.getByText('Search').props.accessibilityRole).toBe('header');
  fireEvent.press(view.getByLabelText('Back'));
  expect(discoverBack).toHaveBeenCalledTimes(1);

  view.rerender(<TopBar mode="title" title="Community" />);
  expect(view.getByText('Community').props.accessibilityRole).toBeUndefined();

  const settingsBack = jest.fn();
  view.rerender(<TopBar mode="back" title="" onBack={settingsBack} />);
  const emptyTitle = view.UNSAFE_getAllByType('Text').find((node) => node.props.numberOfLines === 1);
  expect(emptyTitle.props.children).toBe('');
  expect(emptyTitle.props.accessibilityRole).toBeUndefined();
  fireEvent.press(view.getByLabelText('Back'));
  expect(settingsBack).toHaveBeenCalledTimes(1);
});

it.each([
  [0, null],
  [1, '1'],
  [2, '2'],
  [99, '99'],
  [100, '99+'],
  [127, '99+'],
])('renders count %i with the frozen visual cap %s', (count, visual) => {
  const view = render(
    <TopBar mode="brand" onShoppingPress={jest.fn()} shoppingCount={count} />
  );
  const badge = queryShoppingBadge(view);
  if (visual === null) {
    expect(badge).toBeNull();
  } else {
    expect(badge).toHaveTextContent(visual);
  }
});

it('announces the exact uncapped count, uses singular wording, and hides badge semantics', () => {
  const view = render(<TopBar mode="brand" onShoppingPress={jest.fn()} shoppingCount={1} />);
  expect(view.getByLabelText('Shopping list, 1 unchecked item')).toBeOnTheScreen();

  view.rerender(<TopBar mode="brand" onShoppingPress={jest.fn()} shoppingCount={127} />);
  expect(view.getByLabelText('Shopping list, 127 unchecked items')).toBeOnTheScreen();
  const badge = getShoppingBadge(view);
  expect(badge.props.accessible).toBe(false);
  expect(badge.props.accessibilityElementsHidden).toBe(true);
  expect(badge.props.importantForAccessibility).toBe('no-hide-descendants');
});

it('Dashboard derives one per unchecked entry, excludes checked entries and ignores quantities', async () => {
  mockShopping = {
    status: 'ready',
    error: null,
    items: [
      item('unchecked-a', false, { quantity: 500, amount: '9000', textualQuantity: 'many' }),
      item('checked', true, { quantity: 999 }),
      item('unchecked-b', false, { quantity: 0.25 }),
    ],
  };
  const view = render(<DashboardScreen navigation={mockNativeNavigation} />);
  expect(view.getByLabelText('Shopping list, 2 unchecked items')).toBeOnTheScreen();
  expect(getShoppingBadge(view)).toHaveTextContent('2');
  await waitFor(() => expect(listRecipes).toHaveBeenCalledWith({ sort: 'newest', limit: 8 }));
});

it('one Shopping activation navigates exactly once to the existing List route', () => {
  const view = render(<DashboardScreen navigation={mockNativeNavigation} />);
  fireEvent.press(view.getByLabelText('Shopping list'));
  expect(mockNativeNavigation.navigate).toHaveBeenCalledTimes(1);
  expect(mockNativeNavigation.navigate).toHaveBeenCalledWith('List');
});

it.each(['idle', 'loading', 'error'])(
  '%s keeps the shortcut usable while the unknown badge is hidden',
  (status) => {
    mockShopping = { status, items: [], error: status === 'error' ? 'Unavailable' : null };
    const view = render(<DashboardScreen navigation={mockNativeNavigation} />);
    expect(queryShoppingBadge(view)).toBeNull();
    fireEvent.press(view.getByLabelText('Shopping list'));
    expect(mockNativeNavigation.navigate).toHaveBeenCalledWith('List');
  }
);

it('continues representing retained ready data during a background-refresh error', () => {
  mockShopping = {
    status: 'ready',
    error: 'Refresh failed.',
    items: [item('a'), item('b'), item('checked', true)],
  };
  const view = render(<DashboardScreen navigation={mockNativeNavigation} />);
  expect(view.getByLabelText('Shopping list, 2 unchecked items')).toBeOnTheScreen();
});

it('tracks provider replacements without a Dashboard Shopping request or recipe refetch', async () => {
  mockShopping = { status: 'ready', error: null, items: [item('a')] };
  const view = render(<DashboardScreen navigation={mockNativeNavigation} />);
  const initialQueries = [
    { sort: 'newest', limit: 8 },
    { sort: 'topRated', page: 1, limit: 6 },
  ];
  await waitFor(() => expect(listRecipes.mock.calls.map(([query]) => query)).toEqual(initialQueries));
  expect(getShoppingBadge(view)).toHaveTextContent('1');

  mockShopping = { status: 'ready', error: null, items: [item('a', true), item('b'), item('c')] };
  view.rerender(<DashboardScreen navigation={mockNativeNavigation} />);
  expect(getShoppingBadge(view)).toHaveTextContent('2');

  mockShopping = { status: 'ready', error: null, items: [] };
  view.rerender(<DashboardScreen navigation={mockNativeNavigation} />);
  expect(queryShoppingBadge(view)).toBeNull();
  expect(listRecipes.mock.calls.map(([query]) => query)).toEqual(initialQueries);
});

it('drops the previous account count during the provider ownership transition', () => {
  mockShopping = { status: 'ready', error: null, items: [item('a'), item('b')] };
  const view = render(<DashboardScreen navigation={mockNativeNavigation} />);
  expect(getShoppingBadge(view)).toHaveTextContent('2');

  mockShopping = { status: 'loading', error: null, items: [] };
  view.rerender(<DashboardScreen navigation={mockNativeNavigation} />);
  expect(queryShoppingBadge(view)).toBeNull();
  expect(view.getByLabelText('Shopping list')).toBeOnTheScreen();
});

it('preserves Dashboard recipe loading and debounced authenticated search', async () => {
  jest.useFakeTimers();
  const view = render(<DashboardScreen navigation={mockNativeNavigation} />);
  await act(async () => Promise.resolve());
  expect(listRecipes).toHaveBeenCalledWith({ sort: 'newest', limit: 8 });

  fireEvent.changeText(view.getByLabelText('Search recipes'), 'adobo');
  await act(async () => {
    jest.advanceTimersByTime(300);
    await Promise.resolve();
  });
  expect(listRecipes).toHaveBeenCalledWith({ search: 'adobo', page: 1, limit: 20 });
  jest.useRealTimers();
});
