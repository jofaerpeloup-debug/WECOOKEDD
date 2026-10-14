const React = require('react');
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

let mockAppStateListener;
const mockAppStateRemove = jest.fn();
let mockPreventRemoveState;
let mockAuth;

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) =>
    React.createElement(name, { ...props, ref }, children));
  return {
    AccessibilityInfo: { announceForAccessibility: jest.fn() },
    Alert: { alert: jest.fn() },
    AppState: {
      addEventListener: jest.fn((_event, listener) => {
        mockAppStateListener = listener;
        return { remove: mockAppStateRemove };
      }),
    },
    Platform: { OS: 'ios' },
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
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: jest.fn((enabled, callback) => {
    mockPreventRemoveState = { enabled, callback };
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cream: '#fff', creamDeep: '#eee', ink: '#111', inkSoft: '#333', inkFaint: '#666',
      hairline: '#ccc', onAccent: '#fff', sagePale: '#efe', sageDeep: '#353',
      stone: '#a70', error: '#900',
    },
  }),
}));
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/context/CookHistoryContext', () => ({
  useCookHistory: () => ({ recordCompletion: mockRecordCompletion }),
}));
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/api/cookHistoryErrors', () => ({
  getCookHistoryErrorMessage: (error) => error?.message || 'Could not save.',
}));
jest.mock('../src/utils/alert', () => ({ notify: jest.fn() }));

const { act, cleanup, fireEvent, render } = require('@testing-library/react-native');
const { AccessibilityInfo, Alert, AppState } = require('react-native');
const { notify } = require('../src/utils/alert');
const mockRecordCompletion = jest.fn();
const CookModeScreen = require('../src/screens/CookModeScreen').default;

const BASE_TIME = new Date('2026-10-07T00:00:00.000Z');

function recipe() {
  return {
    id: 'recipe-1',
    title: 'Adobo',
    servings: 2,
    imageUrl: 'https://example.test/adobo.jpg',
    steps: [
      { order: 1, text: 'Brown the chicken.' },
      { order: 2, text: 'Simmer until tender.' },
    ],
    ingredients: [],
  };
}

function renderCookMode(routeParams = null) {
  const navigation = {
    dispatch: jest.fn(),
    goBack: jest.fn(),
  };
  mockPreventRemoveState = { enabled: false, callback: null };
  const view = render(
    <CookModeScreen
      navigation={navigation}
      route={{ params: routeParams || { recipeSource: 'api', recipe: recipe(), servings: 2, ingredients: [] } }}
    />
  );
  const attemptRemoval = (action) => {
    if (!mockPreventRemoveState.enabled) return false;
    mockPreventRemoveState.callback({ data: { action } });
    return true;
  };
  return { ...view, attemptRemoval, navigation };
}

function enterDuration(view, { hours = '', minutes = '', seconds = '' }) {
  fireEvent.changeText(view.getByLabelText('Hours'), hours);
  fireEvent.changeText(view.getByLabelText('Minutes'), minutes);
  fireEvent.changeText(view.getByLabelText('Seconds'), seconds);
}

function startTimer(view, duration = { seconds: '10' }) {
  enterDuration(view, duration);
  fireEvent.press(view.getByLabelText('Start timer'));
}

function removalAction(type = 'GO_BACK') {
  return { type };
}

function loadInstalledNavigationCoreModule(filename, stubs = {}) {
  const nativeRoot = path.dirname(require.resolve('@react-navigation/native/package.json'));
  const modulePath = path.join(
    nativeRoot,
    'node_modules',
    '@react-navigation',
    'core',
    'lib',
    'module',
    filename
  );
  const transformed = babel.transformSync(fs.readFileSync(modulePath, 'utf8'), {
    filename: modulePath,
    babelrc: false,
    configFile: false,
    presets: [require('babel-preset-expo')],
    caller: { name: 'babel-jest', supportsStaticESM: false },
  });
  const loaded = { exports: {} };
  const moduleRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return require(request);
  };
  Function('require', 'exports', 'module', transformed.code)(
    moduleRequire,
    loaded.exports,
    loaded
  );
  return loaded.exports;
}

