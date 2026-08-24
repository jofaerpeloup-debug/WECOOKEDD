import AsyncStorage from '@react-native-async-storage/async-storage';

// Thin wrapper around AsyncStorage that always resolves (never throws) so a
// storage failure degrades to "use the in-memory default" instead of
// crashing a screen.

export async function loadJSON(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw != null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveJSON(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore — persistence is best-effort
  }
}

export async function removeItem(key) {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}
