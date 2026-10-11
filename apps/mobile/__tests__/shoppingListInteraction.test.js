const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) =>
    React.createElement(name, { ...props, ref }, children));
  const Modal = ({ visible, children, ...props }) => visible
    ? React.createElement('Modal', props, children)
    : null;
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: jest.fn() },
    KeyboardAvoidingView: host('KeyboardAvoidingView'),
    Modal,
    PanResponder: {
      create: (handlers) => ({
        panHandlers: {
          onStartShouldSetResponder: handlers.onStartShouldSetPanResponder,
          onMoveShouldSetResponder: handlers.onMoveShouldSetPanResponder,
          onResponderGrant: handlers.onPanResponderGrant,
          onResponderMove: handlers.onPanResponderMove,
          onResponderRelease: handlers.onPanResponderRelease,
          onResponderTerminate: handlers.onPanResponderTerminate,
          onResponderTerminationRequest: handlers.onPanResponderTerminationRequest,
        },
      }),
    },
    Platform: { OS: 'ios', select: (values) => values.ios || values.default },
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      absoluteFill: {},
      absoluteFillObject: {},
      create: (styles) => styles,
      flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

it('adds a custom row once from an inline draft and keeps exact server state', async () => {
  shoppingListService.getShoppingList.mockResolvedValue(list([]));
  const request = deferred();
  shoppingListService.addCustomItem.mockReturnValue(request.promise);
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Custom item name')).toBeOnTheScreen());
  fireEvent.changeText(view.getByLabelText('Custom item name'), ' Milk ');
  fireEvent.press(view.getByLabelText('Add custom item'));
  fireEvent.press(view.getByLabelText('Add custom item'));
  expect(shoppingListService.addCustomItem).toHaveBeenCalledTimes(1);
  expect(shoppingListService.addCustomItem).toHaveBeenCalledWith('Milk');
  await settle(request, 'resolve', list([{ id: 'custom-1', type: 'custom', label: 'Milk', isChecked: false }]));
  expect(view.getByLabelText('Custom item name').props.value).toBe('');
  expect(view.getByLabelText('Check Milk')).toBeOnTheScreen();
  expect(view.queryByLabelText('Edit quantity and unit for Milk')).toBeNull();
});

it('keeps the custom draft on invalid input and a failed server mutation', async () => {
  shoppingListService.getShoppingList.mockResolvedValue(list([]));
  shoppingListService.addCustomItem.mockRejectedValue(new Error('Shopping list changed elsewhere.'));
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Custom item name')).toBeOnTheScreen());
  fireEvent.changeText(view.getByLabelText('Custom item name'), '\u2800');
  fireEvent.press(view.getByLabelText('Add custom item'));
  expect(shoppingListService.addCustomItem).not.toHaveBeenCalled();
  expect(view.getByLabelText('Custom item name').props.value).toBe('\u2800');
  fireEvent.changeText(view.getByLabelText('Custom item name'), 'Bread');
  fireEvent.press(view.getByLabelText('Add custom item'));
  await waitFor(() => expect(view.getByText('Shopping list changed elsewhere.')).toBeOnTheScreen());
  expect(view.getByLabelText('Custom item name').props.value).toBe('Bread');
});

it('shows only truthful Recipe source copy and groups custom rows last', async () => {
  shoppingListService.getShoppingList.mockResolvedValue(list([
    item({ source: { kind: 'single', title: 'Recipe A', quantityEdited: true } }),
    { id: 'custom-1', type: 'custom', label: 'Bread', isChecked: false },
  ]));
  const view = renderScreen();
  await waitFor(() => expect(view.getByText('Includes Recipe A')).toBeOnTheScreen());
  expect(view.getByText('Amount manually adjusted or mixed')).toBeOnTheScreen();
  expect(view.getByText('Custom Items')).toBeOnTheScreen();
  expect(view.getByLabelText('Check Bread')).toBeOnTheScreen();
  expect(view.queryByLabelText('Edit quantity and unit for Bread')).toBeNull();
});

it.each([
  ['network', Object.assign(new Error('offline'), { kind: 'network' })],
  ['server 5xx', Object.assign(new Error('server unavailable'), { status: 503 })],
  ['malformed 2xx', Object.assign(new Error('malformed'), { code: 'INVALID_RESPONSE', status: 502 })],
])('SHOP5 revokes mutation capability after a failed v2 GET: %s', async (_label, failedGet) => {
  const first = deferred();
  shoppingListService.getShoppingList
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(failedGet)
    .mockResolvedValue(list([]));
  shoppingListService.addCustomItem.mockResolvedValue(
    list([{ id: 'custom-1', type: 'custom', label: 'Milk', isChecked: false }])
  );
  render(<ShoppingListProvider><ShoppingListObserver /></ShoppingListProvider>);
  await settle(first, 'resolve', list([]));
  await waitFor(() => expect(observedShoppingList.isReady).toBe(true));
  await act(async () => { await observedShoppingList.reload(); });
  const blocked = await observedShoppingList.addCustomItem('Milk');
  expect(blocked.ok).toBe(false);
  expect(shoppingListService.addCustomItem).not.toHaveBeenCalled();
  await act(async () => { await observedShoppingList.reload(); });
  const allowed = await observedShoppingList.addCustomItem('Milk');
  expect(allowed.ok).toBe(true);
  expect(shoppingListService.addCustomItem).toHaveBeenCalledTimes(1);
});

it.each([
  ['same-user relogin', 'user-a'],
  ['account switch', 'user-b'],
])('SHOP5 clears a custom draft on %s', async (_case, nextUser) => {
  shoppingListService.getShoppingList.mockResolvedValue(list([]));
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Custom item name')).toBeOnTheScreen());
  fireEvent.changeText(view.getByLabelText('Custom item name'), 'Bread');
  mockAuth = {
    status: 'authenticated',
    user: { id: nextUser },
    sessionIdentity: { ownerId: nextUser, generation: 2, localSessionRevision: 2 },
  };
  view.rerender(
    <ShoppingListProvider>
      <ShoppingListObserver />
      <ShoppingListScreen navigation={{ goBack: jest.fn() }} />
    </ShoppingListProvider>
  );
  await waitFor(() => expect(view.getByLabelText('Custom item name').props.value).toBe(''));
  expect(shoppingListService.addCustomItem).not.toHaveBeenCalled();
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

let focusedEffect;
let mockBlurEffect;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => {
    const React = require('react');
    focusedEffect = callback;
    React.useEffect(() => {
      mockBlurEffect = callback();
      return () => {
        mockBlurEffect?.();
        mockBlurEffect = undefined;
      };
    }, [callback]);
  },
}));

