import { formatMinutes } from '../src/utils/recipe';

describe('recipe duration formatting', () => {
  it.each([
    [3, '3 min'],
    [45, '45 min'],
    [60, '1 hr'],
    [90, '1 hr 30 min'],
    [135, '2 hr 15 min'],
  ])('formats %i minutes as %s', (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });
});
