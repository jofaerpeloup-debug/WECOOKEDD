const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  const Modal = ({ visible, children, ...props }) => visible ? React.createElement('Modal', props, children) : null;
  class ValueXY {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    getTranslateTransform() { return [{ translateX: this.value.x }, { translateY: this.value.y }]; }
  }
  return {
    AccessibilityInfo: { setAccessibilityFocus: jest.fn() },
    ActivityIndicator: host('ActivityIndicator'),
    Animated: { ValueXY, View: host('AnimatedView') },
    findNodeHandle: () => 1,
    Modal,
    PanResponder: {
      create: (config) => ({
        panHandlers: {
          onStartShouldSetResponder: config.onStartShouldSetPanResponder,
          onMoveShouldSetResponder: config.onMoveShouldSetPanResponder,
          onMoveShouldSetResponderCapture: config.onMoveShouldSetPanResponderCapture,
          onResponderGrant: config.onPanResponderGrant,
          onResponderMove: config.onPanResponderMove,
          onResponderRelease: config.onPanResponderRelease,
          onResponderTerminate: config.onPanResponderTerminate,
          onResponderTerminationRequest: config.onPanResponderTerminationRequest,
        },
      }),
    },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      absoluteFillObject: {},
      create: (styles) => styles,
      flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    },
    Text: host('Text'),
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
      cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333',
      inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sagePale: '#efe',
      sageDeep: '#353', stone: '#a70', overlay: '#0008', error: '#900', errorBg: '#fee',
    },
  }),
}));

let mockFocusedEffect;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => {
    const React = require('react');
    mockFocusedEffect = callback;
    React.useEffect(callback, [callback]);
  },
}));

let mockUser = { id: 'user-a' };
const mockReminderReconcile = jest.fn();
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../src/context/MealReminderContext', () => ({ useMealReminders: () => ({ state: { kind: 'pending' }, reconcile: mockReminderReconcile, manualRetry: jest.fn(), requestPermission: jest.fn(), openSettings: jest.fn() }) }));
jest.mock('../src/context/ShoppingListContext', () => ({
  useShoppingList: () => ({ addRecipe: jest.fn(), isMutating: false }),
}));
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/components/MealPlanSheet', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockMealPlanSheet({ visible, onAdded }) {
    return visible ? React.createElement(View, null,
      React.createElement(Text, null, 'Add meal sheet open'),
      React.createElement(Pressable, {
        accessibilityLabel: 'Complete add meal',
        onPress: () => onAdded?.(Object.freeze({ id: 'created-entry' })),
      }, React.createElement(Text, null, 'Complete add'))
    ) : null;
  };
});
jest.mock('../src/api/mealPlanService', () => ({
  clearMealPlanRange: jest.fn(),
  getMealPlan: jest.fn(),
  moveMealPlanEntry: jest.fn(),
  removeMealPlanEntry: jest.fn(),
}));
jest.mock('../src/api/mealPlanErrors', () => ({
  getMealPlanErrorMessage: (err) => err?.message || 'Meal plan failed.',
  getMealPlanErrorState: (err) => ({ kind: err?.kind || 'generic', message: err?.message || 'Meal plan failed.' }),
}));
jest.mock('../src/utils/alert', () => ({ confirm: jest.fn(), notify: jest.fn() }));
jest.mock('../src/utils/mealPlanShopping', () => ({
  addPlannedRecipesToShoppingList: jest.fn(async () => ({ recipeIds: [], succeeded: 0, failed: 0 })),
}));

const { act, cleanup, fireEvent, render, waitFor, within } = require('@testing-library/react-native');
const {
  getMealPlan,
  moveMealPlanEntry,
  removeMealPlanEntry,
} = require('../src/api/mealPlanService');
const {
  dateKeyFromLocalDate,
  formatDayDate,
  localDate,
  shiftWeek,
  startOfLocalWeek,
  weekDays,
} = require('../src/utils/mealPlanDates');
const MealPlanMoveSheet = require('../src/components/MealPlanMoveSheet').default;
const MealPlanScreen = require('../src/screens/MealPlanScreen').default;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function currentWeek() {
  return weekDays(startOfLocalWeek(new Date()));
}

function entry(overrides = {}) {
  const days = currentWeek();
  return {
    id: 'entry-1',
    dateKey: days[0].dateKey,
    recipeId: 'recipe-1',
    isAvailable: true,
    recipe: {
      id: 'recipe-1', title: 'Chicken Adobo', imageUrl: null, prepTimeMinutes: 10,
      cookTimeMinutes: 30, difficulty: 'easy',
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-14T08:30:00.000Z',
    ...overrides,
  };
}

async function renderLoaded(entries = [entry()]) {
  getMealPlan.mockResolvedValue(entries);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText(`${entries.length} ${entries.length === 1 ? 'meal' : 'meals'} this week`)).toBeOnTheScreen());
  return { navigation, view };
}

