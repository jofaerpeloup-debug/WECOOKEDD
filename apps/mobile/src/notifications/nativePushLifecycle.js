let beforeLogout = null;
let beforeReminderLogout = null;

export function setBeforePushLogout(handler) {
  beforeLogout = typeof handler === 'function' ? handler : null;
}

export function setBeforeReminderLogout(handler) {
  beforeReminderLogout = typeof handler === 'function' ? handler : null;
}

export async function runBeforePushLogout(options = {}) {
  const reminder = beforeReminderLogout?.(options);
  await Promise.allSettled([beforeLogout?.(options), reminder]);
}

export function responseKey(response) {
  const request = response?.notification?.request;
  if (!request || typeof request.identifier !== 'string' || !request.identifier) return null;
  return `${request.identifier}:${response.actionIdentifier || ''}`;
}

export function permissionState(permission) {
  if (permission?.granted === true || permission?.status === 'granted') return 'granted';
  if (permission?.status === 'undetermined' && permission?.canAskAgain !== false) return 'requestable';
  return 'denied';
}
