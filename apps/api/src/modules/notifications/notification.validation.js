const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');

const emptyBody = z.object({}).strict().default({});
const emptyQuery = z.object({}).strict();

const listNotificationsSchema = z.object({
  body: emptyBody,
  query: z
    .object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().min(1).max(1000).optional(),
    })
    .strict(),
});

const readNotificationSchema = z.object({
  params: z.object({ notificationId: objectIdSchema }).strict(),
  query: emptyQuery,
  body: emptyBody,
});

const anchoredMutationSchema = z.object({
  query: emptyQuery,
  body: z.object({ throughNotificationId: objectIdSchema }).strict(),
});

module.exports = {
  listNotificationsSchema,
  readNotificationSchema,
  readAllNotificationsSchema: anchoredMutationSchema,
  archiveAllNotificationsSchema: anchoredMutationSchema,
};
