const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) =>
    React.forwardRef(({ children, ...props }, ref) =>
      React.createElement(name, { ...props, ref }, children)
    );
  const Modal = ({ visible, children, ...props }) =>
    visible ? React.createElement('Modal', props, children) : null;
  const FlatList = React.forwardRef(
    ({ data = [], renderItem, ListEmptyComponent, ListFooterComponent, ...props }, ref) => {
      const rows = data.length
        ? data.map((item, index) =>
            React.createElement(
              React.Fragment,
              { key: item.id || index },
              renderItem({ item, index })
            )
          )
        : ListEmptyComponent;
      return React.createElement('FlatList', { ...props, data, renderItem, ref }, rows, ListFooterComponent);
    }
  );

  return {
    ActivityIndicator: host('ActivityIndicator'),
    FlatList,
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Modal,
    Platform: { OS: 'ios', select: (spec) => spec?.ios ?? spec?.default },
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      absoluteFill: {},
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
      overlay: '#0008',
      error: '#900',
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

let mockRefreshCallback;
jest.mock('../src/hooks/useRecipeScreenRefresh', () =>
  jest.fn((callback) => {
    mockRefreshCallback = callback;
  })
);

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { api } = require('../src/api/client');
const { listRecipes } = require('../src/api/recipeService');
const { CATEGORY_OPTIONS, REGION_OPTIONS } = require('../src/utils/discoverFilters');
const DiscoverFiltersSheet = require('../src/components/DiscoverFiltersSheet').default;
const DiscoverScreen = require('../src/screens/DiscoverScreen').default;
const ingredientApiGet = api.get;

const emptyRecipePage = {
  recipes: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function advanceIngredientDebounce() {
  await act(async () => {
    jest.advanceTimersByTime(300);
    await Promise.resolve();
  });
}

async function settle(request, method, value) {
  await act(async () => {
    request[method](value);
    await request.promise.catch(() => undefined);
  });
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockRefreshCallback = undefined;
  ingredientApiGet.mockResolvedValue({
    ingredients: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
  });
  listRecipes.mockResolvedValue(emptyRecipePage);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it('searches the canonical Ingredient API after 300 ms and applies only a selected public id', async () => {
  const request = deferred();
  ingredientApiGet.mockReturnValue(request.promise);
  const { props, view } = renderSheet();

  expect(view.getByText('Ingredient')).toBeOnTheScreen();
  expect(view.getByText('Sort')).toBeOnTheScreen();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), '  garlic  ');
  act(() => jest.advanceTimersByTime(299));
  expect(ingredientApiGet).not.toHaveBeenCalled();

  await advanceIngredientDebounce();
  expect(ingredientApiGet).toHaveBeenCalledWith('/ingredients', {
    query: { search: 'garlic', limit: 20 },
  });
  expect(view.getByLabelText('Searching ingredients').props.accessibilityState).toEqual({ busy: true });

  await settle(request, 'resolve', {
    ingredients: [{ id: 'ingredient-garlic', name: 'Garlic', aliases: ['bawang'] }],
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
  });
  expect(view.getByText('Showing the first 1. Keep typing to narrow it down.')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Select ingredient Garlic'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));

  expect(props.onApply).toHaveBeenCalledWith({
    sort: 'titleAsc',
    ingredient: { id: 'ingredient-garlic', name: 'Garlic' },
  });
});

it('never turns typed-but-unselected Ingredient text into a Recipe filter', () => {
  const { props, view } = renderSheet();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'free text only');
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  expect(props.onApply).toHaveBeenCalledWith({ sort: 'titleAsc' });
});

it('renders Ingredient failure, explicit retry, and a truthful empty result', async () => {
  ingredientApiGet
    .mockRejectedValueOnce(new Error('private failure'))
    .mockResolvedValueOnce({
      ingredients: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
  const { view } = renderSheet();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'unknown');
  await advanceIngredientDebounce();

  expect(await view.findByText('Ingredient search failed.')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Retry ingredient search'));
  await advanceIngredientDebounce();

  expect(ingredientApiGet).toHaveBeenCalledTimes(2);
  expect(await view.findByText('No ingredients match “unknown”.')).toBeOnTheScreen();
});

it.each([
  ['missing data', undefined],
  ['missing collection', {}],
  ['null collection', { ingredients: null }],
  ['object collection', { ingredients: {} }],
  ['string collection', { ingredients: 'garlic' }],
  ['null id', { ingredients: [{ id: null, name: 'Garlic' }] }],
  ['object id', { ingredients: [{ id: {}, name: 'Garlic' }] }],
  ['array id', { ingredients: [{ id: [], name: 'Garlic' }] }],
  ['numeric id', { ingredients: [{ id: 123, name: 'Garlic' }] }],
  ['blank id', { ingredients: [{ id: '   ', name: 'Garlic' }] }],
  ['blank name', { ingredients: [{ id: 'ingredient-garlic', name: '   ' }] }],
])('renders Ingredient lookup unavailable for a malformed success payload: %s', async (_case, payload) => {
  ingredientApiGet.mockResolvedValue(payload);
  const { view } = renderSheet();

  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'garlic');
  await advanceIngredientDebounce();

  expect(await view.findByText('Ingredient search failed.')).toBeOnTheScreen();
  expect(view.queryByText(/No ingredients match/)).toBeNull();
  expect(view.queryByLabelText('Select ingredient Garlic')).toBeNull();
});

it.each(['resolve', 'reject'])(
  'drops an older Ingredient-search %s after a newer query owns the state',
  async (oldMethod) => {
    const oldRequest = deferred();
    const newRequest = deferred();
    ingredientApiGet
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const { view } = renderSheet();

    fireEvent.changeText(view.getByLabelText('Search ingredients'), 'old');
    await advanceIngredientDebounce();
    fireEvent.changeText(view.getByLabelText('Search ingredients'), 'onion');
    await advanceIngredientDebounce();
    await settle(newRequest, 'resolve', {
      ingredients: [{ id: 'ingredient-onion', name: 'Onion' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    await settle(
      oldRequest,
      oldMethod,
      oldMethod === 'resolve'
        ? {
            ingredients: [{ id: 'ingredient-old', name: 'Old result' }],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          }
        : new Error('old failure')
    );

    expect(view.getByLabelText('Select ingredient Onion')).toBeOnTheScreen();
    expect(view.queryByText('Old result')).toBeNull();
    expect(view.queryByText('Ingredient search failed.')).toBeNull();
  }
);

it('invalidates an in-flight Ingredient result across close and reopen', async () => {
  const oldRequest = deferred();
  ingredientApiGet.mockReturnValue(oldRequest.promise);
  const { props, view } = renderSheet();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'garlic');
  await advanceIngredientDebounce();

  fireEvent.press(view.getAllByLabelText('Close recipe filters')[1]);
  view.rerender(<DiscoverFiltersSheet {...props} visible={false} />);
  view.rerender(<DiscoverFiltersSheet {...props} visible />);
  await settle(oldRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-garlic', name: 'Garlic' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });

  expect(view.getByText('Type an ingredient name to search the WeCooked catalog.')).toBeOnTheScreen();
  expect(view.queryByText('Garlic')).toBeNull();
});

it('keeps the current visible search authoritative when a cleared request settles late', async () => {
  const clearedRequest = deferred();
  const currentRequest = deferred();
  ingredientApiGet
    .mockReturnValueOnce(clearedRequest.promise)
    .mockReturnValueOnce(currentRequest.promise);
  const { view } = renderSheet();

  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'old');
  await advanceIngredientDebounce();
  fireEvent.press(view.getByLabelText('Clear ingredient search'));
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'onion');
  await advanceIngredientDebounce();
  await settle(currentRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-onion', name: 'Onion' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  await settle(clearedRequest, 'reject', new Error('late cleared failure'));

  expect(view.getByLabelText('Select ingredient Onion')).toBeOnTheScreen();
  expect(view.queryByText('Ingredient search failed.')).toBeNull();
  expect(view.queryByLabelText('Searching ingredients')).toBeNull();
});

it('keeps selection and the later revisited search authoritative over an older request', async () => {
  const oldRequest = deferred();
  const selectionRequest = deferred();
  const revisitedRequest = deferred();
  ingredientApiGet
    .mockReturnValueOnce(oldRequest.promise)
    .mockReturnValueOnce(selectionRequest.promise)
    .mockReturnValueOnce(revisitedRequest.promise);
  const { view } = renderSheet();

  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'old');
  await advanceIngredientDebounce();
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'garlic');
  await advanceIngredientDebounce();
  await settle(selectionRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-garlic', name: 'Garlic' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  fireEvent.press(view.getByLabelText('Select ingredient Garlic'));
  expect(view.getByText('Garlic')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Clear ingredient Garlic'));
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'onion');
  await advanceIngredientDebounce();
  await settle(revisitedRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-onion', name: 'Onion' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  await settle(oldRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-old', name: 'Old result' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });

  expect(view.getByLabelText('Select ingredient Onion')).toBeOnTheScreen();
  expect(view.queryByText('Old result')).toBeNull();
  expect(view.queryByText('Ingredient search failed.')).toBeNull();
  expect(view.queryByLabelText('Searching ingredients')).toBeNull();
});

it('keeps a reopened current search authoritative when a pre-Apply request settles late', async () => {
  const preApplyRequest = deferred();
  const currentRequest = deferred();
  ingredientApiGet
    .mockReturnValueOnce(preApplyRequest.promise)
    .mockReturnValueOnce(currentRequest.promise);
  const { props, view } = renderSheet();

  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'old');
  await advanceIngredientDebounce();
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  expect(props.onApply).toHaveBeenCalledWith({ sort: 'titleAsc' });
  view.rerender(<DiscoverFiltersSheet {...props} visible={false} />);
  view.rerender(<DiscoverFiltersSheet {...props} visible />);
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'onion');
  await advanceIngredientDebounce();
  await settle(currentRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-onion', name: 'Onion' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  await settle(preApplyRequest, 'reject', new Error('late pre-Apply failure'));

  expect(view.getByLabelText('Select ingredient Onion')).toBeOnTheScreen();
  expect(view.queryByText('Ingredient search failed.')).toBeNull();
  expect(view.queryByLabelText('Searching ingredients')).toBeNull();
});

it('keeps a reopened current search authoritative when a pre-Cancel request settles late', async () => {
  const preCancelRequest = deferred();
  const currentRequest = deferred();
  ingredientApiGet
    .mockReturnValueOnce(preCancelRequest.promise)
    .mockReturnValueOnce(currentRequest.promise);
  const appliedFilters = {
    ingredient: { id: 'ingredient-garlic', name: 'Garlic' },
    sort: 'newest',
  };
  const { props, view } = renderSheet({ appliedFilters });

  fireEvent.press(view.getByLabelText('Clear ingredient Garlic'));
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'onion');
  await advanceIngredientDebounce();
  fireEvent.press(view.getByLabelText('Sort: Oldest added'));
  fireEvent.press(view.getAllByLabelText('Close recipe filters')[1]);

  expect(props.onApply).not.toHaveBeenCalled();
  expect(appliedFilters).toEqual({
    ingredient: { id: 'ingredient-garlic', name: 'Garlic' },
    sort: 'newest',
  });
  view.rerender(<DiscoverFiltersSheet {...props} visible={false} />);
  view.rerender(<DiscoverFiltersSheet {...props} visible />);
  expect(view.getByText('Garlic')).toBeOnTheScreen();
  expect(view.getByLabelText('Sort: Newest added').props.accessibilityState).toEqual({ selected: true });
  fireEvent.press(view.getByLabelText('Clear ingredient Garlic'));
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'carrot');
  await advanceIngredientDebounce();
  await settle(currentRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-carrot', name: 'Carrot' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  await settle(preCancelRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-old', name: 'Old result' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });

  expect(view.getByLabelText('Select ingredient Carrot')).toBeOnTheScreen();
  expect(view.queryByText('Old result')).toBeNull();
  expect(view.queryByText('Ingredient search failed.')).toBeNull();
  expect(view.queryByLabelText('Searching ingredients')).toBeNull();
});

