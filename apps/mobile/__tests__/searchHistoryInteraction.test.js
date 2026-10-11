const React = require('react');
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) =>
    React.forwardRef(({ children, ...props }, ref) =>
      React.createElement(name, { ...props, ref }, children)
    );
  const FlatList = React.forwardRef(
    ({ data = [], renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent, ...props }, ref) => {
      const rows = data.length
        ? data.map((item, index) => (
            <React.Fragment key={item.id || index}>{renderItem({ item, index })}</React.Fragment>
          ))
        : ListEmptyComponent;
      return React.createElement(
        'FlatList',
        { ...props, data, renderItem, ref },
        ListHeaderComponent,
        rows,
        ListFooterComponent
      );
    }
  );
  return {
    ActivityIndicator: host('ActivityIndicator'),
    BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    FlatList,
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    ScrollView: host('ScrollView'),
    StyleSheet: { create: (styles) => styles, flatten: (style) => style || {} },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});
const { View } = require('react-native');

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333',
      inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sagePale: '#efe',
      sageDeep: '#353', error: '#900', white: '#fff', shadow: '#000',
    },
  }),
}));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/FavoriteHeart', () => 'FavoriteHeart');
jest.mock('../src/components/DiscoverFiltersSheet', () => 'DiscoverFiltersSheet');
jest.mock('../src/api/recipeService', () => ({ listRecipes: jest.fn() }));
jest.mock('../src/api/recipeErrors', () => ({
  getRecipeErrorMessage: jest.fn(() => 'Recipe request failed.'),
}));
jest.mock('../src/utils/recipeFreshnessState', () => ({
  recipeCollectionPhaseAfterFailure: jest.fn((recipes) => (recipes.length ? 'ready' : 'error')),
  shouldBlockRecipeFailure: jest.fn((error, recipes) => Boolean(error && !recipes.length)),
}));
jest.mock('../src/hooks/useRecipeScreenRefresh', () => jest.fn());
const mockShoppingListState = Object.freeze({ items: Object.freeze([]), status: 'ready' });
jest.mock('../src/context/ShoppingListContext', () => ({
  useShoppingList: () => mockShoppingListState,
}));