function openMove(view, label = 'Move Chicken Adobo') {
  fireEvent.press(view.getByLabelText(label));
  return view.getByLabelText('Move meal');
}

function dragPoint(dayIndex, overrides = {}) {
  return { moveX: 160, moveY: 140 + (dayIndex * 100), dx: 0, dy: 12, ...overrides };
}

function layoutDragTargets(view) {
  fireEvent(view.getByTestId('meal-plan-scroll'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 100, width: 320, height: 700 } },
  });
  currentWeek().forEach((day, index) => {
    fireEvent(view.getByTestId(`meal-plan-day-${day.dateKey}`), 'layout', {
      nativeEvent: { layout: { x: 0, y: index * 100, width: 320, height: 90 } },
    });
  });
}

function beginDrag(view, entryId = 'entry-1') {
  layoutDragTargets(view);
  const handle = view.getByTestId(`meal-plan-drag-${entryId}`);
  expect(handle.props.onStartShouldSetResponder()).toBe(false);
  expect(handle.props.onMoveShouldSetResponder({}, { dx: 0, dy: 9 })).toBe(false);
  expect(handle.props.onMoveShouldSetResponder({}, dragPoint(0))).toBe(true);
  act(() => handle.props.onResponderGrant({ nativeEvent: {} }, dragPoint(0)));
  return handle;
}

function hoverDrag(view, dayIndex, entryId = 'entry-1') {
  const handle = view.getByTestId(`meal-plan-drag-${entryId}`);
  act(() => handle.props.onResponderMove({ nativeEvent: {} }, dragPoint(dayIndex)));
}

function releaseDrag(view, dayIndex, entryId = 'entry-1', overrides = {}) {
  const handle = view.getByTestId(`meal-plan-drag-${entryId}`);
  act(() => handle.props.onResponderRelease({ nativeEvent: {} }, dragPoint(dayIndex, overrides)));
}

async function settle(request, method, value) {
  await act(async () => {
    request[method](value);
    await request.promise.catch(() => undefined);
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { id: 'user-a' };
  mockFocusedEffect = undefined;
});

afterEach(() => cleanup());

it('opens an entry-specific sheet with current/selected semantics and disables the same date', async () => {
  const { view } = await renderLoaded();
  const button = openMove(view);
  expect(button.props.accessibilityState).toEqual({ disabled: true, busy: false });
  expect(moveMealPlanEntry).not.toHaveBeenCalled();
  const selected = view.getByLabelText(/Selected$/);
  expect(selected.props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText(/Current date/)).toBeOnTheScreen();
  const sourceDate = localDate(...entry().dateKey.split('-').map(Number).map((value, index) => index === 1 ? value - 1 : value));
  expect(view.getByText('Moving from')).toBeOnTheScreen();
  expect(view.getAllByText(sourceDate.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })).length).toBe(2);
  expect(view.getByText('Current plan')).toBeOnTheScreen();
});

it('drags in-week with exact id/version, one submit, pessimistic source visibility, and returned-entry reconciliation', async () => {
  const days = currentWeek();
  const request = deferred();
  const sibling = entry({ id: 'entry-2', dateKey: days[2].dateKey });
  const returned = entry({
    dateKey: days[1].dateKey,
    updatedAt: '2026-09-14T09:00:00.000Z',
    recipe: { ...entry().recipe, title: 'Server Adobo' },
  });
  moveMealPlanEntry.mockReturnValue(request.promise);
  const { view } = await renderLoaded([entry(), sibling]);

  beginDrag(view);
  expect(view.getByTestId('meal-plan-drag-preview', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(view.getByTestId('meal-plan-scroll').props.scrollEnabled).toBe(false);
  hoverDrag(view, 1);
  expect(view.getByTestId(`meal-plan-day-${days[1].dateKey}`).props.style)
    .toContainEqual(expect.objectContaining({ borderWidth: 2 }));
  releaseDrag(view, 1);

  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
  expect(moveMealPlanEntry).toHaveBeenCalledWith('entry-1', {
    dateKey: days[1].dateKey,
    expectedUpdatedAt: '2026-09-14T08:30:00.000Z',
  });
  expect(within(view.getByTestId(`meal-plan-day-${days[0].dateKey}`)).getByText('Chicken Adobo')).toBeOnTheScreen();
  expect(within(view.getByTestId(`meal-plan-day-${days[0].dateKey}`)).getByLabelText('Move Chicken Adobo')).toBeDisabled();
  expect(view.getByTestId('meal-plan-drag-entry-1')).toBeDisabled();
  expect(view.getByTestId('meal-plan-scroll').props.scrollEnabled).toBe(true);
  releaseDrag(view, 1);
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);

  await settle(request, 'resolve', returned);
  await waitFor(() => expect(within(view.getByTestId(`meal-plan-day-${days[1].dateKey}`)).getByText('Server Adobo')).toBeOnTheScreen());
  expect(within(view.getByTestId(`meal-plan-day-${days[2].dateKey}`)).getByText('Chicken Adobo')).toBeOnTheScreen();
  expect(view.queryByTestId('meal-plan-drag-preview', { includeHiddenElements: true })).not.toBeOnTheScreen();
});

it('cancels same-day, outside, below-threshold, and terminated gestures without a request', async () => {
  const { view } = await renderLoaded();
  const handle = view.getByTestId('meal-plan-drag-entry-1');
  expect(handle.props.onMoveShouldSetResponder({}, { dx: 4, dy: 4 })).toBe(false);
  expect(view.queryByTestId('meal-plan-drag-preview', { includeHiddenElements: true })).not.toBeOnTheScreen();

  beginDrag(view);
  releaseDrag(view, 0);
  expect(moveMealPlanEntry).not.toHaveBeenCalled();

  beginDrag(view);
  releaseDrag(view, 1, 'entry-1', { moveX: -10, moveY: -10 });
  expect(moveMealPlanEntry).not.toHaveBeenCalled();

  const terminatingHandle = beginDrag(view);
  hoverDrag(view, 1);
  act(() => terminatingHandle.props.onResponderTerminate());
  expect(moveMealPlanEntry).not.toHaveBeenCalled();
  expect(view.queryByTestId('meal-plan-drag-preview', { includeHiddenElements: true })).not.toBeOnTheScreen();
  expect(view.getByTestId('meal-plan-scroll').props.scrollEnabled).toBe(true);
});

it('disables drag while a fresh authoritative generation is loading', async () => {
  const refresh = deferred();
  getMealPlan.mockResolvedValueOnce([entry()]).mockReturnValueOnce(refresh.promise);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeEnabled());

  act(() => { mockFocusedEffect(); });
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeDisabled());
  expect(view.getByTestId('meal-plan-drag-entry-1').props.onMoveShouldSetResponder({}, dragPoint(0))).toBe(false);

  await settle(refresh, 'resolve', [entry()]);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeEnabled());
});

