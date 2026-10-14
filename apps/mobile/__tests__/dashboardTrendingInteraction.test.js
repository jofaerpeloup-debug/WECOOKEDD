const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  return {
    ActivityIndicator: host('ActivityIndicator'), Pressable: host('Pressable'), ScrollView: host('ScrollView'),
    StyleSheet: { create: (styles) => styles, absoluteFillObject: {}, flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {} }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
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
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({ colors: { cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333', inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sagePale: '#efe', sageDeep: '#353' } }),
}));
let mockUser = { id: 'user-a', name: 'A Chef' };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../src/context/ShoppingListContext', () => ({
  useShoppingList: () => ({ items: [], status: 'ready' }),
}));
jest.mock('../src/context/SearchHistoryContext', () => ({ useSearchHistory: () => ({ recentSearches: [], recordSearch: jest.fn(), clearSearchHistory: jest.fn() }) }));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/FavoriteHeart', () => 'FavoriteHeart');
jest.mock('../src/api/recipeService', () => ({ listRecipes: jest.fn() }));
jest.mock('../src/api/recipeErrors', () => ({ getRecipeErrorMessage: () => 'Recipe request failed.' }));
jest.mock('../src/utils/recipeFreshnessState', () => ({ shouldBlockRecipeFailure: (error, rows) => !!error && rows.length === 0 }));
let refreshCallback;
jest.mock('../src/hooks/useRecipeScreenRefresh', () => jest.fn((callback) => { refreshCallback = callback; }));

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { listRecipes } = require('../src/api/recipeService');
const realUseState = React.useState;
let detectPostUnmountWrites = false;
let postUnmountWrites = 0;
jest.spyOn(React, 'useState').mockImplementation((initialValue) => {
  const [value, setValue] = realUseState(initialValue);
  return [value, (...args) => {
    if (detectPostUnmountWrites) postUnmountWrites += 1;
    return setValue(...args);
  }];
});
const DashboardScreen = require('../src/screens/DashboardScreen').default;

const pagination = (limit, total) => ({ page: 1, limit, total, totalPages: total ? 1 : 0 });
const recipe = (id, title, averageRating, ratingCount) => ({
  id, title, imageUrl: null, difficulty: 'easy', prepTimeMinutes: 10,
  ...(averageRating === undefined ? {} : { ratingSummary: { averageRating, ratingCount } }),
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function defaultImplementation(params) {
  if (params.sort === 'topRated') return Promise.resolve({ recipes: [], pagination: pagination(6, 0) });
  if (params.sort === 'newest') return Promise.resolve({ recipes: [recipe('latest', 'Latest')], pagination: pagination(8, 1) });
  return Promise.resolve({ recipes: [], pagination: pagination(20, 0) });
}

beforeEach(() => {
  mockUser = { id: 'user-a', name: 'A Chef' };
  detectPostUnmountWrites = false;
  postUnmountWrites = 0;
  listRecipes.mockReset().mockImplementation(defaultImplementation);
  refreshCallback = undefined;
});
afterEach(cleanup);

it('requests exactly the six-item Top Rated prefix and preserves server order and summaries', async () => {
  const serverOrder = [
    recipe('b', 'Server First', 4.1, 2),
    recipe('a', 'Server Second', 5, 99),
  ];
  listRecipes.mockImplementation((params) => (
    params.sort === 'topRated'
      ? Promise.resolve({ recipes: serverOrder, pagination: pagination(6, 2) })
      : defaultImplementation(params)
  ));
  const navigation = { navigate: jest.fn() };
  const view = render(<DashboardScreen navigation={navigation} />);
  await view.findByText('Server First');
  expect(listRecipes).toHaveBeenCalledWith({ sort: 'topRated', page: 1, limit: 6 });
  const openLabels = view.UNSAFE_getAllByType('Pressable')
    .map((node) => node.props.accessibilityLabel)
    .filter((label) => label?.startsWith('Open Server'));
  expect(openLabels).toEqual(['Open Server First', 'Open Server Second']);
  expect(view.getByText('★ 4.1 · 2')).toBeOnTheScreen();
  expect(view.getByText('★ 5.0 · 99')).toBeOnTheScreen();

  fireEvent.press(view.getByLabelText('Open Trending Meals'));
  expect(navigation.navigate).toHaveBeenCalledWith('Trending');
  fireEvent.press(view.getByLabelText('Open Server First'));
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeDetail', {
    recipeSource: 'api', recipeId: 'b', initialRecipe: serverOrder[0],
  });
});

it('rejects a stale Trending completion after an account switch', async () => {
  const first = deferred();
  const second = deferred();
  let rankedCalls = 0;
  listRecipes.mockImplementation((params) => {
    if (params.sort !== 'topRated') return defaultImplementation(params);
    rankedCalls += 1;
    return rankedCalls === 1 ? first.promise : second.promise;
  });
  const navigation = { navigate: jest.fn() };
  const view = render(<DashboardScreen navigation={navigation} />);
  await waitFor(() => expect(rankedCalls).toBe(1));

  mockUser = { id: 'user-b', name: 'B Chef' };
  view.rerender(<DashboardScreen navigation={navigation} />);
  await waitFor(() => expect(rankedCalls).toBe(2));
  await act(async () => second.resolve({ recipes: [recipe('new', 'New Account', 5, 1)], pagination: pagination(6, 1) }));
  await view.findByText('New Account');
  await act(async () => first.resolve({ recipes: [recipe('old', 'Old Account', 5, 9)], pagination: pagination(6, 1) }));
  expect(view.queryByText('Old Account')).toBeNull();
  expect(view.getByText('New Account')).toBeOnTheScreen();
});

it.each(['resolve', 'reject'])(
  'does not write Dashboard state when a Trending request settles after unmount by %s',
  async (method) => {
    const pending = deferred();
    listRecipes.mockImplementation((params) => (
      params.sort === 'topRated' ? pending.promise : defaultImplementation(params)
    ));
    const view = render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(listRecipes).toHaveBeenCalledWith({ sort: 'topRated', page: 1, limit: 6 }));
    view.unmount();
    detectPostUnmountWrites = true;
    await act(async () => {
      pending[method](method === 'resolve'
        ? { recipes: [recipe('late', 'Late', 5, 1)], pagination: pagination(6, 1) }
        : new Error('late'));
      await pending.promise.catch(() => undefined);
    });
    expect(postUnmountWrites).toBe(0);
  }
);

it('refreshes Trending through the existing guarded screen refresh path', async () => {
  render(<DashboardScreen navigation={{ navigate: jest.fn() }} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledWith({ sort: 'topRated', page: 1, limit: 6 }));
  act(() => refreshCallback());
  await waitFor(() => expect(listRecipes.mock.calls.filter(([params]) => params.sort === 'topRated')).toHaveLength(2));
});