let mockAuth = {
  status: 'authenticated',
  user: { id: 'user-a' },
  sessionIdentity: { ownerId: 'user-a', generation: 1, localSessionRevision: 1 },
};
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/api/shoppingListService', () => ({
  addItem: jest.fn(),
  addCustomItem: jest.fn(),
  addRecipe: jest.fn(),
  clearCheckedItems: jest.fn(),
  clearItems: jest.fn(),
  getShoppingList: jest.fn(),
  removeItem: jest.fn(),
  updateItem: jest.fn(),
}));
jest.mock('../src/api/shoppingListErrors', () => ({
  getShoppingListErrorMessage: (error) => error?.message || 'Shopping request failed.',
  isAmbiguousShoppingMutationOutcome: (error) =>
    error?.kind === 'network' || error?.status >= 500 || error?.code === 'INVALID_RESPONSE',
  isItemAlreadyGone: (error) => error?.code === 'SHOPPING_LIST_ITEM_NOT_FOUND',
  isShoppingListStale: (error) => error?.code === 'SHOPPING_LIST_STALE',
}));

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const shoppingListService = require('../src/api/shoppingListService');
const { ShoppingListProvider, useShoppingList } = require('../src/context/ShoppingListContext');
const ShoppingItemEditModal = require('../src/components/ShoppingItemEditModal').default;
const IngredientPickerModal = require('../src/components/IngredientPickerModal').default;
const ShoppingListScreen = require('../src/screens/ShoppingListScreen').default;
const SwapDetailScreen = require('../src/screens/SwapDetailScreen').default;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function item(overrides = {}) {
  return {
    id: 'item-a',
    type: 'ingredient',
    source: { kind: 'legacy' },
    ingredientId: 'ingredient-1',
    ingredient: { id: 'ingredient-1', name: 'Rice' },
    category: 'grain',
    quantity: 2,
    unit: 'kg',
    isChecked: false,
    isAvailable: true,
    ...overrides,
  };
}

function list(items) {
  return { id: 'list-1', items, createdAt: null, updatedAt: null };
}

let observedShoppingList;

function ShoppingListObserver() {
  observedShoppingList = useShoppingList();
  return null;
}

function renderScreen() {
  return render(
    <ShoppingListProvider>
      <ShoppingListObserver />
      <ShoppingListScreen navigation={{ goBack: jest.fn() }} />
    </ShoppingListProvider>
  );
}

function renderModal(props = {}) {
  const defaultProps = {
    visible: true,
    item: item(),
    onClose: jest.fn(),
    onSave: jest.fn(async () => ({ ok: true })),
  };
  const merged = { ...defaultProps, ...props };
  return { ...render(<ShoppingItemEditModal {...merged} />), props: merged };
}

function renderLockedPicker(props = {}) {
  const defaultProps = {
    visible: true,
    lockedIngredient: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Aquafaba' },
    onClose: jest.fn(),
    onAdd: jest.fn(async () => ({ ok: true })),
    onAdded: jest.fn(),
  };
  const merged = { ...defaultProps, ...props };
  return { ...render(<IngredientPickerModal {...merged} />), props: merged };
}

