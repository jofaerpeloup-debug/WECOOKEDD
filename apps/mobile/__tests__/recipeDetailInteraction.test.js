const React = require('react');
const mockAddRecipe = jest.fn();
const mockFavoritePress = jest.fn();

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
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => require('react').useEffect(() => callback(), [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }),
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
jest.mock('../src/components/SubstitutionsSheet', () => 'SubstitutionsSheet');
jest.mock('../src/components/CollectionPickerSheet', () => 'CollectionPickerSheet');
jest.mock('../src/components/MealPlanSheet', () => 'MealPlanSheet');
jest.mock('../src/components/Button', () => {
  const ReactModule = require('react');
  return ({ title, onPress }) => ReactModule.createElement(
    'Pressable', { accessibilityRole: 'button', accessibilityLabel: title, onPress }, title,
  );
});
jest.mock('../src/context/ShoppingListContext', () => ({
  useShoppingList: () => ({ addRecipe: mockAddRecipe, isMutating: false, pendingAction: null }),
}));
jest.mock('../src/api/recipeService', () => ({ getRecipe: jest.fn() }));
jest.mock('../src/api/recipeErrors', () => ({ getRecipeErrorMessage: () => 'Recipe request failed.' }));
jest.mock('../src/api/reviewService', () => ({
  getRecipeReviews: jest.fn(), createRecipeReview: jest.fn(), updateReview: jest.fn(),
}));
jest.mock('../src/api/reviewErrors', () => ({ getReviewErrorMessage: () => 'Review request failed.' }));
jest.mock('../src/api/cookHistoryService', () => ({ getRecipeStatus: jest.fn() }));
jest.mock('../src/hooks/useRecipeScreenRefresh', () => jest.fn());

const { cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { getRecipe } = require('../src/api/recipeService');
const { getRecipeReviews } = require('../src/api/reviewService');
const { getRecipeStatus } = require('../src/api/cookHistoryService');
const RecipeDetailScreen = require('../src/screens/RecipeDetailScreen').default;

function recipe(overrides = {}) {
  return {
    id: '507f1f77bcf86cd799439099', title: 'Chicken Adobo', description: 'Braised chicken.',
    difficulty: 'easy', prepTimeMinutes: 10, cookTimeMinutes: 30, servings: 4,
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
  getRecipeReviews.mockResolvedValue({
    summary: { averageRating: 0, ratingCount: 0 }, currentUserReview: null,
  });
  getRecipeStatus.mockResolvedValue({ hasCooked: false });
});

afterEach(() => cleanup());

it('renders all authoritative values per serving and keeps them stable when servings change', async () => {
  getRecipe.mockResolvedValue(recipe());
  const view = renderScreen();
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
  for (const value of ['320 kcal', '28 g', '12 g', '18 g', '3 g', '2 g']) {
    expect(view.getByText(value)).toBeTruthy();
  }
  expect(view.getByLabelText('Nutrition information, per serving').props.accessibilityState).toEqual({ expanded: true });
});

it('renders honest unavailability only for null nutrition', async () => {
  getRecipe.mockResolvedValue(recipe({ nutrition: null }));
  const view = renderScreen();
  await view.findByText('Chicken Adobo');
  fireEvent.press(view.getByLabelText('Nutrition information, per serving'));
  expect(view.getByText("Nutrition information isn't available for this recipe yet.")).toBeTruthy();
  expect(view.queryByText('320 kcal')).toBeNull();
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
  await waitFor(() => expect(mockAddRecipe).toHaveBeenCalledWith('507f1f77bcf86cd799439099'));
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
