const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  const FlatList = React.forwardRef(({ data = [], renderItem, ListHeaderComponent, ListFooterComponent, ...props }, ref) => React.createElement(
    'FlatList', { ...props, data, ref }, ListHeaderComponent,
    data.map((item, index) => <React.Fragment key={item.id || index}>{renderItem({ item, index })}</React.Fragment>),
    ListFooterComponent
  ));
  return {
    ActivityIndicator: host('ActivityIndicator'), Alert: { alert: jest.fn() }, FlatList,
    Pressable: host('Pressable'), RefreshControl: host('RefreshControl'), ScrollView: host('ScrollView'),
    StyleSheet: { create: (styles) => styles, flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {} },
    Text: host('Text'), View: host('View'),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => {
    const React = require('react');
    React.useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
  },
}));
jest.mock('../src/theme/ThemeContext', () => ({ useTheme: () => ({ colors: {
  cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333',
  inkFaint: '#666', hairline: '#ccc', sageDeep: '#353', error: '#900',
} }) }));
jest.mock('../src/components/Button', () => 'Button');
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/FavoriteHeart', () => 'FavoriteHeart');
jest.mock('../src/api/collectionService', () => ({ getCollection: jest.fn(), listCollectionRecipes: jest.fn() }));
jest.mock('../src/api/collectionErrors', () => ({ getCollectionErrorMessage: (error) => error.message }));
jest.mock('../src/api/recipeErrors', () => ({ getRecipeErrorMessage: (error) => error.message }));
jest.mock('../src/api/recipeService', () => ({ SMART_COLLECTION_DEFINITIONS: [], getSmartCollection: jest.fn() }));
jest.mock('../src/api/recipeOptions', () => ({ categoryLabel: () => '', regionLabel: () => '', difficultyLabel: () => '' }));
jest.mock('../src/utils/recipe', () => ({ recipeTimeLabel: () => '20 min' }));
let mockAuthState;
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuthState }));
jest.mock('../src/context/FavoritesContext', () => ({ useFavorites: () => ({ favorites: [], status: 'ready', reload: jest.fn() }) }));
const mockRemoveRecipe = jest.fn();
jest.mock('../src/context/CollectionsContext', () => ({ useCollections: () => ({
  deleteCollection: jest.fn(), removeRecipeFromCollection: mockRemoveRecipe,
}) }));

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const service = require('../src/api/collectionService');
const CollectionDetailScreen = require('../src/screens/CollectionDetailScreen').default;

const membership = (number) => ({ id: `member-${number}`, recipe: { id: `recipe-${number}`, title: `Recipe ${number}` } });
const page = (recipes, number, total) => ({ recipes, pagination: { page: number, limit: 100, total, totalPages: Math.ceil(total / 100) } });
const firstHundred = Array.from({ length: 100 }, (_, index) => membership(index + 1));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function screen(collectionId = 'collection-a') {
  return <CollectionDetailScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() }} route={{ params: { collectionType: 'user', collectionId } }} />;
}
async function ready(view) {
  await waitFor(() => expect(view.getByText('Recipe 1')).toBeOnTheScreen());
}
afterEach(() => cleanup());
beforeEach(() => {
  jest.resetAllMocks();
  mockFocused = true;
  mockAuthState = { status: 'authenticated', user: { id: 'owner-a' } };
  service.getCollection.mockImplementation((id) => Promise.resolve({ id, name: `Collection ${id}` }));
  service.listCollectionRecipes.mockResolvedValue(page(firstHundred, 1, 101));
});

