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

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333',
      inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sagePale: '#efe',
      sageDeep: '#353', error: '#900',
    },
  }),
}));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/FavoriteHeart', () => 'FavoriteHeart');
jest.mock('../src/api/client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/api/ingredientErrors', () => ({
  getIngredientErrorMessage: jest.fn(() => 'Ingredient search failed.'),
}));
jest.mock('../src/api/recipeService', () => ({ listRecipes: jest.fn() }));
jest.mock('../src/api/recipeErrors', () => ({
  getRecipeErrorMessage: jest.fn(() => 'Recipe request failed.'),
}));
jest.mock('../src/utils/recipeFreshnessState', () => ({
  recipeCollectionPhaseAfterFailure: jest.fn((recipes) => (recipes.length ? 'ready' : 'error')),
}));

let mockUser = { id: 'user-a' };
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const mockHistoryState = {
  recentSearches: [],
  recordSearch: jest.fn(),
  clearSearchHistory: jest.fn(),
};
jest.mock('../src/context/SearchHistoryContext', () => ({
  useSearchHistory: () => mockHistoryState,
}));

let refreshCallback;
jest.mock('../src/hooks/useRecipeScreenRefresh', () =>
  jest.fn((callback) => {
    refreshCallback = callback;
  })
);

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { api } = require('../src/api/client');
const { listRecipes } = require('../src/api/recipeService');
const { CATEGORY_OPTIONS, REGION_OPTIONS } = require('../src/utils/discoverFilters');
const DiscoverFiltersSheet = require('../src/components/DiscoverFiltersSheet').default;
const DiscoverScreen = require('../src/screens/DiscoverScreen').default;
const ingredientApiGet = api.get;

const page = (recipes, current = 1, totalPages = 1) => ({
  recipes,
  pagination: { page: current, limit: 20, total: recipes.length, totalPages },
});
const recipe = (id, title = id) => ({
  id, title, imageUrl: null, difficulty: 'easy', prepTimeMinutes: 10,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const settle = async (request, method, value) => {
  await act(async () => {
    request[method](value);
    await request.promise.catch(() => undefined);
  });
};
const advance = async (milliseconds = 300) => {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
};

function renderSearch(routeParams = {}) {
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
  const view = render(<DiscoverScreen navigation={navigation} route={{ params: routeParams }} />);
  return { view, navigation };
}

function renderSheet(overrides = {}) {
  const props = {
    visible: true,
    appliedFilters: { sort: 'titleAsc' },
    onCancel: jest.fn(),
    onApply: jest.fn(),
    ...overrides,
  };
  const view = render(<DiscoverFiltersSheet {...props} />);
  return { props, view };
}

function flattenedStyle(node) {
  const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
  return Object.assign({}, ...styles.filter(Boolean));
}

async function resolveInitial(view, recipes = [recipe('catalog', 'Catalog')], totalPages = 1) {
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  await act(async () => { await Promise.resolve(); });
  if (recipes.length) await view.findByText(recipes[0].title);
  return page(recipes, 1, totalPages);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockUser = { id: 'user-a' };
  listRecipes.mockReset();
  ingredientApiGet.mockReset();
  ingredientApiGet.mockResolvedValue({
    ingredients: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
  });
  mockHistoryState.recentSearches = [];
  mockHistoryState.recordSearch.mockReset();
  mockHistoryState.clearSearchHistory.mockReset();
  refreshCallback = undefined;
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('renders the Search shell and eight visible sort controls in the one list header', async () => {
  listRecipes.mockResolvedValueOnce(page([]));
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  expect(view.UNSAFE_getByType('TopBar').props.title).toBe('Search');
  expect(view.UNSAFE_getByType('TopBar').props.variant).toBe('discover');
  expect(view.UNSAFE_getByType('TopBar').props.transparent).toBe(true);
  expect(view.getByLabelText('Search recipes').props.placeholder).toBe('Search recipes...');
  for (const label of [
    'Sort: Title: A-Z', 'Sort: Title: Z-A', 'Sort: Newest added',
    'Sort: Oldest added', 'Sort: Prep time: low to high', 'Sort: Prep time: high to low',
    'Sort: Relevance', 'Sort: Top Rated',
  ]) expect(view.getByLabelText(label)).toBeOnTheScreen();
});

it('starts with a collapsed accessible filter panel and available refresh/pagination', async () => {
  listRecipes
    .mockResolvedValueOnce(page([recipe('a', 'A')], 1, 2))
    .mockResolvedValueOnce(page([recipe('b', 'B')], 2, 2))
    .mockResolvedValueOnce(page([recipe('a', 'A')], 1, 1));
  const { view } = renderSearch();
  await view.findByText('A');
  expect(view.getByLabelText('Filters, none active').props.accessibilityState.expanded).toBe(false);
  expect(view.queryByText('Region')).toBeNull();
  act(() => view.UNSAFE_getByType('FlatList').props.onEndReached());
  await view.findByText('B');
  expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'titleAsc', page: 2, limit: 20 });
  await act(async () => { refreshCallback(); await Promise.resolve(); });
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'titleAsc', page: 1, limit: 20 }));
  fireEvent.press(view.getByLabelText('Filters, none active'));
  expect(view.getByLabelText('Filters, none active').props.accessibilityState.expanded).toBe(true);
  for (const label of ['Region', 'Category', 'Dietary', 'Total time', 'Maximum prep minutes', 'Ingredient']) {
    expect(view.getByText(label)).toBeOnTheScreen();
  }
  expect(view.queryByText(/Vibe|Craving/)).toBeNull();
});

