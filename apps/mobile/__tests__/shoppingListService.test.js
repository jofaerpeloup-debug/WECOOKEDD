class MockApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status = 0, kind = 'api' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.kind = kind;
  }

  get isNetworkError() {
    return this.kind === 'network';
  }
}

jest.mock('../src/api/client', () => ({
  ApiError: MockApiError,
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    del: jest.fn(),
  },
}));

const { api, ApiError } = require('../src/api/client');
const shoppingListService = require('../src/api/shoppingListService');
const {
  getShoppingListErrorMessage,
  isAmbiguousShoppingMutationOutcome,
  isItemAlreadyGone,
  isShoppingListStale,
} = require('../src/api/shoppingListErrors');

const LIST_ID = '507f1f77bcf86cd799439001';
const ITEM_ID = '507f1f77bcf86cd799439002';
const INGREDIENT_ID = '507f1f77bcf86cd799439003';
const RECIPE_ID = '507f1f77bcf86cd799439004';

function validList(overrides = {}) {
  return {
    id: LIST_ID,
    items: [{
      id: ITEM_ID,
      ingredient: { id: INGREDIENT_ID, name: 'Rice' },
      ingredientId: INGREDIENT_ID,
      isAvailable: true,
      category: 'grain',
      quantity: 2,
      unit: 'kg',
      isChecked: false,
    }],
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:01.000Z',
    ...overrides,
  };
}

beforeEach(() => jest.resetAllMocks());

it('uses the frozen endpoints and returns each complete authoritative list unchanged', async () => {
  const list = validList();
  for (const method of ['get', 'post', 'patch', 'del']) {
    api[method].mockResolvedValue({ shoppingList: list });
  }

  await expect(shoppingListService.getShoppingList()).resolves.toBe(list);
  await expect(shoppingListService.addItem({
    ingredientId: INGREDIENT_ID, quantity: 2, unit: 'kg',
  })).resolves.toBe(list);
  await expect(shoppingListService.addRecipe(RECIPE_ID)).resolves.toBe(list);
  await expect(shoppingListService.updateItem(ITEM_ID, { isChecked: true })).resolves.toBe(list);
  await expect(shoppingListService.removeItem(ITEM_ID)).resolves.toBe(list);
  await expect(shoppingListService.clearCheckedItems()).resolves.toBe(list);
  await expect(shoppingListService.clearItems()).resolves.toBe(list);

  expect(api.del).toHaveBeenNthCalledWith(1, `/shopping-list/items/${ITEM_ID}`);
  expect(api.del).toHaveBeenNthCalledWith(2, '/shopping-list/items/checked');
  expect(api.del).toHaveBeenNthCalledWith(3, '/shopping-list/items');
});

it.each([
  ['missing envelope data', {}],
  ['missing shoppingList', { other: validList() }],
  ['extra list field', { shoppingList: { ...validList(), __v: 4 } }],
  ['non-array items', { shoppingList: validList({ items: null }) }],
  ['malformed row', { shoppingList: validList({ items: [{ id: ITEM_ID }] }) }],
  ['duplicate row ids', { shoppingList: validList({
    items: [validList().items[0], { ...validList().items[0] }],
  }) }],
  ['invalid timestamp', { shoppingList: validList({ updatedAt: 'today' }) }],
])('rejects malformed 2xx data without producing fallback state: %s', async (_case, data) => {
  api.get.mockResolvedValue(data);

  await expect(shoppingListService.getShoppingList()).rejects.toMatchObject({
    code: 'INVALID_RESPONSE', status: 502,
  });
});

it('accepts unavailable and toTaste rows only in their exact serialized shapes', async () => {
  const list = validList({
    items: [{
      id: ITEM_ID,
      ingredient: null,
      ingredientId: INGREDIENT_ID,
      isAvailable: false,
      category: null,
      quantity: null,
      unit: 'toTaste',
      isChecked: true,
    }],
  });
  api.get.mockResolvedValue({ shoppingList: list });
  await expect(shoppingListService.getShoppingList()).resolves.toBe(list);
});

it('accepts a null category on an active ingredient while retaining strict mixed-row validation', async () => {
  const known = validList().items[0];
  const unknownCategory = { ...known, id: RECIPE_ID, category: null };
  const list = validList({ items: [known, unknownCategory] });
  api.get.mockResolvedValue({ shoppingList: list });
  await expect(shoppingListService.getShoppingList()).resolves.toBe(list);

  for (const invalid of [
    { ...unknownCategory, category: 'invented' },
    { ...unknownCategory, category: undefined },
    { ...unknownCategory, quantity: '2' },
    { ...unknownCategory, isChecked: 'false' },
    { ...unknownCategory, extra: true },
  ]) {
    api.get.mockResolvedValue({ shoppingList: validList({ items: [known, invalid] }) });
    await expect(shoppingListService.getShoppingList()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', status: 502,
    });
  }
});

it('classifies delete idempotency only by the exact backend code', () => {
  expect(isItemAlreadyGone(new ApiError('gone', {
    code: 'SHOPPING_LIST_ITEM_NOT_FOUND', status: 404,
  }))).toBe(true);
  expect(isItemAlreadyGone(new ApiError('other 404', {
    code: 'HTTP_404', status: 404,
  }))).toBe(false);
});

it('classifies stale and ambiguous outcomes without treating ordinary 4xx as unknown', () => {
  expect(isShoppingListStale(new ApiError('stale', {
    code: 'SHOPPING_LIST_STALE', status: 409,
  }))).toBe(true);
  expect(isAmbiguousShoppingMutationOutcome(new ApiError('offline', {
    code: 'NETWORK_ERROR', kind: 'network',
  }))).toBe(true);
  expect(isAmbiguousShoppingMutationOutcome(new ApiError('malformed', {
    code: 'INVALID_RESPONSE', status: 502,
  }))).toBe(true);
  expect(isAmbiguousShoppingMutationOutcome(new ApiError('bad request', {
    code: 'VALIDATION_ERROR', status: 400,
  }))).toBe(false);
  expect(getShoppingListErrorMessage(new ApiError('raw', {
    code: 'SHOPPING_LIST_STALE', status: 409,
  }))).toMatch(/changed elsewhere/);
});
