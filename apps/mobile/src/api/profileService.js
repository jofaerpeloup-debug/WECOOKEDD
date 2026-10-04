// Self-profile write path for the mobile app — the single place the signed-in
// user's own `name` / `preferences` are persisted:
//
//   ProfileScreen / AccountDetailScreen / NotificationsScreen
//     -> profileService.updateProfile
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (PATCH /api/v1/users/me)
//     -> MongoDB
//
// The call requires authentication; the shared client already attaches the
// bearer access token and performs one transparent refresh+retry. This module
// never calls `fetch`, never touches the token store, and never sends a userId
// — the backend derives ownership from the authenticated identity and its
// strict Zod schema rejects `id` / `email` / `role` / `status` outright.
//
// Reads stay in authService (`fetchCurrentUser` -> `GET /users/me`); this
// module is write-only. Contract: docs/architecture/self-profile-backend-api.md
// and docs/architecture/mobile-self-profile-integration.md.

import { File } from 'expo-file-system';
import { ApiError, api } from './client';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_BY_EXTENSION = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const AVATAR_EXTENSIONS_BY_MIME = {
  'image/jpeg': new Set(['.jpeg', '.jpg']),
  'image/png': new Set(['.png']),
  'image/webp': new Set(['.webp']),
};
const SAFE_LOCAL_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function avatarFileError(code, message) {
  return new ApiError(message, { code, kind: 'local' });
}

function prepareAvatarFile(asset) {
  if (!asset || typeof asset.uri !== 'string' || !asset.uri.trim()) {
    throw avatarFileError('AVATAR_FILE_UNREADABLE', 'Choose a readable, non-empty image and try again.');
  }

  let file;
  try {
    file = new File(asset.uri);
    if (!file.exists || !Number.isFinite(file.size) || file.size <= 0) {
      throw new Error('missing or empty file');
    }
  } catch {
    throw avatarFileError('AVATAR_FILE_UNREADABLE', 'Choose a readable, non-empty image and try again.');
  }

  if (file.size > MAX_AVATAR_BYTES) {
    throw avatarFileError('AVATAR_FILE_TOO_LARGE', 'Choose an image no larger than 5 MiB.');
  }

  const filename = typeof file.name === 'string' ? file.name : '';
  const dot = filename.lastIndexOf('.');
  const extension = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  const pickerMime = typeof asset.mimeType === 'string' ? asset.mimeType.toLowerCase() : '';
  const fileMime = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  const extensionMime = AVATAR_MIME_BY_EXTENSION[extension];
  const supportedPickerMime = !pickerMime || AVATAR_EXTENSIONS_BY_MIME[pickerMime];
  const supportedFileMime = AVATAR_EXTENSIONS_BY_MIME[fileMime];

  if (
    !SAFE_LOCAL_FILENAME.test(filename)
    || !supportedPickerMime
    || !supportedFileMime
    || !extensionMime
    || !AVATAR_EXTENSIONS_BY_MIME[fileMime].has(extension)
    || (pickerMime && pickerMime !== fileMime)
  ) {
    throw avatarFileError('AVATAR_FILE_UNSUPPORTED', 'Choose a JPEG, PNG, or WebP image.');
  }

  return file;
}

/**
 * PATCH /api/v1/users/me
 * @param {{
 *   name?: string,
 *   preferences?: {
 *     dietaryPreferences?: string[],
 *     allergies?: string[],
 *     notifications?: { enabled: boolean },
 *   },
 * }} patch  A pre-built, allow-listed body. Only the leaves present are
 *   written; a supplied array (including `[]`) replaces that array wholesale;
 *   an omitted leaf is left untouched by the backend.
 * @returns {Promise<object>} the authoritative updated public user — the same
 *   shape `GET /users/me` returns (`toPublicUser`). The shared client already
 *   unwraps the `{ success, data }` envelope, so this reads `data.user`.
 */
export function updateProfile(patch) {
  const body = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.bio !== undefined) body.bio = patch.bio;
  if (patch.cookingLevel !== undefined) body.cookingLevel = patch.cookingLevel;
  if (patch.preferences !== undefined) {
    const preferences = {};
    if (patch.preferences.dietaryPreferences !== undefined) {
      preferences.dietaryPreferences = patch.preferences.dietaryPreferences;
    }
    if (patch.preferences.allergies !== undefined) preferences.allergies = patch.preferences.allergies;
    if (patch.preferences.notifications !== undefined) {
      preferences.notifications = { enabled: patch.preferences.notifications.enabled };
    }
    body.preferences = preferences;
  }
  return api.patch('/users/me', { body }).then((data) => data.user);
}

export function uploadAvatar(asset) {
  prepareAvatarFile(asset);
  const bodyFactory = () => {
    const body = new FormData();
    body.append('image', prepareAvatarFile(asset));
    return body;
  };
  return api.post('/users/me/avatar', { bodyFactory }).then((data) => data.user);
}

export function resetAvatar() {
  return api.del('/users/me/avatar').then((data) => data.user);
}