it.each([
  ['duplicate', 'That recipe is already planned for this day.'],
  ['notFound', 'That planned meal no longer exists.'],
  ['network', 'Connection failed.'],
  ['generic', 'Server failed.'],
])('keeps the drag source authoritative after a %s move failure', async (kind, message) => {
  moveMealPlanEntry.mockRejectedValue({ kind, message });
  const days = currentWeek();
  const { view } = await renderLoaded();
  beginDrag(view);
  releaseDrag(view, 1);

  await waitFor(() => expect(view.getByText(message)).toBeOnTheScreen());
  expect(within(view.getByTestId(`meal-plan-day-${days[0].dateKey}`)).getByText('Chicken Adobo')).toBeOnTheScreen();
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
});

it('retains the drag source on malformed success and never applies client-authored movement', async () => {
  moveMealPlanEntry.mockResolvedValue({
    id: null, dateKey: null, recipeId: null, isAvailable: false, recipe: null, createdAt: null, updatedAt: null,
  });
  const days = currentWeek();
  const { view } = await renderLoaded();
  beginDrag(view);
  releaseDrag(view, 1);

  await waitFor(() => expect(view.getByText('Something went wrong. Please try again.')).toBeOnTheScreen());
  expect(within(view.getByTestId(`meal-plan-day-${days[0].dateKey}`)).getByText('Chicken Adobo')).toBeOnTheScreen();
  expect(within(view.getByTestId(`meal-plan-day-${days[1].dateKey}`)).queryByText('Chicken Adobo')).not.toBeOnTheScreen();
});

it('uses the guarded stale refetch for drag and never auto-resubmits', async () => {
  const refreshed = entry({ updatedAt: '2026-09-14T10:00:00.000Z' });
  getMealPlan.mockResolvedValueOnce([entry()]).mockResolvedValueOnce([refreshed]);
  moveMealPlanEntry.mockRejectedValue({ kind: 'stale', message: 'stale' });
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeOnTheScreen());
  beginDrag(view);
  releaseDrag(view, 1);

  await waitFor(() => expect(getMealPlan).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByText('Your meal plan changed. The latest plan is now loaded.')).toBeOnTheScreen());
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
  expect(view.getByText('Chicken Adobo')).toBeOnTheScreen();
});

it('drags an unavailable entry without fabricating recipe content', async () => {
  const days = currentWeek();
  const unavailable = entry({ isAvailable: false, recipe: null });
  moveMealPlanEntry.mockResolvedValue({
    ...unavailable, dateKey: days[1].dateKey, updatedAt: '2026-09-14T09:00:00.000Z',
  });
  const { view } = await renderLoaded([unavailable]);
  beginDrag(view);
  releaseDrag(view, 1);

  await waitFor(() => expect(within(view.getByTestId(`meal-plan-day-${days[1].dateKey}`)).getByText('Recipe unavailable')).toBeOnTheScreen());
  expect(moveMealPlanEntry).toHaveBeenCalledWith('entry-1', expect.objectContaining({
    expectedUpdatedAt: '2026-09-14T08:30:00.000Z',
  }));
  expect(view.queryByText('Chicken Adobo')).not.toBeOnTheScreen();
});