it('keeps all 18 regions in a bounded chooser and stages selection until Apply', () => {
  const { props, view } = renderSheet();
  const trigger = view.getByLabelText('Region: Any');
  expect(trigger.props.accessibilityState.expanded).toBe(false);
  expect(view.queryByLabelText(`Region: ${REGION_OPTIONS[1].label}`)).toBeNull();
  fireEvent.press(trigger);
  expect(view.UNSAFE_getByType('ScrollView').props.nestedScrollEnabled).toBe(true);
  for (const option of REGION_OPTIONS) {
    expect(view.getAllByLabelText(`Region: ${option.label}`).length).toBeGreaterThan(0);
  }
  expect(REGION_OPTIONS).toHaveLength(19);
  fireEvent.press(view.getByLabelText(`Region: ${REGION_OPTIONS[18].label}`));
  expect(view.getByLabelText(`Region: ${REGION_OPTIONS[18].label}`).props.accessibilityState.expanded).toBe(false);
  expect(props.onApply).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  expect(props.onApply).toHaveBeenCalledWith(expect.objectContaining({ region: REGION_OPTIONS[18].value }));
});

it('renders only real card metadata and preserves the separate favorite and API route', async () => {
  const item = { ...recipe('photo', 'Long recipe title'), imageUrl: 'https://example.com/recipe.jpg', cookTimeMinutes: 20 };
  listRecipes.mockResolvedValueOnce(page([item]));
  const { view, navigation } = renderSearch();
  await view.findByText(item.title);
  expect(view.UNSAFE_getByType('RecipeImage').props.source).toBe(item.imageUrl);
  expect(view.getByText(/30 min/)).toBeOnTheScreen();
  expect(view.UNSAFE_getByType('FavoriteHeart').props.recipe).toBe(item);
  fireEvent.press(view.getByLabelText(`Open ${item.title}`));
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeDetail', {
    recipeSource: 'api', recipeId: item.id, initialRecipe: item,
  });
});

it('prevents blank-query Relevance without substituting a different server sort', async () => {
  listRecipes.mockResolvedValueOnce(page([]));
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByLabelText('Sort: Relevance'));
  expect(view.getByText('Enter a search term to sort by Relevance.')).toBeOnTheScreen();
  expect(listRecipes).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Sort: Title: A-Z').props.accessibilityState.selected).toBe(true);
});

it('sends current search, all filters, and Relevance in one authoritative request', async () => {
  listRecipes.mockResolvedValue(page([]));
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'adobo');
  await advance();
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({
    search: 'adobo', sort: 'titleAsc', page: 1, limit: 20,
  }));
  fireEvent.press(view.getByLabelText('Sort: Relevance'));
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({
    search: 'adobo', sort: 'relevance', page: 1, limit: 20,
  }));
});

it('requests Top Rated and renders the server page without local reordering', async () => {
  listRecipes
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([recipe('low', 'Server First'), recipe('high', 'Server Second')]));
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByLabelText('Sort: Top Rated'));
  await view.findByText('Server First');
  expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'topRated', page: 1, limit: 20 });
  const labels = view.UNSAFE_getAllByType('Pressable')
    .map((node) => node.props.accessibilityLabel)
    .filter((label) => label?.startsWith('Open Server'));
  expect(labels).toEqual(['Open Server First', 'Open Server Second']);
});

it('keeps the initial blank-query owner when input changes only to whitespace', async () => {
  const initial = deferred();
  listRecipes.mockReturnValueOnce(initial.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));

  fireEvent.changeText(view.getByLabelText('Search recipes'), '   ');
  expect(view.getByLabelText('Loading recipes')).toBeOnTheScreen();
  await advance();
  expect(listRecipes).toHaveBeenCalledTimes(1);

  await settle(initial, 'resolve', page([recipe('catalog', 'Current Catalog')]));
  expect(view.getByText('Current Catalog')).toBeOnTheScreen();
});

