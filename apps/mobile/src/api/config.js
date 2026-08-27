// WeCooked mobile — REST API base URL resolution.
//
// One place that decides which backend the app talks to. The API URL is NOT a
// secret (see docs/architecture/mobile-auth-session-integration.md); it comes
// from the public `EXPO_PUBLIC_API_BASE_URL` build-time variable, with a
// sensible local-development default per platform.

import { Platform } from 'react-native';

const RAW_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

// Local-development fallback when EXPO_PUBLIC_API_BASE_URL is unset.
// apps/api listens on PORT 5000 and mounts everything under /api/v1.
//
// - Android emulator: `localhost` inside the emulator is the emulator itself,
//   not the host machine. 10.0.2.2 is the standard loopback alias the Android
//   emulator exposes for the host. (Genymotion uses 10.0.3.2 — override via env.)
// - iOS simulator / web: share the host's network, so `localhost` is correct.
// - A physical phone can reach NEITHER of these — it must be given the host's
//   LAN address explicitly via EXPO_PUBLIC_API_BASE_URL (see .env.example).
const DEFAULT_ORIGIN =
  Platform.OS === 'android' ? 'http://10.0.2.2:5000' : 'http://localhost:5000';

/**
 * Normalizes a configured base URL down to a bare origin (no trailing slash,
 * no trailing `/api/v1`) so callers can consistently build `/api/v1/...` paths
 * whether the env var was written as an origin or already versioned.
 */
function normalizeOrigin(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
}

const configuredOrigin = normalizeOrigin(RAW_BASE_URL);

export const API_ORIGIN = configuredOrigin || DEFAULT_ORIGIN;

/** Fully-qualified versioned base, e.g. `http://localhost:5000/api/v1`. */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

/** True when we fell back to the local default (no env override present). */
export const USING_DEFAULT_API_BASE_URL = !configuredOrigin;
