const React = require('react');
let mockFocusCallback;

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => (
    React.createElement(name, { ...props, ref }, children)
  ));
  const FlatList = React.forwardRef(({
    data = [], renderItem, ListHeaderComponent, ListFooterComponent, ...props
  }, ref) => React.createElement(
    'FlatList',
    { ...props, data, renderItem, ref },
    ListHeaderComponent,
    data.map((item, index) => <React.Fragment key={item.id || item.key || index}>
      {renderItem({ item, index })}
    </React.Fragment>),
    ListFooterComponent
  ));
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: jest.fn() },
    FlatList,
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: (styles) => styles,
      flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => {
    const React = require('react');
    mockFocusCallback = callback;
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('../src/theme/theme', () => ({
  typography: { display: { fontFamily: 'display' }, body: { fontFamily: 'body', semibold: 'semibold', medium: 'medium' }, sizes: { base: 14, sm: 12 } },
  spacing: { sm: 4, md: 8, lg: 12, xl: 16, xxl: 24, xxxl: 32 },
  radius: { md: 8, pill: 99 },
}));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({ colors: {
    cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333',
    inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sageDeep: '#353', error: '#900',
  } }),
}));
jest.mock('../src/components/Button', () => 'Button');
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/FavoriteHeart', () => 'FavoriteHeart');
jest.mock('../src/api/collectionService', () => ({}));
jest.mock('../src/api/collectionErrors', () => ({ getCollectionErrorMessage: () => 'Collection failed.' }));
jest.mock('../src/api/recipeErrors', () => ({ getRecipeErrorMessage: (error) => error.message || 'Recipe failed.' }));
jest.mock('../src/api/recipeOptions', () => ({ categoryLabel: () => '', regionLabel: () => '', difficultyLabel: () => '' }));
jest.mock('../src/utils/recipe', () => ({ recipeTimeLabel: () => '20 min' }));

const mockSmartCollectionDefinitions = [
  { key: 'quick-meals', name: 'Quick Meals' },
  { key: 'balanced-meals', name: 'Balanced Meals' },
  { key: 'weekend-cooking', name: 'Weekend Cooking' },
  { key: 'dinner-ideas', name: 'Dinner Ideas' },
  { key: 'breakfast', name: 'Breakfast' },
];
jest.mock('../src/api/recipeService', () => ({
  SMART_COLLECTION_DEFINITIONS: mockSmartCollectionDefinitions,
  listSmartCollections: jest.fn(),
  getSmartCollection: jest.fn(),
}));

let mockAuthState;
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuthState }));
const mockFavoritesState = {
  favorites: [], status: 'ready', error: null, reload: jest.fn(() => Promise.resolve()),
};
const mockCollectionsState = {
  collections: [], status: 'ready', error: null, reload: jest.fn(() => Promise.resolve()),
  createCollection: jest.fn(), deleteCollection: jest.fn(), removeRecipeFromCollection: jest.fn(),
};
jest.mock('../src/context/FavoritesContext', () => ({ useFavorites: () => mockFavoritesState }));
jest.mock('../src/context/CollectionsContext', () => ({ useCollections: () => mockCollectionsState }));

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { listSmartCollections, getSmartCollection } = require('../src/api/recipeService');
const { SMART_COLLECTION_DEFINITIONS } = require('../src/api/recipeService');
const SavedScreen = require('../src/screens/SavedScreen').default;
const CollectionDetailScreen = require('../src/screens/CollectionDetailScreen').default;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function settle(request, method, value) {
  await act(async () => {
    request[method](value);
    await request.promise.catch(() => undefined);
  });
}

function summaries() {
  return SMART_COLLECTION_DEFINITIONS.map((entry, index) => ({
    ...entry, recipeCount: index, coverImageUrls: [],
  }));
}

function detail(key, recipes, page = 1, totalPages = 1, total = recipes.length) {
  const definition = SMART_COLLECTION_DEFINITIONS.find((entry) => entry.key === key);
  return {
    smartCollection: definition,
    recipes,
    pagination: { page, limit: 20, total, totalPages },
  };
}

function renderDetail(key = 'quick-meals') {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const route = { params: { collectionType: 'smart', groupKey: key } };
  const view = render(<CollectionDetailScreen navigation={navigation} route={route} />);
  return { view, navigation };
}

