const React = require('react');
const path = require('path');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => ({ children, ...props }) => React.createElement(name, props, children);
  const Platform = { OS: 'android' };
  Platform.select = (choices) => choices[Platform.OS] ?? choices.native ?? choices.default;
  return {
    View: host('View'), Text: host('Text'), Pressable: host('Pressable'),
    ScrollView: host('ScrollView'), KeyboardAvoidingView: host('KeyboardAvoidingView'),
    ActivityIndicator: host('ActivityIndicator'),
    AccessibilityInfo: { announceForAccessibility: jest.fn() },
    BackHandler: { addEventListener: () => ({ remove: jest.fn() }) },
    I18nManager: { getConstants: () => ({ isRTL: false }) },
    Linking: {
      getInitialURL: async () => null,
      addEventListener: () => ({ remove: jest.fn() }),
      getStateFromPath: () => undefined,
    },
    Platform,
    StyleSheet: {
      create: (styles) => styles,
      flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
}));
jest.mock('../src/theme/ThemeContext', () => ({ useTheme: () => ({
  isDark: false,
  colors: {
    cream: '#fff', paper: '#fff', ink: '#111', inkSoft: '#333', inkFaint: '#666',
    sageDeep: '#353', sage: '#797', stone: '#b82', onAccent: '#fff',
    hairline: '#ccc', error: '#900',
  },
}) }));
jest.mock('../src/theme/brandKit', () => ({ BowlMark: 'BowlMark', GoogleGlyph: 'GoogleGlyph' }));
jest.mock('../src/components/Input', () => ({
  __esModule: true,
  default: ({ label, error, ...props }) => require('react').createElement('Input', { label, error, ...props }),
  PasswordRequirements: () => null,
}));
jest.mock('../src/components/Button', () => ({
  __esModule: true,
  default: (props) => require('react').createElement('Button', props),
}));

let mockGoogle;
let mockSignUp;
let mockIsLoggedIn = false;
jest.mock('../src/hooks/useGoogleSignIn', () => ({
  __esModule: true, default: () => mockGoogle,
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ signUp: mockSignUp, isLoggedIn: mockIsLoggedIn }),
}));

const { act, cleanup, fireEvent, render } = require('@testing-library/react-native');
const RegisterScreen = require('../src/screens/RegisterScreen').default;
const { AccessibilityInfo, Platform } = require('react-native');

beforeEach(() => {
  Platform.OS = 'android';
  mockIsLoggedIn = false;
  AccessibilityInfo.announceForAccessibility.mockClear();
  mockSignUp = jest.fn().mockResolvedValue(undefined);
  mockGoogle = {
    ready: true, loading: false, error: null,
    cancel: jest.fn(), signIn: jest.fn().mockResolvedValue(undefined),
  };
});
afterEach(() => cleanup());

function fillValidForm(view) {
  for (const [label, value] of [
    ['Name', '  Ada Cook  '],
    ['Email', '  ada@example.com  '],
    ['Password', 'Generated1!'],
  ]) {
    const input = view.UNSAFE_getAllByType('Input').find((item) => item.props.label === label);
    fireEvent.changeText(input, value);
  }
}

it('requires acknowledgement before password signUp and sends the unchanged payload', async () => {
  const view = render(<RegisterScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} />);
  fillValidForm(view);
  fireEvent.press(view.UNSAFE_getByType('Button'));
  expect(mockSignUp).not.toHaveBeenCalled();
  expect(view.getByText('Acknowledge the Terms & Conditions and Privacy Policy to create an account.').props.accessibilityLiveRegion).toBe('polite');
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('I acknowledge the Terms & Conditions and Privacy Policy'));
  expect(view.getByLabelText('I acknowledge the Terms & Conditions and Privacy Policy').props.accessibilityState.checked).toBe(true);
  expect(view.queryByText('Acknowledge the Terms & Conditions and Privacy Policy to create an account.')).toBeNull();
  await act(async () => { fireEvent.press(view.UNSAFE_getByType('Button')); });
  expect(mockSignUp).toHaveBeenCalledTimes(1);
  expect(mockSignUp).toHaveBeenCalledWith({
    name: 'Ada Cook', email: 'ada@example.com', password: 'Generated1!',
  });
  fireEvent.press(view.getByLabelText('I acknowledge the Terms & Conditions and Privacy Policy'));
  fireEvent.press(view.UNSAFE_getByType('Button'));
  expect(mockSignUp).toHaveBeenCalledTimes(1);
  expect(view.getByText('Acknowledge the Terms & Conditions and Privacy Policy to create an account.')).toBeOnTheScreen();
});

it('announces an unchecked submit once on iOS and never from rerenders or valid submit', async () => {
  Platform.OS = 'ios';
  const view = render(<RegisterScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} />);
  fillValidForm(view);
  fireEvent.press(view.UNSAFE_getByType('Button'));
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
    'Acknowledge the Terms & Conditions and Privacy Policy to create an account.'
  );
  view.rerender(<RegisterScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} />);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('I acknowledge the Terms & Conditions and Privacy Policy'));
  await act(async () => { fireEvent.press(view.UNSAFE_getByType('Button')); });
  expect(mockSignUp).toHaveBeenCalledWith({
    name: 'Ada Cook', email: 'ada@example.com', password: 'Generated1!',
  });
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
});

it('keeps one password registration request in flight', async () => {
  let complete;
  mockSignUp.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const view = render(<RegisterScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} />);
  fillValidForm(view);
  fireEvent.press(view.getByLabelText('I acknowledge the Terms & Conditions and Privacy Policy'));
  fireEvent.press(view.UNSAFE_getByType('Button'));
  fireEvent.press(view.UNSAFE_getByType('Button'));
  expect(mockSignUp).toHaveBeenCalledTimes(1);
  await act(async () => { complete(); });
});