it('clears an unsettled query back to the catalog before its debounce fires', async () => {
  const catalog = deferred();
  listRecipes.mockResolvedValueOnce(page([recipe('old', 'Old Catalog')])).mockReturnValueOnce(catalog.promise);
  const { view } = renderSearch();
  await view.findByText('Old Catalog');

  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  expect(view.queryByText('Old Catalog')).toBeNull();
  fireEvent.changeText(view.getByLabelText('Search recipes'), '');
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2));
  expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'titleAsc', page: 1, limit: 20 });
  await advance();
  expect(listRecipes).toHaveBeenCalledTimes(2);

  await settle(catalog, 'resolve', page([recipe('catalog', 'Current Catalog')]));
  expect(view.getByText('Current Catalog')).toBeOnTheScreen();
});

it('treats a whitespace variant of settled A as a semantic no-op', async () => {
  listRecipes
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([recipe('a', 'Authoritative A')]));
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'pasta');
  await advance();
  await view.findByText('Authoritative A');

  fireEvent.changeText(view.getByLabelText('Search recipes'), '  pasta  ');
  expect(view.getByText('Authoritative A')).toBeOnTheScreen();
  await advance();
  expect(listRecipes).toHaveBeenCalledTimes(2);
  expect(view.getByText('Authoritative A')).toBeOnTheScreen();
});

it('restarts already-debounced A when unsettled B is reverted before debounce', async () => {
  const replacementA = deferred();
  listRecipes
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([recipe('a', 'First A')]))
    .mockReturnValueOnce(replacementA.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'A');
  await advance();
  await view.findByText('First A');

  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  expect(view.queryByText('First A')).toBeNull();
  fireEvent.changeText(view.getByLabelText('Search recipes'), ' A ');
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(3));
  expect(listRecipes).toHaveBeenLastCalledWith({ search: 'A', sort: 'titleAsc', page: 1, limit: 20 });
  await advance();
  expect(listRecipes).toHaveBeenCalledTimes(3);

  await settle(replacementA, 'resolve', page([recipe('a2', 'Replacement A')]));
  expect(view.getByText('Replacement A')).toBeOnTheScreen();
});

it('preserves unapplied narrowing edits when sort changes while filters are expanded', async () => {
  listRecipes.mockResolvedValue(page([]));
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));

  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText('Difficulty: Hard'));
  expect(view.getByLabelText('Difficulty: Hard').props.accessibilityState).toEqual({ selected: true });
  fireEvent.press(view.getByLabelText('Sort: Newest added'));
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'newest', page: 1, limit: 20 }));
  expect(view.getByLabelText('Difficulty: Hard').props.accessibilityState).toEqual({ selected: true });

  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({ difficulty: 'hard', sort: 'newest', page: 1, limit: 20 }));
});

it('invalidates A immediately when B is typed before B debounce fires', async () => {
  const initial = deferred();
  const a = deferred();
  const b = deferred();
  listRecipes.mockReturnValueOnce(initial.promise).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await settle(initial, 'resolve', page([recipe('catalog', 'Catalog')]));

  fireEvent.changeText(view.getByLabelText('Search recipes'), 'A');
  await advance();
  expect(listRecipes).toHaveBeenLastCalledWith({ search: 'A', sort: 'titleAsc', page: 1, limit: 20 });
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  expect(view.queryByText('Catalog')).toBeNull();
  expect(view.getByText('Loading recipes…')).toBeOnTheScreen();
  await settle(a, 'resolve', page([recipe('a', 'Stale A')]));
  expect(view.queryByText('Stale A')).toBeNull();
  expect(view.getByText('Loading recipes…')).toBeOnTheScreen();
  expect(listRecipes).toHaveBeenCalledTimes(2);
  await advance();
  await settle(b, 'resolve', page([recipe('b', 'Current B')]));
  expect(view.getByText('Current B')).toBeOnTheScreen();
});

it('does not let a stale first-page failure or finalizer clear newer loading', async () => {
  const a = deferred();
  const b = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'A');
  await advance();
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  await advance();

  await settle(a, 'reject', new Error('stale A failure'));
  expect(view.getByLabelText('Loading recipes')).toBeOnTheScreen();
  expect(view.queryByText('Recipe request failed.')).toBeNull();
  await settle(b, 'resolve', page([recipe('b', 'Current B')]));
  expect(view.getByText('Current B')).toBeOnTheScreen();
});

