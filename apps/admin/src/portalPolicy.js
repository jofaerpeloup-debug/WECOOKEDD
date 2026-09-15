export const ADMIN_NAVIGATION = Object.freeze([
  'overview',
  'recipes',
  'ingredients',
  'substitutions',
  'users',
  'staff',
]);

export const MODERATOR_NAVIGATION = Object.freeze([
  'moderator-home',
  'recipes',
  'ingredients',
  'substitutions',
]);

export function getPortalDestination(mode) {
  switch (mode) {
    case 'admin': return 'admin';
    case 'moderator': return 'moderator';
    case 'verify_email': return 'verify-email';
    case 'pending': return 'pending';
    case 'rejected': return 'rejected';
    case 'consumer': return 'consumer';
    default: return 'loading';
  }
}

export function getAllowedNavigation(mode) {
  if (mode === 'admin') return ADMIN_NAVIGATION;
  if (mode === 'moderator') return MODERATOR_NAVIGATION;
  return Object.freeze([]);
}

export function getSafeNavigation(mode, requestedTab) {
  const allowed = getAllowedNavigation(mode);
  if (allowed.includes(requestedTab)) return requestedTab;
  if (mode === 'admin') return 'overview';
  if (mode === 'moderator') return 'moderator-home';
  return null;
}