it('allows only one active drag and blocks conflicting Meal Plan controls', async () => {
  const days = currentWeek();
  const second = entry({
    id: 'entry-2',
    recipeId: 'recipe-2',
    recipe: { ...entry().recipe, id: 'recipe-2', title: 'Pancit' },
  });
  const request = deferred();
  moveMealPlanEntry.mockReturnValue(request.promise);
  const { view } = await renderLoaded([entry(), second]);
  beginDrag(view);

  const secondHandle = view.getByTestId('meal-plan-drag-entry-2');
  expect(secondHandle).toBeDisabled();
  expect(secondHandle.props.onMoveShouldSetResponder({}, dragPoint(0))).toBe(false);
  expect(view.getByLabelText('Move Chicken Adobo')).toBeDisabled();
  expect(view.getByLabelText('Remove Chicken Adobo')).toBeDisabled();
  expect(view.getByLabelText('Add recipe to Tuesday')).toBeDisabled();
  expect(view.getByLabelText('Next week')).toBeDisabled();

  releaseDrag(view, 1);
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
  expect(within(view.getByTestId(`meal-plan-day-${days[0].dateKey}`)).getByText('Chicken Adobo')).toBeOnTheScreen();
  await settle(request, 'reject', { kind: 'network', message: 'Connection failed.' });
});

it.each([
  ['account', async (view, navigation) => {
    mockUser = { id: 'user-b' };
    getMealPlan.mockResolvedValueOnce([]);
    view.rerender(<MealPlanScreen navigation={navigation} />);
  }],
  ['range', async (view) => {
    getMealPlan.mockResolvedValueOnce([]);
    act(() => view.getByLabelText('Next week').props.onPress());
  }],
  ['generation', async () => {
    getMealPlan.mockResolvedValueOnce([entry()]);
    await act(async () => { await mockFocusedEffect(); });
  }],
])('invalidates an active drag after %s authority changes', async (_scenario, invalidate) => {
  getMealPlan.mockResolvedValueOnce([entry()]);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeOnTheScreen());
  const handle = beginDrag(view);
  const lateRelease = handle.props.onResponderRelease;
  await invalidate(view, navigation);
  await waitFor(() => expect(view.queryByTestId('meal-plan-drag-preview', { includeHiddenElements: true })).not.toBeOnTheScreen());
  act(() => lateRelease({ nativeEvent: {} }, dragPoint(1)));
  expect(moveMealPlanEntry).not.toHaveBeenCalled();
});

it.each([
  ['entry removal', (authoritativeEntries) => authoritativeEntries.splice(0, 1)],
  ['version replacement', (authoritativeEntries) => {
    authoritativeEntries[0] = entry({ updatedAt: '2026-09-14T10:00:00.000Z' });
  }],
])('rejects a late release after authoritative %s without relying on generation cancellation', async (_scenario, changeAuthority) => {
  const authoritativeEntries = [entry()];
  getMealPlan.mockResolvedValueOnce(authoritativeEntries);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeOnTheScreen());
  const handle = beginDrag(view);
  const lateRelease = handle.props.onResponderRelease;

  changeAuthority(authoritativeEntries);
  act(() => lateRelease({ nativeEvent: {} }, dragPoint(1)));

  expect(moveMealPlanEntry).not.toHaveBeenCalled();
  expect(view.queryByTestId('meal-plan-drag-preview', { includeHiddenElements: true })).not.toBeOnTheScreen();
  expect(view.getByTestId('meal-plan-scroll').props.scrollEnabled).toBe(true);
});

it.each([
  ['success', 'resolve', entry({ dateKey: currentWeek()[1].dateKey, updatedAt: '2026-09-14T09:00:00.000Z' })],
  ['failure', 'reject', { kind: 'network', message: 'Old owner failure.' }],
  ['stale failure', 'reject', { kind: 'stale', message: 'Old owner stale.' }],
])('keeps a new owner drag authoritative after the old owner has a late %s', async (_outcome, method, value) => {
  const oldRequest = deferred();
  const newRequest = deferred();
  const days = currentWeek();
  const ownerBEntry = entry({
    id: 'entry-b',
    recipeId: 'recipe-b',
    recipe: { ...entry().recipe, id: 'recipe-b', title: 'Owner B Meal' },
  });
  const ownerBReturned = entry({
    ...ownerBEntry,
    dateKey: days[1].dateKey,
    updatedAt: '2026-09-14T10:30:00.000Z',
    recipe: { ...ownerBEntry.recipe, title: 'Owner B Server Meal' },
  });
  getMealPlan.mockResolvedValueOnce([entry()]).mockResolvedValueOnce([ownerBEntry]);
  moveMealPlanEntry.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeOnTheScreen());

  beginDrag(view);
  releaseDrag(view, 1);
  mockUser = { id: 'user-b' };
  view.rerender(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText('Owner B Meal')).toBeOnTheScreen());

  beginDrag(view, 'entry-b');
  releaseDrag(view, 1, 'entry-b');
  expect(moveMealPlanEntry).toHaveBeenNthCalledWith(2, 'entry-b', {
    dateKey: days[1].dateKey,
    expectedUpdatedAt: ownerBEntry.updatedAt,
  });

  await settle(oldRequest, method, value);
  expect(getMealPlan).toHaveBeenCalledTimes(2);
  expect(view.queryByText('Old owner failure.')).not.toBeOnTheScreen();
  expect(view.queryByText('Old owner stale.')).not.toBeOnTheScreen();
  expect(view.getByTestId('meal-plan-drag-entry-b')).toBeDisabled();

  await settle(newRequest, 'resolve', ownerBReturned);
  await waitFor(() => expect(within(view.getByTestId(`meal-plan-day-${days[1].dateKey}`)).getByText('Owner B Server Meal')).toBeOnTheScreen());
  expect(view.getByTestId('meal-plan-drag-entry-b')).toBeEnabled();
  expect(view.queryByTestId('meal-plan-drag-preview', { includeHiddenElements: true })).not.toBeOnTheScreen();
});

