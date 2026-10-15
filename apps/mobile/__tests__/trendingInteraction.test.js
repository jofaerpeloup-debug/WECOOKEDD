const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  const FlatList = React.forwardRef(({ data = [], renderItem, ListEmptyComponent, ListFooterComponent, ...props }, ref) => {
    const empty = typeof ListEmptyComponent === 'function' ? ListEmptyComponent() : ListEmptyComponent;
    const footer = typeof ListFooterComponent === 'function' ? ListFooterComponent() : ListFooterComponent;
    return React.createElement('FlatList', { ...props, data, renderItem, ref },
      data.length ? data.map((item, index) => <React.Fragment key={item.id}>{renderItem({ item, index })}</React.Fragment>) : empty,
      footer);
  });
  return {
    ActivityIndicator: host('ActivityIndicator'), FlatList, Pressable: host('Pressable'), RefreshControl: host('RefreshControl'),
    StyleSheet: { create: (styles) => styles, flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {} }, Text: host('Text'), View: host('View'),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/theme/ThemeContext', () => ({ useTheme: () => ({ colors: { cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333', hairline: '#ccc', sageDeep: '#353' } }) }));
let mockUser = { id: 'user-a' };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/FavoriteHeart', () => 'FavoriteHeart');
jest.mock('../src/api/recipeService', () => ({ listRecipes: jest.fn() }));
jest.mock('../src/api/recipeErrors', () => ({ getRecipeErrorMessage: () => 'Trending failed.' }));
jest.mock('../src/hooks/useRecipeScreenRefresh', () => jest.fn());

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
const TrendingScreen = require('../src/screens/TrendingScreen').default;

const recipe = (id, title, averageRating = 4.5, ratingCount = 2) => ({
  id, title, imageUrl: null, ratingSummary: { averageRating, ratingCount },
});
const page = (recipes, current = 1, totalPages = 1) => ({
  recipes,
  pagination: { page: current, limit: 20, total: recipes.length + (current - 1) * 20, totalPages },
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  mockUser = { id: 'user-a' };
  detectPostUnmountWrites = false;
  postUnmountWrites = 0;
  listRecipes.mockReset();
});
afterEach(cleanup);

it('renders loading and confirmed empty from the exact Top Rated request', async () => {
  const first = deferred();
  listRecipes.mockReturnValueOnce(first.promise);
  const view = render(<TrendingScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() }} />);
  expect(view.getByText('Loading Trending Meals…')).toBeOnTheScreen();
  await act(async () => first.resolve(page([])));
  expect(view.getByText('No rated recipes yet.')).toBeOnTheScreen();
  expect(listRecipes).toHaveBeenCalledWith({ sort: 'topRated', page: 1, limit: 20 });
});

it('renders an error and retries page one', async () => {
  listRecipes.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([]));
  const retryView = render(<TrendingScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() }} />);
  await retryView.findByText('Trending failed.');
  fireEvent.press(retryView.getByLabelText('Retry Trending Meals'));
  await retryView.findByText('No rated recipes yet.');
  expect(listRecipes).toHaveBeenCalledTimes(2);
});

it('preserves server order across pages, defensively dedupes, and navigates with authoritative identity', async () => {
  const first = recipe('a', 'Server First', 4.1, 2);
  const second = recipe('b', 'Server Second', 5, 99);
  const third = recipe('c', 'Server Third', 3, 1);
  listRecipes
    .mockResolvedValueOnce(page([first, second], 1, 2))
    .mockResolvedValueOnce(page([second, third], 2, 2));
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const view = render(<TrendingScreen navigation={navigation} />);
  await view.findByText('Server First');
  act(() => { void view.UNSAFE_getByType('FlatList').props.onEndReached(); });
  await view.findByText('Server Third');
  const labels = view.UNSAFE_getAllByType('Pressable')
    .map((node) => node.props.accessibilityLabel)
    .filter((label) => label?.startsWith('Open Server'));
  expect(labels).toEqual(['Open Server First', 'Open Server Second', 'Open Server Third']);
  expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'topRated', page: 2, limit: 20 });
  fireEvent.press(view.getByLabelText('Open Server Second'));
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeDetail', {
    recipeSource: 'api', recipeId: 'b', initialRecipe: second,
  });
});

it('refresh supersedes stale load-more and keeps the refreshed server order', async () => {
  const staleMore = deferred();
  const refresh = deferred();
  listRecipes
    .mockResolvedValueOnce(page([recipe('a', 'Initial')], 1, 2))
    .mockReturnValueOnce(staleMore.promise)
    .mockReturnValueOnce(refresh.promise);
  const view = render(<TrendingScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() }} />);
  await view.findByText('Initial');
  act(() => { void view.UNSAFE_getByType('FlatList').props.onEndReached(); });
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2));
  act(() => { void view.UNSAFE_getByType('FlatList').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(3));
  await act(async () => refresh.resolve(page([recipe('fresh', 'Refreshed')], 1, 1)));
  await view.findByText('Refreshed');
  await act(async () => staleMore.resolve(page([recipe('stale', 'Stale More')], 2, 2)));
  expect(view.queryByText('Stale More')).toBeNull();
  expect(view.getByText('Refreshed')).toBeOnTheScreen();
});

it('account change rejects the old first page and loads the new owner', async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  listRecipes.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const view = render(<TrendingScreen navigation={navigation} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  mockUser = { id: 'user-b' };
  view.rerender(<TrendingScreen navigation={navigation} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2));
  await act(async () => newRequest.resolve(page([recipe('new', 'New Owner')])));
  await act(async () => oldRequest.resolve(page([recipe('old', 'Old Owner')])));
  expect(view.getByText('New Owner')).toBeOnTheScreen();
  expect(view.queryByText('Old Owner')).toBeNull();
});

it.each(['resolve', 'reject'])(
  'does not write Trending state when page one settles after unmount by %s',
  async (method) => {
    const pending = deferred();
    listRecipes.mockReturnValueOnce(pending.promise);
    const view = render(<TrendingScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() }} />);
    await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
    view.unmount();
    detectPostUnmountWrites = true;
    await act(async () => {
      pending[method](method === 'resolve'
        ? page([recipe('late', 'Late')])
        : new Error('late'));
      await pending.promise.catch(() => undefined);
    });
    expect(postUnmountWrites).toBe(0);
  }
);
