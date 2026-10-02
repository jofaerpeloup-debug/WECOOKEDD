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
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => {
    const React = require('react');
    focusedEffect = callback;
    React.useEffect(callback, [callback]);
  },
}));

let mockAuth = { status: 'authenticated', user: { id: 'user-a' } };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/api/shoppingListService', () => ({
  addItem: jest.fn(),
  addRecipe: jest.fn(),
  clearItems: jest.fn(),
  getShoppingList: jest.fn(),
  removeItem: jest.fn(),
  updateItem: jest.fn(),
}));
jest.mock('../src/api/shoppingListErrors', () => ({
  getShoppingListErrorMessage: (error) => error?.message || 'Shopping request failed.',
  isItemAlreadyGone: () => false,
}));

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const shoppingListService = require('../src/api/shoppingListService');
const { ShoppingListProvider } = require('../src/context/ShoppingListContext');
const ShoppingItemEditModal = require('../src/components/ShoppingItemEditModal').default;
const ShoppingListScreen = require('../src/screens/ShoppingListScreen').default;

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

function renderScreen() {
  return render(
    <ShoppingListProvider>
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

async function settle(request, method, value) {
  await act(async () => {
    request[method](value);
    await request.promise.catch(() => undefined);
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth = { status: 'authenticated', user: { id: 'user-a' } };
  focusedEffect = undefined;
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
  expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-a', { quantity: 2.5, unit: 'cup' });
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
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-b', { quantity: 5, unit: 'piece' }));
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
  await waitFor(() => expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-a', { isChecked: true }));
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

  mockAuth = { status: 'authenticated', user: { id: 'user-b' } };
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
  expect(shoppingListService.updateItem).toHaveBeenCalledWith('item-a', { quantity: 6, unit: 'kg' });
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
