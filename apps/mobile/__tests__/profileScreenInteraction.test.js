const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  return {
    View: host('View'), Text: host('Text'), Image: host('Image'),
    Pressable: host('Pressable'), ScrollView: host('ScrollView'),
    Alert: { alert: jest.fn() },
    StyleSheet: { create: (styles) => styles, flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {} },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/theme/ThemeContext', () => ({ useTheme: () => ({ colors: {
  cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333', inkFaint: '#666',
  hairline: '#ccc', onAccent: '#fff', sagePale: '#efe', sageDeep: '#353', error: '#900',
} }) }));
jest.mock('../src/components/NotificationsDropdown', () => 'NotificationsDropdown');

let mockAuth;
let mockFavorites;
let mockCollections;
let mockCookHistory;
let mockNotifications;
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/context/FavoritesContext', () => ({ useFavorites: () => mockFavorites }));
jest.mock('../src/context/CollectionsContext', () => ({ useCollections: () => mockCollections }));
jest.mock('../src/context/CookHistoryContext', () => ({ useCookHistory: () => mockCookHistory }));
jest.mock('../src/context/NotificationsContext', () => ({ useNotifications: () => mockNotifications }));

const { cleanup, fireEvent, render } = require('@testing-library/react-native');
const ProfileScreen = require('../src/screens/ProfileScreen').default;

const user = (id, name) => ({ id, name, email: `${id}@example.test`, avatarUrl: null,
  bio: `Cooking with ${name}`, cookingLevel: 'beginner', preferences: { dietaryPreferences: [], allergies: [] } });

beforeEach(() => {
  mockAuth = { user: user('a', 'Ada'), signOut: jest.fn() };
  mockFavorites = { favoriteIds: new Set(['recipe-1', 'recipe-2']), isInitializing: false, error: null };
  mockCollections = { collections: [{ id: 'collection-1' }], isInitializing: false, error: null };
  mockCookHistory = { stats: { uniqueRecipesCooked: 3 }, isInitializing: false, error: null };
  mockNotifications = { unreadCount: 2 };
});
afterEach(() => cleanup());

it('shows authenticated identity and real counts, and opens existing destinations', () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<ProfileScreen navigation={navigation} />);
  expect(view.getByText('Ada')).toBeOnTheScreen();
  expect(view.getByText('a@example.test')).toBeOnTheScreen();
  expect(view.getByLabelText('Recipes saved: 2')).toBeOnTheScreen();
  expect(view.getByLabelText('Collections: 1')).toBeOnTheScreen();
  expect(view.getByLabelText('Cooked: 3. Open cooking history')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Open saved recipes and collections'));
  fireEvent.press(view.getByLabelText('Open cooking history'));
  fireEvent.press(view.getByLabelText('Edit profile and preferences'));
  expect(navigation.navigate.mock.calls).toEqual([['Saved'], ['CookingHistory'], ['AccountDetails']]);
});

it('replaces identity and statistics on account change', () => {
  const view = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
  mockAuth = { user: user('b', 'Bea'), signOut: jest.fn() };
  mockFavorites = { favoriteIds: new Set(['recipe-3']), isInitializing: false, error: null };
  mockCollections = { collections: [], isInitializing: false, error: null };
  mockCookHistory = { stats: { uniqueRecipesCooked: 0 }, isInitializing: false, error: null };
  mockNotifications = { unreadCount: 0 };
  view.rerender(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
  expect(view.getByText('Bea')).toBeOnTheScreen();
  expect(view.queryByText('Ada')).toBeNull();
  expect(view.getByLabelText('Recipes saved: 1')).toBeOnTheScreen();
  expect(view.getByLabelText('Cooked: 0. Open cooking history')).toBeOnTheScreen();
});

it('shows unavailable counts during initialization and failures', () => {
  mockFavorites.isInitializing = true;
  mockCollections.error = new Error('offline');
  mockCookHistory.stats = null;
  const view = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
  expect(view.getByLabelText('Recipes saved: —')).toBeOnTheScreen();
  expect(view.getByLabelText('Collections: —')).toBeOnTheScreen();
  expect(view.getByLabelText('Cooked: —. Open cooking history')).toBeOnTheScreen();
});