it('ignores pending drag success and finalizer work after the displayed week changes', async () => {
  const request = deferred();
  const days = currentWeek();
  const nextDays = weekDays(shiftWeek(days[0].date, 1));
  const nextEntry = entry({
    id: 'entry-next',
    recipeId: 'recipe-next',
    dateKey: nextDays[0].dateKey,
    recipe: { ...entry().recipe, id: 'recipe-next', title: 'Next Week Soup' },
  });
  getMealPlan.mockResolvedValueOnce([entry()]).mockResolvedValueOnce([nextEntry]);
  moveMealPlanEntry.mockReturnValueOnce(request.promise);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeOnTheScreen());
  beginDrag(view);
  releaseDrag(view, 1);

  act(() => view.getByLabelText('Next week').props.onPress());
  await waitFor(() => expect(view.getByText('Next Week Soup')).toBeOnTheScreen());
  await settle(request, 'resolve', entry({ dateKey: days[1].dateKey, updatedAt: '2026-09-14T09:00:00.000Z' }));

  expect(view.getByText('Next Week Soup')).toBeOnTheScreen();
  expect(view.queryByText('Chicken Adobo')).not.toBeOnTheScreen();
  expect(view.getByTestId('meal-plan-drag-entry-next')).toBeEnabled();
  expect(view.queryByTestId('meal-plan-drag-preview', { includeHiddenElements: true })).not.toBeOnTheScreen();
});

it.each([
  ['failure', { kind: 'network', message: 'Old generation failure.' }],
  ['stale failure', { kind: 'stale', message: 'Old generation stale.' }],
])('ignores pending drag %s, error, and stale-refetch work after a newer generation and version', async (_outcome, failure) => {
  const request = deferred();
  const refreshed = entry({
    updatedAt: '2026-09-14T10:00:00.000Z',
    recipe: { ...entry().recipe, title: 'Refreshed Meal' },
  });
  getMealPlan.mockResolvedValueOnce([entry()]).mockResolvedValueOnce([refreshed]);
  moveMealPlanEntry.mockReturnValueOnce(request.promise);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeOnTheScreen());
  beginDrag(view);
  releaseDrag(view, 1);

  await act(async () => { await mockFocusedEffect(); });
  await waitFor(() => expect(view.getByText('Refreshed Meal')).toBeOnTheScreen());
  await settle(request, 'reject', failure);

  expect(getMealPlan).toHaveBeenCalledTimes(2);
  expect(view.getByText('Refreshed Meal')).toBeOnTheScreen();
  expect(view.queryByText(failure.message)).not.toBeOnTheScreen();
  expect(view.queryByText(/Your meal plan changed/)).not.toBeOnTheScreen();
  expect(view.getByTestId('meal-plan-drag-entry-1')).toBeEnabled();
});

it('does not process or refetch a pending stale drag failure after unmount', async () => {
  const request = deferred();
  moveMealPlanEntry.mockReturnValue(request.promise);
  const { view } = await renderLoaded();
  beginDrag(view);
  releaseDrag(view, 1);
  view.unmount();
  await settle(request, 'reject', { kind: 'stale', message: 'Unmounted stale.' });
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
  expect(getMealPlan).toHaveBeenCalledTimes(1);
});