it('isolates a fresh mount from a request owned by an unmounted sheet', async () => {
  const oldRequest = deferred();
  const freshRequest = deferred();
  ingredientApiGet
    .mockReturnValueOnce(oldRequest.promise)
    .mockReturnValueOnce(freshRequest.promise);
  const oldSheet = renderSheet();

  fireEvent.changeText(oldSheet.view.getByLabelText('Search ingredients'), 'old');
  await advanceIngredientDebounce();
  oldSheet.view.unmount();

  const freshSheet = renderSheet();
  fireEvent.changeText(freshSheet.view.getByLabelText('Search ingredients'), 'onion');
  await advanceIngredientDebounce();
  await settle(freshRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-onion', name: 'Onion' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  await settle(oldRequest, 'resolve', {
    ingredients: [{ id: 'ingredient-old', name: 'Old result' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });

  expect(freshSheet.view.getByLabelText('Select ingredient Onion')).toBeOnTheScreen();
  expect(freshSheet.view.queryByText('Old result')).toBeNull();
  expect(freshSheet.view.queryByText('Ingredient search failed.')).toBeNull();
  expect(freshSheet.view.queryByLabelText('Searching ingredients')).toBeNull();
});

it('keeps Reset draft-only and Cancel leaves onApply and applied filter state unchanged', () => {
  const appliedFilters = {
    ingredient: { id: 'ingredient-garlic', name: 'Garlic' },
    difficulty: 'hard',
    sort: 'newest',
  };
  const { props, view } = renderSheet({ appliedFilters });
  fireEvent.press(view.getByLabelText('Reset recipe filters'));

  expect(props.onApply).not.toHaveBeenCalled();
  expect(view.queryByText('Garlic')).toBeNull();
  expect(view.getByLabelText('Sort: Newest added').props.accessibilityState).toEqual({ selected: true });
  fireEvent.press(view.getAllByLabelText('Close recipe filters')[1]);
  expect(props.onApply).not.toHaveBeenCalled();
  expect(appliedFilters).toEqual({
    ingredient: { id: 'ingredient-garlic', name: 'Garlic' },
    difficulty: 'hard',
    sort: 'newest',
  });
  view.rerender(<DiscoverFiltersSheet {...props} visible={false} />);
  view.rerender(<DiscoverFiltersSheet {...props} visible />);
  expect(view.getByText('Garlic')).toBeOnTheScreen();
});

it('Cancel does not change the applied Discover request and reopening discards the draft', async () => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
  const view = render(<DiscoverScreen navigation={navigation} route={{ params: {} }} />);
  await waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(1));
  expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'titleAsc', page: 1, limit: 20 });

  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText('Sort: Newest added'));
  fireEvent.press(view.getAllByLabelText('Close recipe filters')[1]);
  await act(async () => Promise.resolve());

  expect(listRecipes).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Sorted by Title: A-Z')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Filters, none active'));
  expect(view.getByLabelText('Sort: Title: A-Z').props.accessibilityState).toEqual({ selected: true });
  expect(view.getByLabelText('Sort: Newest added').props.accessibilityState).toEqual({ selected: false });
});

