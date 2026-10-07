const React = require('react');

let mockAppStateListener;
const mockAppStateRemove = jest.fn();

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

function renderCookMode() {
  const listeners = {};
  const listenerRemovers = {};
  const navigation = {
    addListener: jest.fn((name, listener) => {
      listeners[name] = listener;
      listenerRemovers[name] = jest.fn();
      return listenerRemovers[name];
    }),
    dispatch: jest.fn(),
    goBack: jest.fn(),
  };
  const view = render(
    <CookModeScreen
      navigation={navigation}
      route={{ params: { recipeSource: 'api', recipe: recipe(), servings: 2, ingredients: [] } }}
    />
  );
  return { ...view, listeners, listenerRemovers, navigation };
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

function removalEvent(type = 'GO_BACK') {
  return { preventDefault: jest.fn(), data: { action: { type } } };
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
  mockRecordCompletion.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
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

it('owns one discard prompt while repeated removal events remain prevented', () => {
  const view = renderCookMode();
  startTimer(view);
  const first = removalEvent('FIRST_BACK');
  const second = removalEvent('SECOND_BACK');

  act(() => {
    view.listeners.beforeRemove(first);
    view.listeners.beforeRemove(second);
  });

  expect(first.preventDefault).toHaveBeenCalledTimes(1);
  expect(second.preventDefault).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
});

it('keeps the first removal action as prompt owner across three distinct Back actions', () => {
  const view = renderCookMode();
  startTimer(view);
  const backA = removalEvent('BACK_A');
  const backB = removalEvent('BACK_B');
  const backC = removalEvent('BACK_C');

  act(() => {
    view.listeners.beforeRemove(backA);
    view.listeners.beforeRemove(backB);
    view.listeners.beforeRemove(backC);
  });

  expect(backA.preventDefault).toHaveBeenCalledTimes(1);
  expect(backB.preventDefault).toHaveBeenCalledTimes(1);
  expect(backC.preventDefault).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(1);

  act(() => latestDiscardActions()[1].onPress());

  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).toHaveBeenCalledWith(backA.data.action);
  expect(view.navigation.dispatch).not.toHaveBeenCalledWith(backB.data.action);
  expect(view.navigation.dispatch).not.toHaveBeenCalledWith(backC.data.action);
});

it('Stay preserves the timer and permits a later removal to own a fresh prompt', () => {
  const view = renderCookMode();
  startTimer(view);
  const first = removalEvent('FIRST_BACK');
  act(() => view.listeners.beforeRemove(first));
  expect(Alert.alert).toHaveBeenCalledWith(
    'Discard timer?',
    'Leaving Cook Mode will discard the active timer.',
    expect.any(Array)
  );
  const firstActions = latestDiscardActions();
  expect(firstActions[0]).toEqual(expect.objectContaining({
    text: 'Stay', style: 'cancel', onPress: expect.any(Function),
  }));

  act(() => firstActions[0].onPress());
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();

  const second = removalEvent('SECOND_BACK');
  act(() => view.listeners.beforeRemove(second));
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  const secondActions = latestDiscardActions();

  act(() => firstActions[0].onPress());
  const third = removalEvent('THIRD_BACK');
  act(() => view.listeners.beforeRemove(third));
  expect(third.preventDefault).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(2);

  act(() => secondActions[0].onPress());
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();
});

it('makes old Discard inert after Stay while the new prompt retains ownership', () => {
  const view = renderCookMode();
  startTimer(view);
  const backA = removalEvent('BACK_A');
  act(() => view.listeners.beforeRemove(backA));
  const promptA = latestDiscardActions();
  const stayA = promptA[0].onPress;
  const discardA = promptA[1].onPress;

  act(() => stayA());
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();

  const backB = removalEvent('BACK_B');
  act(() => view.listeners.beforeRemove(backB));
  const promptB = latestDiscardActions();
  expect(Alert.alert).toHaveBeenCalledTimes(2);

  act(() => discardA());
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();

  const competingBack = removalEvent('COMPETING_BACK');
  act(() => view.listeners.beforeRemove(competingBack));
  expect(competingBack.preventDefault).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(2);

  act(() => promptB[1].onPress());
  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).toHaveBeenCalledWith(backB.data.action);
  expect(view.navigation.dispatch).not.toHaveBeenCalledWith(backA.data.action);
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
});

it('Discard is one-shot and its confirmed action passes the removal guard without a loop', () => {
  const view = renderCookMode();
  startTimer(view);
  const event = removalEvent();
  view.navigation.dispatch.mockImplementation((action) => {
    view.listeners.beforeRemove({ preventDefault: jest.fn(), data: { action } });
  });
  act(() => view.listeners.beforeRemove(event));
  const actions = latestDiscardActions();

  act(() => {
    actions[1].onPress();
    actions[1].onPress();
  });
  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).toHaveBeenCalledWith(event.data.action);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
});