it('navigates previous and next target weeks and submits a real cross-week date', async () => {
  const days = currentWeek();
  const nextDays = weekDays(shiftWeek(days[0].date, 1));
  const previousDays = weekDays(shiftWeek(days[0].date, -1));
  const request = deferred();
  moveMealPlanEntry.mockReturnValue(request.promise);
  const { view } = await renderLoaded();
  openMove(view);

  fireEvent.press(view.getByLabelText('Previous target week'));
  expect(view.getByLabelText(new RegExp(`^Monday, ${formatDayDate(previousDays[0].date)}`))).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Next target week'));
  fireEvent.press(view.getByLabelText('Next target week'));
  fireEvent.press(view.getByLabelText(new RegExp(`^Monday, ${formatDayDate(nextDays[0].date)}`)));
  fireEvent.press(view.getByLabelText('Move meal'));

  expect(moveMealPlanEntry).toHaveBeenCalledWith('entry-1', {
    dateKey: nextDays[0].dateKey,
    expectedUpdatedAt: '2026-09-14T08:30:00.000Z',
  });
  request.resolve(entry({ dateKey: nextDays[0].dateKey, updatedAt: '2026-09-14T09:00:00.000Z' }));
  await act(async () => request.promise);
});

it('keeps the source visible, exposes busy state, and blocks duplicate submission while pending', async () => {
  const request = deferred();
  moveMealPlanEntry.mockReturnValue(request.promise);
  const { view } = await renderLoaded();
  openMove(view);
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));
  fireEvent.press(view.getByLabelText('Move meal'));
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
  expect(view.getAllByText('Chicken Adobo').length).toBeGreaterThan(0);
  expect(view.getByLabelText('Move meal').props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(view.getByLabelText('Next target week').props.accessibilityState.disabled).toBe(true);
  await settle(request, 'reject', { kind: 'network', message: 'Connection failed.' });
});

it('replaces only the submitted entry id when a sibling has the same recipeId', async () => {
  const days = currentWeek();
  const sibling = entry({ id: 'entry-2', dateKey: days[2].dateKey });
  const returned = entry({
    dateKey: days[1].dateKey,
    recipe: { ...entry().recipe, title: 'Server Adobo' },
    updatedAt: '2026-09-14T09:00:00.000Z',
  });
  moveMealPlanEntry.mockResolvedValue(returned);
  const { view } = await renderLoaded([entry(), sibling]);
  const monday = view.getByTestId(`meal-plan-day-${days[0].dateKey}`);
  fireEvent.press(within(monday).getByLabelText('Move Chicken Adobo'));
  expect(view.getByLabelText('Move meal')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));
  const tuesday = view.getByTestId(`meal-plan-day-${days[1].dateKey}`);
  const wednesday = view.getByTestId(`meal-plan-day-${days[2].dateKey}`);
  await waitFor(() => expect(within(tuesday).getByText('Server Adobo')).toBeOnTheScreen());
  expect(within(wednesday).getByText('Chicken Adobo')).toBeOnTheScreen();
  expect(within(wednesday).queryByText('Server Adobo')).not.toBeOnTheScreen();
  expect(moveMealPlanEntry).toHaveBeenCalledWith('entry-1', expect.any(Object));
});

it('removes only the moved id when the returned target is outside the displayed week', async () => {
  const days = currentWeek();
  const nextDays = weekDays(shiftWeek(days[0].date, 1));
  moveMealPlanEntry.mockResolvedValue(entry({ dateKey: nextDays[0].dateKey, updatedAt: '2026-09-14T09:00:00.000Z' }));
  const other = entry({ id: 'entry-2', recipeId: 'recipe-2', recipe: { ...entry().recipe, id: 'recipe-2', title: 'Pancit' } });
  const { view } = await renderLoaded([entry(), other]);
  openMove(view);
  fireEvent.press(view.getByLabelText('Next target week'));
  fireEvent.press(view.getByLabelText(new RegExp(`^Monday, ${formatDayDate(nextDays[0].date)}`)));
  fireEvent.press(view.getByLabelText('Move meal'));
  await waitFor(() => expect(view.queryByText('Chicken Adobo')).not.toBeOnTheScreen());
  expect(view.getByText('Pancit')).toBeOnTheScreen();
});

it.each([
  ['duplicate', 'That recipe is already planned for this day.'],
  ['notFound', 'That planned meal no longer exists.'],
  ['network', 'Connection failed.'],
  ['generic', 'Server failed.'],
])('%s failure retains the source entry and selected target', async (kind, message) => {
  moveMealPlanEntry.mockRejectedValue({ kind, message });
  const { view } = await renderLoaded();
  openMove(view);
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));
  await waitFor(() => expect(view.getByText(message)).toBeOnTheScreen());
  expect(view.getAllByText('Chicken Adobo').length).toBeGreaterThan(0);
  expect(view.getByLabelText(/^Tuesday,.*Selected$/)).toBeOnTheScreen();
});

it('retains the source, reports stale state, refetches once, and never auto-retries', async () => {
  const original = entry();
  const refreshed = entry({ updatedAt: '2026-09-14T10:00:00.000Z' });
  getMealPlan.mockResolvedValueOnce([original]).mockResolvedValueOnce([refreshed]);
  moveMealPlanEntry.mockRejectedValue({ kind: 'stale', message: 'We refreshed before the request completed.' });
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByLabelText('Move Chicken Adobo')).toBeOnTheScreen());
  openMove(view);
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));
  await waitFor(() => expect(getMealPlan).toHaveBeenCalledTimes(2));
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(view.getByText('Your meal plan changed. The latest plan is now loaded.')).toBeOnTheScreen());
  expect(view.queryByText(/We refreshed/)).not.toBeOnTheScreen();
  expect(view.getAllByText('Chicken Adobo').length).toBeGreaterThan(0);
});