it('keeps newer refresh-owned loading active when a stale first-page finalizer settles', async () => {
  const firstPageA = deferred();
  const refreshB = deferred();
  listRecipes.mockReturnValueOnce(firstPageA.promise).mockReturnValueOnce(refreshB.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));

  await act(async () => { refreshCallback(); await Promise.resolve(); });
  expect(listRecipes).toHaveBeenCalledTimes(2);
  expect(view.UNSAFE_getByType('FlatList').props.refreshControl.props.refreshing).toBe(true);

  // A's success guard returns before any success mutation. Only its finally
  // ownership check can keep B's visible refresh state active here.
  await settle(firstPageA, 'resolve', page([recipe('stale-a', 'Stale A')]));
  expect(view.getByLabelText('Loading recipes')).toBeOnTheScreen();
  expect(view.UNSAFE_getByType('FlatList').props.refreshControl.props.refreshing).toBe(true);
  expect(view.queryByText('Stale A')).toBeNull();

  await settle(refreshB, 'resolve', page([recipe('current-b', 'Current B')]));
  expect(view.getByText('Current B')).toBeOnTheScreen();
  expect(view.UNSAFE_getByType('FlatList').props.refreshControl.props.refreshing).toBe(false);
});

it.each(['resolve', 'reject'])('keeps visible B authoritative after stale A %s', async (method) => {
  const a = deferred();
  const b = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'A');
  await advance();
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  await advance();
  await settle(b, 'resolve', page([recipe('b', 'Current B')], 1, 2));
  expect(view.getByText('Current B')).toBeOnTheScreen();
  expect(view.getByText('1+ recipes found')).toBeOnTheScreen();
  await settle(a, method, method === 'resolve' ? page([recipe('a', 'Stale A')]) : new Error('old'));
  expect(view.getByText('Current B')).toBeOnTheScreen();
  expect(view.getByText('1+ recipes found')).toBeOnTheScreen();
  expect(view.queryByText('Stale A')).toBeNull();
  expect(view.queryByText('Recipe request failed.')).toBeNull();
});

it('keeps the visible empty-query catalog after an old query settles', async () => {
  const a = deferred();
  const catalog = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(a.promise).mockReturnValueOnce(catalog.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'A');
  await advance();
  fireEvent.press(view.getByLabelText('Clear search'));
  await settle(catalog, 'resolve', page([recipe('catalog', 'Current Catalog')]));
  await settle(a, 'resolve', page([recipe('a', 'Stale A')]));
  expect(view.getByText('Current Catalog')).toBeOnTheScreen();
  expect(view.queryByText('Stale A')).toBeNull();
});

it('selecting recent B records it and protects its visible result from A', async () => {
  mockHistoryState.recentSearches = ['B'];
  const a = deferred();
  const catalog = deferred();
  const blank = deferred();
  const b = deferred();
  listRecipes
    .mockReturnValueOnce(catalog.promise)
    .mockReturnValueOnce(a.promise)
    .mockReturnValueOnce(blank.promise)
    .mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await settle(catalog, 'resolve', page([]));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'A');
  await advance();
  fireEvent.press(view.getByLabelText('Clear search'));
  // The blank-query replacement is superseded immediately by the intentional recent selection.
  fireEvent.press(view.getByLabelText('Search for B'));
  expect(mockHistoryState.recordSearch).toHaveBeenCalledWith('B');
  await settle(b, 'resolve', page([recipe('b', 'Recent B')]));
  await settle(blank, 'resolve', page([recipe('blank', 'Stale Catalog')]));
  await settle(a, 'resolve', page([recipe('a', 'Stale A')]));
  expect(view.getByText('Recent B')).toBeOnTheScreen();
  expect(view.queryByText('Stale A')).toBeNull();
});

it('drops stale load-more after B page 1 is visibly current', async () => {
  const moreA = deferred();
  const b = deferred();
  listRecipes
    .mockResolvedValueOnce(page([recipe('a1', 'A One')], 1, 2))
    .mockReturnValueOnce(moreA.promise)
    .mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await view.findByText('A One');
  act(() => view.UNSAFE_getByType('FlatList').props.onEndReached());
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  await advance();
  await settle(b, 'resolve', page([recipe('b', 'Current B')]));
  await settle(moreA, 'resolve', page([recipe('a2', 'Stale A Two')], 2, 2));
  expect(view.getByText('Current B')).toBeOnTheScreen();
  expect(view.queryByText('Stale A Two')).toBeNull();
});

