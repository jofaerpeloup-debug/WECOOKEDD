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
      type: 'ingredient',
      source: { kind: 'legacy' },
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
    api[method].mockResolvedValue({ shoppingListFormat: 2, shoppingList: list });
  }

  await expect(shoppingListService.getShoppingList()).resolves.toBe(list);
  await expect(shoppingListService.addItem({
    ingredientId: INGREDIENT_ID, quantity: 2, unit: 'kg',
  })).resolves.toBe(list);
  await expect(shoppingListService.addRecipe(RECIPE_ID)).resolves.toBe(list);
  await expect(shoppingListService.addCustomItem('Milk')).resolves.toBe(list);
  await expect(shoppingListService.updateItem(ITEM_ID, { type: 'ingredient', isChecked: true })).resolves.toBe(list);
  await expect(shoppingListService.removeItem(ITEM_ID)).resolves.toBe(list);
  await expect(shoppingListService.clearCheckedItems()).resolves.toBe(list);
  await expect(shoppingListService.clearItems()).resolves.toBe(list);

  expect(api.get).toHaveBeenCalledWith('/shopping-list/v2');
  expect(api.del).toHaveBeenNthCalledWith(1, `/shopping-list/v2/items/${ITEM_ID}`);
  expect(api.del).toHaveBeenNthCalledWith(2, '/shopping-list/v2/items/checked');
  expect(api.del).toHaveBeenNthCalledWith(3, '/shopping-list/v2/items');
});

it.each([
  ['missing envelope data', {}],
  ['missing shoppingList', { other: validList() }],
  ['extra list field', { shoppingListFormat: 2, shoppingList: { ...validList(), __v: 4 } }],
  ['non-array items', { shoppingListFormat: 2, shoppingList: validList({ items: null }) }],
  ['malformed row', { shoppingListFormat: 2, shoppingList: validList({ items: [{ id: ITEM_ID }] }) }],
  ['duplicate row ids', { shoppingListFormat: 2, shoppingList: validList({
    items: [validList().items[0], { ...validList().items[0] }],
  }) }],
  ['invalid timestamp', { shoppingListFormat: 2, shoppingList: validList({ updatedAt: 'today' }) }],
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
      type: 'ingredient',
      source: { kind: 'legacy' },
    }],
  });
  api.get.mockResolvedValue({ shoppingListFormat: 2, shoppingList: list });
  await expect(shoppingListService.getShoppingList()).resolves.toBe(list);
});

