jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn(async () => Uint8Array.from({ length: 32 }, (_value, index) => index)) }));

const { Platform } = require('react-native');
const SecureStore = require('expo-secure-store');
const store = require('../src/notifications/mealReminderSessionStore');
const OWNER = '507f1f77bcf86cd799439001';
const SESSION = '507f1f77bcf86cd799439002';
const OTHER = '507f1f77bcf86cd799439003';
const ID = `${store.PREFIX}${'A'.repeat(43)}`;
let records;

beforeEach(() => {
  Platform.OS = 'ios';
  records = new Map();
  SecureStore.getItemAsync.mockImplementation(async (key) => records.get(key) ?? null);
  SecureStore.setItemAsync.mockImplementation(async (key, value) => { records.set(key, value); });
  SecureStore.deleteItemAsync.mockImplementation(async (key) => { records.delete(key); });
});

it('retains epoch for same owner/session and rotates on session switch', async () => {
  const first = await store.ensureBinding(OWNER, SESSION);
  expect(first.ownerId).toBe(OWNER);
  expect(await store.ensureBinding(OWNER, SESSION)).toEqual(first);
  const switched = await store.ensureBinding(OTHER, SESSION);
  expect(switched.ownerId).toBe(OTHER);
  await store.clearBinding();
  expect((await store.loadBinding()).kind).toBe('missing');
});

it('journals exact ID before schedule, increments attempts durably, and retains provenance across binding clear', async () => {
  await store.journalId(ID);
  expect((await store.loadJournal()).value.records[ID].attempts).toBe(0);
  expect(await store.incrementAttempt(ID)).toBe(1);
  expect((await store.loadJournal()).value.records[ID].attempts).toBe(1);
  await store.clearBinding();
  expect((await store.loadJournal()).value.records[ID].attempts).toBe(1);
  await store.pruneAbsent(new Set([ID]));
  expect((await store.loadJournal()).value.records[ID].attempts).toBe(1);
  await store.pruneAbsent(new Set());
  expect((await store.loadJournal()).value.records[ID]).toBeUndefined();
});

it('failed or uncertain persistence prevents schedule provenance and recovery increment', async () => {
  SecureStore.setItemAsync.mockRejectedValueOnce(new Error('offline'));
  await expect(store.journalId(ID)).rejects.toThrow();
  expect((await store.loadJournal()).kind).toBe('missing');
  await store.journalId(ID);
  SecureStore.setItemAsync.mockRejectedValueOnce(new Error('offline'));
  await expect(store.incrementAttempt(ID)).rejects.toThrow();
  expect((await store.loadJournal()).value.records[ID].attempts).toBe(0);
});

it('malformed journal and unsafe attempt count fail closed', async () => {
  records.set(store.JOURNAL_KEY || 'wecooked.meal4.journal.v1', '{bad json');
  expect((await store.loadJournal()).kind).toBe('unavailable');
  await expect(store.incrementAttempt(ID)).rejects.toThrow();
  expect(store.validJournal({ version: 1, records: { [ID]: { attempts: Number.MAX_SAFE_INTEGER + 1 } } })).toBe(false);
});
