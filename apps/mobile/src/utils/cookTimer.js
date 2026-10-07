export const COOK_TIMER_STATES = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
});

export const MIN_COOK_TIMER_MS = 1000;
export const MAX_COOK_TIMER_MS = 3 * 60 * 60 * 1000;
export const MAX_DATE_MS = 8640000000000000;

const INVALID_DURATION_MESSAGE = 'Enter a duration from 00:00:01 to 03:00:00.';
const COMPONENT_RULES = Object.freeze({
  hours: { maxLength: 1, max: 3 },
  minutes: { maxLength: 2, max: 59 },
  seconds: { maxLength: 2, max: 59 },
});

function parseComponent(value, rule) {
  if (typeof value !== 'string' || value.length > rule.maxLength || !/^\d*$/.test(value)) {
    return null;
  }
  if (value === '') return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= rule.max ? parsed : null;
}

export function validateCookTimerDuration(input = {}) {
  const { hours, minutes, seconds } = input || {};
  const parsedHours = parseComponent(hours, COMPONENT_RULES.hours);
  const parsedMinutes = parseComponent(minutes, COMPONENT_RULES.minutes);
  const parsedSeconds = parseComponent(seconds, COMPONENT_RULES.seconds);

  if (parsedHours === null || parsedMinutes === null || parsedSeconds === null) {
    return { ok: false, error: INVALID_DURATION_MESSAGE };
  }
  if (parsedHours === 3 && (parsedMinutes !== 0 || parsedSeconds !== 0)) {
    return { ok: false, error: INVALID_DURATION_MESSAGE };
  }

  const durationMs = ((parsedHours * 60 + parsedMinutes) * 60 + parsedSeconds) * 1000;
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < MIN_COOK_TIMER_MS ||
    durationMs > MAX_COOK_TIMER_MS
  ) {
    return { ok: false, error: INVALID_DURATION_MESSAGE };
  }

  return {
    ok: true,
    durationMs,
    components: { hours: parsedHours, minutes: parsedMinutes, seconds: parsedSeconds },
  };
}

export function isSafeClockMs(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS;
}

export function createCookTimerEndAt(nowMs, durationMs) {
  if (
    !isSafeClockMs(nowMs) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_COOK_TIMER_MS
  ) {
    return null;
  }
  const endAtMs = nowMs + durationMs;
  return Number.isSafeInteger(endAtMs) && endAtMs <= MAX_DATE_MS ? endAtMs : null;
}

export function getCookTimerRemainingMs(endAtMs, nowMs) {
  if (!isSafeClockMs(endAtMs) || !isSafeClockMs(nowMs)) return null;
  return Math.max(0, endAtMs - nowMs);
}

export function getCookTimerVisibleSeconds(remainingMs) {
  if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
}

export function formatCookTimer(remainingMs) {
  const totalSeconds = getCookTimerVisibleSeconds(remainingMs);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