it('accepts a null category on an active ingredient while retaining strict mixed-row validation', async () => {
  const known = validList().items[0];
  const unknownCategory = { ...known, id: RECIPE_ID, category: null };
  const list = validList({ items: [known, unknownCategory] });
  api.get.mockResolvedValue({ shoppingListFormat: 2, shoppingList: list });
  await expect(shoppingListService.getShoppingList()).resolves.toBe(list);

  for (const invalid of [
    { ...unknownCategory, category: 'invented' },
    { ...unknownCategory, category: undefined },
    { ...unknownCategory, quantity: '2' },
    { ...unknownCategory, isChecked: 'false' },
    { ...unknownCategory, extra: true },
  ]) {
    api.get.mockResolvedValue({ shoppingListFormat: 2, shoppingList: validList({ items: [known, invalid] }) });
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

const acceptedShop5Labels = [["\"Milk\"","Milk"],["\"\\uAE40\\uCE58\"","김치"],["\"\\u5BFF\\u53F8\"","寿司"],["\"Cafe\\u0301\"","Café"],["\"\\u0020Milk\\u00A0\"","Milk"],["\"\\u0645\\u06CC\\u200C\\u0631\\u0648\\u0645\"","می‌روم"],["\"\\uD83C\\uDF4E\"","🍎"],["\"\\uD83D\\uDC69\\u200D\\uD83C\\uDF73\"","👩‍🍳"]];
const rejectedShop5Labels = ["\"\\u2800\"","\"\\u3164\"","\"\\uFFA0\"","\"\\u115F\"","\"\\u1160\"","\"\\u115F\\u1160\"","\"\\u2800\\u3164\\uFFA0\"","\"\\u0020\\u2800\\u00A0\"","\"Milk\\u2800\"","\"Milk\\u3164\"","\"Milk\\uFFA0\"","\"\\u200B\"","\"Milk\\u200B\"","\"\\u0301\"","\"\\u200D\"","\"A\\u200D\"","\"A\\u200D\\u200DB\"","\"\\u00ADMilk\""];

it('SHOP5 mobile label validator matches every literal Unicode vector', () => {
  expect(acceptedShop5Labels).toHaveLength(8);
  expect(rejectedShop5Labels).toHaveLength(18);
  const { normalizeCustomLabel } = require('../src/utils/shoppingCustomLabel');
  for (const [token, expected] of acceptedShop5Labels) {
    expect(normalizeCustomLabel(JSON.parse(token))).toBe(expected);
  }
  for (const token of rejectedShop5Labels) {
    expect(normalizeCustomLabel(JSON.parse(token))).toBeNull();
  }
  expect(normalizeCustomLabel('A'.repeat(80))).toBe('A'.repeat(80));
  expect(normalizeCustomLabel('A'.repeat(81))).toBeNull();
  for (const invalid of ['A\u200D ', 'Milk\u2060', 'Milk\uFEFF', 'Milk\u202E', 'Milk\u0001', '\uD800']) {
    expect(normalizeCustomLabel(invalid)).toBeNull();
  }
});

it('SHOP5 parser accepts exact source variants and custom rows, rejects extra fields', () => {
  const base = validList().items[0];
  const custom = { id: RECIPE_ID, type: 'custom', label: 'Milk', isChecked: false };
  for (const source of [
    { kind: 'legacy' }, { kind: 'manual' },
    { kind: 'single', title: 'Recipe A', quantityEdited: false },
    { kind: 'single', title: 'Recipe A', quantityEdited: true },
    { kind: 'multiple', quantityEdited: false },
    { kind: 'multiple', quantityEdited: true },
    { kind: 'unavailable', quantityEdited: false },
    { kind: 'unavailable', quantityEdited: true },
  ]) {
    const data = { shoppingListFormat: 2,
      shoppingList: validList({ items: [{ ...base, source }, custom] }) };
    expect(shoppingListService.parseShoppingListResponse(data)).toBe(data.shoppingList);
  }
  for (const source of [
    { kind: 'single', title: 'Recipe A' },
    { kind: 'multiple', quantityEdited: 'false' },
    { kind: 'unavailable', quantityEdited: false, title: 'Hidden' },
  ]) {
    expect(() => shoppingListService.parseShoppingListResponse({
      shoppingListFormat: 2, shoppingList: validList({ items: [{ ...base, source }] }),
    })).toThrow(/malformed/);
  }
  expect(() => shoppingListService.parseShoppingListResponse({
    shoppingListFormat: 3, shoppingList: validList(),
  })).toThrow(/malformed/);
});

it('SHOP5 maps only the old backend v2 GET missing route', async () => {
  api.get.mockRejectedValue(new ApiError('missing', { code: 'ROUTE_NOT_FOUND', status: 404 }));
  await expect(shoppingListService.getShoppingList()).rejects.toMatchObject({
    code: 'SHOPPING_LIST_SERVER_UPGRADE_REQUIRED', status: 426,
  });
  api.get.mockRejectedValue(new ApiError('missing', { code: 'OTHER', status: 404 }));
  await expect(shoppingListService.getShoppingList()).rejects.toMatchObject({ code: 'OTHER' });
  api.del.mockRejectedValue(new ApiError('missing', { code: 'ROUTE_NOT_FOUND', status: 404 }));
  await expect(shoppingListService.removeItem(ITEM_ID)).rejects.toMatchObject({
    code: 'ROUTE_NOT_FOUND', status: 404,
  });
  expect(api.del).toHaveBeenCalledWith(`/shopping-list/v2/items/${ITEM_ID}`);
});