async function fireRefresh(view, listType = 'FlatList') {
  const refreshControl = view.UNSAFE_getByType(listType).props.refreshControl;
  await act(async () => {
    refreshControl.props.onRefresh();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockAuthState = { status: 'authenticated', user: { id: 'user-a' } };
  listSmartCollections.mockReset();
  getSmartCollection.mockReset();
  mockFavoritesState.reload.mockClear();
  mockCollectionsState.reload.mockClear();
});

afterEach(cleanup);

it('Saved keeps five stable smart positions loading, commits server counts, and navigates by key only', async () => {
  const request = deferred();
  listSmartCollections.mockReturnValue(request.promise);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const view = render(<SavedScreen navigation={navigation} />);
  expect(listSmartCollections).toHaveBeenCalledTimes(1);
  for (const { name } of SMART_COLLECTION_DEFINITIONS) expect(view.getByLabelText(name)).toBeDisabled();
  expect(view.getByLabelText('Loading Quick Meals').props.accessibilityState).toEqual({ busy: true });

  await settle(request, 'resolve', { smartCollections: summaries() });
  const quick = view.getByLabelText('Quick Meals, 0 recipes');
  expect(quick).not.toBeDisabled();
  fireEvent.press(quick);
  expect(navigation.navigate).toHaveBeenCalledWith('CollectionDetail', {
    collectionType: 'smart', groupKey: 'quick-meals',
  });
});

it('Saved rejects stale account success and stale finally without clearing the current owner', async () => {
  const oldRequest = deferred();
  const currentRequest = deferred();
  listSmartCollections.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const view = render(<SavedScreen navigation={navigation} />);

  mockAuthState = { status: 'authenticated', user: { id: 'user-b' } };
  view.rerender(<SavedScreen navigation={navigation} />);
  await waitFor(() => expect(listSmartCollections).toHaveBeenCalledTimes(2));
  await settle(currentRequest, 'resolve', { smartCollections: summaries() });
  expect(view.getByLabelText('Balanced Meals, 1 recipe')).toBeOnTheScreen();
  await settle(oldRequest, 'resolve', { smartCollections: summaries().map((entry) => ({ ...entry, recipeCount: 99 })) });
  expect(view.queryByLabelText('Balanced Meals, 99 recipes')).toBeNull();
  expect(view.getByLabelText('Balanced Meals, 1 recipe')).not.toBeDisabled();
});

it('Saved refreshes once on refocus after the single initial request', async () => {
  listSmartCollections.mockResolvedValue({ smartCollections: summaries() });
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const view = render(<SavedScreen navigation={navigation} />);
  await view.findByLabelText('Quick Meals, 0 recipes');
  expect(listSmartCollections).toHaveBeenCalledTimes(1);
  await act(async () => {
    await mockFocusCallback();
  });
  await waitFor(() => expect(listSmartCollections).toHaveBeenCalledTimes(2));
});

it('Saved shows an independent safe retry and a newer retry owns the result', async () => {
  listSmartCollections.mockRejectedValueOnce(new Error('Smart failed.')).mockResolvedValueOnce({ smartCollections: summaries() });
  const view = render(<SavedScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() }} />);
  const retry = await view.findByLabelText('Smart collections: Smart failed.. Tap to retry.');
  expect(view.getByLabelText('Quick Meals')).toBeDisabled();
  const favoritesReloads = mockFavoritesState.reload.mock.calls.length;
  const collectionsReloads = mockCollectionsState.reload.mock.calls.length;
  fireEvent.press(retry);
  await view.findByLabelText('Quick Meals, 0 recipes');
  expect(mockFavoritesState.reload).toHaveBeenCalledTimes(favoritesReloads);
  expect(mockCollectionsState.reload).toHaveBeenCalledTimes(collectionsReloads);
});

it('smart detail rejects stale success and stale finally after a group switch', async () => {
  const quick = deferred();
  const breakfast = deferred();
  getSmartCollection.mockReturnValueOnce(quick.promise).mockReturnValueOnce(breakfast.promise);
  const { view, navigation } = renderDetail('quick-meals');
  view.rerender(<CollectionDetailScreen navigation={navigation} route={{ params: { collectionType: 'smart', groupKey: 'breakfast' } }} />);
  await waitFor(() => expect(getSmartCollection).toHaveBeenCalledTimes(2));
  await settle(quick, 'resolve', detail('quick-meals', [{ id: 'stale', title: 'Stale Quick' }]));
  expect(view.queryByText('Stale Quick')).toBeNull();
  expect(view.getByLabelText('Loading Breakfast')).toBeOnTheScreen();
  await settle(breakfast, 'resolve', detail('breakfast', [{ id: 'b1', title: 'Current Breakfast' }]));
  expect(view.getByText('Current Breakfast')).toBeOnTheScreen();
});