it('round-trips both guest legal screens and drops a guest legal route on auth transition', async () => {
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = (handle) => clearTimeout(handle);
  const nativeDir = path.dirname(require.resolve('@react-navigation/native/package.json'));
  for (const moduleName of ['useLinking', 'useDocumentTitle']) {
    jest.doMock(path.join(nativeDir, 'lib/module', `${moduleName}.js`), () =>
      require(path.join(nativeDir, 'lib/module', `${moduleName}.native.js`))
    );
  }
  const nativeStackDir = path.dirname(require.resolve('@react-navigation/native-stack/package.json'));
  // Keep the production native-stack navigator and StackRouter. The native
  // renderer is replaced with a host view so Jest can render real descriptors.
  jest.doMock(path.join(nativeStackDir, 'lib/module/views/NativeStackView.js'), () => ({
    NativeStackView: ({ state, descriptors }) => require('react').createElement(
      'NativeStackView', null,
      state.routes.map((route) => require('react').createElement(
        'RouteHost', { key: route.key, routeName: route.name },
        descriptors[route.key].render()
      ))
    ),
  }));
  jest.doMock('../src/components/TopBar', () => ({
    __esModule: true,
    default: ({ title, onBack }) => require('react').createElement('Pressable', {
      accessibilityLabel: `Back from ${title}`, onPress: onBack,
    }, title),
  }));
  for (const name of [
    'LandingScreen', 'LoginScreen', 'MainTabs', 'DiscoverScreen', 'TrendingScreen', 'SavedScreen',
    'CollectionDetailScreen', 'AssistantScreen', 'MealPlanScreen',
    'IngredientStudioScreen', 'SwapDetailScreen', 'RecipeDetailScreen',
    'RecipeReviewsScreen', 'CookingHistoryScreen', 'CookModeScreen',
    'ShoppingListScreen', 'AccountDetailScreen', 'SettingsScreen',
    'SecurityScreen', 'NotificationsScreen', 'HelpCenterScreen', 'AboutScreen',
    'LicensesScreen', 'ResetPasswordScreen', 'VerifyEmailScreen',
    'VerifyEmailChangeScreen',
  ]) {
    const path = name === 'MainTabs' ? '../src/navigation/MainTabs' : `../src/screens/${name}`;
    jest.doMock(path, () => ({ __esModule: true, default: function UnusedRoute() { return null; } }));
  }
  const RootNavigator = require('../src/navigation/RootNavigator').default;
  const { navigationRef } = require('../src/navigation/navigationRef');
  const view = render(<RootNavigator />);
  await act(async () => {});
  expect(navigationRef.isReady()).toBe(true);
  const routeNames = () => view.UNSAFE_getAllByType('RouteHost').map((item) => item.props.routeName);
  const draftValues = () => view.UNSAFE_getAllByType('Input').map((item) => item.props.value);
  expect(routeNames()).toEqual(['Landing']);

  await act(async () => { navigationRef.navigate('Register'); });
  expect(routeNames()).toEqual(['Landing', 'Register']);
  fillValidForm(view);
  const expectedDraft = ['  Ada Cook  ', '  ada@example.com  ', 'Generated1!'];
  expect(draftValues()).toEqual(expectedDraft);

  for (const [label, route, title] of [
    ['Terms & Conditions', 'Terms', 'Terms of Service'],
    ['Privacy Policy', 'Privacy', 'Privacy Policy'],
  ]) {
    fireEvent.press(view.getByLabelText(label));
    expect(routeNames()).toEqual(['Landing', 'Register', route]);
    expect(navigationRef.getCurrentRoute().name).toBe(route);
    expect(view.getByText(route === 'Terms' ? '1. Acceptance of Terms' : 'Information We Collect')).toBeOnTheScreen();
    expect(view.getByLabelText(`Back from ${title}`)).toBeOnTheScreen();
    fireEvent.press(view.getByLabelText(`Back from ${title}`));
    expect(routeNames()).toEqual(['Landing', 'Register']);
    expect(navigationRef.getCurrentRoute().name).toBe('Register');
    expect(draftValues()).toEqual(expectedDraft);
    expect(view.getByLabelText('I acknowledge the Terms & Conditions and Privacy Policy').props.accessibilityState.checked).toBe(false);
  }

  fireEvent.press(view.getByLabelText('Privacy Policy'));
  expect(navigationRef.getCurrentRoute().name).toBe('Privacy');
  mockIsLoggedIn = true;
  view.rerender(<RootNavigator />);
  expect(routeNames()).toEqual(['MainTabs']);
  expect(navigationRef.getCurrentRoute().name).toBe('MainTabs');

  await act(async () => { navigationRef.navigate('Terms'); });
  expect(routeNames()).toEqual(['MainTabs', 'Terms']);
  expect(view.getByLabelText('Back from Terms of Service')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Back from Terms of Service'));
  await act(async () => { navigationRef.navigate('Privacy'); });
  expect(routeNames()).toEqual(['MainTabs', 'Privacy']);
  expect(view.getByLabelText('Back from Privacy Policy')).toBeOnTheScreen();
});

it('leaves the existing Google flow available without client consent claims', async () => {
  const view = render(<RegisterScreen navigation={{ navigate: jest.fn(), setOptions: jest.fn() }} />);
  await act(async () => { fireEvent.press(view.getByLabelText('Continue with Google')); });
  expect(mockGoogle.signIn).toHaveBeenCalledTimes(1);
  expect(mockSignUp).not.toHaveBeenCalled();
});
