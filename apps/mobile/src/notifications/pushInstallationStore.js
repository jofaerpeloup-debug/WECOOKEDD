import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';

const STORAGE_KEY = 'wecooked.pushInstallation.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;
const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

export function validRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === ['bindingCredential', 'bindingGeneration', 'installationId', 'version'].sort().join('|')
    && value.version === 1 && UUID.test(value.installationId)
    && CREDENTIAL.test(value.bindingCredential)
    && Number.isSafeInteger(value.bindingGeneration) && value.bindingGeneration >= 1;
}

export async function loadInstallationRecord() {
  if (!IS_NATIVE) return { kind: 'unsupported' };
  let raw;
  try {
    raw = await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw == null) return { kind: 'missing' };
  try {
    const value = JSON.parse(raw);
    return validRecord(value) ? { kind: 'valid', record: value } : { kind: 'malformed' };
  } catch {
    return { kind: 'malformed' };
  }
}

export async function saveInstallationRecord(record) {
  if (!IS_NATIVE || !validRecord(record)) return false;
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function uuidFrom(bytes) {
  const copy = Uint8Array.from(bytes);
  copy[6] = (copy[6] & 0x0f) | 0x40;
  copy[8] = (copy[8] & 0x3f) | 0x80;
  const hex = [...copy].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function createInstallationRecord() {
  if (!IS_NATIVE) throw new Error('Native push is unsupported.');
  const [idBytes, credentialBytes] = await Promise.all([
    Crypto.getRandomBytesAsync(16), Crypto.getRandomBytesAsync(32),
  ]);
  return {
    version: 1,
    installationId: uuidFrom(idBytes),
    bindingCredential: Buffer.from(credentialBytes).toString('base64url'),
    bindingGeneration: 1,
  };
}

export async function incrementAndPersist(record) {
  if (!validRecord(record) || record.bindingGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Push installation generation is unavailable.');
  }
  const next = { ...record, bindingGeneration: record.bindingGeneration + 1 };
  if (!(await saveInstallationRecord(next))) throw new Error('Push installation state could not be persisted.');
  return next;
}

export { STORAGE_KEY, IS_NATIVE };