it('does not let stale load-more failure or finalizer clear the current footer owner', async () => {
  const moreA = deferred();
  const firstB = deferred();
  const moreB = deferred();
  listRecipes
    .mockResolvedValueOnce(page([recipe('a1', 'A One')], 1, 2))
    .mockReturnValueOnce(moreA.promise)
    .mockReturnValueOnce(firstB.promise)
    .mockReturnValueOnce(moreB.promise);
  const { view } = renderSearch();
  await view.findByText('A One');
  act(() => view.UNSAFE_getByType('FlatList').props.onEndReached());
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  await advance();
  await settle(firstB, 'resolve', page([recipe('b1', 'B One')], 1, 2));
  act(() => view.UNSAFE_getByType('FlatList').props.onEndReached());
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(4));
  expect(view.getByLabelText('Loading more recipes')).toBeOnTheScreen();

  await settle(moreA, 'reject', new Error('stale more failure'));
  expect(view.getByLabelText('Loading more recipes')).toBeOnTheScreen();
  expect(view.queryByText(/Recipe request failed/)).toBeNull();
  await settle(moreB, 'resolve', page([recipe('b2', 'B Two')], 2, 2));
  expect(view.getByText('B Two')).toBeOnTheScreen();
});

it('drops stale refresh success and finalizer after B is visible', async () => {
  const refreshA = deferred();
  const b = deferred();
  listRecipes
    .mockResolvedValueOnce(page([recipe('a', 'A')]))
    .mockReturnValueOnce(refreshA.promise)
    .mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await view.findByText('A');
  await act(async () => { refreshCallback(); await Promise.resolve(); });
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  await advance();
  expect(listRecipes).toHaveBeenCalledTimes(3);
  await settle(b, 'resolve', page([recipe('b', 'Current B')]));
  await settle(refreshA, 'resolve', page([recipe('old', 'Old Refresh')]));
  expect(view.getByText('Current B')).toBeOnTheScreen();
  expect(view.queryByText('Old Refresh')).toBeNull();
  expect(view.UNSAFE_getByType('FlatList').props.refreshControl.props.refreshing).toBe(false);
});

it('does not let a stale refresh failure clear the current replacement loading owner', async () => {
  const refreshA = deferred();
  const b = deferred();
  listRecipes
    .mockResolvedValueOnce(page([recipe('a', 'A')]))
    .mockReturnValueOnce(refreshA.promise)
    .mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await view.findByText('A');
  await act(async () => { refreshCallback(); await Promise.resolve(); });
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  await advance();

  await settle(refreshA, 'reject', new Error('stale refresh failure'));
  expect(view.getByLabelText('Loading recipes')).toBeOnTheScreen();
  expect(view.queryByText('Recipe request failed.')).toBeNull();
  await settle(b, 'resolve', page([recipe('b', 'Current B')]));
  expect(view.getByText('Current B')).toBeOnTheScreen();
});

it('keeps newer refresh B active when only stale refresh A finalizes', async () => {
  const refreshA = deferred();
  const refreshB = deferred();
  listRecipes
    .mockResolvedValueOnce(page([recipe('seed', 'Seed')]))
    .mockReturnValueOnce(refreshA.promise)
    .mockReturnValueOnce(refreshB.promise);
  const { view } = renderSearch();
  await view.findByText('Seed');

  await act(async () => { refreshCallback(); await Promise.resolve(); });
  await act(async () => { refreshCallback(); await Promise.resolve(); });
  expect(listRecipes).toHaveBeenCalledTimes(3);
  expect(view.UNSAFE_getByType('FlatList').props.refreshControl.props.refreshing).toBe(true);

  // A resolves successfully, so its failure path is irrelevant and its stale
  // success guard remains intact. Removing only the finally guard clears B.
  await settle(refreshA, 'resolve', page([recipe('stale-refresh', 'Stale Refresh')]));
  expect(view.UNSAFE_getByType('FlatList').props.refreshControl.props.refreshing).toBe(true);
  expect(view.getByText('Seed')).toBeOnTheScreen();
  expect(view.queryByText('Stale Refresh')).toBeNull();

  await settle(refreshB, 'resolve', page([recipe('current-refresh', 'Current Refresh')]));
  expect(view.getByText('Current Refresh')).toBeOnTheScreen();
  expect(view.UNSAFE_getByType('FlatList').props.refreshControl.props.refreshing).toBe(false);
});

it('applies a staged filter once and an old query cannot replace it', async () => {
  const old = deferred();
  const filtered = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(old.promise).mockReturnValueOnce(filtered.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'soup');
  await advance();
  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText('Difficulty: Hard'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(3));
  expect(listRecipes).toHaveBeenLastCalledWith({ search: 'soup', difficulty: 'hard', sort: 'titleAsc', page: 1, limit: 20 });
  await settle(filtered, 'resolve', page([recipe('hard', 'Hard Soup')]));
  await settle(old, 'resolve', page([recipe('old', 'Old Soup')]));
  expect(view.getByText('Hard Soup')).toBeOnTheScreen();
  expect(view.queryByText('Old Soup')).toBeNull();
});

