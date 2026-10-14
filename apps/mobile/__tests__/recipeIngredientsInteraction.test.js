const React = require('react');
let mockObservedText = null;

jest.mock('react-native', () => {
  const ReactModule = require('react');
  const host = (name) => ReactModule.forwardRef(({ children, ...props }, ref) =>
    ReactModule.createElement(name, { ...props, ref }, children));
  return {
    ActivityIndicator: host('ActivityIndicator'), Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    Text: ReactModule.forwardRef(({ children, ...props }, ref) => {
      if (mockObservedText) mockObservedText.push(children);
      return ReactModule.createElement('Text', { ...props, ref }, children);
    }),
    View: host('View'),
    StyleSheet: {
      create: (styles) => styles,
      flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    },
  };
});
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#333' }) }),
}));
let mockAuth = { status: 'authenticated', sessionIdentity: { ownerId: 'user-a', generation: 1, localSessionRevision: 1 } };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/components/TopBar', () => ({ title, onBack }) => {
  const ReactModule = require('react');
  return ReactModule.createElement('View', {},
    ReactModule.createElement('Text', {}, title),
    ReactModule.createElement('Pressable', { accessibilityLabel: 'Back', onPress: onBack }, 'Back'));
});
jest.mock('../src/api/recipeService', () => ({ getRecipe: jest.fn() }));
jest.mock('../src/api/recipeErrors', () => ({ getRecipeErrorMessage: () => 'Could not load recipe.' }));
jest.mock('../src/hooks/useRecipeScreenRefresh', () => jest.fn());

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { getRecipe } = require('../src/api/recipeService');
const useRecipeScreenRefresh = require('../src/hooks/useRecipeScreenRefresh');
const RecipeIngredientsScreen = require('../src/screens/RecipeIngredientsScreen').default;
const ID_A = '507f1f77bcf86cd799439099';
const ID_B = '507f1f77bcf86cd799439098';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function recipe(id = ID_A) {
  return { id, title: 'Fresh Adobo', ingredients: [
    { ingredient: { id: 'ingredient-1', name: 'Chicken' }, quantity: 1, unit: 'kg', note: null, optional: false },
    { ingredient: { id: null, name: 'Pepper' }, quantity: null, unit: 'toTaste', note: 'crushed', optional: true },
  ] };
}

function screen(id = ID_A, navigation = { goBack: jest.fn() }) {
  return render(<RecipeIngredientsScreen navigation={navigation} route={{ params: { recipeId: id } }} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockObservedText = null;
  mockAuth = { status: 'authenticated', sessionIdentity: { ownerId: 'user-a', generation: 1, localSessionRevision: 1 } };
});
afterEach(() => { mockObservedText = null; cleanup(); });