let mockCurrentUser = { id: 'user-a' };
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: mockCurrentUser }),
}));
jest.mock('../src/utils/storage', () => ({
  loadJSON: jest.fn(),
  saveJSON: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const fs = require('fs');
const path = require('path');
const { act, fireEvent, render, waitFor, within } = require('@testing-library/react-native');
const { listRecipes } = require('../src/api/recipeService');
const { getRecipeErrorMessage } = require('../src/api/recipeErrors');
const { loadJSON, removeItem, saveJSON } = require('../src/utils/storage');
const {
  normalizeSearchHistory,
  searchHistoryKey,
  SearchHistoryProvider,
  useSearchHistory,
} = require('../src/context/SearchHistoryContext');
const DashboardScreen = require('../src/screens/DashboardScreen').default;
const DiscoverScreen = require('../src/screens/DiscoverScreen').default;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Probe({ name }) {
  const { recentSearches, recordSearch, clearSearchHistory } = useSearchHistory();
  return (
    <View
      testID={name}
      history={recentSearches.join('|')}
      onRecord={recordSearch}
      onClear={clearSearchHistory}
    />
  );
}

function Harness() {
  return (
    <SearchHistoryProvider>
      <Probe name="dashboard" />
      <Probe name="search" />
    </SearchHistoryProvider>
  );
}

function RealConsumerHarness() {
  const dashboardNavigation = { navigate: jest.fn() };
  const searchNavigation = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
  return (
    <SearchHistoryProvider>
      <View testID="real-dashboard">
        <DashboardScreen navigation={dashboardNavigation} />
      </View>
      <View testID="real-search">
        <DiscoverScreen navigation={searchNavigation} route={{ params: {} }} />
      </View>
    </SearchHistoryProvider>
  );
}

beforeEach(() => {
  mockCurrentUser = { id: 'user-a' };
  loadJSON.mockReset().mockResolvedValue([]);
  saveJSON.mockReset().mockResolvedValue(undefined);
  removeItem.mockReset().mockResolvedValue(undefined);
  listRecipes.mockReset().mockResolvedValue({
    recipes: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
  });
});

it('normalizes hostile stored values, dedupes case-insensitively, and caps at eight', () => {
  expect(normalizeSearchHistory(null)).toEqual([]);
  expect(normalizeSearchHistory({ 0: 'unsafe' })).toEqual([]);
  expect(normalizeSearchHistory([
    '  One  ', 4, '', 'one', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  ])).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']);
});

it('uses only an authenticated user id in the scoped key and never reads the legacy key', async () => {
  const view = render(<Harness />);
  await waitFor(() => expect(loadJSON).toHaveBeenCalledWith(searchHistoryKey('user-a'), []));
  expect(loadJSON).not.toHaveBeenCalledWith('wecooked:recentSearches', expect.anything());
  view.unmount();
});

it('hydrates sanitized data and synchronizes Dashboard and Search immediately', async () => {
  loadJSON.mockResolvedValueOnce(['  Soup ', 'soup', null, 'Rice']);
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('dashboard').props.history).toBe('Soup|Rice'));
  expect(view.getByTestId('search').props.history).toBe('Soup|Rice');

  act(() => view.getByTestId('search').props.onRecord('  Adobo  '));
  expect(view.getByTestId('dashboard').props.history).toBe('Adobo|Soup|Rice');
  expect(view.getByTestId('search').props.history).toBe('Adobo|Soup|Rice');
  expect(saveJSON).toHaveBeenLastCalledWith(
    searchHistoryKey('user-a'),
    ['Adobo', 'Soup', 'Rice']
  );

  act(() => view.getByTestId('dashboard').props.onClear());
  expect(view.getByTestId('dashboard').props.history).toBe('');
  expect(view.getByTestId('search').props.history).toBe('');
  expect(removeItem).toHaveBeenCalledWith(searchHistoryKey('user-a'));
});

it('synchronizes the mounted real Dashboard and Search consumers through one provider', async () => {
  const latestRecipes = deferred();
  const trendingRecipes = deferred();
  const searchRecipes = deferred();
  const unexpectedQueries = [];
  listRecipes.mockImplementation((query) => {
    if (query.sort === 'newest') return latestRecipes.promise;
    if (query.sort === 'topRated') return trendingRecipes.promise;
    if (query.sort === 'titleAsc') return searchRecipes.promise;
    unexpectedQueries.push(query);
    return Promise.reject(new Error(`Unexpected Recipe request: ${JSON.stringify(query)}`));
  });
  const view = render(<RealConsumerHarness />);
  await waitFor(() => expect(loadJSON).toHaveBeenCalledWith(searchHistoryKey('user-a'), []));
  await waitFor(() => {
    const queries = listRecipes.mock.calls.map(([query]) => query);
    expect(queries).toHaveLength(3);
    expect(queries).toEqual(expect.arrayContaining([
      { sort: 'newest', limit: 8 },
      { sort: 'topRated', page: 1, limit: 6 },
      { sort: 'titleAsc', page: 1, limit: 20 },
    ]));
    expect(queries.filter(({ sort }) => sort === 'topRated')).toEqual([
      { sort: 'topRated', page: 1, limit: 6 },
    ]);
  });
  await act(async () => {
    latestRecipes.resolve({
      recipes: [{ id: '507f1f77bcf86cd799439021', title: 'Dashboard Pick' }],
      pagination: { page: 1, limit: 8, total: 1, totalPages: 1 },
    });
    trendingRecipes.resolve({
      recipes: [
        {
          id: '507f1f77bcf86cd799439022', title: 'Trending Zeta',
          ratingSummary: { averageRating: 4.8, ratingCount: 6 },
        },
        {
          id: '507f1f77bcf86cd799439024', title: 'Trending Alpha',
          ratingSummary: { averageRating: 4.7, ratingCount: 9 },
        },
      ],
      pagination: { page: 1, limit: 6, total: 2, totalPages: 1 },
    });
    searchRecipes.resolve({
      recipes: [
        { id: '507f1f77bcf86cd799439023', title: 'Search Zeta' },
        { id: '507f1f77bcf86cd799439025', title: 'Search Alpha' },
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
    await Promise.all([latestRecipes.promise, trendingRecipes.promise, searchRecipes.promise]);
  });
  const dashboard = within(view.getByTestId('real-dashboard'));
  const search = within(view.getByTestId('real-search'));
  expect(dashboard.getByText('Dashboard Pick')).toBeOnTheScreen();
  const trendingOrder = dashboard.getAllByText(/^Trending (Zeta|Alpha)$/).map((row) => row.props.children);
  const searchOrder = search.getAllByText(/^Search (Zeta|Alpha)$/).map((row) => row.props.children);
  const assertTrendingOrder = (order) => expect(order).toEqual(['Trending Zeta', 'Trending Alpha']);
  const assertSearchOrder = (order) => expect(order).toEqual(['Search Zeta', 'Search Alpha']);
  assertTrendingOrder(trendingOrder);
  assertSearchOrder(searchOrder);
  expect(() => assertTrendingOrder([...trendingOrder].reverse())).toThrow();
  expect(() => assertSearchOrder([...searchOrder].reverse())).toThrow();
  expect(unexpectedQueries).toEqual([]);
  expect(listRecipes).toHaveBeenCalledTimes(3);
  expect(getRecipeErrorMessage).not.toHaveBeenCalled();

  fireEvent.changeText(search.getByLabelText('Search recipes'), '  Adobo  ');
  fireEvent(search.getByLabelText('Search recipes'), 'submitEditing');
  expect(dashboard.getByText('Adobo')).toBeOnTheScreen();

  fireEvent.press(search.getByLabelText('Clear search'));
  expect(search.getByText('Adobo')).toBeOnTheScreen();

  fireEvent.changeText(dashboard.getByLabelText('Search recipes'), '  Rice  ');
  fireEvent(dashboard.getByLabelText('Search recipes'), 'submitEditing');
  expect(search.getByText('Rice')).toBeOnTheScreen();
  expect(search.getByText('Adobo')).toBeOnTheScreen();

  fireEvent.press(dashboard.getByLabelText('Clear recent searches'));
  expect(search.queryByText('Rice')).toBeNull();
  expect(search.queryByText('Adobo')).toBeNull();
  expect(removeItem).toHaveBeenLastCalledWith(searchHistoryKey('user-a'));
  expect(unexpectedQueries).toEqual([]);
  expect(getRecipeErrorMessage).not.toHaveBeenCalled();
});

it('keeps both real consumers free of a screen-local history owner', () => {
  for (const relative of ['../src/screens/DashboardScreen.js', '../src/screens/DiscoverScreen.js']) {
    const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
    expect(source).toMatch(/useSearchHistory\(\)/);
    expect(source).not.toMatch(/loadJSON|saveJSON|removeItem|AsyncStorage|RECENT_SEARCH_KEY/);
    expect(source).not.toMatch(/useState\(\[\]\).*recent|setRecent|rememberSearch/);
  }
});

it('bumps newest-first, rejects blanks, and evicts the ninth item', async () => {
  loadJSON.mockResolvedValueOnce(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']);
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('search').props.history).toContain('Eight'));
  act(() => view.getByTestId('search').props.onRecord('  two '));
  expect(view.getByTestId('search').props.history).toBe('two|One|Three|Four|Five|Six|Seven|Eight');
  act(() => view.getByTestId('search').props.onRecord('Nine'));
  expect(view.getByTestId('search').props.history).toBe('Nine|two|One|Three|Four|Five|Six|Seven');
  act(() => view.getByTestId('search').props.onRecord('   '));
  expect(view.getByTestId('search').props.history).toBe('Nine|two|One|Three|Four|Five|Six|Seven');
});

it('clears visible A history synchronously on account switch and ignores late A hydration', async () => {
  const hydrationA = deferred();
  loadJSON.mockImplementation((key) => {
    if (key === searchHistoryKey('user-a')) return hydrationA.promise;
    if (key === searchHistoryKey('user-b')) return Promise.resolve(['B only']);
    return Promise.resolve([]);
  });
  const view = render(<Harness />);
  await waitFor(() => expect(loadJSON).toHaveBeenCalledWith(searchHistoryKey('user-a'), []));
  mockCurrentUser = { id: 'user-b' };
  view.rerender(<Harness />);
  expect(view.getByTestId('dashboard').props.history).toBe('');
  await waitFor(() => expect(view.getByTestId('dashboard').props.history).toBe('B only'));
  await act(async () => { hydrationA.resolve(['A secret']); await hydrationA.promise; });
  expect(view.getByTestId('dashboard').props.history).toBe('B only');
  expect(saveJSON).not.toHaveBeenCalledWith(searchHistoryKey('user-b'), expect.arrayContaining(['A secret']));
});

it('keeps B authoritative when an A persistence write settles after the switch', async () => {
  const writeA = deferred();
  saveJSON.mockImplementation((key) =>
    key === searchHistoryKey('user-a') ? writeA.promise : Promise.resolve()
  );
  const view = render(<Harness />);
  await waitFor(() => expect(loadJSON).toHaveBeenCalledWith(searchHistoryKey('user-a'), []));
  act(() => view.getByTestId('search').props.onRecord('A term'));
  mockCurrentUser = { id: 'user-b' };
  loadJSON.mockResolvedValueOnce([]);
  view.rerender(<Harness />);
  await waitFor(() => expect(loadJSON).toHaveBeenCalledWith(searchHistoryKey('user-b'), []));
  act(() => view.getByTestId('dashboard').props.onRecord('B term'));
  expect(view.getByTestId('search').props.history).toBe('B term');
  await act(async () => { writeA.resolve(); await writeA.promise; });
  expect(view.getByTestId('search').props.history).toBe('B term');
  expect(saveJSON).toHaveBeenCalledWith(searchHistoryKey('user-b'), ['B term']);
});

it('shows empty in-memory history when storage hydration degrades to its wrapper fallback', async () => {
  loadJSON.mockResolvedValueOnce([]);
  const view = render(<Harness />);
  await waitFor(() => expect(loadJSON).toHaveBeenCalled());
  expect(view.getByTestId('dashboard').props.history).toBe('');
  act(() => view.getByTestId('dashboard').props.onRecord('Still works'));
  expect(view.getByTestId('search').props.history).toBe('Still works');
});
