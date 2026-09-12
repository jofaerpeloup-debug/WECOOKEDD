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
          id: 'substitution-id',
          substituteIngredient: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Aquafaba' },
          ratio: { sourceAmount: 1, substituteAmount: 3 },
          notes: 'Adjust to taste.',
          contexts: ['baking'],
        },
      ],
    });

    await expect(getSubstitutesFor('aaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toEqual({
      substitutes: [
        {
          id: 'substitution-id',
          substitute: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Aquafaba' },
          notes: 'Adjust to taste.',
          contexts: ['baking'],
        },
      ],
    });
    expect(api.get).toHaveBeenCalledWith('/substitutions', {
      query: { sourceIngredientId: 'aaaaaaaaaaaaaaaaaaaaaaaa', limit: 100 },
    });
  });
});