function latestDiscardActions() {
  return Alert.alert.mock.calls.at(-1)[2];
}

function enterFinalStep(view) {
  fireEvent.press(view.getByText('Start cooking'));
  fireEvent.press(view.getByText('Next Step'));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(BASE_TIME);
  jest.clearAllMocks();
  mockAppStateListener = undefined;
  mockPreventRemoveState = { enabled: false, callback: null };
  mockRecordCompletion.mockResolvedValue(undefined);
  mockAuth = { status: 'authenticated', user: { id: 'user-a' },
    sessionIdentity: { ownerId: 'user-a', generation: 1, localSessionRevision: 1 } };
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('shows only the exact authored step/servings/spice preset and retains manual fallback', () => {
  const profiled = {
    ...recipe(),
    ingredients: [{ ingredient: { id: 'i1', name: 'Chicken' }, quantity: 1, unit: 'kg' }],
    cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild', spiceAlternatives: [{
      spiceLevel: 'hot', ingredients: [{ ingredient: { id: 'i2', name: 'Chili' }, quantity: 2, unit: 'piece' }],
    }], stepTimers: [
      { stepOrder: 2, servings: 5, spiceLevel: 'hot', durationSeconds: 90 },
      { stepOrder: 2, servings: 2, spiceLevel: 'hot', durationSeconds: 60 },
      { stepOrder: 1, servings: 5, spiceLevel: 'mild', durationSeconds: 30 },
    ] },
  };
  const view = renderCookMode({ recipeSource: 'api', recipe: profiled, servings: 5, spiceLevel: 'hot', ingredients: [] });
  expect(view.getByText('Chili')).toBeTruthy();
  expect(view.queryByText('Chicken')).toBeNull();
  fireEvent.press(view.getByText('Start cooking'));
  expect(view.queryByLabelText('Start step timer for 01:30')).toBeNull();
  expect(view.getByLabelText('Start timer')).toBeTruthy();
  fireEvent.press(view.getByText('Next Step'));
  fireEvent.press(view.getByLabelText('Start step timer for 01:30'));
  expect(view.getByText('01:30')).toBeTruthy();
  expect(view.queryByLabelText('Start timer')).toBeNull();
  expect(mockRecordCompletion).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Back'));
  expect(view.getByText('01:30')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Reset timer'));
  expect(view.getByLabelText('Start timer')).toBeTruthy();
});

it('uses a null spice tuple for a timer-only profile and requires an explicit start', () => {
  const profiled = { ...recipe(), cooking: { schemaVersion: 1, defaultSpiceLevel: null,
    spiceAlternatives: [], stepTimers: [{ stepOrder: 1, servings: 2, spiceLevel: null, durationSeconds: 12 }] } };
  const view = renderCookMode({ recipeSource: 'api', recipe: profiled, servings: 2 });
  fireEvent.press(view.getByText('Start cooking'));
  expect(view.queryByLabelText('Pause timer')).toBeNull();
  fireEvent.press(view.getByLabelText('Start step timer for 00:12'));
  expect(view.getByText('00:12')).toBeTruthy();
  expect(mockRecordCompletion).not.toHaveBeenCalled();
});

it('rejects a spice selection absent from the fetched profile without substituting the default', () => {
  const profiled = { ...recipe(), cooking: { schemaVersion: 1, defaultSpiceLevel: 'mild',
    spiceAlternatives: [], stepTimers: [] } };
  const view = renderCookMode({ recipeSource: 'api', recipe: profiled, spiceLevel: 'hot' });
  expect(view.getByText('That spice level is no longer available. Return to the recipe and choose again.')).toBeTruthy();
  expect(view.queryByText('Start cooking')).toBeNull();
  expect(view.queryByLabelText('Start timer')).toBeNull();
});

