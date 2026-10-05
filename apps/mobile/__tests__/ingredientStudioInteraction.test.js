const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) =>
    React.createElement(name, { ...props, ref }, children));
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Pressable: host('Pressable'),
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
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cream: '#fff', paper: '#fff', ink: '#111', inkSoft: '#333', inkFaint: '#666',
      hairline: '#ccc', onAccent: '#fff', sagePale: '#efe', sageDeep: '#353',
      error: '#900',
    },
    shadow: { card: {} },
  }),
}));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/components/Badge', () => 'Badge');
jest.mock('../src/api/ingredientService', () => ({ searchIngredientsStrict: jest.fn() }));
jest.mock('../src/api/ingredientErrors', () => ({
  getIngredientErrorMessage: () => 'Ingredient search unavailable.',
}));
jest.mock('../src/api/substitutionService', () => ({ getSubstitutesFor: jest.fn() }));
jest.mock('../src/api/substitutionErrors', () => ({
  getSubstitutionErrorMessage: () => 'Substitution lookup unavailable.',
}));
let mockAuth = { status: 'authenticated', user: { id: 'user-a' } };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { searchIngredientsStrict } = require('../src/api/ingredientService');
const { getSubstitutesFor } = require('../src/api/substitutionService');
const IngredientStudioScreen = require('../src/screens/IngredientStudioScreen').default;

const A = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Apple' };
const B = { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Banana' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderStudio(navigate = jest.fn()) {
  return {
    ...render(<IngredientStudioScreen navigation={{ navigate, goBack: jest.fn() }} route={{ name: 'Swaps' }} />),
    navigate,
  };
}

async function runTimers(ms = 300) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

async function settle(request, method, value) {
  await act(async () => {
    request[method](value);
    await request.promise.catch(() => undefined);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAuth = { status: 'authenticated', user: { id: 'user-a' } };
  searchIngredientsStrict.mockResolvedValue({ ingredients: [], pagination: null });
  getSubstitutesFor.mockResolvedValue({ substitutes: [] });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it('shows the Assistant CTA only after the current nonblank strict search confirms []', async () => {
  const query = deferred();
  searchIngredientsStrict
    .mockResolvedValueOnce({ ingredients: [], pagination: null })
    .mockReturnValueOnce(query.promise);
  const view = renderStudio();
  await runTimers(0);

  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'dragon fruit');
  expect(view.queryByText('Ask Chef Assistant')).toBeNull();
  await runTimers();
  expect(view.queryByText('Ask Chef Assistant')).toBeNull();

  await settle(query, 'resolve', { ingredients: [], pagination: null });
  const action = view.getByLabelText('Ask Chef Assistant about dragon fruit');
  act(() => {
    action.props.onPress();
    action.props.onPress();
  });
  expect(view.navigate).toHaveBeenCalledTimes(1);
  expect(view.navigate).toHaveBeenCalledWith('Assistant', {
    initialPrompt: expect.stringContaining('dragon fruit'),
  });
});

it('treats malformed strict success as unavailable rather than unmatched', async () => {
  searchIngredientsStrict
    .mockResolvedValueOnce({ ingredients: [], pagination: null })
    .mockRejectedValueOnce(new Error('malformed'));
  const view = renderStudio();
  await runTimers(0);
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'mystery');
  await runTimers();
  await waitFor(() => expect(view.getByText(/Ingredient search unavailable/)).toBeOnTheScreen());
  expect(view.queryByText('Ask Chef Assistant')).toBeNull();
});

it('does not let stale search A restore selection or CTA after empty search B wins', async () => {
  const requestA = deferred();
  const requestB = deferred();
  searchIngredientsStrict
    .mockResolvedValueOnce({ ingredients: [], pagination: null })
    .mockReturnValueOnce(requestA.promise)
    .mockReturnValueOnce(requestB.promise);
  const view = renderStudio();
  await runTimers(0);

  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'apple');
  await runTimers();
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'banana');
  await runTimers();
  await settle(requestB, 'resolve', { ingredients: [], pagination: null });
  expect(view.getByLabelText('Ask Chef Assistant about banana')).toBeOnTheScreen();

  await settle(requestA, 'resolve', { ingredients: [A], pagination: null });
  expect(view.queryByText('Apple')).toBeNull();
  expect(view.getByLabelText('Ask Chef Assistant about banana')).toBeOnTheScreen();
});

it('does not let a stale search failure replace the current empty-search CTA', async () => {
  const requestA = deferred();
  searchIngredientsStrict
    .mockResolvedValueOnce({ ingredients: [], pagination: null })
    .mockReturnValueOnce(requestA.promise)
    .mockResolvedValueOnce({ ingredients: [], pagination: null });
  const view = renderStudio();
  await runTimers(0);
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'apple');
  await runTimers();
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'banana');
  await runTimers();
  await waitFor(() => expect(view.getByLabelText('Ask Chef Assistant about banana')).toBeOnTheScreen());
  await settle(requestA, 'reject', new Error('stale failure'));
  expect(view.getByLabelText('Ask Chef Assistant about banana')).toBeOnTheScreen();
  expect(view.queryByText(/Ingredient search unavailable/)).toBeNull();
});