it('loads beyond 100 with stable recipe identity, order and authoritative total', async () => {
  service.listCollectionRecipes.mockImplementation((_id, params) => Promise.resolve(
    params.page === 1 ? page(firstHundred, 1, 102) : page([membership(100), membership(101), membership(102)], 2, 102)
  ));
  const view = render(screen());
  await ready(view);
  expect(view.getByText('102 collection entries')).toBeOnTheScreen();
  expect(view.queryByText('102 recipes')).toBeNull();
  const list = view.UNSAFE_getByType(require('react-native').FlatList);
  await act(async () => { list.props.onEndReached(); list.props.onEndReached(); });
  await waitFor(() => expect(view.getByText('Recipe 102')).toBeOnTheScreen());
  expect(view.getAllByText('Recipe 100')).toHaveLength(1);
  expect(service.listCollectionRecipes.mock.calls.filter(([, params]) => params.page === 2)).toHaveLength(1);
  expect(view.UNSAFE_getByType(require('react-native').FlatList).props.data.map((entry) => entry.recipe.id)).toEqual(
    [...firstHundred, membership(101), membership(102)].map((entry) => entry.recipe.id)
  );
});

it('retains loaded rows when page two fails and retries that page', async () => {
  service.listCollectionRecipes.mockImplementation((_id, params) => params.page === 1
    ? Promise.resolve(page(firstHundred, 1, 101))
    : service.listCollectionRecipes.mock.calls.filter(([, p]) => p.page === 2).length === 1
      ? Promise.reject(new Error('Page unavailable')) : Promise.resolve(page([membership(101)], 2, 101)));
  const view = render(screen());
  await ready(view);
  fireEvent(view.UNSAFE_getByType(require('react-native').FlatList), 'onEndReached');
  await waitFor(() => expect(view.getByLabelText('Retry loading more collection recipes')).toBeOnTheScreen());
  expect(view.getByText('Recipe 100')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Retry loading more collection recipes'));
  await waitFor(() => expect(view.getByText('Recipe 101')).toBeOnTheScreen());
  expect(view.queryByLabelText('Retry loading more collection recipes')).toBeNull();
});

it('shows a refresh error over retained rows and clears it only on successful retry', async () => {
  service.listCollectionRecipes.mockResolvedValueOnce(page(firstHundred, 1, 101))
    .mockRejectedValueOnce(new Error('Refresh unavailable'))
    .mockResolvedValueOnce(page([membership(1)], 1, 1));
  const view = render(screen());
  await ready(view);
  await act(async () => view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.onRefresh());
  expect(view.getByText('Recipe 100')).toBeOnTheScreen();
  expect(view.getByLabelText('Retry refreshing collection')).toBeOnTheScreen();
  await act(async () => fireEvent.press(view.getByLabelText('Retry refreshing collection')));
  await waitFor(() => expect(view.getByText('1 collection entry')).toBeOnTheScreen());
  expect(view.queryByLabelText('Retry refreshing collection')).toBeNull();
});

it('suppresses a stale page response after a collection navigation change', async () => {
  const oldPage = deferred();
  service.listCollectionRecipes.mockImplementation((id, params) => {
    if (id === 'collection-a' && params.page === 2) return oldPage.promise;
    return Promise.resolve(id === 'collection-a' ? page(firstHundred, 1, 101) : page([membership(900)], 1, 1));
  });
  const view = render(screen());
  await ready(view);
  fireEvent(view.UNSAFE_getByType(require('react-native').FlatList), 'onEndReached');
  view.rerender(screen('collection-b'));
  await waitFor(() => expect(view.getByText('Recipe 900')).toBeOnTheScreen());
  await act(async () => oldPage.resolve(page([membership(101)], 2, 101)));
  expect(view.queryByText('Recipe 101')).toBeNull();
  expect(view.getByText('1 collection entry')).toBeOnTheScreen();
});

it('reconciles pagination and count after removing a recipe from loaded pages', async () => {
  service.listCollectionRecipes.mockImplementation((_id, params) => Promise.resolve(
    params.page === 2 ? page([membership(101)], 2, 101)
      : service.listCollectionRecipes.mock.calls.filter(([, p]) => p.page === 1).length === 1
        ? page(firstHundred, 1, 101) : page(firstHundred.filter((entry) => entry.recipe.id !== 'recipe-1').concat(membership(101)), 1, 100)
  ));
  mockRemoveRecipe.mockResolvedValue({ ok: true });
  const view = render(screen());
  await ready(view);
  fireEvent(view.UNSAFE_getByType(require('react-native').FlatList), 'onEndReached');
  await waitFor(() => expect(view.getByText('Recipe 101')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  await waitFor(() => expect(mockRemoveRecipe).toHaveBeenCalledWith('collection-a', 'recipe-1'));
  await waitFor(() => expect(view.getByText('100 collection entries')).toBeOnTheScreen());
  expect(view.queryByText('Recipe 1')).toBeNull();
  expect(view.getByText('Recipe 101')).toBeOnTheScreen();
});

it('uses truthful loaded-count wording when the server omits totals', async () => {
  service.listCollectionRecipes.mockResolvedValue({ recipes: [membership(1)], pagination: null });
  const view = render(screen());
  await ready(view);
  expect(view.getByText('1 loaded recipe')).toBeOnTheScreen();
  expect(view.queryByText('1 collection entry')).toBeNull();
});

it('can advance when the first API page contains only unavailable recipes', async () => {
  service.listCollectionRecipes.mockImplementation((_id, params) => Promise.resolve(
    params.page === 1 ? page([], 1, 101) : page([membership(101)], 2, 101)
  ));
  const view = render(screen());
  await waitFor(() => expect(view.getByLabelText('Load more collection recipes')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Load more collection recipes'));
  await waitFor(() => expect(view.getByText('Recipe 101')).toBeOnTheScreen());
  expect(view.getByText('101 collection entries')).toBeOnTheScreen();
});

it('does not apply a pending refresh response after unmount', async () => {
  const request = deferred();
  service.listCollectionRecipes.mockResolvedValueOnce(page([membership(1)], 1, 1))
    .mockReturnValueOnce(request.promise);
  const view = render(screen());
  await ready(view);
  act(() => { void view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.onRefresh(); });
  view.unmount();
  await act(async () => request.resolve(page([membership(2)], 1, 1)));
  expect(service.listCollectionRecipes).toHaveBeenCalledTimes(2);
});

it('distinguishes initial load failure and retries it without a false empty state', async () => {
  service.getCollection.mockRejectedValueOnce(new Error('Collection unavailable'))
    .mockResolvedValueOnce({ id: 'collection-a', name: 'Collection collection-a' });
  service.listCollectionRecipes.mockResolvedValue(page([membership(1)], 1, 1));
  const view = render(screen());
  await waitFor(() => expect(view.getByLabelText('Retry loading collection')).toBeOnTheScreen());
  expect(view.queryByText('Add recipes from any recipe page.')).toBeNull();
  fireEvent.press(view.getByLabelText('Retry loading collection'));
  await ready(view);
  expect(view.queryByLabelText('Retry loading collection')).toBeNull();
});

it('discards an old load-more page when a newer refresh succeeds', async () => {
  const oldPage = deferred();
  service.listCollectionRecipes.mockResolvedValueOnce(page(firstHundred, 1, 101))
    .mockReturnValueOnce(oldPage.promise)
    .mockResolvedValueOnce(page([membership(501)], 1, 1));
  const view = render(screen());
  await ready(view);
  fireEvent(view.UNSAFE_getByType(require('react-native').FlatList), 'onEndReached');
  await act(async () => view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.getByText('Recipe 501')).toBeOnTheScreen());
  await act(async () => oldPage.resolve(page([membership(101)], 2, 101)));
  expect(view.queryByText('Recipe 101')).toBeNull();
  expect(view.getByText('1 collection entry')).toBeOnTheScreen();
});

it('serializes two rapid removals synchronously and reconciles each success', async () => {
  const first = deferred();
  const second = deferred();
  const deleted = new Set();
  service.listCollectionRecipes.mockImplementation(() => Promise.resolve(page(
    [membership(1), membership(2)].filter((entry) => !deleted.has(entry.recipe.id)), 1, 2 - deleted.size
  )));
  mockRemoveRecipe.mockImplementation((_collectionId, recipeId) =>
    recipeId === 'recipe-1' ? first.promise : second.promise);
  const view = render(screen());
  await ready(view);

  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  expect(view.getByLabelText('Updating collection')).toBeOnTheScreen();
  expect(view.getByLabelText('Removing Recipe 1 from collection').props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(view.getByLabelText('Remove Recipe 2 from collection').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Remove Recipe 2 from collection'));
  expect(mockRemoveRecipe).toHaveBeenCalledTimes(1);

  deleted.add('recipe-1');
  await act(async () => first.resolve({ ok: true }));
  await waitFor(() => expect(view.queryByText('Recipe 1')).toBeNull());
  expect(view.getByText('1 collection entry')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Remove Recipe 2 from collection'));
  expect(mockRemoveRecipe).toHaveBeenNthCalledWith(2, 'collection-a', 'recipe-2');
  deleted.add('recipe-2');
  await act(async () => second.resolve({ ok: true }));
  await waitFor(() => expect(view.getByText('0 collection entries')).toBeOnTheScreen());
  expect(view.queryByText('Recipe 2')).toBeNull();
});

it('blocks refresh during removal and rejects an older GET that still contains the deleted recipe', async () => {
  const oldGet = deferred();
  const mutation = deferred();
  const reconcile = deferred();
  service.listCollectionRecipes.mockResolvedValueOnce(page([membership(1), membership(2)], 1, 2))
    .mockReturnValueOnce(oldGet.promise)
    .mockReturnValueOnce(reconcile.promise);
  mockRemoveRecipe.mockReturnValue(mutation.promise);
  const view = render(screen());
  await ready(view);
  act(() => { void view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.onRefresh(); });
  expect(service.listCollectionRecipes).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  act(() => { void view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.onRefresh(); });
  expect(service.listCollectionRecipes).toHaveBeenCalledTimes(2);
  expect(view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.enabled).toBe(false);
  await act(async () => mutation.resolve({ ok: true }));
  await waitFor(() => expect(service.listCollectionRecipes).toHaveBeenCalledTimes(3));
  await act(async () => oldGet.resolve(page([membership(1), membership(2)], 1, 2)));
  expect(view.queryByText('Recipe 1')).toBeNull();
  await act(async () => reconcile.resolve(page([membership(2)], 1, 1)));
  expect(view.getByText('Recipe 2')).toBeOnTheScreen();
  expect(view.getByText('1 collection entry')).toBeOnTheScreen();
});

it('retains a recipe on failed removal, reports the error, and serves a queued refresh', async () => {
  const mutation = deferred();
  service.listCollectionRecipes.mockResolvedValue(page([membership(1)], 1, 1));
  mockRemoveRecipe.mockReturnValue(mutation.promise);
  const view = render(screen());
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  act(() => { void view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.onRefresh(); });
  expect(service.listCollectionRecipes).toHaveBeenCalledTimes(1);
  await act(async () => mutation.resolve({ ok: false, error: 'Removal denied' }));
  await waitFor(() => expect(service.listCollectionRecipes).toHaveBeenCalledTimes(2));
  expect(require('react-native').Alert.alert).toHaveBeenCalledWith('Couldn’t remove recipe', 'Removal denied');
  expect(view.getByText('Recipe 1')).toBeOnTheScreen();
  expect(view.getByText('1 collection entry')).toBeOnTheScreen();
});

it('reissues a refresh that was already in flight when removal fails', async () => {
  const oldRefresh = deferred();
  const mutation = deferred();
  service.listCollectionRecipes.mockResolvedValueOnce(page([membership(1)], 1, 1))
    .mockReturnValueOnce(oldRefresh.promise)
    .mockResolvedValueOnce(page([membership(1)], 1, 1));
  mockRemoveRecipe.mockReturnValue(mutation.promise);
  const view = render(screen());
  await ready(view);
  act(() => { void view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.onRefresh(); });
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  await act(async () => mutation.resolve({ ok: false, error: 'Removal denied' }));
  await waitFor(() => expect(service.listCollectionRecipes).toHaveBeenCalledTimes(3));
  await act(async () => oldRefresh.resolve(page([membership(1)], 1, 1)));
  expect(view.getByText('Recipe 1')).toBeOnTheScreen();
  expect(require('react-native').Alert.alert).toHaveBeenCalledWith('Couldn’t remove recipe', 'Removal denied');
});

it('does not publish an old removal into a newly selected collection or account', async () => {
  const oldCollectionMutation = deferred();
  const oldAccountMutation = deferred();
  mockRemoveRecipe.mockReturnValueOnce(oldCollectionMutation.promise).mockReturnValueOnce(oldAccountMutation.promise);
  service.listCollectionRecipes.mockImplementation((id) => Promise.resolve(page(
    id === 'collection-b' || mockAuthState.user.id === 'owner-b' ? [membership(900)] : [membership(1)], 1, 1
  )));
  const view = render(screen());
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  view.rerender(screen('collection-b'));
  await waitFor(() => expect(view.getByText('Recipe 900')).toBeOnTheScreen());
  await act(async () => oldCollectionMutation.resolve({ ok: true }));
  expect(view.getByText('Recipe 900')).toBeOnTheScreen();
  expect(service.listCollectionRecipes.mock.calls.filter(([id]) => id === 'collection-a')).toHaveLength(1);

  view.rerender(screen('collection-a'));
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  mockAuthState = { status: 'authenticated', user: { id: 'owner-b' } };
  view.rerender(screen('collection-a'));
  await waitFor(() => expect(view.getByText('Recipe 900')).toBeOnTheScreen());
  await act(async () => oldAccountMutation.resolve({ ok: true }));
  expect(view.getByText('Recipe 900')).toBeOnTheScreen();
  expect(view.queryByText('Recipe 1')).toBeNull();
});

it('releases collection A controls on switching to B and ignores A completion', async () => {
  const oldMutation = deferred();
  mockRemoveRecipe.mockReturnValue(oldMutation.promise);
  service.listCollectionRecipes.mockImplementation((id) => Promise.resolve(page(
    [id === 'collection-a' ? membership(1) : membership(900)], 1, 1
  )));
  const view = render(screen());
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  view.rerender(screen('collection-b'));
  await waitFor(() => expect(view.getByText('Recipe 900')).toBeOnTheScreen());
  expect(view.getByLabelText('Remove Recipe 900 from collection').props.accessibilityState.disabled).toBe(false);
  expect(view.getByLabelText('Delete collection').props.accessibilityState.disabled).toBe(false);
  expect(view.UNSAFE_getByType(require('react-native').FlatList).props.refreshControl.props.enabled).toBe(true);
  await act(async () => oldMutation.resolve({ ok: false, error: 'Old failure' }));
  expect(view.getByText('Recipe 900')).toBeOnTheScreen();
  expect(view.getByText('1 collection entry')).toBeOnTheScreen();
  expect(view.queryByLabelText('Updating collection')).toBeNull();
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
  expect(service.listCollectionRecipes.mock.calls.filter(([id]) => id === 'collection-b')).toHaveLength(1);
});

it('does not let A completion release B mutation ownership', async () => {
  const oldMutation = deferred();
  const newMutation = deferred();
  mockRemoveRecipe.mockReturnValueOnce(oldMutation.promise).mockReturnValueOnce(newMutation.promise);
  service.listCollectionRecipes.mockImplementation((id) => Promise.resolve(page(
    [id === 'collection-a' ? membership(1) : membership(900)], 1, 1
  )));
  const view = render(screen());
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  view.rerender(screen('collection-b'));
  await waitFor(() => expect(view.getByLabelText('Remove Recipe 900 from collection')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Remove Recipe 900 from collection'));
  expect(mockRemoveRecipe).toHaveBeenNthCalledWith(2, 'collection-b', 'recipe-900');
  await act(async () => oldMutation.resolve({ ok: true }));
  expect(view.getByLabelText('Updating collection')).toBeOnTheScreen();
  expect(view.getByLabelText('Removing Recipe 900 from collection').props.accessibilityState).toEqual({ disabled: true, busy: true });
  fireEvent.press(view.getByLabelText('Removing Recipe 900 from collection'));
  expect(mockRemoveRecipe).toHaveBeenCalledTimes(2);
  await act(async () => newMutation.resolve({ ok: false, error: 'B failure' }));
  expect(view.getByText('Recipe 900')).toBeOnTheScreen();
  expect(view.getByLabelText('Remove Recipe 900 from collection').props.accessibilityState.disabled).toBe(false);
  expect(require('react-native').Alert.alert).toHaveBeenCalledWith(expect.any(String), 'B failure');
});

it('clears pending removal when authenticated account changes', async () => {
  const oldMutation = deferred();
  mockRemoveRecipe.mockReturnValue(oldMutation.promise);
  service.listCollectionRecipes.mockImplementation(() => Promise.resolve(page(
    [mockAuthState.user.id === 'owner-a' ? membership(1) : membership(900)], 1, 1
  )));
  const view = render(screen());
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  mockAuthState = { status: 'authenticated', user: { id: 'owner-b' } };
  view.rerender(screen());
  await waitFor(() => expect(view.getByText('Recipe 900')).toBeOnTheScreen());
  expect(view.getByLabelText('Remove Recipe 900 from collection').props.accessibilityState.disabled).toBe(false);
  expect(view.queryByLabelText('Updating collection')).toBeNull();
  await act(async () => oldMutation.resolve({ ok: false, error: 'Previous account failure' }));
  expect(view.getByText('Recipe 900')).toBeOnTheScreen();
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
});

it('restores current collection controls after blur and refocus with an old request pending', async () => {
  const oldMutation = deferred();
  mockRemoveRecipe.mockReturnValue(oldMutation.promise);
  service.listCollectionRecipes.mockResolvedValue(page([membership(1)], 1, 1));
  const view = render(screen());
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  mockFocused = false;
  view.rerender(screen());
  mockFocused = true;
  view.rerender(screen());
  await ready(view);
  expect(view.getByLabelText('Remove Recipe 1 from collection').props.accessibilityState.disabled).toBe(false);
  expect(view.queryByLabelText('Updating collection')).toBeNull();
  await act(async () => oldMutation.resolve({ ok: true }));
  expect(view.getByText('Recipe 1')).toBeOnTheScreen();
  expect(service.listCollectionRecipes).toHaveBeenCalledTimes(2);
});

it('can load page two again after a removal rebases page one', async () => {
  let deleted = false;
  service.listCollectionRecipes.mockImplementation((_id, params) => Promise.resolve(
    params.page === 1
      ? deleted
        ? page([...firstHundred.slice(1), membership(101)], 1, 101)
        : page(firstHundred, 1, 102)
      : deleted ? page([membership(102)], 2, 101) : page([membership(101), membership(102)], 2, 102)
  ));
  mockRemoveRecipe.mockImplementation(async () => { deleted = true; return { ok: true }; });
  const view = render(screen());
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  await waitFor(() => expect(view.getByText('101 collection entries')).toBeOnTheScreen());
  expect(view.queryByText('Recipe 1')).toBeNull();
  fireEvent.press(view.getByLabelText('Load more collection recipes'));
  await waitFor(() => expect(view.getByText('Recipe 102')).toBeOnTheScreen());
  expect(view.UNSAFE_getByType(require('react-native').FlatList).props.data).toHaveLength(101);
});

it('labels prefilter membership totals as entries when most referenced recipes are unusable', async () => {
  service.listCollectionRecipes.mockResolvedValue(page([membership(1)], 1, 7));
  const view = render(screen());
  await ready(view);
  expect(view.getByText('7 collection entries')).toBeOnTheScreen();
  expect(view.queryByText('7 recipes')).toBeNull();
  expect(view.UNSAFE_getByType(require('react-native').FlatList).props.data).toHaveLength(1);
});

it('does not publish a completed old removal after the detail screen unmounts', async () => {
  const mutation = deferred();
  service.listCollectionRecipes.mockResolvedValue(page([membership(1)], 1, 1));
  mockRemoveRecipe.mockReturnValue(mutation.promise);
  const view = render(screen());
  await ready(view);
  fireEvent.press(view.getByLabelText('Remove Recipe 1 from collection'));
  view.unmount();
  await act(async () => mutation.resolve({ ok: true }));
  expect(service.listCollectionRecipes).toHaveBeenCalledTimes(1);
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
});