async function settle(request, method, value) {
  await act(async () => {
    request[method](value);
    await request.promise.catch(() => undefined);
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth = {
    status: 'authenticated',
    user: { id: 'user-a' },
    sessionIdentity: { ownerId: 'user-a', generation: 1, localSessionRevision: 1 },
  };
  focusedEffect = undefined;
  mockBlurEffect = undefined;
  observedShoppingList = undefined;
});

afterEach(() => cleanup());

it('opens the exact item, prefills measurable values, and reconciles the full server list before close', async () => {
  const original = [item(), item({ id: 'item-b', ingredientId: 'ingredient-2', ingredient: { id: 'ingredient-2', name: 'Milk' }, category: 'dairy', quantity: 1, unit: 'l' })];
  shoppingListService.getShoppingList.mockResolvedValue(list(original));
  const request = deferred();
  shoppingListService.updateItem.mockReturnValue(request.promise);
  const view = renderScreen();

  await waitFor(() => expect(view.getByLabelText('Edit quantity and unit for Rice')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Edit quantity and unit for Rice'));
  expect(view.getByText('Edit Shopping Item')).toBeOnTheScreen();
  expect(view.getAllByText('Rice')).toHaveLength(2);
  expect(view.getByText('Category: Grain')).toBeOnTheScreen();
  expect(view.getByLabelText('Quantity').props.value).toBe('2');
  expect(view.getByLabelText('kg unit').props.accessibilityState.selected).toBe(true);

  fireEvent.changeText(view.getByLabelText('Quantity'), '2.5');
  fireEvent.press(view.getByLabelText('cup unit'));
  fireEvent(view.getByLabelText('Save item changes'), 'accessibilityTap');
  fireEvent(view.getByLabelText('Save item changes'), 'accessibilityTap');
  expect(shoppingListService.updateItem).toHaveBeenCalledTimes(1);
  expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-a', { type: 'ingredient', quantity: 2.5, unit: 'cup' });
  expect(view.getByLabelText('Save item changes').props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(view.getByText('2 kg')).toBeOnTheScreen();

  await settle(request, 'resolve', list([
    item({ quantity: 3, unit: 'cup' }),
    original[1],
  ]));
  await waitFor(() => expect(view.getByText('3 cup')).toBeOnTheScreen());
  expect(view.queryByText('Edit Shopping Item')).not.toBeOnTheScreen();
  expect(view.getByText('Milk')).toBeOnTheScreen();
});

it('clears quantity for measurable-to-toTaste and sends explicit null', async () => {
  const { getByLabelText, queryByLabelText, props } = renderModal();
  fireEvent.press(getByLabelText('to taste unit'));
  expect(queryByLabelText('Quantity')).toBeNull();
  fireEvent(getByLabelText('Save item changes'), 'accessibilityTap');
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith('item-a', { quantity: null, unit: 'toTaste' }));
});

it('does not restore the old quantity after a mounted measurable-to-toTaste-to-measurable round trip', async () => {
  const { getByLabelText, queryByLabelText, props } = renderModal();
  expect(getByLabelText('Quantity').props.value).toBe('2');

  fireEvent.press(getByLabelText('to taste unit'));
  expect(queryByLabelText('Quantity')).toBeNull();

  fireEvent.press(getByLabelText('cup unit'));
  expect(getByLabelText('Quantity').props.value).toBe('');
  expect(getByLabelText('Save item changes').props.accessibilityState.disabled).toBe(true);
  fireEvent(getByLabelText('Save item changes'), 'accessibilityTap');
  expect(props.onSave).not.toHaveBeenCalled();

  fireEvent.changeText(getByLabelText('Quantity'), '3');
  fireEvent(getByLabelText('Save item changes'), 'accessibilityTap');
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith('item-a', { quantity: 3, unit: 'cup' }));
});

it('prefills toTaste without quantity and blocks measurable Save until a positive finite value exists', async () => {
  const toTaste = item({ quantity: null, unit: 'toTaste' });
  const { getByLabelText, queryByLabelText, props } = renderModal({ item: toTaste });
  expect(queryByLabelText('Quantity')).toBeNull();
  fireEvent.press(getByLabelText('kg unit'));
  expect(getByLabelText('Quantity').props.value).toBe('');
  expect(getByLabelText('Save item changes').props.accessibilityState.disabled).toBe(true);

  for (const invalid of ['', '0', '-1', '1/2', 'Infinity', 'NaN']) {
    fireEvent.changeText(getByLabelText('Quantity'), invalid);
    fireEvent(getByLabelText('Save item changes'), 'accessibilityTap');
  }
  expect(props.onSave).not.toHaveBeenCalled();
  fireEvent.changeText(getByLabelText('Quantity'), '0.5');
  fireEvent(getByLabelText('Save item changes'), 'accessibilityTap');
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith('item-a', { quantity: 0.5, unit: 'kg' }));
});

it.each([
  ['duplicate conflict', 'You already have that ingredient in that unit.'],
  ['network/server failure', 'Can\u2019t reach WeCooked. Check your connection and try again.'],
])('%s keeps the modal and draft intact without changing either row', async (_case, message) => {
  const original = [item(), item({ id: 'item-b', quantity: 4, unit: 'cup' })];
  shoppingListService.getShoppingList.mockResolvedValue(list(original));
  shoppingListService.updateItem.mockRejectedValue(new Error(message));
  const view = renderScreen();
  await waitFor(() => expect(view.getAllByLabelText('Edit quantity and unit for Rice')).toHaveLength(2));
  fireEvent.press(view.getAllByLabelText('Edit quantity and unit for Rice')[0]);
  fireEvent.changeText(view.getByLabelText('Quantity'), '7');
  fireEvent.press(view.getByLabelText('cup unit'));
  fireEvent(view.getByLabelText('Save item changes'), 'accessibilityTap');

  await waitFor(() => expect(view.getByText(message)).toBeOnTheScreen());
  expect(view.getByText('Edit Shopping Item')).toBeOnTheScreen();
  expect(view.getByLabelText('Quantity').props.value).toBe('7');
  expect(view.getByText('2 kg')).toBeOnTheScreen();
  expect(view.getByText('4 cup')).toBeOnTheScreen();
  expect(shoppingListService.updateItem).toHaveBeenCalledTimes(1);
});

it('keeps same-ingredient rows independent by Shopping item id', async () => {
  const rows = [item(), item({ id: 'item-b', quantity: 4, unit: 'piece' })];
  shoppingListService.getShoppingList.mockResolvedValue(list(rows));
  shoppingListService.updateItem.mockResolvedValue(list(rows));
  const view = renderScreen();
  await waitFor(() => expect(view.getAllByLabelText('Edit quantity and unit for Rice')).toHaveLength(2));
  fireEvent.press(view.getAllByLabelText('Edit quantity and unit for Rice')[1]);
  expect(view.getByLabelText('Quantity').props.value).toBe('4');
  expect(view.getByLabelText('piece unit').props.accessibilityState.selected).toBe(true);
  fireEvent.changeText(view.getByLabelText('Quantity'), '5');
  fireEvent(view.getByLabelText('Save item changes'), 'accessibilityTap');
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-b', { type: 'ingredient', quantity: 5, unit: 'piece' }));
});

it('Cancel and Close discard drafts without mutation', () => {
  const first = renderModal();
  fireEvent.changeText(first.getByLabelText('Quantity'), '9');
  fireEvent.press(first.getByLabelText('Cancel editing item'));
  expect(first.props.onClose).toHaveBeenCalledTimes(1);
  expect(first.props.onSave).not.toHaveBeenCalled();
  first.unmount();

  const second = renderModal();
  fireEvent.press(second.getAllByLabelText('Close item editor')[1]);
  expect(second.props.onClose).toHaveBeenCalledTimes(1);
  expect(second.props.onSave).not.toHaveBeenCalled();
});

it('reopens after Cancel and Close from the authoritative row instead of a discarded draft', async () => {
  shoppingListService.getShoppingList.mockResolvedValue(list([item()]));
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Edit quantity and unit for Rice')).toBeOnTheScreen());

  fireEvent.press(view.getByLabelText('Edit quantity and unit for Rice'));
  fireEvent.changeText(view.getByLabelText('Quantity'), '9');
  fireEvent.press(view.getByLabelText('cup unit'));
  fireEvent.press(view.getByLabelText('Cancel editing item'));
  expect(view.queryByText('Edit Shopping Item')).toBeNull();

  fireEvent.press(view.getByLabelText('Edit quantity and unit for Rice'));
  expect(view.getByLabelText('Quantity').props.value).toBe('2');
  expect(view.getByLabelText('kg unit').props.accessibilityState.selected).toBe(true);
  fireEvent.changeText(view.getByLabelText('Quantity'), '8');
  fireEvent.press(view.getByLabelText('piece unit'));
  fireEvent.press(view.getAllByLabelText('Close item editor')[1]);
  expect(view.queryByText('Edit Shopping Item')).toBeNull();

  fireEvent.press(view.getByLabelText('Edit quantity and unit for Rice'));
  expect(view.getByLabelText('Quantity').props.value).toBe('2');
  expect(view.getByLabelText('kg unit').props.accessibilityState.selected).toBe(true);
  expect(shoppingListService.updateItem).not.toHaveBeenCalled();
});

it('renders Ingredient and category as read-only and saves only quantity and unit', async () => {
  const { getByLabelText, getByText, UNSAFE_getAllByType, props } = renderModal();
  const { TextInput } = require('react-native');

  expect(getByText('Rice')).toBeOnTheScreen();
  expect(getByText('Category: Grain')).toBeOnTheScreen();
  const inputs = UNSAFE_getAllByType(TextInput);
  expect(inputs).toHaveLength(1);
  expect(inputs[0].props.accessibilityLabel).toBe('Quantity');

  fireEvent.changeText(getByLabelText('Quantity'), '4.5');
  fireEvent.press(getByLabelText('g unit'));
  fireEvent(getByLabelText('Save item changes'), 'accessibilityTap');
  await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
  expect(props.onSave.mock.calls[0]).toEqual(['item-a', { quantity: 4.5, unit: 'g' }]);
  expect(Object.keys(props.onSave.mock.calls[0][1]).sort()).toEqual(['quantity', 'unit']);
});

it.each([
  ['explicitly unavailable despite an Ingredient projection', item({ isAvailable: false })],
  ['missing Ingredient projection despite explicit availability', item({ ingredient: null, isAvailable: true })],
])('%s has no Edit action', async (_case, unavailableItem) => {
  shoppingListService.getShoppingList.mockResolvedValue(list([unavailableItem]));
  const view = renderScreen();
  await waitFor(() => expect(view.getByText(
    unavailableItem.ingredient ? 'Rice' : 'Unavailable ingredient'
  )).toBeOnTheScreen());
  const label = unavailableItem.ingredient ? 'Rice' : 'Unavailable ingredient';
  expect(view.queryByLabelText(`Edit quantity and unit for ${label}`)).toBeNull();
});

it('keeps check, unavailable removal, clear-all, grouping, and focus reload behavior', async () => {
  const available = item();
  const unavailable = item({
    id: 'item-missing', ingredientId: 'ingredient-missing', ingredient: null,
    category: null, isAvailable: false, quantity: 1, unit: 'piece',
  });
  shoppingListService.getShoppingList.mockResolvedValue(list([available, unavailable]));
  shoppingListService.updateItem.mockResolvedValue(list([{ ...available, isChecked: true }, unavailable]));
  shoppingListService.removeItem.mockResolvedValue(list([available]));
  shoppingListService.clearItems.mockResolvedValue(list([]));
  const view = renderScreen();

  await waitFor(() => expect(view.getByText('Grain')).toBeOnTheScreen());
  expect(view.getByText('Category unavailable')).toBeOnTheScreen();
  expect(view.queryByLabelText('Edit quantity and unit for Unavailable ingredient')).toBeNull();
  fireEvent.press(view.getByLabelText('Check Rice'));
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-a', { type: 'ingredient', isChecked: true }));
  expect(view.queryByText('Edit Shopping Item')).toBeNull();

  fireEvent.press(view.getByLabelText('Edit shopping list'));
  fireEvent.press(view.getByLabelText('Remove Unavailable ingredient'));
  await waitFor(() => expect(shoppingListService.removeItem).toHaveBeenCalledWith('item-missing'));
  fireEvent.press(view.getByLabelText('Clear shopping list'));
  const clearAlert = require('react-native').Alert.alert.mock.calls.at(-1);
  await act(async () => clearAlert[2][1].onPress());
  expect(shoppingListService.clearItems).toHaveBeenCalledTimes(1);
  await act(async () => focusedEffect());
  expect(shoppingListService.getShoppingList.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('ignores an old owner response and does not close a newly opened owner modal', async () => {
  const oldRequest = deferred();
  const ownerBItem = item({ id: 'item-b', ingredientId: 'ingredient-b', ingredient: { id: 'ingredient-b', name: 'Beans' }, category: 'legume', quantity: 1, unit: 'can' });
  shoppingListService.getShoppingList.mockImplementation(() => Promise.resolve(
    mockAuth.user.id === 'user-b' ? list([ownerBItem]) : list([item()])
  ));
  shoppingListService.updateItem.mockReturnValue(oldRequest.promise);
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Edit quantity and unit for Rice')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Edit quantity and unit for Rice'));
  fireEvent.changeText(view.getByLabelText('Quantity'), '8');
  fireEvent(view.getByLabelText('Save item changes'), 'accessibilityTap');

  mockAuth = {
    status: 'authenticated',
    user: { id: 'user-b' },
    sessionIdentity: { ownerId: 'user-b', generation: 2, localSessionRevision: 2 },
  };
  view.rerender(
    <ShoppingListProvider>
      <ShoppingListScreen navigation={{ goBack: jest.fn() }} />
    </ShoppingListProvider>
  );
  await waitFor(() => expect(view.getByLabelText('Edit quantity and unit for Beans')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Edit quantity and unit for Beans'));
  expect(view.getByText('Edit Shopping Item')).toBeOnTheScreen();

  await settle(oldRequest, 'resolve', list([item({ quantity: 8 })]));
  expect(view.getAllByText('Beans')).toHaveLength(2);
  expect(view.getByText('Edit Shopping Item')).toBeOnTheScreen();
  expect(view.queryByText('8 kg')).toBeNull();
});

it('invalidates an in-flight mutation when the same user starts a new auth session', async () => {
  const oldMutation = deferred();
  const newLoad = deferred();
  const newMutation = deferred();
  const beans = item({
    id: 'item-b', ingredientId: 'ingredient-b',
    ingredient: { id: 'ingredient-b', name: 'Beans' }, category: 'legume',
    quantity: 1, unit: 'can',
  });
  shoppingListService.getShoppingList.mockResolvedValue(list([item()]));
  shoppingListService.updateItem
    .mockReturnValueOnce(oldMutation.promise)
    .mockReturnValueOnce(newMutation.promise);

  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Check Rice'));
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledTimes(1));
  const readsBeforeSessionChange = shoppingListService.getShoppingList.mock.calls.length;
  shoppingListService.getShoppingList.mockReturnValueOnce(newLoad.promise);

  mockAuth = {
    status: 'authenticated',
    user: { id: 'user-a' },
    sessionIdentity: { ownerId: 'user-a', generation: 2, localSessionRevision: 2 },
  };
  view.rerender(
    <ShoppingListProvider>
      <ShoppingListObserver />
      <ShoppingListScreen navigation={{ goBack: jest.fn() }} />
    </ShoppingListProvider>
  );
  expect(view.queryByText('Rice')).toBeNull();
  await waitFor(() => expect(shoppingListService.getShoppingList)
    .toHaveBeenCalledTimes(readsBeforeSessionChange + 1));
  await settle(newLoad, 'resolve', list([beans]));
  await waitFor(() => expect(view.getByLabelText('Check Beans')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Check Beans'));
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledTimes(2));

  await settle(oldMutation, 'resolve', list([{ ...item(), isChecked: true }]));
  expect(view.queryByText('Rice')).toBeNull();
  expect(view.getByLabelText('Check Beans').props.accessibilityState.disabled).toBe(true);
  await settle(newMutation, 'resolve', list([{ ...beans, isChecked: true }]));
  expect(view.getByLabelText('Uncheck Beans')).toBeOnTheScreen();
});

it.each([
  ['resolve', 'resolve'], ['reject', 'resolve'],
  ['resolve', 'reject'], ['reject', 'reject'],
])('keeps the newer session GET in charge when old GET %ss and new GET %ss', async (oldOutcome, newOutcome) => {
  const oldLoad = deferred();
  const newLoad = deferred();
  const beans = item({ id: 'item-b', ingredientId: 'ingredient-b',
    ingredient: { id: 'ingredient-b', name: 'Beans' }, category: 'legume' });
  shoppingListService.getShoppingList
    .mockReturnValueOnce(oldLoad.promise)
    .mockReturnValueOnce(newLoad.promise);
  const view = render(<ShoppingListProvider><ShoppingListObserver /></ShoppingListProvider>);
  await waitFor(() => expect(shoppingListService.getShoppingList).toHaveBeenCalledTimes(1));

  mockAuth = { status: 'authenticated', user: { id: 'user-a' },
    sessionIdentity: { ownerId: 'user-a', generation: 2, localSessionRevision: 2 } };
  view.rerender(<ShoppingListProvider><ShoppingListObserver /></ShoppingListProvider>);
  await waitFor(() => expect(shoppingListService.getShoppingList).toHaveBeenCalledTimes(2));
  await settle(oldLoad, oldOutcome, oldOutcome === 'resolve' ? list([item()]) : new Error('old failure'));
  expect(observedShoppingList.status).toBe('loading');
  expect(observedShoppingList.items).toHaveLength(0);
  await act(async () => observedShoppingList.reload());
  expect(shoppingListService.getShoppingList).toHaveBeenCalledTimes(2);

  await settle(newLoad, newOutcome,
    newOutcome === 'resolve' ? list([beans]) : new Error('Current failure'));
  if (newOutcome === 'resolve') {
    expect(observedShoppingList.items).toEqual([beans]);
    expect(observedShoppingList.error).toBeNull();
    expect(observedShoppingList.status).toBe('ready');
  } else {
    expect(observedShoppingList.items).toHaveLength(0);
    expect(observedShoppingList.error).toBe('Current failure');
    expect(observedShoppingList.status).toBe('error');
  }
  shoppingListService.getShoppingList.mockResolvedValue(list([beans]));
  await act(async () => observedShoppingList.reload());
  expect(shoppingListService.getShoppingList).toHaveBeenCalledTimes(3);
  expect(observedShoppingList.items).toEqual([beans]);
  expect(observedShoppingList.status).toBe('ready');
});

it('does not let an unmounted edit response affect a remounted screen or its open modal', async () => {
  const request = deferred();
  const remountedItem = item({
    id: 'item-b',
    ingredientId: 'ingredient-b',
    ingredient: { id: 'ingredient-b', name: 'Beans' },
    category: 'legume',
    quantity: 1,
    unit: 'can',
  });
  let currentServerList = list([item()]);
  shoppingListService.getShoppingList.mockImplementation(() => Promise.resolve(currentServerList));
  shoppingListService.updateItem.mockReturnValue(request.promise);
  const oldView = renderScreen();
  await waitFor(() => expect(oldView.getByLabelText('Edit quantity and unit for Rice')).toBeOnTheScreen());
  fireEvent.press(oldView.getByLabelText('Edit quantity and unit for Rice'));
  fireEvent.changeText(oldView.getByLabelText('Quantity'), '6');
  fireEvent(oldView.getByLabelText('Save item changes'), 'accessibilityTap');
  expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-a', { type: 'ingredient', quantity: 6, unit: 'kg' });
  oldView.unmount();

  currentServerList = list([remountedItem]);
  const freshView = renderScreen();
  await waitFor(() => expect(freshView.getByLabelText('Edit quantity and unit for Beans')).toBeOnTheScreen());
  fireEvent.press(freshView.getByLabelText('Edit quantity and unit for Beans'));
  expect(freshView.getByText('Edit Shopping Item')).toBeOnTheScreen();
  expect(freshView.getByLabelText('Quantity').props.value).toBe('1');

  await settle(request, 'resolve', list([item({ quantity: 6 })]));
  expect(shoppingListService.updateItem).toHaveBeenCalledTimes(1);
  expect(freshView.getAllByText('Beans')).toHaveLength(2);
  expect(freshView.getByText('Edit Shopping Item')).toBeOnTheScreen();
  expect(freshView.getByLabelText('Quantity').props.value).toBe('1');
  expect(freshView.queryByText('6 kg')).toBeNull();
});

it.each([
  [1, 'Clear 1 checked item'],
  [2, 'Clear 2 checked items'],
])('shows the exact count-aware Clear Checked label for %i checked rows with no confirmation', async (count, label) => {
  const rows = [item({ isChecked: true })];
  if (count === 2) {
    rows.push(item({
      id: 'item-b', ingredientId: 'ingredient-b',
      ingredient: { id: 'ingredient-b', name: 'Beans' }, category: 'legume',
      quantity: 1, unit: 'can', isChecked: true,
    }));
  }
  shoppingListService.getShoppingList.mockResolvedValue(list(rows));
  shoppingListService.clearCheckedItems.mockResolvedValue(list([]));
  const view = renderScreen();

  await waitFor(() => expect(view.getByLabelText(label)).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText(label));

  await waitFor(() => expect(shoppingListService.clearCheckedItems).toHaveBeenCalledTimes(1));
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
  await waitFor(() => expect(view.queryByLabelText(label)).toBeNull());
});

it('hides Clear Checked at zero while preserving confirmed Clear All in Edit mode', async () => {
  shoppingListService.getShoppingList.mockResolvedValue(list([item()]));
  shoppingListService.clearItems.mockResolvedValue(list([]));
  const view = renderScreen();

  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  expect(view.queryByText(/Clear \d+ checked items?/)).toBeNull();
  fireEvent.press(view.getByLabelText('Edit shopping list'));
  fireEvent.press(view.getByLabelText('Clear shopping list'));

  const clearAlert = require('react-native').Alert.alert.mock.calls.at(-1);
  expect(clearAlert[0]).toBe('Clear shopping list?');
  await act(async () => clearAlert[2][1].onPress());
  expect(shoppingListService.clearItems).toHaveBeenCalledTimes(1);
});

it('reveals Delete only after a horizontal left swipe and deletes only after explicit activation', async () => {
  const rice = item();
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  shoppingListService.removeItem.mockResolvedValue(list([]));
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());

  const swipe = view.getByTestId('shopping-item-item-a-swipe');
  expect(swipe.props.onMoveShouldSetResponder({}, { dx: -6, dy: 40 })).toBe(false);
  expect(view.queryByLabelText('Delete Rice')).toBeNull();
  expect(swipe.props.onMoveShouldSetResponder({}, { dx: -60, dy: 3 })).toBe(true);
  act(() => {
    swipe.props.onResponderGrant({}, { dx: -60, dy: 3, vx: -1 });
    swipe.props.onResponderMove({}, { dx: -60, dy: 3, vx: -1 });
    swipe.props.onResponderRelease({}, { dx: -60, dy: 3, vx: -1 });
  });

  expect(view.getByLabelText('Delete Rice')).toBeOnTheScreen();
  expect(shoppingListService.removeItem).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Delete Rice'));
  await waitFor(() => expect(shoppingListService.removeItem).toHaveBeenCalledWith('item-a'));
});

it('keeps checkbox taps usable when a vertical gesture does not claim the row', async () => {
  const rice = item();
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  shoppingListService.updateItem.mockResolvedValue(list([{ ...rice, isChecked: true }]));
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());

  const swipe = view.getByTestId('shopping-item-item-a-swipe');
  expect(swipe.props.onMoveShouldSetResponder({}, { dx: -8, dy: 48 })).toBe(false);
  fireEvent.press(view.getByLabelText('Check Rice'));

  await waitFor(() => expect(shoppingListService.updateItem)
    .toHaveBeenCalledWith('item-a', { type: 'ingredient', isChecked: true }));
  expect(view.getByLabelText('Uncheck Rice')).toBeOnTheScreen();
});

it('does not let a delayed mounted refresh overwrite a newer successful mutation', async () => {
  const rice = item();
  const refresh = deferred();
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  shoppingListService.updateItem.mockResolvedValue(list([{ ...rice, isChecked: true }]));
  const view = renderScreen();

  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  const readsBeforeRefresh = shoppingListService.getShoppingList.mock.calls.length;
  shoppingListService.getShoppingList.mockReturnValueOnce(refresh.promise);
  const refreshControl = view.UNSAFE_getByType('ScrollView').props.refreshControl;
  let refreshPromise;
  act(() => {
    refreshPromise = refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(shoppingListService.getShoppingList)
    .toHaveBeenCalledTimes(readsBeforeRefresh + 1));

  fireEvent.press(view.getByLabelText('Check Rice'));
  await waitFor(() => expect(view.getByLabelText('Uncheck Rice')).toBeOnTheScreen());

  await act(async () => {
    refresh.resolve(list([rice]));
    await refreshPromise;
  });
  expect(view.getByLabelText('Uncheck Rice')).toBeOnTheScreen();
  expect(view.queryByLabelText('Check Rice')).toBeNull();
});

it('serializes same-frame conflicting mounted actions before React can rerender', async () => {
  const rice = item();
  const mutation = deferred();
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  shoppingListService.updateItem.mockReturnValue(mutation.promise);
  const view = renderScreen();

  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  const checkbox = view.getByLabelText('Check Rice');
  act(() => {
    fireEvent.press(checkbox);
    fireEvent.press(checkbox);
  });

  expect(shoppingListService.updateItem).toHaveBeenCalledTimes(1);
  expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-a', { type: 'ingredient', isChecked: true });
  await settle(mutation, 'resolve', list([{ ...rice, isChecked: true }]));
  expect(view.getByLabelText('Uncheck Rice')).toBeOnTheScreen();
});

it('keeps mutations blocked after failed reconciliation until mounted authoritative recovery succeeds', async () => {
  const rice = item();
  const stale = Object.assign(new Error('stale'), { code: 'SHOPPING_LIST_STALE', status: 409 });
  const failedRecovery = deferred();
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  shoppingListService.updateItem
    .mockRejectedValueOnce(stale)
    .mockResolvedValueOnce(list([rice]));
  const view = renderScreen();

  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  const readsBeforeMutation = shoppingListService.getShoppingList.mock.calls.length;
  shoppingListService.getShoppingList
    .mockReturnValueOnce(failedRecovery.promise)
    .mockResolvedValueOnce(list([{ ...rice, isChecked: true }]));
  fireEvent.press(view.getByLabelText('Check Rice'));
  await waitFor(() => expect(shoppingListService.getShoppingList)
    .toHaveBeenCalledTimes(readsBeforeMutation + 1));
  await settle(failedRecovery, 'reject', new Error('recovery offline'));

  await waitFor(() => expect(view.getByText('recovery offline Tap to retry.')).toBeOnTheScreen());
  expect(view.getByLabelText('Check Rice').props.accessibilityState.disabled).toBe(true);
  let blockedResult;
  await act(async () => {
    blockedResult = await observedShoppingList.setChecked('item-a', true);
  });
  expect(blockedResult).toEqual({
    ok: false,
    error: 'Refresh your shopping list before making another change.',
  });
  expect(shoppingListService.updateItem).toHaveBeenCalledTimes(1);

  fireEvent.press(view.getByLabelText('recovery offline. Retry loading shopping list'));
  await waitFor(() => expect(view.getByLabelText('Uncheck Rice')).toBeOnTheScreen());
  expect(view.getByLabelText('Uncheck Rice').props.accessibilityState.disabled).toBe(false);

  fireEvent.press(view.getByLabelText('Uncheck Rice'));
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledTimes(2));
});

it('does not let stale owner recovery overwrite state or unlock a newer owner mutation', async () => {
  const rice = item();
  const beans = item({
    id: 'item-b', ingredientId: 'ingredient-b',
    ingredient: { id: 'ingredient-b', name: 'Beans' }, category: 'legume',
    quantity: 1, unit: 'can',
  });
  const stale = Object.assign(new Error('stale'), { code: 'SHOPPING_LIST_STALE', status: 409 });
  const oldRecovery = deferred();
  const newOwnerLoad = deferred();
  const newOwnerMutation = deferred();
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  shoppingListService.updateItem
    .mockRejectedValueOnce(stale)
    .mockReturnValueOnce(newOwnerMutation.promise);
  const view = renderScreen();

  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  const readsBeforeMutation = shoppingListService.getShoppingList.mock.calls.length;
  shoppingListService.getShoppingList
    .mockReturnValueOnce(oldRecovery.promise)
    .mockReturnValueOnce(newOwnerLoad.promise);
  fireEvent.press(view.getByLabelText('Check Rice'));
  await waitFor(() => expect(shoppingListService.getShoppingList)
    .toHaveBeenCalledTimes(readsBeforeMutation + 1));

  mockAuth = {
    status: 'authenticated',
    user: { id: 'user-b' },
    sessionIdentity: { ownerId: 'user-b', generation: 2, localSessionRevision: 2 },
  };
  view.rerender(
    <ShoppingListProvider>
      <ShoppingListScreen navigation={{ goBack: jest.fn() }} />
    </ShoppingListProvider>
  );
  await waitFor(() => expect(shoppingListService.getShoppingList)
    .toHaveBeenCalledTimes(readsBeforeMutation + 2));
  await settle(newOwnerLoad, 'resolve', list([beans]));
  await waitFor(() => expect(view.getByLabelText('Check Beans')).toBeOnTheScreen());

  fireEvent.press(view.getByLabelText('Check Beans'));
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledTimes(2));
  await settle(oldRecovery, 'resolve', list([{ ...rice, isChecked: true }]));

  expect(view.getByText('Beans')).toBeOnTheScreen();
  expect(view.queryByText('Rice')).toBeNull();
  expect(view.getByLabelText('Check Beans').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Check Beans'));
  expect(shoppingListService.updateItem).toHaveBeenCalledTimes(2);

  await settle(newOwnerMutation, 'resolve', list([{ ...beans, isChecked: true }]));
  expect(view.getByLabelText('Uncheck Beans')).toBeOnTheScreen();
});

it('reconciles SHOPPING_LIST_STALE without replay and requires a new explicit action', async () => {
  const rice = item();
  const stale = Object.assign(new Error('stale'), { code: 'SHOPPING_LIST_STALE', status: 409 });
  shoppingListService.getShoppingList.mockImplementation(() => Promise.resolve(
    shoppingListService.updateItem.mock.calls.length > 0
      ? list([{ ...rice, isChecked: true }])
      : list([rice])
  ));
  shoppingListService.updateItem
    .mockRejectedValueOnce(stale)
    .mockResolvedValueOnce(list([rice]));
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  const readsBeforeMutation = shoppingListService.getShoppingList.mock.calls.length;

  fireEvent.press(view.getByLabelText('Check Rice'));
  await waitFor(() => expect(view.getByLabelText('Uncheck Rice')).toBeOnTheScreen());
  expect(shoppingListService.updateItem).toHaveBeenCalledTimes(1);
  expect(shoppingListService.getShoppingList).toHaveBeenCalledTimes(readsBeforeMutation + 1);

  fireEvent.press(view.getByLabelText('Uncheck Rice'));
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledTimes(2));
});

it('reconciles an ambiguous destructive outcome without replaying the delete', async () => {
  const rice = item();
  const network = Object.assign(new Error('offline'), { code: 'NETWORK_ERROR', kind: 'network' });
  shoppingListService.getShoppingList.mockImplementation(() => Promise.resolve(
    shoppingListService.removeItem.mock.calls.length > 0 ? list([]) : list([rice])
  ));
  shoppingListService.removeItem.mockRejectedValue(network);
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  const readsBeforeMutation = shoppingListService.getShoppingList.mock.calls.length;

  const swipe = view.getByTestId('shopping-item-item-a-swipe');
  act(() => {
    swipe.props.onResponderGrant({}, { dx: -70, dy: 2, vx: -1 });
    swipe.props.onResponderMove({}, { dx: -70, dy: 2, vx: -1 });
    swipe.props.onResponderRelease({}, { dx: -70, dy: 2, vx: -1 });
  });
  fireEvent.press(view.getByLabelText('Delete Rice'));

  await waitFor(() => expect(view.getByText('Your shopping list is empty')).toBeOnTheScreen());
  expect(shoppingListService.removeItem).toHaveBeenCalledTimes(1);
  expect(shoppingListService.getShoppingList).toHaveBeenCalledTimes(readsBeforeMutation + 1);
});

it('keeps a row visible after definitive delete failure and allows an explicit retry', async () => {
  const rice = item();
  const failure = Object.assign(new Error('Delete rejected'), {
    code: 'VALIDATION_ERROR', status: 400,
  });
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  shoppingListService.removeItem.mockRejectedValueOnce(failure).mockResolvedValueOnce(list([]));
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  const readsBeforeDelete = shoppingListService.getShoppingList.mock.calls.length;
  fireEvent.press(view.getByLabelText('Edit shopping list'));
  fireEvent.press(view.getByLabelText('Remove Rice'));
  await waitFor(() => expect(require('react-native').Alert.alert)
    .toHaveBeenCalledWith('Could not remove item', 'Delete rejected'));
  expect(view.getByText('Rice')).toBeOnTheScreen();
  expect(view.getByLabelText('Remove Rice')).toBeOnTheScreen();
  expect(shoppingListService.removeItem).toHaveBeenCalledTimes(1);
  expect(shoppingListService.getShoppingList).toHaveBeenCalledTimes(readsBeforeDelete);
  fireEvent.press(view.getByLabelText('Remove Rice'));
  await waitFor(() => expect(view.getByText('Your shopping list is empty')).toBeOnTheScreen());
  expect(shoppingListService.removeItem).toHaveBeenCalledTimes(2);
});

it.each(['checked', 'remove', 'clearChecked'])('suppresses a stale %s error after blur and alerts on a new focused action', async (action) => {
  const rice = item({ isChecked: action === 'clearChecked' });
  const first = deferred();
  const failure = new Error('Current failure');
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  const method = action === 'checked' ? shoppingListService.updateItem
    : action === 'remove' ? shoppingListService.removeItem
      : shoppingListService.clearCheckedItems;
  method.mockReturnValueOnce(first.promise).mockRejectedValueOnce(failure);
  const view = renderScreen();
  await waitFor(() => expect(view.getByText('Rice')).toBeOnTheScreen());
  const pressAction = () => {
    if (action === 'checked') fireEvent.press(view.getByLabelText('Check Rice'));
    if (action === 'remove') fireEvent.press(view.getByLabelText('Remove Rice'));
    if (action === 'clearChecked') fireEvent.press(view.getByLabelText('Clear 1 checked item'));
  };
  if (action === 'remove') fireEvent.press(view.getByLabelText('Edit shopping list'));
  pressAction();
  await waitFor(() => expect(method).toHaveBeenCalledTimes(1));
  act(() => mockBlurEffect());
  await settle(first, 'reject', new Error('Old failure'));
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
  act(() => { mockBlurEffect = focusedEffect(); });
  pressAction();
  await waitFor(() => expect(method).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(require('react-native').Alert.alert)
    .toHaveBeenCalledWith(expect.any(String), 'Current failure'));
});

it('does not alert after the screen unmounts while its provider finishes a mutation', async () => {
  const rice = item();
  const request = deferred();
  shoppingListService.getShoppingList.mockResolvedValue(list([rice]));
  shoppingListService.updateItem.mockReturnValue(request.promise);
  const view = renderScreen();
  await waitFor(() => expect(view.getByLabelText('Check Rice')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Check Rice'));
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledTimes(1));
  view.rerender(<ShoppingListProvider><ShoppingListObserver /></ShoppingListProvider>);
  await settle(request, 'reject', new Error('Old screen failure'));
  expect(require('react-native').Alert.alert).not.toHaveBeenCalled();
  expect(observedShoppingList.items).toEqual([rice]);
});

describe('locked substitute picker', () => {
  it('opens from Swap Detail with the exact validated substitute identity and context mutation path', async () => {
    shoppingListService.getShoppingList.mockResolvedValue(list([]));
    shoppingListService.addItem.mockResolvedValue(list([item({
      ingredientId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      ingredient: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Aquafaba' },
      quantity: 2,
      unit: 'tbsp',
    })]));
    const route = { params: {
      sourceIngredient: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Egg' },
      substitution: {
        id: 'cccccccccccccccccccccccc',
        source: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Egg' },
        substitute: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Aquafaba' },
        contexts: ['baking'],
        notes: null,
      },
    } };
    const view = render(
      <ShoppingListProvider>
        <SwapDetailScreen navigation={{ goBack: jest.fn() }} route={route} />
      </ShoppingListProvider>
    );
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByText('Add Substitute to Shopping'));
    expect(view.getByText('Locked catalog ingredient')).toBeOnTheScreen();
    fireEvent.press(view.getByLabelText('tbsp unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '2');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');
    await waitFor(() => expect(shoppingListService.addItem).toHaveBeenCalledWith({
      ingredientId: 'bbbbbbbbbbbbbbbbbbbbbbbb', unit: 'tbsp', quantity: 2,
    }));
    await waitFor(() => expect(view.getByText('Added to Shopping List')).toBeOnTheScreen());
  });

  it('seeds the exact canonical substitute while leaving unit and quantity unset', () => {
    const view = renderLockedPicker();
    expect(view.getByText('Aquafaba')).toBeOnTheScreen();
    expect(view.getByText('Locked catalog ingredient')).toBeOnTheScreen();
    expect(view.queryByText('Change')).toBeNull();
    expect(view.queryByLabelText('Quantity')).toBeNull();
    expect(view.getByLabelText('Add item to shopping list').props.accessibilityState.disabled).toBe(true);
  });

  it('submits an explicit measurable quantity and unit only after authoritative success', async () => {
    const request = deferred();
    const view = renderLockedPicker({ onAdd: jest.fn(() => request.promise) });
    fireEvent.press(view.getByLabelText('kg unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '2.5');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');

    expect(view.props.onAdd).toHaveBeenCalledWith({
      ingredientId: 'aaaaaaaaaaaaaaaaaaaaaaaa', unit: 'kg', quantity: 2.5,
    });
    expect(view.props.onAdded).not.toHaveBeenCalled();
    expect(view.props.onClose).not.toHaveBeenCalled();
    expect(view.getByLabelText('Close add item').props.accessibilityState.disabled).toBe(true);

    await settle(request, 'resolve', { ok: true });
    expect(view.props.onAdded).toHaveBeenCalledTimes(1);
    expect(view.props.onClose).toHaveBeenCalledTimes(1);
  });

  it('submits explicit toTaste without a quantity', async () => {
    const view = renderLockedPicker();
    fireEvent.press(view.getByLabelText('to taste unit'));
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');
    await waitFor(() => expect(view.props.onAdd).toHaveBeenCalledWith({
      ingredientId: 'aaaaaaaaaaaaaaaaaaaaaaaa', unit: 'toTaste', quantity: undefined,
    }));
  });

  it('uses a synchronous submit lock so rapid Save issues one mutation', () => {
    const view = renderLockedPicker({ onAdd: jest.fn(() => new Promise(() => {})) });
    fireEvent.press(view.getByLabelText('kg unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '3');
    const save = view.getByLabelText('Add item to shopping list');
    act(() => {
      save.props.onAccessibilityTap();
      save.props.onAccessibilityTap();
    });
    expect(view.props.onAdd).toHaveBeenCalledTimes(1);
  });

  it('keeps same-frame header Close behind the synchronous submit lock', async () => {
    const request = deferred();
    const view = renderLockedPicker({ onAdd: jest.fn(() => request.promise) });
    fireEvent.press(view.getByLabelText('kg unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '3');
    const save = view.getByLabelText('Add item to shopping list');
    const close = view.getByLabelText('Close add item');

    act(() => {
      save.props.onAccessibilityTap();
      close.props.onPress();
    });

    expect(view.props.onAdd).toHaveBeenCalledTimes(1);
    expect(view.props.onClose).not.toHaveBeenCalled();
    await settle(request, 'resolve', { ok: true });
    expect(view.props.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['archived ingredient', 'That ingredient is unavailable.'],
    ['list limit', 'Your shopping list is full.'],
    ['network failure', 'Shopping is temporarily unavailable.'],
    ['busy mutation', null],
  ])('keeps the draft open for %s', async (_label, message) => {
    const result = message ? { ok: false, error: message } : { ok: false, busy: true };
    const view = renderLockedPicker({ onAdd: jest.fn(async () => result) });
    fireEvent.press(view.getByLabelText('kg unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '4');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');
    const expected = message || 'Another change is still saving. Try again in a moment.';
    await waitFor(() => expect(view.getByText(expected)).toBeOnTheScreen());
    expect(view.props.onClose).not.toHaveBeenCalled();
    expect(view.getByLabelText('Quantity').props.value).toBe('4');
  });

  it('ignores an old completion after close and reopen', async () => {
    const request = deferred();
    const oldClose = jest.fn();
    const newClose = jest.fn();
    const base = {
      lockedIngredient: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Aquafaba' },
      onAdd: jest.fn(() => request.promise),
      onAdded: jest.fn(),
    };
    const view = render(<IngredientPickerModal {...base} visible onClose={oldClose} />);
    fireEvent.press(view.getByLabelText('kg unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '2');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');
    view.rerender(<IngredientPickerModal {...base} visible={false} onClose={oldClose} />);
    view.rerender(<IngredientPickerModal {...base} visible onClose={newClose} />);
    await settle(request, 'resolve', { ok: true });
    expect(oldClose).not.toHaveBeenCalled();
    expect(newClose).not.toHaveBeenCalled();
    expect(base.onAdded).not.toHaveBeenCalled();
    expect(view.getByText('Aquafaba')).toBeOnTheScreen();
  });

  it('keeps a reopened modal draft and save ownership when the prior session rejects', async () => {
    const oldRequest = deferred();
    const currentRequest = deferred();
    const oldClose = jest.fn();
    const currentClose = jest.fn();
    const onAdded = jest.fn();
    const onAdd = jest.fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);
    const base = {
      lockedIngredient: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Aquafaba' },
      onAdd,
      onAdded,
    };
    const view = render(<IngredientPickerModal {...base} visible onClose={oldClose} />);
    fireEvent.press(view.getByLabelText('kg unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '2');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');

    view.rerender(<IngredientPickerModal {...base} visible={false} onClose={oldClose} />);
    view.rerender(<IngredientPickerModal {...base} visible onClose={currentClose} />);
    fireEvent.press(view.getByLabelText('cup unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '7');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(view.getByLabelText('Close add item').props.accessibilityState.disabled).toBe(true);

    await settle(oldRequest, 'reject', new Error('old session failed'));

    expect(view.getByText('Add Item')).toBeOnTheScreen();
    expect(view.getByLabelText('Quantity').props.value).toBe('7');
    expect(view.getByLabelText('cup unit').props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText('Close add item').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('Add item to shopping list').props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(view.queryByText(/Couldn.t add that item/)).toBeNull();
    expect(oldClose).not.toHaveBeenCalled();
    expect(currentClose).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();

    await settle(currentRequest, 'resolve', { ok: true });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(currentClose).toHaveBeenCalledTimes(1);
  });

  it('ignores old completion after account change or unmount', async () => {
    const accountRequest = deferred();
    const close = jest.fn();
    const props = {
      visible: true,
      lockedIngredient: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Aquafaba' },
      onAdd: jest.fn(() => accountRequest.promise),
      onClose: close,
      onAdded: jest.fn(),
    };
    const view = render(<IngredientPickerModal {...props} />);
    fireEvent.press(view.getByLabelText('kg unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '2');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');
    mockAuth = { status: 'authenticated', user: { id: 'user-b' } };
    view.rerender(<IngredientPickerModal {...props} />);
    await settle(accountRequest, 'resolve', { ok: true });
    expect(close).not.toHaveBeenCalled();
    expect(props.onAdded).not.toHaveBeenCalled();

    const unmountRequest = deferred();
    const unmountProps = { ...props, onAdd: jest.fn(() => unmountRequest.promise) };
    const unmounted = render(<IngredientPickerModal {...unmountProps} />);
    fireEvent.press(unmounted.getByLabelText('kg unit'));
    fireEvent.changeText(unmounted.getByLabelText('Quantity'), '2');
    fireEvent(unmounted.getByLabelText('Add item to shopping list'), 'accessibilityTap');
    unmounted.unmount();
    await settle(unmountRequest, 'resolve', { ok: true });
    expect(close).not.toHaveBeenCalled();
    expect(props.onAdded).not.toHaveBeenCalled();
  });

  it('keeps the new account draft and save ownership when the prior account rejects', async () => {
    const userARequest = deferred();
    const userBRequest = deferred();
    const close = jest.fn();
    const onAdded = jest.fn();
    const onAdd = jest.fn()
      .mockReturnValueOnce(userARequest.promise)
      .mockReturnValueOnce(userBRequest.promise);
    const props = {
      visible: true,
      lockedIngredient: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Aquafaba' },
      onAdd,
      onClose: close,
      onAdded,
    };
    const view = render(<IngredientPickerModal {...props} />);
    fireEvent.press(view.getByLabelText('kg unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '2');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');

    mockAuth = { status: 'authenticated', user: { id: 'user-b' } };
    view.rerender(<IngredientPickerModal {...props} />);
    fireEvent.press(view.getByLabelText('tbsp unit'));
    fireEvent.changeText(view.getByLabelText('Quantity'), '5');
    fireEvent(view.getByLabelText('Add item to shopping list'), 'accessibilityTap');
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(view.getByLabelText('Close add item').props.accessibilityState.disabled).toBe(true);

    await settle(userARequest, 'reject', new Error('user A failed'));

    expect(view.getByText('Add Item')).toBeOnTheScreen();
    expect(view.getByLabelText('Quantity').props.value).toBe('5');
    expect(view.getByLabelText('tbsp unit').props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText('Close add item').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('Add item to shopping list').props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(view.queryByText(/Couldn.t add that item/)).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();

    await settle(userBRequest, 'resolve', { ok: false, error: 'User B current failure.' });
    expect(view.getByText('User B current failure.')).toBeOnTheScreen();
    expect(view.getByLabelText('Quantity').props.value).toBe('5');
    expect(view.getByLabelText('Close add item').props.accessibilityState.disabled).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });
});
