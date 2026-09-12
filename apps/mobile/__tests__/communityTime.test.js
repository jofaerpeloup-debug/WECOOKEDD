const { formatCommunityTime } = require('../src/utils/communityTime');

const NOW = new Date('2026-09-13T12:00:00.000Z').getTime();

it('derives teammate-style relative time from real createdAt', () => {
  expect(formatCommunityTime('2026-09-13T11:59:40.000Z', NOW)).toBe('Just now');
  expect(formatCommunityTime('2026-09-13T11:45:00.000Z', NOW)).toBe('15m ago');
  expect(formatCommunityTime('2026-09-13T07:00:00.000Z', NOW)).toBe('5h ago');
  expect(formatCommunityTime('2026-09-12T12:00:00.000Z', NOW)).toBe('Yesterday');
  expect(formatCommunityTime('2026-09-10T12:00:00.000Z', NOW)).toBe('3d ago');
});

it('handles invalid and future timestamps honestly', () => {
  expect(formatCommunityTime('not-a-date', NOW)).toBe('');
  expect(formatCommunityTime('2026-09-14T12:00:00.000Z', NOW)).toBe('Just now');
});