it('smart loading and recipe rows expose busy and button semantics', async () => {
  const request = deferred();
  getSmartCollection.mockReturnValue(request.promise);
  const { view } = renderDetail();
  expect(view.getByLabelText('Loading Quick Meals').props.accessibilityState).toEqual({ busy: true });
  await settle(request, 'resolve', detail('quick-meals', [{ id: 'a11y', title: 'Accessible Adobo' }]));
  expect(view.getByLabelText('Open Accessible Adobo').props.accessibilityRole).toBe('button');
});

it('smart detail exposes initial error retry and accepts only the retry generation', async () => {
  getSmartCollection.mockRejectedValueOnce(new Error('Initial failed.')).mockResolvedValueOnce(
    detail('quick-meals', [{ id: 'retry', title: 'Retry Result' }])
  );
  const { view } = renderDetail();
  const retry = await view.findByLabelText('Retry loading smart collection');
  expect(view.queryByText('No recipes in this smart collection yet.')).toBeNull();
  fireEvent.press(retry);
  await view.findByText('Retry Result');
  expect(getSmartCollection).toHaveBeenCalledTimes(2);
});

it('smart detail clears account A immediately and accepts only account B', async () => {
  getSmartCollection.mockResolvedValueOnce(detail('quick-meals', [{ id: 'a1', title: 'Account A Recipe' }]));
  const { view, navigation } = renderDetail();
  await view.findByText('Account A Recipe');
  const next = deferred();
  getSmartCollection.mockReturnValueOnce(next.promise);
  mockAuthState = { status: 'authenticated', user: { id: 'user-b' } };
  view.rerender(<CollectionDetailScreen navigation={navigation} route={{ params: { collectionType: 'smart', groupKey: 'quick-meals' } }} />);
  expect(view.queryByText('Account A Recipe')).toBeNull();
  await settle(next, 'resolve', detail('quick-meals', [{ id: 'b1', title: 'Account B Recipe' }]));
  expect(view.getByText('Account B Recipe')).toBeOnTheScreen();
});

it('smart detail rejects stale success and stale finally after an account switch', async () => {
  const accountA = deferred();
  const accountB = deferred();
  getSmartCollection.mockReturnValueOnce(accountA.promise).mockReturnValueOnce(accountB.promise);
  const { view, navigation } = renderDetail();
  mockAuthState = { status: 'authenticated', user: { id: 'user-b' } };
  view.rerender(<CollectionDetailScreen navigation={navigation} route={{ params: { collectionType: 'smart', groupKey: 'quick-meals' } }} />);
  await waitFor(() => expect(getSmartCollection).toHaveBeenCalledTimes(2));
  await settle(accountA, 'resolve', detail('quick-meals', [{ id: 'a-stale', title: 'Stale Account A' }]));
  expect(view.queryByText('Stale Account A')).toBeNull();
  expect(view.getByLabelText('Loading Quick Meals')).toBeOnTheScreen();
  await settle(accountB, 'resolve', detail('quick-meals', [{ id: 'b-current', title: 'Current Account B' }]));
  expect(view.getByText('Current Account B')).toBeOnTheScreen();
});

it('single-flights overlapping page-one refresh and retry requests', async () => {
  getSmartCollection.mockResolvedValueOnce(detail('quick-meals', [{ id: 'r1', title: 'Ready Row' }]));
  const { view } = renderDetail();
  await view.findByText('Ready Row');
  const refresh = deferred();
  getSmartCollection.mockReturnValueOnce(refresh.promise);
  await fireRefresh(view);
  await fireRefresh(view);
  expect(getSmartCollection).toHaveBeenCalledTimes(2);
  await settle(refresh, 'reject', new Error('Refresh failed.'));

  const retryRequest = deferred();
  getSmartCollection.mockReturnValueOnce(retryRequest.promise);
  const retry = await view.findByLabelText('Retry refreshing smart collection');
  fireEvent.press(retry);
  fireEvent.press(retry);
  expect(getSmartCollection).toHaveBeenCalledTimes(3);
  await settle(retryRequest, 'resolve', detail('quick-meals', [{ id: 'r2', title: 'Recovered Row' }]));
  expect(view.getByText('Recovered Row')).toBeOnTheScreen();
});