it('keeps an Apply replacement loading when the superseded query fails and finalizes', async () => {
  const old = deferred();
  const filtered = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(old.promise).mockReturnValueOnce(filtered.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'soup');
  await advance();
  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText('Difficulty: Hard'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(3));

  await settle(old, 'reject', new Error('stale query'));
  expect(view.getByLabelText('Loading recipes')).toBeOnTheScreen();
  expect(view.queryByText('Recipe request failed.')).toBeNull();
  await settle(filtered, 'resolve', page([recipe('hard', 'Hard Soup')]));
  expect(view.getByText('Hard Soup')).toBeOnTheScreen();
});

it('replaces an old query with a Dashboard preset and keeps the preset result authoritative', async () => {
  const old = deferred();
  const preset = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(old.promise).mockReturnValueOnce(preset.promise);
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
  const view = render(<DiscoverScreen navigation={navigation} route={{ params: {} }} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'old');
  await advance();
  view.rerender(<DiscoverScreen navigation={navigation} route={{ params: { initialFilter: 'vegan' } }} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(3));
  expect(listRecipes).toHaveBeenLastCalledWith({ dietaryTags: 'vegan', sort: 'titleAsc', page: 1, limit: 20 });
  await settle(preset, 'resolve', page([recipe('vegan', 'Current Vegan')]));
  await settle(old, 'resolve', page([recipe('old', 'Stale Query')]));
  expect(view.getByText('Current Vegan')).toBeOnTheScreen();
  expect(view.queryByText('Stale Query')).toBeNull();
});

it('keeps a preset replacement loading when the superseded query fails and finalizes', async () => {
  const old = deferred();
  const preset = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(old.promise).mockReturnValueOnce(preset.promise);
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
  const view = render(<DiscoverScreen navigation={navigation} route={{ params: {} }} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'old');
  await advance();
  view.rerender(<DiscoverScreen navigation={navigation} route={{ params: { initialFilter: 'vegan' } }} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(3));

  await settle(old, 'reject', new Error('stale query'));
  expect(view.getByLabelText('Loading recipes')).toBeOnTheScreen();
  expect(view.queryByText('Recipe request failed.')).toBeNull();
  await settle(preset, 'resolve', page([recipe('vegan', 'Current Vegan')]));
  expect(view.getByText('Current Vegan')).toBeOnTheScreen();
});

it('does not paginate while filters are expanded or the query is unsettled', async () => {
  listRecipes.mockResolvedValueOnce(page([recipe('a', 'A')], 1, 2));
  const { view } = renderSearch();
  await view.findByText('A');
  fireEvent.press(view.getByLabelText('Filters, none active'));
  act(() => view.UNSAFE_getByType('FlatList').props.onEndReached());
  expect(listRecipes).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('Close recipe filters'));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'B');
  act(() => view.UNSAFE_getByType('FlatList').props.onEndReached());
  expect(listRecipes).toHaveBeenCalledTimes(1);
});

it('preserves sort through screen Clear while clearing query and narrowing filters', async () => {
  listRecipes.mockResolvedValue(page([]));
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByLabelText('Sort: Newest added'));
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'newest', page: 1, limit: 20 }));
  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText('Difficulty: Hard'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({ difficulty: 'hard', sort: 'newest', page: 1, limit: 20 }));
  fireEvent.changeText(view.getByLabelText('Search recipes'), 'soup');
  await advance();
  fireEvent.press(view.getByLabelText('Clear search and filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'newest', page: 1, limit: 20 }));
});

it('records keyboard submission and opening a result, but typing alone does not', async () => {
  listRecipes.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([recipe('s', 'Soup')]));
  const { view, navigation } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), '  soup  ');
  expect(mockHistoryState.recordSearch).not.toHaveBeenCalled();
  fireEvent(view.getByLabelText('Search recipes'), 'blur');
  fireEvent(view.getByLabelText('Search recipes'), 'endEditing');
  expect(mockHistoryState.recordSearch).not.toHaveBeenCalled();
  fireEvent(view.getByLabelText('Search recipes'), 'submitEditing');
  expect(mockHistoryState.recordSearch).toHaveBeenCalledWith('soup');
  await view.findByText('Soup');
  fireEvent.press(view.getByLabelText('Open Soup'));
  expect(mockHistoryState.recordSearch).toHaveBeenLastCalledWith('soup');
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeDetail', expect.objectContaining({ recipeId: 's' }));
});

it('account change rejects the old first page and loads the new owner', async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  listRecipes.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
  const view = render(<DiscoverScreen navigation={navigation} route={{ params: {} }} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));

  mockUser = { id: 'user-b' };
  view.rerender(<DiscoverScreen navigation={navigation} route={{ params: {} }} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2));

  await settle(newRequest, 'resolve', page([recipe('new-owner', 'New Owner')]));
  expect(view.getByText('New Owner')).toBeOnTheScreen();
  await settle(oldRequest, 'resolve', page([recipe('old-owner', 'Old Owner')]));
  expect(view.queryByText('Old Owner')).toBeNull();
  expect(view.getByText('New Owner')).toBeOnTheScreen();
});