it.each(['route', 'relogin', 'account', 'logout'])('discards timer state and suppresses delayed Finish feedback after %s changes', async (change) => {
  let resolveCompletion;
  mockRecordCompletion.mockReturnValue(new Promise((resolve) => { resolveCompletion = resolve; }));
  const params = { recipeSource: 'api', recipe: recipe(), servings: 2 };
  const view = renderCookMode(params);
  startTimer(view);
  enterFinalStep(view);
  fireEvent.press(view.getByText('Finish Cooking'));
  if (change === 'route') params.recipe = { ...recipe(), id: 'recipe-2', title: 'New recipe' };
  if (change === 'relogin') mockAuth = { ...mockAuth,
    sessionIdentity: { ownerId: 'user-a', generation: 2, localSessionRevision: 2 } };
  if (change === 'account') mockAuth = { status: 'authenticated', user: { id: 'user-b' },
    sessionIdentity: { ownerId: 'user-b', generation: 2, localSessionRevision: 2 } };
  if (change === 'logout') mockAuth = { status: 'anonymous', user: null, sessionIdentity: null };
  view.rerender(<CookModeScreen navigation={view.navigation} route={{ params }} />);
  await act(async () => resolveCompletion());
  expect(notify).not.toHaveBeenCalled();
  expect(view.navigation.goBack).not.toHaveBeenCalled();
  if (change === 'logout') expect(view.getByText('Please log in to cook.')).toBeTruthy();
  else expect(view.getByLabelText('Start timer')).toBeTruthy();
  act(() => jest.advanceTimersByTime(10000));
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

it('starts only from valid explicit input and rejects zero, malformed, and overflowing entry', () => {
  const view = renderCookMode();
  fireEvent.press(view.getByLabelText('Start timer'));
  expect(view.getByText('Enter a duration from 00:00:01 to 03:00:00.')).toBeOnTheScreen();
  expect(view.queryByLabelText('Pause timer')).toBeNull();

  fireEvent.changeText(view.getByLabelText('Seconds'), '1e');
  fireEvent.press(view.getByLabelText('Start timer'));
  expect(view.queryByLabelText('Pause timer')).toBeNull();

  fireEvent.changeText(view.getByLabelText('Seconds'), '123');
  fireEvent.press(view.getByLabelText('Start timer'));
  expect(view.queryByLabelText('Pause timer')).toBeNull();

  enterDuration(view, { seconds: '1' });
  fireEvent.press(view.getByLabelText('Start timer'));
  expect(view.getByLabelText('Timer running, 00:01 remaining')).toBeOnTheScreen();
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();
});

it('derives delayed running display from one absolute target without cumulative decrement drift', () => {
  const view = renderCookMode();
  startTimer(view);
  expect(view.getByText('00:10')).toBeOnTheScreen();

  act(() => {
    jest.setSystemTime(new Date(BASE_TIME.getTime() + 7250));
    jest.advanceTimersByTime(250);
  });
  expect(view.getByText('00:03')).toBeOnTheScreen();

  act(() => {
    jest.setSystemTime(new Date(BASE_TIME.getTime() + 9999));
    jest.advanceTimersByTime(250);
  });
  expect(view.getByText('Timer complete')).toBeOnTheScreen();
});

it('pauses from the absolute clock, freezes while paused, and resumes with a new target', () => {
  const view = renderCookMode();
  startTimer(view);
  act(() => jest.advanceTimersByTime(2000));
  fireEvent.press(view.getByLabelText('Pause timer'));
  expect(view.getByLabelText('Timer paused, 00:08 remaining')).toBeOnTheScreen();

  act(() => jest.advanceTimersByTime(5000));
  expect(view.getByLabelText('Timer paused, 00:08 remaining')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Resume timer'));
  act(() => jest.advanceTimersByTime(1000));
  expect(view.getByLabelText('Timer running, 00:07 remaining')).toBeOnTheScreen();
});

it('resumes an exact positive sub-second remainder instead of treating it as a new-duration validation', () => {
  const view = renderCookMode();
  startTimer(view, { seconds: '1' });
  act(() => jest.advanceTimersByTime(250));
  jest.setSystemTime(new Date(BASE_TIME.getTime() + 751));
  fireEvent.press(view.getByLabelText('Pause timer'));
  expect(view.getByLabelText('Timer paused, 00:01 remaining')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Resume timer'));
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();
  act(() => jest.advanceTimersByTime(250));
  expect(view.getByText('Timer complete')).toBeOnTheScreen();
});

it('completes exactly once at authoritative expiry without changing steps or writing Cook History', () => {
  const view = renderCookMode();
  fireEvent.press(view.getByText('Start cooking'));
  expect(view.getByText('Brown the chicken.')).toBeOnTheScreen();
  startTimer(view, { seconds: '1' });

  act(() => jest.advanceTimersByTime(1000));
  expect(view.getByText('Timer complete')).toBeOnTheScreen();
  expect(view.getByLabelText('Reset timer')).toBeOnTheScreen();
  expect(view.getByText('Brown the chicken.')).toBeOnTheScreen();
  expect(view.queryByText('Simmer until tender.')).toBeNull();
  expect(mockRecordCompletion).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Timer complete');

  act(() => {
    jest.advanceTimersByTime(5000);
    mockAppStateListener('active');
    mockAppStateListener('active');
  });
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
});

it.each([
  ['RUNNING', (view) => startTimer(view)],
  ['PAUSED', (view) => { startTimer(view); fireEvent.press(view.getByLabelText('Pause timer')); }],
  ['COMPLETED', (view) => { startTimer(view, { seconds: '1' }); act(() => jest.advanceTimersByTime(1000)); }],
])('Reset clears input and all timer state from %s', (_state, arrange) => {
  const view = renderCookMode();
  arrange(view);
  fireEvent.press(view.getByLabelText('Reset timer'));
  expect(view.getByLabelText('Hours').props.value).toBe('');
  expect(view.getByLabelText('Minutes').props.value).toBe('');
  expect(view.getByLabelText('Seconds').props.value).toBe('');
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
  expect(view.queryByLabelText('Pause timer')).toBeNull();
  expect(view.queryByLabelText('Resume timer')).toBeNull();
  expect(view.queryByLabelText('Reset timer')).toBeNull();
});

it('foreground reconciliation catches an elapsed target after interval callbacks are absent', () => {
  const view = renderCookMode();
  startTimer(view, { seconds: '5' });
  jest.clearAllTimers();
  act(() => {
    jest.setSystemTime(new Date(BASE_TIME.getTime() + 6000));
    mockAppStateListener('active');
  });
  expect(view.getByText('Timer complete')).toBeOnTheScreen();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
});

it('a captured interval callback is inert after Reset', () => {
  const intervalSpy = jest.spyOn(global, 'setInterval');
  const view = renderCookMode();
  startTimer(view, { seconds: '1' });
  const staleInterval = intervalSpy.mock.calls.at(-1)[0];

  fireEvent.press(view.getByLabelText('Reset timer'));
  act(() => {
    jest.setSystemTime(new Date(BASE_TIME.getTime() + 5000));
    staleInterval();
  });

  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
  expect(view.queryByText('Timer complete')).toBeNull();
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

it('a captured interval callback is inert after unmount', () => {
  const intervalSpy = jest.spyOn(global, 'setInterval');
  const view = renderCookMode();
  startTimer(view, { seconds: '1' });
  const staleInterval = intervalSpy.mock.calls.at(-1)[0];

  view.unmount();
  act(() => {
    jest.setSystemTime(new Date(BASE_TIME.getTime() + 5000));
    staleInterval();
  });

  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
});

it.each([
  ['RUNNING', (view) => startTimer(view)],
  ['PAUSED with time remaining', (view) => {
    startTimer(view);
    fireEvent.press(view.getByLabelText('Pause timer'));
  }],
])('enables the supported removal flow for %s', (_state, arrange) => {
  const view = renderCookMode();
  arrange(view);

  let prevented;
  act(() => { prevented = view.attemptRemoval(removalAction()); });

  expect(prevented).toBe(true);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
});

it('owns one prompt and retains the first action across repeated active removals', () => {
  const view = renderCookMode();
  startTimer(view);
  const backA = removalAction('BACK_A');
  const backB = removalAction('BACK_B');
  const backC = removalAction('BACK_C');

  act(() => {
    expect(view.attemptRemoval(backA)).toBe(true);
    expect(view.attemptRemoval(backB)).toBe(true);
    expect(view.attemptRemoval(backC)).toBe(true);
  });
  expect(Alert.alert).toHaveBeenCalledTimes(1);

  act(() => latestDiscardActions()[1].onPress());
  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).toHaveBeenCalledWith(backA);
  expect(view.navigation.dispatch).not.toHaveBeenCalledWith(backB);
  expect(view.navigation.dispatch).not.toHaveBeenCalledWith(backC);
});

it('Stay preserves the timer, permits a fresh prompt, and makes the old Discard inert', () => {
  const view = renderCookMode();
  startTimer(view);
  const backA = removalAction('BACK_A');
  act(() => view.attemptRemoval(backA));
  const promptA = latestDiscardActions();
  expect(promptA[0]).toEqual(expect.objectContaining({
    text: 'Stay', style: 'cancel', onPress: expect.any(Function),
  }));

  act(() => promptA[0].onPress());
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();

  const backB = removalAction('BACK_B');
  act(() => view.attemptRemoval(backB));
  const promptB = latestDiscardActions();
  expect(Alert.alert).toHaveBeenCalledTimes(2);

  act(() => promptA[1].onPress());
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();

  act(() => view.attemptRemoval(removalAction('COMPETING_BACK')));
  expect(Alert.alert).toHaveBeenCalledTimes(2);

  act(() => promptB[0].onPress());
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();
});

it('Discard clears the timer and dispatches the owned action exactly once', () => {
  const view = renderCookMode();
  startTimer(view);
  const action = removalAction();
  act(() => view.attemptRemoval(action));
  const discard = latestDiscardActions()[1].onPress;

  act(() => {
    discard();
    discard();
  });

  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).toHaveBeenCalledWith(action);
  expect(view.navigation.dispatch.mock.calls[0][0]).toBe(action);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
});

it('real navigation core completes a prevented removal once without a continuation loop', () => {
  let beforeRemoveListener;
  let preventedAction;
  let routes = [{ key: 'home', name: 'Home' }, { key: 'guarded', name: 'Guarded' }];
  const nextRoutes = routes.slice(0, 1);
  const navigation = {
    addListener: jest.fn((_event, listener) => {
      beforeRemoveListener = listener;
      return jest.fn();
    }),
  };
  const { usePreventRemove: installedUsePreventRemove } = loadInstalledNavigationCoreModule(
    'usePreventRemove.js',
    {
      react: React,
      'nanoid/non-secure': { nanoid: () => 'test-prevent-remove-id' },
      'use-latest-callback': { __esModule: true, default: (callback) => callback },
      './useNavigation.js': { useNavigation: () => navigation },
      './useRoute.js': { useRoute: () => ({ key: 'guarded' }) },
      './usePreventRemoveContext.js': {
        usePreventRemoveContext: () => ({
          setPreventRemove: jest.fn(),
          notifyPreventRemove: jest.fn(),
        }),
      },
    }
  );
  const { shouldPreventRemove } = loadInstalledNavigationCoreModule(
    'useOnPreventRemove.js',
    {
      react: React,
      './NavigationBuilderContext.js': { NavigationBuilderContext: React.createContext({}) },
      './NavigationProvider.js': { NavigationRouteContext: React.createContext(undefined) },
    }
  );
  const emitter = {
    emit: jest.fn((event) => {
      let defaultPrevented = false;
      beforeRemoveListener({
        ...event,
        preventDefault: () => { defaultPrevented = true; },
      });
      return { defaultPrevented };
    }),
  };
  const dispatch = jest.fn((action) => {
    const prevented = shouldPreventRemove(emitter, {}, routes, nextRoutes, action);
    if (!prevented) routes = nextRoutes;
  });
  navigation.dispatch = dispatch;

  function ActiveGuard() {
    installedUsePreventRemove(true, ({ data }) => {
      preventedAction = data.action;
      Alert.alert('Discard timer?', 'Leave?', [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Discard timer and leave',
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ]);
    });
    return <React.Fragment>Guarded route</React.Fragment>;
  }

  render(<ActiveGuard />);
  expect(navigation.addListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function));
  const initialAction = { type: 'GO_BACK' };
  act(() => navigation.dispatch(initialAction));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(preventedAction).toBeDefined();
  expect(routes).toHaveLength(2);

  act(() => latestDiscardActions()[1].onPress());

  expect(dispatch).toHaveBeenCalledTimes(2);
  expect(dispatch.mock.calls[1][0]).toBe(preventedAction);
  expect(routes).toEqual(nextRoutes);
  expect(emitter.emit).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

it('Reset invalidates old prompt callbacks, returns to IDLE, and stops guarding removal', () => {
  const view = renderCookMode();
  startTimer(view);
  act(() => view.attemptRemoval(removalAction('BACK_BEFORE_RESET')));
  const actions = latestDiscardActions();

  fireEvent.press(view.getByLabelText('Reset timer'));
  act(() => {
    actions[0].onPress();
    actions[1].onPress();
  });

  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
  expect(view.attemptRemoval(removalAction('IDLE_BACK'))).toBe(false);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

it('unmount and session-tree replacement make captured prompt callbacks inert', () => {
  const view = renderCookMode();
  startTimer(view);
  act(() => view.attemptRemoval(removalAction()));
  const actions = latestDiscardActions();

  view.unmount();
  act(() => {
    actions[0].onPress();
    actions[1].onPress();
  });

  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

it('does not guard IDLE or COMPLETED removal', () => {
  const view = renderCookMode();
  expect(view.attemptRemoval(removalAction('IDLE_BACK'))).toBe(false);

  startTimer(view, { seconds: '1' });
  act(() => jest.advanceTimersByTime(1000));
  expect(view.attemptRemoval(removalAction('COMPLETED_BACK'))).toBe(false);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('routes the custom in-screen Back through the same active removal contract', () => {
  const view = renderCookMode();
  startTimer(view);

  fireEvent.press(view.getByLabelText('Back'));
  expect(view.navigation.goBack).toHaveBeenCalledTimes(1);
  act(() => view.attemptRemoval(removalAction('CUSTOM_BACK')));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

it('keeps explicit Finish as the only Cook History path and retains its rapid-tap guard', async () => {
  let resolveCompletion;
  mockRecordCompletion.mockReturnValue(new Promise((resolve) => { resolveCompletion = resolve; }));
  const view = renderCookMode();
  fireEvent.press(view.getByText('Start cooking'));
  fireEvent.press(view.getByText('Next Step'));
  const finish = view.getByText('Finish Cooking');
  act(() => {
    fireEvent.press(finish);
    fireEvent.press(finish);
  });
  expect(mockRecordCompletion).toHaveBeenCalledTimes(1);
  expect(mockRecordCompletion).toHaveBeenCalledWith({ recipeId: 'recipe-1', servings: 2 });
  await act(async () => resolveCompletion());
  expect(notify).toHaveBeenCalledTimes(1);
});

it.each([undefined, null, 0, -1, NaN, Infinity, '2', 1.5, 101])(
  'shows original quantities and omits history servings for invalid recipe base %#',
  async (base) => {
    const apiRecipe = {
      ...recipe(), servings: base,
      ingredients: [{ ingredient: { id: 'ingredient-1', name: 'Chicken' }, quantity: 1, unit: 'kg' }],
    };
    const view = renderCookMode({ recipeSource: 'api', recipe: apiRecipe, servings: 3, ingredients: ['1 kg Chicken'] });
    expect(view.getByText(/Servings unknown/)).toBeOnTheScreen();
    expect(view.getByText('1 kg')).toBeOnTheScreen();
    expect(view.queryByText('1 serving')).toBeNull();
    enterFinalStep(view);
    expect(view.getByText('Simmer until tender.')).toBeOnTheScreen();
    await act(async () => fireEvent.press(view.getByText('Finish Cooking')));
    expect(mockRecordCompletion).toHaveBeenCalledTimes(1);
    expect(mockRecordCompletion).toHaveBeenCalledWith({ recipeId: 'recipe-1' });
    expect(Object.keys(mockRecordCompletion.mock.calls[0][0])).toEqual(['recipeId']);
  }
);

it('keeps selected valid servings for checklist scaling and completion', async () => {
  const apiRecipe = {
    ...recipe(),
    ingredients: [{ ingredient: { id: 'ingredient-1', name: 'Chicken' }, quantity: 1, unit: 'kg' }],
  };
  const view = renderCookMode({ recipeSource: 'api', recipe: apiRecipe, servings: 3, ingredients: [] });
  expect(view.getByText('1.5 kg')).toBeOnTheScreen();
  enterFinalStep(view);
  await act(async () => fireEvent.press(view.getByText('Finish Cooking')));
  expect(mockRecordCompletion).toHaveBeenCalledWith({ recipeId: 'recipe-1', servings: 3 });
});

it('uses the real recipe base when a route supplies an invalid selection', async () => {
  const apiRecipe = {
    ...recipe(),
    ingredients: [{ ingredient: { id: 'ingredient-1', name: 'Chicken' }, quantity: 1, unit: 'kg' }],
  };
  const view = renderCookMode({ recipeSource: 'api', recipe: apiRecipe, servings: 101, ingredients: [] });
  expect(view.getByText('1 kg')).toBeOnTheScreen();
  enterFinalStep(view);
  await act(async () => fireEvent.press(view.getByText('Finish Cooking')));
  expect(mockRecordCompletion).toHaveBeenCalledWith({ recipeId: 'recipe-1', servings: 2 });
});

it.each([
  ['RUNNING', (view) => startTimer(view)],
  ['PAUSED', (view) => {
    startTimer(view);
    fireEvent.press(view.getByLabelText('Pause timer'));
  }],
])('%s timer coexists with one explicit Finish request and one guarded navigation', async (_state, arrange) => {
  const view = renderCookMode();
  enterFinalStep(view);
  arrange(view);

  await act(async () => fireEvent.press(view.getByText('Finish Cooking')));
  expect(mockRecordCompletion).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);

  act(() => notify.mock.calls[0][2]());
  expect(view.navigation.goBack).toHaveBeenCalledTimes(1);
  const finishRemoval = removalAction('FINISH_BACK');
  act(() => view.attemptRemoval(finishRemoval));
  expect(Alert.alert).toHaveBeenCalledTimes(1);

  const firstPrompt = latestDiscardActions();
  act(() => firstPrompt[0].onPress());
  expect(mockRecordCompletion).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).not.toHaveBeenCalled();

  act(() => view.attemptRemoval(removalAction('FINISH_BACK_AGAIN')));
  const secondPrompt = latestDiscardActions();
  act(() => {
    secondPrompt[1].onPress();
    secondPrompt[1].onPress();
    firstPrompt[1].onPress();
  });
  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(mockRecordCompletion).toHaveBeenCalledTimes(1);
});

it('COMPLETED timer exits after one explicit Finish without a discard prompt', async () => {
  const view = renderCookMode();
  enterFinalStep(view);
  startTimer(view, { seconds: '1' });
  act(() => jest.advanceTimersByTime(1000));
  expect(mockRecordCompletion).not.toHaveBeenCalled();

  await act(async () => fireEvent.press(view.getByText('Finish Cooking')));
  expect(mockRecordCompletion).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);

  act(() => notify.mock.calls[0][2]());
  expect(view.attemptRemoval(removalAction('FINISH_BACK'))).toBe(false);
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockRecordCompletion).toHaveBeenCalledTimes(1);
});

it('cleans intervals and listeners on unmount and ignores late lifecycle callbacks', () => {
  const view = renderCookMode();
  startTimer(view, { seconds: '2' });
  const lateAppState = mockAppStateListener;
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
  expect(mockAppStateRemove).toHaveBeenCalledTimes(1);

  act(() => {
    jest.setSystemTime(new Date(BASE_TIME.getTime() + 5000));
    lateAppState('active');
  });
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

it('registers AppState cleanup while removal ownership is hook-managed', () => {
  renderCookMode();
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  expect(mockPreventRemoveState).toEqual({ enabled: false, callback: expect.any(Function) });
});
