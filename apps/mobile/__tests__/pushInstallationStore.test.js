const SecureStore = require('expo-secure-store');
const Crypto = require('expo-crypto');
const store = require('../src/notifications/pushInstallationStore');

jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

it('strictly validates the versioned record and rejects extra or unsafe generation fields', () => {
  const valid = { version: 1, installationId: '123e4567-e89b-42d3-a456-426614174000', bindingCredential: 'A'.repeat(43), bindingGeneration: 1 };
  expect(store.validRecord(valid)).toBe(true);
  expect(store.validRecord({ ...valid, ownerId: 'forbidden' })).toBe(false);
  expect(store.validRecord({ ...valid, bindingGeneration: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
});

it('classifies malformed secure state as malformed and never invents continuity', async () => {
  SecureStore.getItemAsync.mockResolvedValue('{"version":1}');
  await expect(store.loadInstallationRecord()).resolves.toEqual({ kind: 'malformed' });
});

it('creates independent native-random identity and credential and persists generation before returning', async () => {
  Crypto.getRandomBytesAsync
    .mockResolvedValueOnce(Uint8Array.from({ length: 16 }, (_, index) => index + 1))
    .mockResolvedValueOnce(Uint8Array.from({ length: 32 }, (_, index) => index + 33));
  const record = await store.createInstallationRecord();
  expect(record.installationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(record.bindingCredential).toHaveLength(43);
  expect(record.bindingCredential).not.toContain(record.installationId.replaceAll('-', ''));
  await expect(store.incrementAndPersist(record)).resolves.toMatchObject({ bindingGeneration: 2 });
  expect(SecureStore.setItemAsync).toHaveBeenCalled();
});

it('reports write failure and does not claim a generation increment', async () => {
  SecureStore.setItemAsync.mockRejectedValue(new Error('locked'));
  const record = { version: 1, installationId: '123e4567-e89b-42d3-a456-426614174000', bindingCredential: 'A'.repeat(43), bindingGeneration: 1 };
  await expect(store.incrementAndPersist(record)).rejects.toThrow(/could not be persisted/);
});
