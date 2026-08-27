// Token storage for the mobile auth session.
//
// Policy (see docs/architecture/mobile-auth-session-integration.md):
//
//   ACCESS TOKEN  — process memory ONLY. Never written to SecureStore,
//                   AsyncStorage, files, or app config. Gone on app restart.
//
//   REFRESH TOKEN — on native (iOS/Android): Expo SecureStore ONLY, under one
//                   stable key. Replaced after every successful refresh
//                   rotation. Never AsyncStorage, never logged, never surfaced
//                   to UI state.
//                 — on web: kept in memory only for the session (SecureStore is
//                   not available on web and there is no safe persistent store
//                   for a long-lived token in a browser). Persistent web login
//                   is intentionally unsupported for this slice.

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'wecooked.refreshToken';

const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

// --- access token: memory only, always -------------------------------------

let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
}

export function clearAccessToken() {
  accessToken = null;
}

// --- refresh token --------------------------------------------------------

// Web-only fallback: memory for the current JS session, never persisted.
let webRefreshToken = null;

export async function getRefreshToken() {
  if (IS_NATIVE) {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      // SecureStore unavailable / read failed — treat as "no session".
      return null;
    }
  }
  return webRefreshToken;
}

/**
 * Persists the refresh token. Returns `true` if it is now safely stored (or
 * intentionally cleared, or held in web memory), `false` if a native
 * SecureStore write failed. On a native failure the key is best-effort
 * cleared so a stale token that no longer matches the session can never be
 * left behind — callers must treat `false` as "this session can't be
 * persisted" and act accordingly (see authService rotation handling).
 */
export async function setRefreshToken(token) {
  if (!token) {
    await clearRefreshToken();
    return true;
  }
  if (IS_NATIVE) {
    try {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
      return true;
    } catch {
      await clearRefreshToken();
      return false;
    }
  }
  webRefreshToken = token;
  return true;
}

export async function clearRefreshToken() {
  webRefreshToken = null;
  if (IS_NATIVE) {
    try {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      // ignore
    }
  }
}

// --- whole session -------------------------------------------------------

export async function clearSession() {
  clearAccessToken();
  await clearRefreshToken();
}
