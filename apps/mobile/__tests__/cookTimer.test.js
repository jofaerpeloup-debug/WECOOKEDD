const {
  MAX_DATE_MS,
  createCookTimerEndAt,
  formatCookTimer,
  getCookTimerRemainingMs,
  getCookTimerVisibleSeconds,
  isSafeClockMs,
  validateCookTimerDuration,
} = require('../src/utils/cookTimer');

const valid = (hours = '', minutes = '', seconds = '') =>
  validateCookTimerDuration({ hours, minutes, seconds });

describe('manual cook timer duration validation', () => {
  it.each([
    ['', '', '', null],
    ['0', '00', '00', null],
    ['0', '00', '01', 1000],
    ['0', '00', '59', 59000],
    ['0', '01', '00', 60000],
    ['0', '59', '59', 3599000],
    ['1', '00', '00', 3600000],
    ['2', '59', '59', 10799000],
    ['3', '00', '00', 10800000],
  ])('%s:%s:%s produces only the frozen result', (hours, minutes, seconds, durationMs) => {
    const result = valid(hours, minutes, seconds);
    if (durationMs === null) {
      expect(result.ok).toBe(false);
    } else {
      expect(result).toEqual({
        ok: true,
        durationMs,
        components: { hours: Number(hours), minutes: Number(minutes), seconds: Number(seconds) },
      });
    }
  });

  it.each([
    ['0', '60', '00'],
    ['0', '00', '60'],
    ['4', '00', '00'],
    ['3', '00', '01'],
    ['3', '01', '00'],
    ['-1', '00', '00'],
    ['+1', '00', '00'],
    ['1.5', '00', '00'],
    ['1e0', '00', '00'],
    [' ', '00', '01'],
    ['a', '00', '01'],
    ['1x', '00', '00'],
    ['0', '999', '00'],
    ['0', '12abc', '00'],
    ['0', ' 1', '00'],
    ['0', '01 ', '00'],
  ])('rejects malformed or out-of-range %s:%s:%s without normalization', (hours, minutes, seconds) => {
    expect(valid(hours, minutes, seconds).ok).toBe(false);
  });

  it('rejects non-string and missing components rather than coercing them', () => {
    expect(validateCookTimerDuration({ hours: 1, minutes: '00', seconds: '00' }).ok).toBe(false);
    expect(validateCookTimerDuration({ hours: '1', minutes: '00' }).ok).toBe(false);
    expect(validateCookTimerDuration(null).ok).toBe(false);
  });
});

describe('absolute cook timer clock', () => {
  it('creates a safe target once and derives exact clamped remaining time', () => {
    expect(createCookTimerEndAt(10000, 5000)).toBe(15000);
    expect(getCookTimerRemainingMs(15000, 10000)).toBe(5000);
    expect(getCookTimerRemainingMs(15000, 14999)).toBe(1);
    expect(getCookTimerRemainingMs(15000, 15000)).toBe(0);
    expect(getCookTimerRemainingMs(15000, 20000)).toBe(0);
  });

  it('does not accumulate callback drift because every delayed sample uses the same target', () => {
    const endAtMs = createCookTimerEndAt(1000, 10000);
    expect(getCookTimerRemainingMs(endAtMs, 2200)).toBe(8800);
    expect(getCookTimerRemainingMs(endAtMs, 7900)).toBe(3100);
    expect(getCookTimerRemainingMs(endAtMs, 10999)).toBe(1);
  });

  it('ceil-rounds positive milliseconds so zero is never shown before actual expiry', () => {
    expect(getCookTimerVisibleSeconds(1001)).toBe(2);
    expect(getCookTimerVisibleSeconds(1000)).toBe(1);
    expect(getCookTimerVisibleSeconds(1)).toBe(1);
    expect(getCookTimerVisibleSeconds(0)).toBe(0);
    expect(getCookTimerVisibleSeconds(-1)).toBe(0);
  });

  it('rejects unsafe clocks and target overflow', () => {
    expect(isSafeClockMs(MAX_DATE_MS)).toBe(true);
    expect(isSafeClockMs(MAX_DATE_MS + 1)).toBe(false);
    expect(isSafeClockMs(1.5)).toBe(false);
    expect(createCookTimerEndAt(MAX_DATE_MS - 500, 1000)).toBeNull();
    expect(createCookTimerEndAt(0, 999)).toBe(999);
    expect(createCookTimerEndAt(0, 0)).toBeNull();
    expect(getCookTimerRemainingMs(Number.MAX_SAFE_INTEGER, 0)).toBeNull();
  });

  it('creates a fresh target from a positive sub-second paused remainder', () => {
    const pausedRemainingMs = getCookTimerRemainingMs(10000, 9251);
    expect(pausedRemainingMs).toBe(749);
    expect(createCookTimerEndAt(20000, pausedRemainingMs)).toBe(20749);
  });
});

describe('cook timer display formatting', () => {
  it.each([
    [5000, '00:05'],
    [307000, '05:07'],
    [3599000, '59:59'],
    [3600000, '1:00:00'],
    [3723000, '1:02:03'],
    [10800000, '3:00:00'],
    [1, '00:01'],
    [0, '00:00'],
  ])('formats %i milliseconds as %s', (remainingMs, expected) => {
    expect(formatCookTimer(remainingMs)).toBe(expected);
  });
});
