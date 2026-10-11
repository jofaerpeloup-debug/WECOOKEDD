import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';

const SESSION_KEY = 'wecooked.meal4.session.v1';
const JOURNAL_KEY = 'wecooked.meal4.journal.v1';
export const PREFIX = 'wecooked.meal4.v1.';
const ID = /^[0-9a-f]{24}$/i;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const native = Platform.OS === 'ios' || Platform.OS === 'android';

export function validRequestId(id) { return typeof id === 'string' && id.startsWith(PREFIX) && NONCE.test(id.slice(PREFIX.length)); }
export function validBinding(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === 'epoch|ownerId|sessionId|version'
    && value.version === 1 && ID.test(value.ownerId) && ID.test(value.sessionId) && NONCE.test(value.epoch);
}
export function validJournal(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === 'records|version' && value.version === 1
    && !!value.records && typeof value.records === 'object' && !Array.isArray(value.records)
    && Object.entries(value.records).every(([id, record]) => validRequestId(id)
      && !!record && typeof record === 'object' && !Array.isArray(record)
      && Object.keys(record).join('|') === 'attempts'
      && Number.isSafeInteger(record.attempts) && record.attempts >= 0);
}

async function read(key, validate) {
  if (!native) return { kind: 'unsupported' };
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (raw == null) return { kind: 'missing' };
    const value = JSON.parse(raw);
    return validate(value) ? { kind: 'valid', value } : { kind: 'malformed' };
  } catch { return { kind: 'unavailable' }; }
}
async function write(key, value) {
  if (!native) return false;
  try { await SecureStore.setItemAsync(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export const loadBinding = () => read(SESSION_KEY, validBinding);
export const loadJournal = () => read(JOURNAL_KEY, validJournal);
export const saveBinding = (value) => validBinding(value) && write(SESSION_KEY, value);
export const saveJournal = (value) => validJournal(value) && write(JOURNAL_KEY, value);
export async function clearBinding() {
  try { await SecureStore.deleteItemAsync(SESSION_KEY); return true; } catch { return false; }
}
export async function randomNonce() { return Buffer.from(await Crypto.getRandomBytesAsync(32)).toString('base64url'); }
export async function newBinding(ownerId, sessionId) {
  const value = { version: 1, ownerId, sessionId, epoch: await randomNonce() };
  if (!validBinding(value) || !(await saveBinding(value))) throw new Error('Reminder session binding unavailable.');
  return value;
}
export async function ensureBinding(ownerId, sessionId) {
  const loaded = await loadBinding();
  if (loaded.kind === 'valid' && loaded.value.ownerId === ownerId && loaded.value.sessionId === sessionId) return loaded.value;
  return newBinding(ownerId, sessionId);
}
export async function journalId(id) {
  const loaded = await loadJournal();
  if (loaded.kind === 'malformed' || loaded.kind === 'unavailable' || loaded.kind === 'unsupported' || !validRequestId(id)) throw new Error('Reminder ownership journal unavailable.');
  const journal = loaded.kind === 'valid' ? loaded.value : { version: 1, records: {} };
  if (journal.records[id]) throw new Error('Reminder request ID already exists.');
  const next = { version: 1, records: { ...journal.records, [id]: { attempts: 0 } } };
  if (!(await saveJournal(next))) throw new Error('Reminder ownership journal write failed.');
  return next;
}
export async function incrementAttempt(id) {
  const loaded = await loadJournal();
  if (loaded.kind !== 'valid' || !loaded.value.records[id]) throw new Error('Reminder recovery count unavailable.');
  const count = loaded.value.records[id].attempts;
  if (count >= Number.MAX_SAFE_INTEGER) throw new Error('Reminder recovery count overflow.');
  const next = { version: 1, records: { ...loaded.value.records, [id]: { attempts: count + 1 } } };
  if (!(await saveJournal(next))) throw new Error('Reminder recovery count write failed.');
  return count + 1;
}
export async function pruneAbsent(ids) {
  const loaded = await loadJournal();
  if (loaded.kind === 'missing') return { version: 1, records: {} };
  if (loaded.kind !== 'valid') throw new Error('Reminder ownership journal unavailable.');
  const nextRecords = Object.fromEntries(Object.entries(loaded.value.records).filter(([id]) => ids.has(id)));
  if (Object.keys(nextRecords).length === Object.keys(loaded.value.records).length) return loaded.value;
  const next = { version: 1, records: nextRecords };
  if (!(await saveJournal(next))) throw new Error('Reminder ownership journal cleanup failed.');
  return next;
}