it.each([
  ['Title: A-Z', 'titleAsc'],
  ['Title: Z-A', 'titleDesc'],
  ['Newest added', 'newest'],
  ['Oldest added', 'oldest'],
  ['Prep time: low to high', 'prepTimeAsc'],
  ['Prep time: high to low', 'prepTimeDesc'],
])('sends the exact frozen sort for %s', (label, value) => {
  const { props, view } = renderSheet();
  fireEvent.press(view.getByLabelText(`Sort: ${label}`));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  expect(props.onApply).toHaveBeenCalledWith({ sort: value });
  expect(view.queryByText('updatedDesc')).toBeNull();
  expect(view.queryByText(/Top Rated|Trending|Relevance|Most Popular|Best Match/i)).toBeNull();
});

it('composes search, every P3 family, Ingredient, sort, refresh, and totalPages load-more', async () => {
  const firstPage = {
    recipes: [{ id: 'recipe-1', title: 'One' }],
    pagination: { page: 1, limit: 20, total: 2, totalPages: 2 },
  };
  const secondPage = {
    recipes: [{ id: 'recipe-2', title: 'Two' }],
    pagination: { page: 2, limit: 20, total: 2, totalPages: 2 },
  };
  listRecipes.mockResolvedValue(firstPage);
  ingredientApiGet.mockResolvedValue({
    ingredients: [{ id: 'ingredient-garlic', name: 'Garlic' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const navigation = { goBack: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
  const route = { params: {} };
  const view = render(<DiscoverScreen navigation={navigation} route={route} />);
  await act(async () => Promise.resolve());

  fireEvent.changeText(view.getByLabelText('Search recipes'), '  adobo  ');
  await act(async () => {
    jest.advanceTimersByTime(300);
    await Promise.resolve();
  });
  fireEvent.press(view.getByLabelText('Filters, none active'));
  fireEvent.press(view.getByLabelText(`Region: ${REGION_OPTIONS[1].label}`));
  fireEvent.press(view.getByLabelText(`Category: ${CATEGORY_OPTIONS[1].label}`));
  fireEvent.press(view.getByLabelText('Difficulty: Hard'));
  fireEvent.press(view.getByLabelText('Dietary tag: Vegan'));
  fireEvent.changeText(view.getByLabelText('Maximum prep minutes, from 1 to 1440'), '45');
  fireEvent.changeText(view.getByLabelText('Search ingredients'), 'garlic');
  await advanceIngredientDebounce();
  expect(await view.findByLabelText('Select ingredient Garlic')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Select ingredient Garlic'));
  fireEvent.press(view.getByLabelText('Sort: Newest added'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));

  const composed = {
    search: 'adobo',
    region: REGION_OPTIONS[1].value,
    category: CATEGORY_OPTIONS[1].value,
    difficulty: 'hard',
    dietaryTag: 'vegan',
    maxPrepTimeMinutes: 45,
    ingredientId: 'ingredient-garlic',
    sort: 'newest',
    page: 1,
    limit: 20,
  };
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith(composed));
  expect(view.getByLabelText('Remove ingredient filter Garlic')).toBeOnTheScreen();
  expect(view.getByLabelText('Sorted by Newest added')).toBeOnTheScreen();

  listRecipes.mockResolvedValueOnce(firstPage);
  await act(async () => {
    mockRefreshCallback();
    await Promise.resolve();
  });
  await waitFor(() => expect(listRecipes).toHaveBeenLastCalledWith(composed));

  listRecipes.mockResolvedValueOnce(secondPage);
  await act(async () => {
    view.UNSAFE_getByType('FlatList').props.onEndReached();
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(listRecipes).toHaveBeenLastCalledWith({ ...composed, page: 2 })
  );

  fireEvent.press(view.getByLabelText('Remove ingredient filter Garlic'));
  await waitFor(() =>
    expect(listRecipes).toHaveBeenLastCalledWith({
      search: 'adobo',
      region: REGION_OPTIONS[1].value,
      category: CATEGORY_OPTIONS[1].value,
      difficulty: 'hard',
      dietaryTag: 'vegan',
      maxPrepTimeMinutes: 45,
      sort: 'newest',
      page: 1,
      limit: 20,
    })
  );
  expect(listRecipes.mock.calls.at(-1)[0]).not.toHaveProperty('ingredientId');

  fireEvent.press(view.getByLabelText('Clear search and filters'));
  await waitFor(() =>
    expect(listRecipes).toHaveBeenLastCalledWith({ sort: 'newest', page: 1, limit: 20 })
  );
});

it('renders real Recipe loading, failure/retry, and empty states', async () => {
  const failedRequest = deferred();
  listRecipes.mockReturnValueOnce(failedRequest.promise).mockResolvedValueOnce(emptyRecipePage);
  const navigation = { goBack: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
  const view = render(<DiscoverScreen navigation={navigation} route={{ params: {} }} />);

  expect(view.getByLabelText('Loading recipes').props.accessibilityState).toEqual({ busy: true });
  await settle(failedRequest, 'reject', new Error('private recipe failure'));
  expect(view.getByText('Recipe request failed.')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Retry loading recipes'));

  await waitFor(() => expect(view.getByText('Nothing matches')).toBeOnTheScreen());
  expect(view.getByText('No recipes match this filter yet.')).toBeOnTheScreen();
});

it('keeps the real compact Recipe row navigable with API route params', async () => {
  const recipe = {
    id: 'recipe-adobo',
    title: 'Chicken Adobo',
    imageUrl: 'https://api.example.test/adobo.jpg',
    category: 'dinner',
    region: 'bicol-region',
    prepTimeMinutes: 20,
    difficulty: 'easy',
  };
  listRecipes.mockResolvedValue({
    recipes: [recipe],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const navigation = { goBack: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
  const view = render(<DiscoverScreen navigation={navigation} route={{ params: {} }} />);

  await waitFor(() => expect(view.getByLabelText('Open Chicken Adobo')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Open Chicken Adobo'));
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeDetail', {
    recipeSource: 'api',
    recipeId: 'recipe-adobo',
    initialRecipe: recipe,
  });
  expect(view.UNSAFE_getByType('FavoriteHeart').props.recipe).toBe(recipe);
  expect(view.UNSAFE_getByType('RecipeImage').props.source).toBe(recipe.imageUrl);
});

it('gives the relevant DISC4 controls explicit 44-point effective targets', async () => {
  const applied = renderSheet({
    appliedFilters: {
      ingredient: { id: 'ingredient-garlic', name: 'Garlic' },
      sort: 'titleAsc',
    },
  });
  expect(flattenedStyle(applied.view.getByLabelText('Clear ingredient Garlic'))).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
  expect(flattenedStyle(applied.view.getByLabelText('Sort: Title: A-Z'))).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
  applied.view.unmount();

  ingredientApiGet.mockResolvedValue({
    ingredients: [{ id: 'ingredient-onion', name: 'Onion' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const searchable = renderSheet();
  fireEvent.changeText(searchable.view.getByLabelText('Search ingredients'), 'onion');
  expect(flattenedStyle(searchable.view.getByLabelText('Clear ingredient search'))).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
  await advanceIngredientDebounce();
  expect(
    flattenedStyle(await searchable.view.findByLabelText('Select ingredient Onion')).minHeight
  ).toBeGreaterThanOrEqual(44);
  searchable.view.unmount();

  listRecipes.mockResolvedValue({
    recipes: [{ id: 'recipe-1', title: 'Recipe One' }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const discover = render(
    <DiscoverScreen
      navigation={{ goBack: jest.fn(), navigate: jest.fn(), setParams: jest.fn() }}
      route={{ params: {} }}
    />
  );
  await waitFor(() => expect(discover.getByLabelText('Open Recipe One')).toBeOnTheScreen());
  expect(flattenedStyle(discover.getByLabelText('Filter recipes by All'))).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
  expect(flattenedStyle(discover.getByLabelText('Open Recipe One')).minHeight).toBeGreaterThanOrEqual(44);
  expect(flattenedStyle(discover.UNSAFE_getByType('FavoriteHeart'))).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
  fireEvent.changeText(discover.getByLabelText('Search recipes'), 'adobo');
  expect(flattenedStyle(discover.getByLabelText('Clear search'))).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
});

it('keeps an equivalent Dashboard preset to one initial request and preserves sort on later handoff', async () => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
  const initialRoute = { params: { initialFilter: 'vegan' } };
  const view = render(<DiscoverScreen navigation={navigation} route={initialRoute} />);
  await act(async () => Promise.resolve());

  expect(listRecipes).toHaveBeenCalledTimes(1);
  expect(listRecipes).toHaveBeenLastCalledWith({
    dietaryTag: 'vegan',
    sort: 'titleAsc',
    page: 1,
    limit: 20,
  });
  expect(navigation.setParams).toHaveBeenCalledWith({ initialFilter: undefined });

  fireEvent.press(view.getByLabelText('Filters, 1 active'));
  fireEvent.press(view.getByLabelText('Sort: Oldest added'));
  fireEvent.press(view.getByLabelText('Apply recipe filters'));
  await act(async () => Promise.resolve());
  view.rerender(
    <DiscoverScreen navigation={navigation} route={{ params: { initialFilter: 'easy' } }} />
  );
  await act(async () => Promise.resolve());

  expect(listRecipes).toHaveBeenLastCalledWith({
    difficulty: 'easy',
    sort: 'oldest',
    page: 1,
    limit: 20,
  });
});
