const React = require('react');
const mockAddRecipe = jest.fn();
const mockFavoritePress = jest.fn();
let mockPalette = null;
let mockAuth;
let mockUseRealShoppingList = false;

jest.mock('react-native', () => {
  const ReactModule = require('react');
  const host = (name) => ReactModule.forwardRef(({ children, ...props }, ref) => (
    ReactModule.createElement(name, { ...props, ref }, children)
  ));
  return {
    View: host('View'), Text: host('Text'), ScrollView: host('ScrollView'), Pressable: host('Pressable'),
    ActivityIndicator: host('ActivityIndicator'),
    StyleSheet: { create: (styles) => styles, flatten: (style) => style },
    Share: { share: jest.fn(() => Promise.resolve()) },
    Alert: { alert: jest.fn() },
    Platform: { OS: 'ios' },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => require('react').useEffect(() => callback(), [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({ colors: mockPalette || new Proxy({}, { get: () => '#000' }) }),
}));
jest.mock('../src/components/Badge', () => 'Badge');
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/FavoriteHeart', () => {
  const ReactModule = require('react');
  return ({ recipe: favoriteRecipe }) => ReactModule.createElement(
    'Pressable',
    {
      accessibilityRole: 'button',
      accessibilityLabel: 'Favorite recipe',
      onPress: () => mockFavoritePress(favoriteRecipe),
    },
    'Favorite',
  );
});
jest.mock('../src/components/CollectionPickerSheet', () => 'CollectionPickerSheet');
jest.mock('../src/components/MealPlanSheet', () => 'MealPlanSheet');
jest.mock('../src/components/Button', () => {
  const ReactModule = require('react');
  return ({ title, onPress, disabled }) => ReactModule.createElement(
    'Pressable', { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, title,
  );
});
jest.mock('../src/context/ShoppingListContext', () => {
  const actual = jest.requireActual('../src/context/ShoppingListContext');
  return { ...actual, useShoppingList: () => mockUseRealShoppingList ? actual.useShoppingList()
    : { addRecipe: mockAddRecipe, isMutating: false, pendingAction: null } };
});
jest.mock('../src/api/shoppingListService', () => ({ getShoppingList: jest.fn(), addRecipe: jest.fn() }));
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/api/recipeService', () => ({ getRecipe: jest.fn() }));
jest.mock('../src/api/recipeErrors', () => ({ getRecipeErrorMessage: () => 'Recipe request failed.' }));
jest.mock('../src/api/reviewService', () => ({
  getRecipeReviews: jest.fn(), createRecipeReview: jest.fn(), updateReview: jest.fn(),
}));
jest.mock('../src/api/reviewErrors', () => ({ getReviewErrorMessage: () => 'Review request failed.' }));
jest.mock('../src/api/cookHistoryService', () => ({ getRecipeStatus: jest.fn() }));
jest.mock('../src/hooks/useRecipeScreenRefresh', () => jest.fn());

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { getRecipe } = require('../src/api/recipeService');
const { getRecipeReviews } = require('../src/api/reviewService');
const { getRecipeStatus } = require('../src/api/cookHistoryService');
const { lightColors, darkColors } = require('../src/theme/theme');
const RecipeDetailScreen = require('../src/screens/RecipeDetailScreen').default;
const { ShoppingListProvider, useShoppingList } = require('../src/context/ShoppingListContext');
const shoppingListService = require('../src/api/shoppingListService');

function recipe(overrides = {}) {
  return {
    id: '507f1f77bcf86cd799439099', title: 'Chicken Adobo', description: 'Braised chicken.',
    difficulty: 'easy', prepTimeMinutes: 10, cookTimeMinutes: 30, servings: 4,
    updatedAt: '2026-10-14T00:00:00.000Z', cooking: null,
    ingredients: [{ ingredient: { id: 'i1', name: 'Chicken' }, quantity: 1, unit: 'kg', optional: false, note: null }],
    instructions: ['Simmer until tender.'], steps: [{ order: 1, text: 'Simmer until tender.' }],
    dietaryTags: [], region: null, category: null, imageUrl: null,
    nutrition: {
      schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
      carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
    },
    ...overrides,
  };
}

function renderScreen(navigation = { goBack: jest.fn(), navigate: jest.fn() }) {
  return render(<RecipeDetailScreen
    navigation={navigation}
    route={{ params: { recipeSource: 'api', recipeId: '507f1f77bcf86cd799439099' } }}
  />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPalette = null;
  mockUseRealShoppingList = false;
  mockAuth = { status: 'authenticated', user: { id: 'user-a' },
    sessionIdentity: { ownerId: 'user-a', generation: 1, localSessionRevision: 1 } };
  getRecipeReviews.mockResolvedValue({
    summary: { averageRating: 0, ratingCount: 0 }, currentUserReview: null,
  });
  getRecipeStatus.mockResolvedValue({ hasCooked: false });
});

afterEach(() => cleanup());

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('forwards a selected import through the real provider lock and ignores its old session result', async () => {
  mockUseRealShoppingList = true;
  const oldImport = deferred();
  const oldList = { id: 'old-list', items: [], createdAt: null, updatedAt: null };
  const newList = { ...oldList, id: 'new-list' };
  shoppingListService.getShoppingList.mockResolvedValueOnce(oldList).mockResolvedValue(newList);
  shoppingListService.addRecipe.mockReturnValue(oldImport.promise);
  getRecipe.mockResolvedValue(recipe());
  let context;
  function Observer() { context = useShoppingList(); return null; }
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const tree = () => <ShoppingListProvider><Observer /><RecipeDetailScreen navigation={navigation}
    route={{ params: { recipeSource: 'api', recipeId: recipe().id } }} /></ShoppingListProvider>;
  const view = render(tree());
  await view.findByText('Chicken Adobo');
  await waitFor(() => expect(context.isReady).toBe(true));
  const press = view.getByLabelText('Add ingredients to grocery list').props.onPress;
  act(() => { press(); press(); });
  expect(shoppingListService.addRecipe).toHaveBeenCalledTimes(1);
  expect(shoppingListService.addRecipe).toHaveBeenCalledWith(recipe().id, {
    servings: 4, expectedRecipeUpdatedAt: recipe().updatedAt,
  });
  mockAuth = { ...mockAuth, sessionIdentity: { ownerId: 'user-a', generation: 2, localSessionRevision: 2 } };
  view.rerender(tree());
  await waitFor(() => expect(context.list?.id).toBe('new-list'));
  await act(async () => oldImport.resolve(oldList));
  expect(context.list.id).toBe('new-list');
  expect(navigation.navigate).not.toHaveBeenCalled();
});

it.each(['account', 'relogin', 'route', 'unmount'])('ignores a pending detail GET after %s changes', async (change) => {
  const oldGet = deferred();
  getRecipe.mockReturnValueOnce(oldGet.promise).mockResolvedValue(recipe({ title: 'Current recipe' }));
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const view = renderScreen(navigation);
  if (change === 'unmount') view.unmount();
  else {
    const recipeId = change === 'route' ? '507f1f77bcf86cd799439098' : recipe().id;
    if (change === 'route') getRecipe.mockResolvedValue(recipe({ id: recipeId, title: 'Current recipe' }));
    if (change === 'account') mockAuth = { status: 'authenticated', user: { id: 'user-b' },
      sessionIdentity: { ownerId: 'user-b', generation: 2, localSessionRevision: 2 } };
    if (change === 'relogin') mockAuth = { ...mockAuth,
      sessionIdentity: { ownerId: 'user-a', generation: 2, localSessionRevision: 2 } };
    view.rerender(<RecipeDetailScreen navigation={navigation} route={{ params: { recipeSource: 'api', recipeId } }} />);
    await view.findByText('Current recipe');
  }
  await act(async () => oldGet.resolve(recipe({ title: 'Old recipe' })));
  if (change !== 'unmount') expect(view.queryByText('Old recipe')).toBeNull();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

it.each([{}, { servings: null }, { updatedAt: undefined }])('uses only supported serving/timestamp values for import %#', async (override) => {
  getRecipe.mockResolvedValue(recipe(override));
  mockAddRecipe.mockResolvedValue({ ok: true });
  const view = renderScreen();
  await view.findByText('Chicken Adobo');
  if (Object.keys(override).length) {
    expect(view.getByLabelText('Add ingredients to grocery list').props.disabled).toBe(true);
    return;
  }
  for (let index = 0; index < 4; index += 1) fireEvent.press(view.getByLabelText('Decrease servings'));
  expect(view.getByLabelText('Decrease servings').props.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Add ingredients to grocery list'));
  await waitFor(() => expect(mockAddRecipe.mock.calls[0][1].servings).toBe(1));
});

it('uses the complete authored spice list for detail, Cook Mode, and selected v2 import', async () => {
  const fullRecipe = recipe({
    ingredients: [{ ingredient: { id: 'i1', name: 'Chicken' }, quantity: 1, unit: 'kg', note: null, optional: false }],
    cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [{
      spiceLevel: 'hot', ingredients: [
        { ingredient: { id: 'i2', name: 'Chili' }, quantity: 2, unit: 'piece', note: 'chopped', optional: false },
        { ingredient: { id: 'i3', name: 'Garlic' }, quantity: 1, unit: 'clove', note: null, optional: true },
      ],
    }], stepTimers: [] },
  });
  getRecipe.mockResolvedValue(fullRecipe);
  mockAddRecipe.mockResolvedValue({ ok: true });
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = renderScreen(navigation);
  await view.findByText('Chicken Adobo');
  expect(view.getByText('Chicken')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Spice level hot'));
  expect(view.queryByText('Chicken')).toBeNull();
  expect(view.getByText('Chili')).toBeTruthy();
  expect(view.getByText('Garlic')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Nutrition information, per serving'));
  expect(view.getByText('Nutrition is available for the default spice level only.')).toBeTruthy();
  expect(view.queryByText('320 kcal')).toBeNull();
  fireEvent.press(view.getByLabelText('Increase servings'));
  expect(view.getByText('2.5 piece')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Start Cooking'));
  expect(navigation.navigate).toHaveBeenCalledWith('CookMode', expect.objectContaining({
    spiceLevel: 'hot', servings: 5, ingredients: expect.arrayContaining(['2.5 piece Chili (chopped)']),
  }));
  fireEvent.press(view.getByLabelText('Add ingredients to grocery list'));
  await waitFor(() => expect(mockAddRecipe).toHaveBeenCalledWith(fullRecipe.id, {
    servings: 5, spiceLevel: 'hot', expectedRecipeUpdatedAt: fullRecipe.updatedAt,
  }));
});

it('initializes the authored default when a list snapshot hydrates detail at the same timestamp', async () => {
  const pendingDetail = deferred();
  getRecipe.mockReturnValue(pendingDetail.promise);
  const initialRecipe = recipe();
  const profiled = recipe({ cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [], stepTimers: [] } });
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const view = render(<RecipeDetailScreen navigation={navigation} route={{ params: {
    recipeSource: 'api', recipeId: initialRecipe.id, initialRecipe,
  } }} />);
  expect(view.getByLabelText('Add ingredients to grocery list').props.disabled).toBe(true);
  await act(async () => pendingDetail.resolve(profiled));
  expect(view.getByLabelText('Spice level mild').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('Chicken')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Start Cooking'));
  expect(navigation.navigate).toHaveBeenCalledWith('CookMode', expect.objectContaining({ spiceLevel: 'mild' }));
});

it('keeps an unavailable Recipe hidden until a later refresh actually succeeds', async () => {
  const refreshed = deferred();
  getRecipe.mockRejectedValueOnce({ code: 'RECIPE_NOT_FOUND' }).mockReturnValueOnce(refreshed.promise);
  const view = render(<RecipeDetailScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() }}
    route={{ params: { recipeSource: 'api', recipeId: recipe().id, initialRecipe: recipe() } }} />);
  await view.findByText("This recipe isn't available anymore.");
  const refreshHook = require('../src/hooks/useRecipeScreenRefresh');
  act(() => refreshHook.mock.calls.at(-1)[0]());
  expect(view.queryByText('Chicken Adobo')).toBeNull();
  expect(view.queryByLabelText('Start Cooking')).toBeNull();
  await act(async () => refreshed.resolve(recipe({ title: 'Available again' })));
  expect(view.getByText('Available again')).toBeTruthy();
});

it('keeps an unprofiled recipe on its default list and omits spice from selected import', async () => {
  getRecipe.mockResolvedValue(recipe());
  mockAddRecipe.mockResolvedValue({ ok: true });
  const view = renderScreen();
  await view.findByText('Chicken Adobo');
  expect(view.queryByLabelText('Spice level mild')).toBeNull();
  fireEvent.press(view.getByLabelText('Add ingredients to grocery list'));
  await waitFor(() => expect(mockAddRecipe).toHaveBeenCalledWith('507f1f77bcf86cd799439099', {
    servings: 4, expectedRecipeUpdatedAt: '2026-10-14T00:00:00.000Z',
  }));
});

it('blocks a stale import until refreshed and hides a recipe removed during import', async () => {
  let resolveRefresh;
  getRecipe.mockResolvedValueOnce(recipe()).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
  mockAddRecipe.mockResolvedValueOnce({ ok: false, error: 'Recipe changed.', err: { code: 'RECIPE_STALE' } })
    .mockResolvedValueOnce({ ok: false, error: 'Recipe unavailable.', err: { code: 'RECIPE_NOT_FOUND' } });
  const view = renderScreen();
  await view.findByText('Chicken Adobo');
  fireEvent.press(view.getByLabelText('Add ingredients to grocery list'));
  await waitFor(() => expect(getRecipe).toHaveBeenCalledTimes(2));
  expect(view.getByLabelText('Add ingredients to grocery list').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Add ingredients to grocery list'));
  expect(mockAddRecipe).toHaveBeenCalledTimes(1);
  await require('@testing-library/react-native').act(async () => resolveRefresh(recipe({
    updatedAt: '2026-10-14T01:00:00.000Z',
  })));
  fireEvent.press(view.getByLabelText('Add ingredients to grocery list'));
  await waitFor(() => expect(view.getByText("This recipe isn't available anymore.")).toBeTruthy());
  expect(mockAddRecipe.mock.calls[1][1].expectedRecipeUpdatedAt).toBe('2026-10-14T01:00:00.000Z');
});

it('keeps instructions in the Cook Mode handoff without showing them on Detail', async () => {
  const steps = [
    'Heat oil.',
    'Simmer the sauce until deeply flavored while stirring every few minutes so the full instruction remains readable on a narrow screen.',
    'Fold gently.\nRest for ten minutes before serving.',
  ];
  const fullRecipe = recipe({ steps: steps.map((text, index) => ({ order: index + 1, text })) });
  getRecipe.mockResolvedValue(fullRecipe);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = renderScreen(navigation);
  await view.findByText(fullRecipe.title);
  for (const text of steps) {
    expect(view.queryByText(text)).toBeNull();
  }
  expect(view.queryByText('Instructions')).toBeNull();
  fireEvent.press(view.getByLabelText('Start Cooking'));
  expect(navigation.navigate).toHaveBeenCalledWith('CookMode', expect.objectContaining({
    recipe: fullRecipe,
  }));
});

it.each([['light', lightColors], ['dark', darkColors]])('keeps long Detail content and touch targets readable in %s palette', async (_mode, palette) => {
  mockPalette = palette;
  const longTitle = 'A long Filipino recipe title that must wrap on a narrow iPhone screen';
  const longDescription = 'A detailed description that continues across several lines without hiding the Ingredients section or controls.';
  const longName = 'Very long ingredient name with additional preparation details';
  getRecipe.mockResolvedValue(recipe({
    title: longTitle, description: longDescription, category: null,
    ingredients: [{ ingredient: { id: 'i1', name: longName }, quantity: 1, unit: 'kg', note: 'finely chopped', optional: true }],
  }));
  const view = renderScreen();
  await view.findByText(longTitle);

  expect(view.getByText(longDescription).props.style).toEqual(expect.objectContaining({ color: palette.inkSoft, marginTop: 8 }));
  expect(view.getByText('Time').parent.parent.props.style).toEqual(expect.objectContaining({ flex: 1, minWidth: 0 }));
  expect(view.getByText(longName).props.style).toEqual(expect.objectContaining({ flexShrink: 1, color: palette.ink }));
  expect(view.getByText('1 kg').props.style).toEqual(expect.objectContaining({ maxWidth: '35%', flexShrink: 1, textAlign: 'right' }));
  expect(view.getByText('finely chopped · optional')).toBeTruthy();
  expect(view.getByText('finely chopped · optional').props.style.color).toBe(palette.inkSoft);
  expect(view.getByText(longName).parent.parent.parent.props.style).toEqual(expect.objectContaining({ flex: 1, minWidth: 0 }));

  for (const label of ['Increase servings', 'Decrease servings']) {
    expect(view.getByLabelText(label).props.style).toEqual(expect.objectContaining({ width: 44, height: 44 }));
  }
  expect(view.queryByLabelText(`Find substitutes for ${longName}`)).toBeNull();
  expect(view.getByLabelText('Find swaps in Ingredient Studio').props.style).toEqual(expect.objectContaining({ minHeight: 44, backgroundColor: palette.sageLight }));
  expect(view.getByText('Need a substitute? Find swaps').props.style.color).toBe(palette.ink);
  for (const n of [1, 2, 3, 4, 5]) {
    expect(view.getByLabelText(`Rate ${n} star${n === 1 ? '' : 's'}`).props.style).toEqual(expect.objectContaining({ width: 44, height: 44 }));
  }
  expect(view.getByLabelText('Start Cooking')).toBeTruthy();
});

it('renders all authoritative values per serving and keeps them stable when servings change', async () => {
  getRecipe.mockResolvedValue(recipe());
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = renderScreen(navigation);
  await view.findByText('Chicken Adobo');

  const nutritionControl = view.getByLabelText('Nutrition information, per serving');
  expect(nutritionControl.props.accessibilityState).toEqual({ expanded: false });
  fireEvent.press(nutritionControl);
  expect(view.getByText('Per serving')).toBeTruthy();
  for (const value of ['320 kcal', '28 g', '12 g', '18 g', '3 g', '2 g']) {
    expect(view.getByText(value)).toBeTruthy();
  }

  fireEvent.press(view.getByLabelText('Increase servings'));
  await waitFor(() => expect(view.getAllByText('5').length).toBeGreaterThan(0));
  expect(view.getByText('1.25 kg')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Start Cooking'));
  expect(navigation.navigate).toHaveBeenCalledWith('CookMode', expect.objectContaining({
    servings: 5, ingredients: ['1.25 kg Chicken'],
  }));
  for (const value of ['320 kcal', '28 g', '12 g', '18 g', '3 g', '2 g']) {
    expect(view.getByText(value)).toBeTruthy();
  }
  expect(view.getByLabelText('Nutrition information, per serving').props.accessibilityState).toEqual({ expanded: true });
});

it.each([undefined, null, 0, -1, NaN, Infinity, '4', 1.5, 101])(
  'keeps supplied ingredient quantities unscaled for invalid base servings %#',
  async (base) => {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    getRecipe.mockResolvedValue(recipe({ servings: base }));
    const view = renderScreen(navigation);
    await view.findByText('Chicken Adobo');
    expect(view.getByText('1 kg')).toBeTruthy();
    expect(view.getByLabelText('Increase servings').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('Decrease servings').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(view.getByLabelText('Increase servings'));
    expect(view.getByText('1 kg')).toBeTruthy();
    fireEvent.press(view.getByLabelText('Start Cooking'));
    expect(navigation.navigate).toHaveBeenCalledWith('CookMode', expect.objectContaining({
      recipeSource: 'api', servings: null, ingredients: ['1 kg Chicken'],
    }));
    expect(require('react-native').Alert.alert).not.toHaveBeenCalledWith('Servings unavailable', expect.any(String));
  }
);

it('renders honest unavailability only for null nutrition', async () => {
  getRecipe.mockResolvedValue(recipe({ nutrition: null }));
  const view = renderScreen();
  await view.findByText('Chicken Adobo');
  fireEvent.press(view.getByLabelText('Nutrition information, per serving'));
  expect(view.getByText("Nutrition information isn't available for this recipe yet.")).toBeTruthy();
  expect(view.queryByText('320 kcal')).toBeNull();
});

it('does not turn missing time or blank ingredient IDs into stats or row controls', async () => {
  getRecipe.mockResolvedValue(recipe({
    prepTimeMinutes: null, cookTimeMinutes: null, difficulty: null, imageUrl: 'https://example.com/detail.jpg',
    ingredients: [{ ingredient: { id: ' ', name: 'Herbs' }, quantity: 1, unit: 'bunch', optional: true, note: 'fresh' }],
  }));
  const view = renderScreen();
  await view.findByText('Chicken Adobo');
  expect(view.UNSAFE_getByType('RecipeImage').props.source).toBe('https://example.com/detail.jpg');
  expect(view.queryByText('0 min')).toBeNull();
  expect(view.getAllByText('—')).toHaveLength(2);
  expect(view.getByText('fresh · optional')).toBeTruthy();
  expect(view.queryByLabelText('Find substitutes for Herbs')).toBeNull();
});

it.each([
  ['canonical', [{ ingredient: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Chicken' }, quantity: 1, unit: 'kg' }]],
  ['unlinked', [{ ingredient: { id: null, name: 'Herbs' }, quantity: 1, unit: 'bunch' }]],
  ['empty', []],
])('places Meal Plan before Find swaps and passes reduced recipe context for %s rows', async (_kind, ingredients) => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  getRecipe.mockResolvedValue(recipe({ ingredients }));
  const view = renderScreen(navigation);
  await view.findByText('Chicken Adobo');
  const nutrition = view.getByLabelText('Nutrition information, per serving');
  const swaps = view.getByLabelText('Find swaps in Ingredient Studio');
  const mealPlan = view.getByLabelText('Add to meal plan');
  const labels = [nutrition, swaps, mealPlan].map((node) => node.props.accessibilityLabel);
  const findSiblingLabels = (node) => {
    if (!node || typeof node !== 'object') return null;
    const children = node.children || [];
    const childLabels = children.map((child) => child?.props?.accessibilityLabel);
    if (labels.every((label) => childLabels.includes(label))) return childLabels;
    for (const child of children) {
      const found = findSiblingLabels(child);
      if (found) return found;
    }
    return null;
  };
  const siblingLabels = findSiblingLabels(view.toJSON());
  expect(siblingLabels).not.toBeNull();
  expect(siblingLabels.indexOf(labels[0])).toBeLessThan(siblingLabels.indexOf(labels[1]));
  expect(siblingLabels.indexOf(labels[2])).toBeLessThan(siblingLabels.indexOf(labels[1]));
  expect(swaps.props.accessibilityRole).toBe('button');
  expect(swaps.props.style.minHeight).toBeGreaterThanOrEqual(44);
  expect(view.queryByText('Substitutes')).toBeNull();
  expect(view.queryByLabelText('Find substitutes for Chicken')).toBeNull();
  expect(view.UNSAFE_queryAllByType('SubstitutionsSheet')).toHaveLength(0);
  fireEvent.press(swaps);
  expect(navigation.navigate).toHaveBeenCalledWith('IngredientStudio', {
    recipeContext: { recipeId: '507f1f77bcf86cd799439099', ingredients: ingredients.map((entry) => ({
      id: entry.ingredient.id || null, name: entry.ingredient.name,
    })) },
  });
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
});

it('keeps every existing Recipe Detail action mounted and wired with authoritative nutrition present', async () => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  mockAddRecipe.mockResolvedValue({ ok: true });
  getRecipe.mockResolvedValue(recipe());
  const view = renderScreen(navigation);
  await view.findByText('Chicken Adobo');

  fireEvent.press(view.getByLabelText('Favorite recipe'));
  expect(mockFavoritePress).toHaveBeenCalledWith(expect.objectContaining({
    id: '507f1f77bcf86cd799439099', nutrition: expect.objectContaining({ caloriesKcal: 320 }),
  }));

  expect(view.UNSAFE_getByType('CollectionPickerSheet').props.visible).toBe(false);
  fireEvent.press(view.getByLabelText('Add to a collection'));
  expect(view.UNSAFE_getByType('CollectionPickerSheet').props.visible).toBe(true);

  fireEvent.press(view.getByLabelText('Add ingredients to grocery list'));
  await waitFor(() => expect(mockAddRecipe).toHaveBeenCalledWith('507f1f77bcf86cd799439099', {
    servings: 4, expectedRecipeUpdatedAt: '2026-10-14T00:00:00.000Z',
  }));
  expect(navigation.navigate).toHaveBeenCalledWith('List');

  const { Share } = require('react-native');
  fireEvent.press(view.getByLabelText('Share recipe'));
  expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Chicken Adobo' }));

  expect(view.UNSAFE_getByType('MealPlanSheet').props.visible).toBe(false);
  fireEvent.press(view.getByText('Add to meal plan'));
  expect(view.UNSAFE_getByType('MealPlanSheet').props.visible).toBe(true);

  fireEvent.press(view.getByLabelText('Start Cooking'));
  expect(navigation.navigate).toHaveBeenCalledWith('CookMode', expect.objectContaining({
    recipeSource: 'api',
    recipe: expect.objectContaining({ id: '507f1f77bcf86cd799439099' }),
    servings: 4,
  }));
});
