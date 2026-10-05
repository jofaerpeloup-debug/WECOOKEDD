jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    constructor(message, opts = {}) {
      super(message);
      this.name = 'ApiError';
      Object.assign(this, { code: 'UNKNOWN', status: 0, details: [], kind: 'api' }, opts);
    }
  }
  return {
    api: { get: jest.fn() },
    ApiError,
  };
});

const { api } = require('../src/api/client');
const { getSubstitutesFor } = require('../src/api/substitutionService');

const SOURCE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SUBSTITUTE_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const RELATION_ID = 'cccccccccccccccccccccccc';

function row(overrides = {}) {
  return {
    id: RELATION_ID,
    sourceIngredient: { id: SOURCE_ID, name: 'Egg' },
    substituteIngredient: { id: SUBSTITUTE_ID, name: 'Aquafaba' },
    ratio: { sourceAmount: 1, substituteAmount: 3 },
    notes: 'Adjust to taste.',
    contexts: ['baking'],
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('substitutionService recipe-ingredient boundary', () => {
  it.each([undefined, '', 'r4', 'not-an-object-id'])(
    'rejects a non-canonical ingredient id without issuing a request',
    async (id) => {
      await expect(getSubstitutesFor(id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(api.get).not.toHaveBeenCalled();
    }
  );

  it('queries one canonical ingredient and drops unsupported ratio semantics', async () => {
    api.get.mockResolvedValue({
      substitutions: [
        {
          ...row(),
        },
      ],
    });

    await expect(getSubstitutesFor(SOURCE_ID)).resolves.toEqual({
      substitutes: [
        {
          id: RELATION_ID,
          source: { id: SOURCE_ID, name: 'Egg' },
          substitute: { id: SUBSTITUTE_ID, name: 'Aquafaba' },
          notes: 'Adjust to taste.',
          contexts: ['baking'],
        },
      ],
    });
    expect(api.get).toHaveBeenCalledWith('/substitutions', {
      query: { sourceIngredientId: 'aaaaaaaaaaaaaaaaaaaaaaaa', limit: 100 },
    });
  });

  it('accepts an exact empty substitutions array', async () => {
    api.get.mockResolvedValue({ substitutions: [] });
    await expect(getSubstitutesFor(SOURCE_ID)).resolves.toEqual({ substitutes: [] });
  });

  it.each([
    undefined,
    null,
    {},
    { substitutions: null },
    { substitutions: {} },
    { substitutions: 'none' },
  ])('rejects malformed collection payload %# as unavailable', async (payload) => {
    api.get.mockResolvedValue(payload);
    await expect(getSubstitutesFor(SOURCE_ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    ['wrong source', row({ sourceIngredient: { id: 'dddddddddddddddddddddddd', name: 'Milk' } })],
    ['inactive relation', row({ isActive: false })],
    ['missing relation id', row({ id: null })],
    ['malformed substitute', row({ substituteIngredient: { id: SUBSTITUTE_ID, name: '  ' } })],
    ['same source and substitute', row({ substituteIngredient: { id: SOURCE_ID, name: 'Egg' } })],
    ['malformed contexts', row({ contexts: ['baking', ''] })],
  ])('rejects a %s row instead of filtering it', async (_label, invalidRow) => {
    api.get.mockResolvedValue({ substitutions: [invalidRow] });
    await expect(getSubstitutesFor(SOURCE_ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a mixed valid and malformed collection without returning a partial result', async () => {
    api.get.mockResolvedValue({
      substitutions: [
        row(),
        row({
          id: 'dddddddddddddddddddddddd',
          substituteIngredient: { id: 'eeeeeeeeeeeeeeeeeeeeeeee', name: '  ' },
        }),
      ],
    });

    await expect(getSubstitutesFor(SOURCE_ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    ['relation', [row(), row({ substituteIngredient: { id: 'dddddddddddddddddddddddd', name: 'Flax' } })]],
    ['substitute', [row(), row({ id: 'dddddddddddddddddddddddd' })]],
    ['case-variant relation', [row(), row({
      id: RELATION_ID.toUpperCase(),
      substituteIngredient: { id: 'dddddddddddddddddddddddd', name: 'Flax' },
    })]],
  ])('rejects duplicate %s identities', async (_label, substitutions) => {
    api.get.mockResolvedValue({ substitutions });
    await expect(getSubstitutesFor(SOURCE_ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
