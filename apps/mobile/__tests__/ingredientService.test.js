jest.mock('../src/api/client', () => ({ api: { get: jest.fn() } }));

const { api } = require('../src/api/client');
const { searchIngredients, searchIngredientsStrict } = require('../src/api/ingredientService');

const ingredient = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: ' Apple ' };
const page = (number, total = 21) => ({ page: number, limit: 20, total, totalPages: Math.ceil(total / 20) });

beforeEach(() => jest.clearAllMocks());

it('keeps the legacy query and response shape when page is omitted', async () => {
  api.get.mockResolvedValue({ ingredients: [ingredient], pagination: null });
  await expect(searchIngredients({ search: ' apple ' })).resolves.toEqual({
    ingredients: [{ id: ingredient.id, name: ingredient.name, category: null, aliases: [] }],
    pagination: null,
  });
  expect(api.get).toHaveBeenCalledWith('/ingredients', { query: { search: 'apple', limit: 20 } });
  await expect(searchIngredientsStrict({ search: ' apple ' })).resolves.toEqual({
    ingredients: [{ id: ingredient.id, name: 'Apple', category: null, aliases: [] }],
    pagination: null,
  });
});

it('passes an explicit page and validates server pagination', async () => {
  api.get.mockResolvedValue({ ingredients: [ingredient], pagination: page(2) });
  await expect(searchIngredientsStrict({ page: 2, limit: 20 })).resolves.toMatchObject({ pagination: page(2) });
  expect(api.get).toHaveBeenCalledWith('/ingredients', { query: { limit: 20, page: 2 } });
});

it.each([
  null,
  { page: 1, limit: 20, total: 21, totalPages: 2 },
  { page: 2, limit: 20, total: -1, totalPages: 2 },
  { page: 2, limit: 20, total: 21, totalPages: 1 },
  { page: 2, limit: 20, total: 21, totalPages: '2' },
])('rejects malformed page metadata %#', async (pagination) => {
  api.get.mockResolvedValue({ ingredients: [], pagination });
  await expect(searchIngredientsStrict({ page: 2 })).rejects.toThrow(/malformed/);
});

it.each([
  { ingredients: [ingredient], pagination: page(1, 0) },
  { ingredients: [ingredient], pagination: { page: 1, limit: 20, total: 20, totalPages: 0 } },
  { ingredients: [ingredient, { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Banana' }], pagination: page(1, 1) },
  { ingredients: [ingredient, { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Banana' }], pagination: page(2, 21) },
  { ingredients: Array.from({ length: 21 }, (_, index) => ({ id: String(index), name: `Ingredient ${index}` })), pagination: page(1, 21) },
])('rejects result rows that contradict pagination totals or limit %#', async (response) => {
  api.get.mockResolvedValue(response);
  await expect(searchIngredientsStrict({ page: response.pagination.page })).rejects.toThrow(/malformed/);
});

it.each([
  { ingredients: [], pagination: page(1, 0) },
  { ingredients: [], pagination: page(1, 21) },
  { ingredients: [], pagination: page(2, 21) },
])('preserves valid empty page responses %#', async (response) => {
  api.get.mockResolvedValue(response);
  await expect(searchIngredientsStrict({ page: response.pagination.page })).resolves.toEqual(response);
});

it('accepts the single remaining result on the final page', async () => {
  api.get.mockResolvedValue({ ingredients: [ingredient], pagination: page(2, 21) });
  await expect(searchIngredientsStrict({ page: 2 })).resolves.toMatchObject({
    ingredients: [{ id: ingredient.id, name: 'Apple' }],
    pagination: page(2, 21),
  });
});

it('rejects invalid page before a request', () => {
  expect(() => searchIngredientsStrict({ page: 0 })).toThrow(/Invalid ingredient page/);
  expect(api.get).not.toHaveBeenCalled();
});