it('Reset invalidates both captured discard callbacks', () => {
  const view = renderCookMode();
  startTimer(view);
  act(() => view.listeners.beforeRemove(removalEvent()));
  const actions = latestDiscardActions();

  fireEvent.press(view.getByLabelText('Reset timer'));
  act(() => {
    actions[0].onPress();
    actions[1].onPress();
  });

  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
});

it('Reset directly invalidates an old Discard without invoking old Stay first', () => {
  const view = renderCookMode();
  startTimer(view);
  act(() => view.listeners.beforeRemove(removalEvent('BACK_BEFORE_RESET')));
  const oldDiscard = latestDiscardActions()[1].onPress;

  fireEvent.press(view.getByLabelText('Reset timer'));
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
  expect(view.queryByLabelText('Pause timer')).toBeNull();

  act(() => oldDiscard());
  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();

  const idleRemoval = removalEvent('IDLE_BACK');
  act(() => view.listeners.beforeRemove(idleRemoval));
  expect(idleRemoval.preventDefault).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();
});

it('cleans the one-shot bypass when confirmed dispatch does not re-enter beforeRemove', () => {
  const view = renderCookMode();
  startTimer(view);
  const actionA = { type: 'BACK_A' };
  const firstRemoval = { preventDefault: jest.fn(), data: { action: actionA } };
  act(() => view.listeners.beforeRemove(firstRemoval));

  act(() => latestDiscardActions()[1].onPress());
  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).toHaveBeenCalledWith(actionA);
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();

  startTimer(view);
  const laterSameActionRemoval = { preventDefault: jest.fn(), data: { action: actionA } };
  act(() => view.listeners.beforeRemove(laterSameActionRemoval));

  expect(laterSameActionRemoval.preventDefault).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();
});

it('cleans the one-shot bypass when confirmed dispatch throws', () => {
  const view = renderCookMode();
  startTimer(view);
  const actionA = { type: 'BACK_A' };
  const firstRemoval = { preventDefault: jest.fn(), data: { action: actionA } };
  const dispatchError = new Error('dispatch failed');
  view.navigation.dispatch.mockImplementationOnce(() => { throw dispatchError; });
  act(() => view.listeners.beforeRemove(firstRemoval));
  const firstDiscard = latestDiscardActions()[1].onPress;

  let caughtError;
  act(() => {
    try {
      firstDiscard();
    } catch (error) {
      caughtError = error;
    }
  });
  expect(caughtError).toBe(dispatchError);
  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.navigation.dispatch).toHaveBeenCalledWith(actionA);
  expect(view.getByLabelText('Start timer')).toBeOnTheScreen();

  startTimer(view);
  const laterSameActionRemoval = { preventDefault: jest.fn(), data: { action: actionA } };
  act(() => view.listeners.beforeRemove(laterSameActionRemoval));

  expect(laterSameActionRemoval.preventDefault).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  expect(view.navigation.dispatch).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Pause timer')).toBeOnTheScreen();
});

it('unmount invalidates captured Stay and Discard callbacks', () => {
  const view = renderCookMode();
  startTimer(view);
  act(() => view.listeners.beforeRemove(removalEvent()));
  const actions = latestDiscardActions();

  view.unmount();
  act(() => {
    actions[0].onPress();
    actions[1].onPress();
  });

  expect(view.navigation.dispatch).not.toHaveBeenCalled();
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

it('lets IDLE and COMPLETED timers exit without discard confirmation', () => {
  const view = renderCookMode();
  const idleEvent = removalEvent();
  act(() => view.listeners.beforeRemove(idleEvent));
  expect(idleEvent.preventDefault).not.toHaveBeenCalled();

  startTimer(view, { seconds: '1' });
  act(() => jest.advanceTimersByTime(1000));
  const completedEvent = removalEvent();
  act(() => view.listeners.beforeRemove(completedEvent));
  expect(completedEvent.preventDefault).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
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
  const finishRemoval = removalEvent('FINISH_BACK');
  act(() => view.listeners.beforeRemove(finishRemoval));
  expect(finishRemoval.preventDefault).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(1);

  const actions = latestDiscardActions();
  act(() => {
    actions[1].onPress();
    actions[1].onPress();
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
  const finishRemoval = removalEvent('FINISH_BACK');
  act(() => view.listeners.beforeRemove(finishRemoval));
  expect(finishRemoval.preventDefault).not.toHaveBeenCalled();
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
  expect(view.listenerRemovers.beforeRemove).toHaveBeenCalledTimes(1);

  act(() => {
    jest.setSystemTime(new Date(BASE_TIME.getTime() + 5000));
    lateAppState('active');
  });
  expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});

it('registers the AppState and navigation-removal lifecycle exactly once', () => {
  const view = renderCookMode();
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  expect(view.navigation.addListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function));
});
