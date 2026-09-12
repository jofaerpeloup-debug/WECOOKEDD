export function formatCommunityTime(value, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';

  const elapsed = Math.max(0, now - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return 'Just now';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < 2 * day) return 'Yesterday';
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`;

  const date = new Date(timestamp);
  const current = new Date(now);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === current.getFullYear() ? {} : { year: 'numeric' }),
  });
}
