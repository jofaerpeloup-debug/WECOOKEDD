const { dateKeyFromLocalDate, startOfLocalWeek, weekDays, shiftWeek } = require('../src/utils/mealPlanDates');

describe('meal-plan local calendar helpers', () => {
  it('uses the local Monday through Sunday containing the supplied date', () => {
    expect(weekDays(new Date(2026, 8, 13, 23, 30)).map((day) => day.dateKey)).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13',
    ]);
  });

  it('navigates exactly seven local calendar dates across month and year boundaries', () => {
    const decemberWeek = startOfLocalWeek(new Date(2027, 0, 3, 8));
    expect(dateKeyFromLocalDate(decemberWeek)).toBe('2026-12-28');
    expect(dateKeyFromLocalDate(shiftWeek(decemberWeek, 1))).toBe('2027-01-04');
    expect(dateKeyFromLocalDate(shiftWeek(decemberWeek, -1))).toBe('2026-12-21');
    const marchWeek = weekDays(new Date(2026, 2, 1, 8));
    expect(marchWeek[0].dateKey).toBe('2026-02-23');
    expect(marchWeek[6].dateKey).toBe('2026-03-01');
  });

  it('formats dateKey from local components rather than UTC serialization', () => {
    expect(dateKeyFromLocalDate(new Date(2026, 8, 13, 23, 59, 59))).toBe('2026-09-13');
  });
});