it('refresh invalidates load-more, stale finally cannot clear refresh, and refresh atomically replaces rows', async () => {
  getSmartCollection.mockResolvedValueOnce(detail('quick-meals', [{ id: 'r1', title: 'Old First' }], 1, 2, 2));
  const { view } = renderDetail();
  await view.findByText('Old First');
  const more = deferred();
  const refresh = deferred();
  getSmartCollection.mockReturnValueOnce(more.promise).mockReturnValueOnce(refresh.promise);
  fireEvent(view.UNSAFE_getByType('FlatList'), 'onEndReached');
  await waitFor(() => expect(getSmartCollection).toHaveBeenCalledTimes(2));
  await fireRefresh(view);
  await waitFor(() => expect(getSmartCollection).toHaveBeenCalledTimes(3));
  await settle(more, 'resolve', detail('quick-meals', [{ id: 'r2', title: 'Stale More' }], 2, 2, 2));
  expect(view.queryByText('Stale More')).toBeNull();
  expect(view.UNSAFE_getByType('FlatList').props.refreshControl.props.refreshing).toBe(true);
  await settle(refresh, 'resolve', detail('quick-meals', [{ id: 'fresh', title: 'Fresh Replacement' }], 1, 1, 1));
  expect(view.queryByText('Old First')).toBeNull();
  expect(view.getByText('Fresh Replacement')).toBeOnTheScreen();
});

it('single-flights load more and deduplicates ids', async () => {
  getSmartCollection.mockResolvedValueOnce(detail('quick-meals', [{ id: 'r1', title: 'First' }], 1, 2, 3));
  const { view } = renderDetail();
  await view.findByText('First');
  const more = deferred();
  getSmartCollection.mockReturnValueOnce(more.promise);
  const list = view.UNSAFE_getByType('FlatList');
  fireEvent(list, 'onEndReached');
  fireEvent(list, 'onEndReached');
  expect(getSmartCollection).toHaveBeenCalledTimes(2);
  await settle(more, 'resolve', detail('quick-meals', [
    { id: 'r1', title: 'Duplicate First' }, { id: 'r2', title: 'Second' },
  ], 2, 2, 3));
  expect(view.getAllByText('First')).toHaveLength(1);
  expect(view.getByText('Second')).toBeOnTheScreen();
});

it('retains rows on load-more error and retries the same page', async () => {
  getSmartCollection.mockResolvedValueOnce(detail('quick-meals', [{ id: 'x1', title: 'Retained' }], 1, 2, 2));
  const secondView = renderDetail().view;
  await secondView.findByText('Retained');
  getSmartCollection.mockRejectedValueOnce(new Error('More failed.')).mockResolvedValueOnce(
    detail('quick-meals', [{ id: 'x2', title: 'Recovered' }], 2, 2, 2)
  );
  fireEvent(secondView.UNSAFE_getByType('FlatList'), 'onEndReached');
  const retry = await secondView.findByLabelText('Retry loading more recipes');
  expect(secondView.getByText('Retained')).toBeOnTheScreen();
  fireEvent.press(retry);
  await secondView.findByText('Recovered');
  expect(getSmartCollection.mock.calls.slice(-2).map(([, params]) => params.page)).toEqual([2, 2]);
});

it('renders only successful zero totals as empty and ignores success after unmount', async () => {
  const request = deferred();
  getSmartCollection.mockReturnValueOnce(request.promise);
  const { view } = renderDetail('breakfast');
  expect(view.queryByText('No recipes in this smart collection yet.')).toBeNull();
  await settle(request, 'resolve', detail('breakfast', [], 1, 0, 0));
  expect(view.getByText('No recipes in this smart collection yet.')).toBeOnTheScreen();

  const late = deferred();
  getSmartCollection.mockReturnValueOnce(late.promise);
  await fireRefresh(view, 'ScrollView');
  view.unmount();
  await settle(late, 'resolve', detail('breakfast', [{ id: 'late', title: 'Late Success' }]));
});

it('ignores Saved summary success and rejection after unmount', async () => {
  const success = deferred();
  listSmartCollections.mockReturnValueOnce(success.promise);
  const first = render(<SavedScreen navigation={{ navigate: jest.fn() }} />);
  first.unmount();
  await settle(success, 'resolve', { smartCollections: summaries() });

  const rejection = deferred();
  listSmartCollections.mockReturnValueOnce(rejection.promise);
  const second = render(<SavedScreen navigation={{ navigate: jest.fn() }} />);
  second.unmount();
  await settle(rejection, 'reject', new Error('late summary failure'));
});

it('retains an accepted empty result when refresh fails and exposes retry', async () => {
  getSmartCollection.mockResolvedValueOnce(detail('breakfast', [], 1, 0, 0));
  const { view } = renderDetail('breakfast');
  await view.findByText('No recipes in this smart collection yet.');
  getSmartCollection.mockRejectedValueOnce(new Error('Empty refresh failed.'));
  await fireRefresh(view, 'ScrollView');
  expect(view.getByText('No recipes in this smart collection yet.')).toBeOnTheScreen();
  expect(view.getByText('Retry')).toBeOnTheScreen();
});