it('fetches fresh authenticated detail and shows only its ingredient rows', async () => {
  const pending = deferred();
  getRecipe.mockReturnValue(pending.promise);
  const navigation = { goBack: jest.fn() };
  const view = screen(ID_A, navigation);
  expect(getRecipe).toHaveBeenCalledWith(ID_A);
  expect(view.getByLabelText('Loading ingredients')).toBeOnTheScreen();
  await act(async () => pending.resolve(recipe()));
  expect(view.getByText('Fresh Adobo')).toBeOnTheScreen();
  expect(view.getByText('2 ingredients')).toBeOnTheScreen();
  expect(view.getByText('Chicken')).toBeOnTheScreen();
  expect(view.getByText('1 kg')).toBeOnTheScreen();
  expect(view.getByText('To taste')).toBeOnTheScreen();
  expect(view.getByText('crushed · optional')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Back'));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

it('rejects invalid route IDs without fetching', () => {
  const view = screen('mock-recipe');
  expect(getRecipe).not.toHaveBeenCalled();
  expect(view.getByText("This recipe isn't available anymore.")).toBeOnTheScreen();
});

it('shows retryable errors and retries with another fresh GET', async () => {
  const fresh = deferred();
  getRecipe.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(fresh.promise);
  const view = screen();
  await view.findByText('Could not load recipe.');
  const renderedText = [];
  mockObservedText = renderedText;
  fireEvent.press(view.getByLabelText('Try Again'));
  mockObservedText = null;
  expect(renderedText).not.toContain('Could not load recipe.');
  expect(view.queryByText('Could not load recipe.')).toBeNull();
  expect(view.getByLabelText('Loading ingredients')).toBeOnTheScreen();
  expect(getRecipe).toHaveBeenCalledTimes(2);
  await act(async () => fresh.resolve(recipe()));
  expect(view.getByText('Chicken')).toBeOnTheScreen();
});

it('does not render a mismatched detail response as this recipe', async () => {
  getRecipe.mockResolvedValue(recipe(ID_B));
  const view = screen(ID_A);
  await view.findByText('Could not load recipe. Please try again.');
  expect(view.queryByText('Chicken')).toBeNull();
});

it('treats a 404 as unavailable without offering stale ingredients', async () => {
  getRecipe.mockRejectedValue({ code: 'RECIPE_NOT_FOUND' });
  const view = screen();
  await view.findByText("This recipe isn't available anymore.");
  expect(view.queryByLabelText('Try Again')).toBeNull();
});

it('removes previously visible ingredients when focus refresh finds the recipe unavailable', async () => {
  const fresh = deferred();
  getRecipe.mockResolvedValueOnce(recipe()).mockReturnValueOnce(fresh.promise);
  const view = screen();
  await view.findByText('Chicken');
  const renderedText = [];
  mockObservedText = renderedText;
  await act(async () => useRecipeScreenRefresh.mock.calls.at(-1)[0]());
  mockObservedText = null;
  expect(renderedText).not.toContain('Chicken');
  expect(view.queryByText('Chicken')).toBeNull();
  expect(view.queryByText('Fresh Adobo')).toBeNull();
  expect(view.getByLabelText('Loading ingredients')).toBeOnTheScreen();
  await act(async () => fresh.reject({ code: 'RECIPE_NOT_FOUND' }));
  await view.findByText("This recipe isn't available anymore.");
  expect(view.queryByText('Chicken')).toBeNull();
});

it('discards an old route response after Recipe ID changes', async () => {
  const old = deferred();
  const fresh = deferred();
  getRecipe.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const navigation = { goBack: jest.fn() };
  const view = screen(ID_A, navigation);
  view.rerender(<RecipeIngredientsScreen navigation={navigation} route={{ params: { recipeId: ID_B } }} />);
  await act(async () => old.resolve({ ...recipe(ID_A), title: 'Stale Recipe' }));
  expect(view.queryByText('Stale Recipe')).toBeNull();
  await act(async () => fresh.resolve(recipe(ID_B)));
  expect(view.getByText('Fresh Adobo')).toBeOnTheScreen();
  expect(getRecipe).toHaveBeenNthCalledWith(2, ID_B);
});

it('hides data and discards an old response when the account changes', async () => {
  const old = deferred();
  const fresh = deferred();
  getRecipe.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const navigation = { goBack: jest.fn() };
  const view = screen(ID_A, navigation);
  mockAuth = { status: 'authenticated', sessionIdentity: { ownerId: 'user-b', generation: 2, localSessionRevision: 2 } };
  view.rerender(<RecipeIngredientsScreen navigation={navigation} route={{ params: { recipeId: ID_A } }} />);
  await act(async () => old.resolve({ ...recipe(), title: 'Old Account' }));
  expect(view.queryByText('Old Account')).toBeNull();
  await act(async () => fresh.resolve(recipe()));
  await waitFor(() => expect(view.getByText('Fresh Adobo')).toBeOnTheScreen());
});

it('discards a pending response after unmount', async () => {
  const pending = deferred();
  getRecipe.mockReturnValue(pending.promise);
  const view = screen();
  view.unmount();
  await act(async () => pending.resolve(recipe()));
  expect(getRecipe).toHaveBeenCalledTimes(1);
});