it('does not render stale substitution A after search B selects a newer ingredient', async () => {
  const substitutionsA = deferred();
  const substitutionsB = deferred();
  searchIngredientsStrict
    .mockResolvedValueOnce({ ingredients: [], pagination: null })
    .mockResolvedValueOnce({ ingredients: [A], pagination: null })
    .mockResolvedValueOnce({ ingredients: [B], pagination: null });
  getSubstitutesFor
    .mockReturnValueOnce(substitutionsA.promise)
    .mockReturnValueOnce(substitutionsB.promise);
  const view = renderStudio();
  await runTimers(0);

  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'apple');
  await runTimers();
  await waitFor(() => expect(getSubstitutesFor).toHaveBeenCalledWith(A.id));
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'banana');
  await runTimers();
  await waitFor(() => expect(getSubstitutesFor).toHaveBeenCalledWith(B.id));

  await settle(substitutionsB, 'resolve', {
    substitutes: [{
      id: 'cccccccccccccccccccccccc', source: B,
      substitute: { id: 'dddddddddddddddddddddddd', name: 'Plantain' },
      contexts: ['cooking'], notes: null,
    }],
  });
  expect(view.getByText('Plantain')).toBeOnTheScreen();

  await settle(substitutionsA, 'resolve', {
    substitutes: [{
      id: 'eeeeeeeeeeeeeeeeeeeeeeee', source: A,
      substitute: { id: 'ffffffffffffffffffffffff', name: 'Pear' },
      contexts: ['baking'], notes: null,
    }],
  });
  expect(view.getByText('Plantain')).toBeOnTheScreen();
  expect(view.queryByText('Pear')).toBeNull();
});

it('does not render a stale substitution failure over the newer selected ingredient', async () => {
  const substitutionsA = deferred();
  searchIngredientsStrict
    .mockResolvedValueOnce({ ingredients: [], pagination: null })
    .mockResolvedValueOnce({ ingredients: [A], pagination: null })
    .mockResolvedValueOnce({ ingredients: [B], pagination: null });
  getSubstitutesFor
    .mockReturnValueOnce(substitutionsA.promise)
    .mockResolvedValueOnce({ substitutes: [] });
  const view = renderStudio();
  await runTimers(0);
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'apple');
  await runTimers();
  await waitFor(() => expect(getSubstitutesFor).toHaveBeenCalledWith(A.id));
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'banana');
  await runTimers();
  await waitFor(() => expect(view.getByText('No substitutions available')).toBeOnTheScreen());
  await settle(substitutionsA, 'reject', new Error('stale failure'));
  expect(view.getByText('No substitutions available')).toBeOnTheScreen();
  expect(view.queryByText(/Substitution lookup unavailable/)).toBeNull();
});

it.each([
  ['success', 'resolve', { ingredients: [A], pagination: null }],
  ['empty success', 'resolve', { ingredients: [], pagination: null }],
  ['failure', 'reject', new Error('late account-a failure')],
])('clears account A search state and ignores its late %s after a direct switch to B', async (
  _label,
  method,
  value
) => {
  const accountARequest = deferred();
  searchIngredientsStrict
    .mockResolvedValueOnce({ ingredients: [], pagination: null })
    .mockReturnValueOnce(accountARequest.promise)
    .mockResolvedValue({ ingredients: [], pagination: null });
  const view = renderStudio();
  await runTimers(0);
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'apple');
  await runTimers();

  mockAuth = { status: 'authenticated', user: { id: 'user-b' } };
  view.rerender(
    <IngredientStudioScreen
      navigation={{ navigate: view.navigate, goBack: jest.fn() }}
      route={{ name: 'Swaps' }}
    />
  );
  await act(async () => {});
  await runTimers(0);
  await settle(accountARequest, method, value);

  expect(view.getByLabelText('Search ingredient catalog').props.value).toBe('');
  expect(view.queryByText('Apple')).toBeNull();
  expect(view.queryByText('Ask Chef Assistant')).toBeNull();
  expect(view.queryByText(/Ingredient search unavailable/)).toBeNull();
  expect(view.queryByText(/Searching the ingredient catalog/)).toBeNull();
});

it.each([
  ['success', 'resolve', {
    substitutes: [{
      id: 'cccccccccccccccccccccccc', source: A,
      substitute: { id: 'dddddddddddddddddddddddd', name: 'Pear' },
      contexts: ['baking'], notes: null,
    }],
  }],
  ['failure', 'reject', new Error('late substitution failure')],
])('ignores account A substitution %s after a direct switch to B', async (_label, method, value) => {
  const accountASubstitutions = deferred();
  searchIngredientsStrict
    .mockResolvedValueOnce({ ingredients: [], pagination: null })
    .mockResolvedValueOnce({ ingredients: [A], pagination: null })
    .mockResolvedValue({ ingredients: [], pagination: null });
  getSubstitutesFor.mockReturnValueOnce(accountASubstitutions.promise);
  const view = renderStudio();
  await runTimers(0);
  fireEvent.changeText(view.getByLabelText('Search ingredient catalog'), 'apple');
  await runTimers();
  await waitFor(() => expect(getSubstitutesFor).toHaveBeenCalledWith(A.id));

  mockAuth = { status: 'authenticated', user: { id: 'user-b' } };
  view.rerender(
    <IngredientStudioScreen
      navigation={{ navigate: view.navigate, goBack: jest.fn() }}
      route={{ name: 'Swaps' }}
    />
  );
  await act(async () => {});
  await runTimers(0);
  await settle(accountASubstitutions, method, value);

  expect(view.queryByText('Apple')).toBeNull();
  expect(view.queryByText('Pear')).toBeNull();
  expect(view.queryByText(/Substitution lookup unavailable/)).toBeNull();
  expect(view.queryByText(/Loading catalog substitutions/)).toBeNull();
});