it('keeps stale reload failure truthful and exposes the existing retry path', async () => {
  getMealPlan
    .mockResolvedValueOnce([entry()])
    .mockRejectedValueOnce({ message: 'Reload failed.' });
  moveMealPlanEntry.mockRejectedValue({ kind: 'stale', message: 'stale' });
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByLabelText('Move Chicken Adobo')).toBeOnTheScreen());
  openMove(view);
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));

  await waitFor(() => expect(view.getByText('Your meal plan changed. Reload the latest plan and try again.')).toBeOnTheScreen());
  expect(view.getByText('Reload failed. Tap to retry.')).toBeOnTheScreen();
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
});

it('allows moving an unavailable entry without inventing recipe content', async () => {
  const unavailable = entry({ isAvailable: false, recipe: null });
  const { view } = await renderLoaded([unavailable]);
  openMove(view, `Move unavailable recipe planned for ${formatDayDate(currentWeek()[0].date)}`);
  expect(view.getByText('Unavailable recipe')).toBeOnTheScreen();
  expect(view.getByLabelText('Move meal')).toBeDisabled();
});

it('ignores a late move response after the displayed week changes', async () => {
  const request = deferred();
  const days = currentWeek();
  const nextDays = weekDays(shiftWeek(days[0].date, 1));
  const nextEntry = entry({
    id: 'entry-next', recipeId: 'recipe-next', dateKey: nextDays[0].dateKey,
    recipe: { ...entry().recipe, id: 'recipe-next', title: 'Next Week Soup' },
  });
  getMealPlan.mockResolvedValueOnce([entry()]).mockResolvedValueOnce([nextEntry]);
  moveMealPlanEntry.mockReturnValue(request.promise);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByLabelText('Move Chicken Adobo')).toBeOnTheScreen());
  openMove(view);
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));
  fireEvent.press(view.getByLabelText('Next week'));
  await waitFor(() => expect(view.getByText('Next Week Soup')).toBeOnTheScreen());
  await settle(request, 'resolve', entry({ dateKey: days[1].dateKey, updatedAt: '2026-09-14T09:00:00.000Z' }));
  expect(view.getByText('Next Week Soup')).toBeOnTheScreen();
  expect(view.queryByText('Chicken Adobo')).not.toBeOnTheScreen();
});

it('ignores a late stale refetch for week A after week B becomes current', async () => {
  const staleReload = deferred();
  const weekBLoad = deferred();
  const days = currentWeek();
  const nextDays = weekDays(shiftWeek(days[0].date, 1));
  const nextEntry = entry({
    id: 'entry-next',
    dateKey: nextDays[0].dateKey,
    recipe: { ...entry().recipe, title: 'Next Week Soup' },
  });
  getMealPlan
    .mockResolvedValueOnce([entry()])
    .mockReturnValueOnce(staleReload.promise)
    .mockReturnValueOnce(weekBLoad.promise);
  moveMealPlanEntry.mockRejectedValue({ kind: 'stale', message: 'stale' });
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByLabelText('Move Chicken Adobo')).toBeOnTheScreen());
  openMove(view);
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));
  await waitFor(() => expect(getMealPlan).toHaveBeenCalledTimes(2));
  expect(view.getByText('Your meal plan changed. Reloading the latest plan.')).toBeOnTheScreen();
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);

  fireEvent.press(view.getByLabelText('Next week'));
  await waitFor(() => expect(getMealPlan).toHaveBeenCalledTimes(3));
  await settle(weekBLoad, 'resolve', [nextEntry]);
  await waitFor(() => expect(view.getByText('Next Week Soup')).toBeOnTheScreen());

  await settle(staleReload, 'resolve', [entry({ recipe: { ...entry().recipe, title: 'Late Week A Meal' } })]);
  expect(view.getByText('Next Week Soup')).toBeOnTheScreen();
  expect(view.queryByText('Late Week A Meal')).not.toBeOnTheScreen();
  expect(view.queryByText(/Tap to retry/)).not.toBeOnTheScreen();
  expect(view.getByText('1 meal this week')).toBeOnTheScreen();
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
});

