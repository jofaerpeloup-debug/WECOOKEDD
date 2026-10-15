const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');

const empty = z.object({}).strict();
const emptyBody = empty.default({});
const pageQuery = z.object({
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number)
    .pipe(z.number().int().min(1).max(50)).default(20),
  cursor: z.string().min(1).max(1000).optional(),
}).strict();
const conversationParams = z.object({ conversationId: objectIdSchema }).strict();
const attemptFields = {
  requestId: z.uuid().transform((value) => value.toLowerCase()),
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
};

module.exports = {
  createConversationSchema: z.object({
    body: z.object({ requestId: z.uuid().transform((value) => value.toLowerCase()) }).strict(),
    params: empty, query: empty,
  }),
  listConversationsSchema: z.object({ body: emptyBody, params: empty, query: pageQuery }),
  openConversationSchema: z.object({ body: emptyBody, params: conversationParams, query: pageQuery }),
  deleteConversationSchema: z.object({ body: emptyBody, params: conversationParams, query: empty }),
  sendMessageSchema: z.object({
    body: z.union([
      z.object({ ...attemptFields, content: z.string().trim().min(1).max(2000) }).strict(),
      z.object({ ...attemptFields, retryOf: objectIdSchema.transform((value) => value.toLowerCase()) }).strict(),
    ]),
    params: conversationParams, query: empty,
  }),
};