it.each(['resolve', 'reject'])(
  'keeps the current account/session instance visible when an unmounted instance settles late by %s',
  async (method) => {
  const old = deferred();
  const current = deferred();
  listRecipes.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const first = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  first.view.unmount();
  const second = renderSearch();
  await settle(current, 'resolve', page([recipe('new', 'New Instance')]));
  await settle(
    old,
    method,
    method === 'resolve' ? page([recipe('old', 'Old Instance')]) : new Error('old instance')
  );
  expect(second.view.getByText('New Instance')).toBeOnTheScreen();
  expect(second.view.queryByText('Old Instance')).toBeNull();
  expect(second.view.queryByText('Recipe request failed.')).toBeNull();
});

it('searches canonical Ingredients and applies only the selected public id', async () => {
  ingredientApiGet.mockResolvedValueOnce({
    ingredients: [{ id: 'ingredient-garlic', name: 'Garlic', aliases: ['bawang'] }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const { props, view } = renderSheet();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), '  garlic  ');
  await advance();
  expect(ingredientApiGet).toHaveBeenCalledWith('/ingredients', {
    query: { search: 'garlic', limit: 20 },
  });
  fireEvent.press(await view.findByLabelText('Select ingredient Garlic'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  expect(props.onApply).toHaveBeenCalledWith({
    sort: 'titleAsc',
    ingredient: { id: 'ingredient-garlic', name: 'Garlic' },
  });
});

it.each([
  undefined,
  {},
  { ingredients: null },
  { ingredients: [{ id: ' ', name: 'Garlic' }] },
])('fails closed for malformed Ingredient success payload %#', async (payload) => {
  ingredientApiGet.mockResolvedValueOnce(payload);
  const { view } = renderSheet();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'garlic');
  await advance();
  expect(await view.findByText('Ingredient search failed.')).toBeOnTheScreen();
  expect(view.queryByText(/No ingredients match/)).toBeNull();
});

it('renders Ingredient failure, retries explicitly, and reports a truthful empty result', async () => {
  ingredientApiGet
    .mockRejectedValueOnce(new Error('private failure'))
    .mockResolvedValueOnce({
      ingredients: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
  const { view } = renderSheet();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'unknown');
  await advance();
  expect(await view.findByText('Ingredient search failed.')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Retry ingredient search'));
  await advance();
  expect(ingredientApiGet).toHaveBeenCalledTimes(2);
  expect(await view.findByText(/No ingredients match/)).toBeOnTheScreen();
});

it('invalidates an Ingredient continuation across close and reopen', async () => {
  const old = deferred();
  ingredientApiGet.mockReturnValueOnce(old.promise);
  const { props, view } = renderSheet();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'garlic');
  await advance();
  fireEvent.press(view.getByLabelText('Close recipe filters'));
  view.rerender(<DiscoverFiltersSheet {...props} visible={false} />);
  view.rerender(<DiscoverFiltersSheet {...props} visible />);
  await settle(old, 'resolve', {
    ingredients: [{ id: 'ingredient-garlic', name: 'Garlic' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  expect(view.queryByText('Garlic')).toBeNull();
  expect(view.getByText('Type an ingredient name to search the WeCooked catalog.')).toBeOnTheScreen();
});

it('composes the complete Search request from query, narrowing draft, Ingredient, and sort', async () => {
  listRecipes.mockResolvedValue(page([]));
  ingredientApiGet.mockResolvedValueOnce({
    ingredients: [{ id: 'ingredient-garlic', name: 'Garlic' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  fireEvent.changeText(view.getByLabelText('Search recipes'), ' adobo ');
  await advance();
  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText('Region: Any'));
  fireEvent.press(view.getByLabelText(`Region: ${REGION_OPTIONS[1].label}`));
  fireEvent.press(view.getByLabelText(`Category: ${CATEGORY_OPTIONS[1].label}`));
  fireEvent.press(view.getByLabelText('Difficulty: Hard'));
  fireEvent.press(view.getByLabelText('Dietary: Vegan'));
  fireEvent.press(view.getByLabelText('Dietary: Nut-free'));
  fireEvent.press(view.getByLabelText('Total time: 31-60 min'));
  fireEvent.changeText(view.getByLabelText('Maximum prep minutes, from 1 to 1440'), '45');
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'garlic');
  await advance();
  fireEvent.press(await view.findByLabelText('Select ingredient Garlic'));
  fireEvent.press(view.getByLabelText('Sort: Newest added'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith({
    search: 'adobo',
    region: REGION_OPTIONS[1].value,
    category: CATEGORY_OPTIONS[1].value,
    difficulty: 'hard',
    dietaryTags: 'vegan,nutFree',
    maxPrepTimeMinutes: 45,
    totalTimeBucket: '31-to-60',
    ingredientId: 'ingredient-garlic',
    sort: 'newest',
    page: 1,
    limit: 20,
  }));
});

it('rapid Apply A to B rejects A success and preserves B request ownership', async () => {
  const a = deferred();
  const b = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));

  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText('Dietary: Vegetarian'));
  fireEvent.press(view.getByLabelText('Total time: Under 15 min'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2));
  expect(listRecipes).toHaveBeenLastCalledWith({
    dietaryTags: 'vegetarian', totalTimeBucket: 'under-15', sort: 'titleAsc', page: 1, limit: 20,
  });

  fireEvent.press(view.getByLabelText('Filters, 2 active'));
  fireEvent.press(view.getByLabelText('Dietary: Vegetarian'));
  fireEvent.press(view.getByLabelText('Dietary: Vegan'));
  fireEvent.press(view.getByLabelText('Total time: Over 60 min'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(3));
  expect(listRecipes).toHaveBeenLastCalledWith({
    dietaryTags: 'vegan', totalTimeBucket: 'over-60', sort: 'titleAsc', page: 1, limit: 20,
  });

  await settle(a, 'resolve', page([recipe('stale-a', 'Stale A')]));
  expect(view.queryByText('Stale A')).toBeNull();
  expect(view.getByLabelText('Loading recipes')).toBeOnTheScreen();
  await settle(b, 'resolve', page([recipe('current-b', 'Current B')]));
  expect(view.getByText('Current B')).toBeOnTheScreen();
});

it('rapid Apply A to B rejects A error and stale finalizer', async () => {
  const a = deferred();
  const b = deferred();
  listRecipes.mockResolvedValueOnce(page([])).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { view } = renderSearch();
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));

  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText('Dietary: Vegetarian'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2));
  fireEvent.press(view.getByLabelText('Filters, 1 active'));
  fireEvent.press(view.getByLabelText('Dietary: Vegetarian'));
  fireEvent.press(view.getByLabelText('Dietary: Vegan'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(3));

  await settle(a, 'reject', new Error('stale Apply A'));
  expect(view.queryByText('Recipe request failed.')).toBeNull();
  expect(view.getByLabelText('Loading recipes')).toBeOnTheScreen();
  await settle(b, 'resolve', page([recipe('current-b', 'Current B')]));
  expect(view.getByText('Current B')).toBeOnTheScreen();
});

it('renders a later-page error and retries the same authoritative page', async () => {
  const failedMore = deferred();
  listRecipes
    .mockResolvedValueOnce(page([recipe('one', 'One')], 1, 2))
    .mockReturnValueOnce(failedMore.promise)
    .mockResolvedValueOnce(page([recipe('two', 'Two')], 2, 2));
  const { view } = renderSearch();
  await view.findByText('One');
  act(() => view.UNSAFE_getByType('FlatList').props.onEndReached());
  await settle(failedMore, 'reject', new Error('later page'));
  const retry = view.getByLabelText('Retry loading more recipes');
  expect(retry).toBeOnTheScreen();
  fireEvent.press(retry);
  await view.findByText('Two');
  expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'titleAsc', page: 2, limit: 20 });
});

it('keeps the DISC4 controls mounted and wired to accessible 44-point targets', async () => {
  ingredientApiGet.mockResolvedValueOnce({
    ingredients: [{ id: 'ingredient-onion', name: 'Onion' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const { view } = renderSheet();
  expect(flattenedStyle(view.getByLabelText('Difficulty: Hard'))).toMatchObject({ minWidth: 44, minHeight: 44 });
  expect(flattenedStyle(view.getByLabelText('Dietary: Vegan'))).toMatchObject({ minWidth: 44, minHeight: 44 });
  expect(view.getByLabelText('Dietary: Vegan').props.accessibilityState).toEqual({ checked: false });
  expect(flattenedStyle(view.getByLabelText('Total time: Under 15 min'))).toMatchObject({ minWidth: 44, minHeight: 44 });
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'onion');
  expect(flattenedStyle(view.getByLabelText('Clear ingredient search'))).toMatchObject({ minWidth: 44, minHeight: 44 });
  await advance();
  expect(flattenedStyle(await view.findByLabelText('Select ingredient Onion')).minHeight).toBeGreaterThanOrEqual(44);
  expect(flattenedStyle(view.getByLabelText('Apply recipe filters')).minHeight).toBeGreaterThanOrEqual(44);
});