it.each([
  ['month', '2026-10-31', '2026-11-01', 'Sunday'],
  ['year', '2026-12-31', '2027-01-01', 'Friday'],
])('keeps local calendar identity across a %s boundary', async (_boundary, sourceKey, targetKey, targetDay) => {
  const onMove = jest.fn();
  const source = entry({ dateKey: sourceKey });
  const view = render(
    <MealPlanMoveSheet
      visible
      entry={source}
      pending={false}
      error={null}
      onClose={jest.fn()}
      onMove={onMove}
    />
  );
  const sourceDate = localDate(...sourceKey.split('-').map(Number).map((value, index) => index === 1 ? value - 1 : value));
  const sourceLabel = `Moving from ${sourceDate.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })}`;
  const targetDate = localDate(...targetKey.split('-').map(Number).map((value, index) => index === 1 ? value - 1 : value));
  expect(dateKeyFromLocalDate(targetDate)).toBe(targetKey);
  expect(view.getByLabelText(sourceLabel)).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText(new RegExp(`^${targetDay}, ${formatDayDate(targetDate)}`)));
  expect(view.getByText('Selected target')).toBeOnTheScreen();
  expect(view.getByLabelText(sourceLabel)).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Move meal'));
  expect(onMove).toHaveBeenCalledWith(targetKey);
});

it('ignores a late move response after the authenticated account changes', async () => {
  const request = deferred();
  const otherEntry = entry({
    id: 'entry-b', recipeId: 'recipe-b',
    recipe: { ...entry().recipe, id: 'recipe-b', title: 'Owner B Meal' },
  });
  getMealPlan.mockResolvedValueOnce([entry()]).mockResolvedValueOnce([otherEntry]);
  moveMealPlanEntry.mockReturnValue(request.promise);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByLabelText('Move Chicken Adobo')).toBeOnTheScreen());
  openMove(view);
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));
  mockUser = { id: 'user-b' };
  view.rerender(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText('Owner B Meal')).toBeOnTheScreen());
  await settle(request, 'resolve', entry({ dateKey: currentWeek()[1].dateKey }));
  expect(view.getByText('Owner B Meal')).toBeOnTheScreen();
  expect(view.queryByText('Chicken Adobo')).not.toBeOnTheScreen();
});

it('uses the current account authority for a new same-week drag after an account switch', async () => {
  const days = currentWeek();
  const ownerBEntry = entry({
    id: 'entry-b',
    recipeId: 'recipe-b',
    recipe: { ...entry().recipe, id: 'recipe-b', title: 'Owner B Meal' },
  });
  const ownerBReturned = entry({
    ...ownerBEntry,
    dateKey: days[1].dateKey,
    updatedAt: '2026-09-14T10:30:00.000Z',
    recipe: { ...ownerBEntry.recipe, title: 'Owner B Server Meal' },
  });
  getMealPlan.mockResolvedValueOnce([entry()]).mockResolvedValueOnce([ownerBEntry]);
  moveMealPlanEntry.mockResolvedValueOnce(ownerBReturned);
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const view = render(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-1')).toBeOnTheScreen());

  mockUser = { id: 'user-b' };
  view.rerender(<MealPlanScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('meal-plan-drag-entry-b')).toBeEnabled());

  beginDrag(view, 'entry-b');
  releaseDrag(view, 1, 'entry-b');
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
  expect(moveMealPlanEntry).toHaveBeenCalledWith('entry-b', {
    dateKey: days[1].dateKey,
    expectedUpdatedAt: ownerBEntry.updatedAt,
  });
  await waitFor(() => expect(within(view.getByTestId(`meal-plan-day-${days[1].dateKey}`)).getByText('Owner B Server Meal')).toBeOnTheScreen());
  expect(view.getByTestId('meal-plan-drag-entry-b')).toBeEnabled();
  expect(view.queryByText('Chicken Adobo')).not.toBeOnTheScreen();
});

it('keeps existing add, remove, Recipe Detail, and focus reload wiring live', async () => {
  removeMealPlanEntry.mockResolvedValue(true);
  const { navigation, view } = await renderLoaded();
  fireEvent.press(view.getByLabelText('Open Chicken Adobo'));
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeDetail', expect.objectContaining({ recipeId: 'recipe-1' }));
  fireEvent.press(view.getByLabelText('Add recipe to Monday'));
  expect(view.getByText('Add meal sheet open')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Complete add meal'));
  await waitFor(() => expect(getMealPlan.mock.calls.length).toBeGreaterThanOrEqual(2));
  fireEvent.press(view.getByLabelText('Remove Chicken Adobo'));
  await waitFor(() => expect(removeMealPlanEntry).toHaveBeenCalledWith('entry-1', '2026-09-14T08:30:00.000Z'));
  await act(async () => mockFocusedEffect());
  expect(getMealPlan.mock.calls.length).toBeGreaterThanOrEqual(3);
});

it('does not update screen state from a move response after unmount', async () => {
  const request = deferred();
  moveMealPlanEntry.mockReturnValue(request.promise);
  const { view } = await renderLoaded();
  openMove(view);
  fireEvent.press(view.getByLabelText(/^Tuesday,/));
  fireEvent.press(view.getByLabelText('Move meal'));
  view.unmount();
  await settle(request, 'resolve', entry({ dateKey: currentWeek()[1].dateKey }));
  expect(moveMealPlanEntry).toHaveBeenCalledTimes(1);
});
