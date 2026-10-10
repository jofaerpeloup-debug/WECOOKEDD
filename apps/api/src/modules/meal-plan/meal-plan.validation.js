const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');

const MAX_RANGE_DAYS = 31;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidDateKey(value) {
  const match = typeof value === 'string' ? value.match(DATE_KEY_PATTERN) : null;
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function dayNumber(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / 86400000);
}

const dateKeySchema = z
  .string()
  .regex(DATE_KEY_PATTERN, 'Date must use YYYY-MM-DD format.')
  .refine(isValidDateKey, 'Date must be a real calendar date.');

const rangeQuerySchema = z
  .object({ startDate: dateKeySchema, endDate: dateKeySchema })
  .strict()
  .superRefine((query, ctx) => {
    if (query.startDate > query.endDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must not precede startDate.' });
      return;
    }
    if (dayNumber(query.endDate) - dayNumber(query.startDate) + 1 > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: `Date range cannot exceed ${MAX_RANGE_DAYS} days.`,
      });
    }
  });

const listMealPlanSchema = z.object({ query: rangeQuerySchema });

const createMealPlanEntrySchema = z.object({
  body: z.object({ dateKey: dateKeySchema, recipeId: objectIdSchema }).strict(),
});

const expectedUpdatedAtSchema = z
  .string()
  .datetime({ offset: true, message: 'expectedUpdatedAt must be an ISO-8601 timestamp.' })
  .refine((value) => {
    const fractionalSeconds = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1];
    return !fractionalSeconds || fractionalSeconds.length <= 3;
  }, 'expectedUpdatedAt must not be more precise than milliseconds.');

const moveMealPlanEntrySchema = z.object({
  params: z.object({ entryId: objectIdSchema }).strict(),
  body: z.object({ dateKey: dateKeySchema, expectedUpdatedAt: expectedUpdatedAtSchema }).strict(),
  query: z.object({}).strict(),
});

const entryParamsSchema = z.object({
  params: z.object({ entryId: objectIdSchema }).strict(),
  query: z.object({}).strict(),
  body: z.union([z.undefined(), z.object({}).strict()]),
});

const entryVersionSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema }).strict();
const removeMealPlanEntrySchema = z.object({
  params: z.object({ entryId: objectIdSchema }).strict(),
  query: z.object({}).strict(),
  body: entryVersionSchema,
});
const expectedEntrySchema = z.object({ id: objectIdSchema, expectedUpdatedAt: expectedUpdatedAtSchema }).strict();
const clearMealPlanSchema = z.object({
  query: rangeQuerySchema,
  body: z.object({ expectedEntries: z.array(expectedEntrySchema).superRefine((items, ctx) => {
    for (let i = 1; i < items.length; i += 1) {
      if (items[i - 1].id >= items[i].id) ctx.addIssue({ code: 'custom', message: 'expectedEntries must have unique ascending IDs.' });
    }
  }) }).strict(),
});
const reminderVersionSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
const reminderBase = { expectedUpdatedAt: expectedUpdatedAtSchema, expectedReminderRevision: reminderVersionSchema };
const reminderPath = { params: z.object({ entryId: objectIdSchema }).strict(), query: z.object({}).strict() };
const putReminderSchema = z.object({ ...reminderPath, body: z.object({ ...reminderBase, localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: z.string().min(1).max(128) }).strict() });
const deleteReminderSchema = z.object({ ...reminderPath, body: z.object(reminderBase).strict() });

module.exports = {
  MAX_RANGE_DAYS,
  isValidDateKey,
  dateKeySchema,
  listMealPlanSchema,
  createMealPlanEntrySchema,
  moveMealPlanEntrySchema,
  entryParamsSchema,
  clearMealPlanSchema,
  removeMealPlanEntrySchema,
  putReminderSchema,
  deleteReminderSchema,
};
