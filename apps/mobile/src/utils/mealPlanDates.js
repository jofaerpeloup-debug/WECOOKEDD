export const PLAN_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function localDate(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

export function dateKeyFromLocalDate(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addLocalCalendarDays(date, amount) {
  return localDate(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function startOfLocalWeek(date = new Date()) {
  const weekday = date.getDay();
  return addLocalCalendarDays(date, -(weekday === 0 ? 6 : weekday - 1));
}

export function weekDays(anchor) {
  const monday = startOfLocalWeek(anchor);
  return PLAN_DAYS.map((label, index) => {
    const date = addLocalCalendarDays(monday, index);
    return { label, date, dateKey: dateKeyFromLocalDate(date) };
  });
}

export function shiftWeek(anchor, direction) {
  return addLocalCalendarDays(startOfLocalWeek(anchor), direction * 7);
}

export function formatWeekRange(days) {
  if (!days?.length) return '';
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const sameYear = first.getFullYear() === last.getFullYear();
  const firstText = first.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const lastText = last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${firstText} – ${lastText}`;
}

export function formatDayDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
