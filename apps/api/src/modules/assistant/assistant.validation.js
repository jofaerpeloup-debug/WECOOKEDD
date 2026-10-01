const { z } = require('zod');

const MAX_TRANSCRIPT_LENGTH = 12_000;

const assistantMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant'], 'Role must be user or assistant.'),
    content: z.string('Content must be a string.').trim().min(1, 'Content must not be blank.'),
  })
  .strict()
  .superRefine((message, ctx) => {
    const maximum = message.role === 'user' ? 2_000 : 4_000;
    if (message.content.length > maximum) {
      ctx.addIssue({
        code: 'too_big',
        maximum,
        origin: 'string',
        inclusive: true,
        path: ['content'],
        message: `${message.role === 'user' ? 'User' : 'Assistant'} content must be ${maximum} characters or fewer.`,
      });
    }
  });

const assistantChatSchema = z.object({
  body: z
    .object({
      messages: z
        .array(assistantMessageSchema)
        .min(1, 'At least one message is required.')
        .max(12, 'A maximum of 12 messages is allowed.'),
    })
    .strict()
    .superRefine((body, ctx) => {
      const total = body.messages.reduce((sum, message) => sum + message.content.length, 0);
      if (total > MAX_TRANSCRIPT_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['messages'],
          message: `Transcript content must be ${MAX_TRANSCRIPT_LENGTH} characters or fewer.`,
        });
      }
      if (body.messages.at(-1)?.role !== 'user') {
        ctx.addIssue({
          code: 'custom',
          path: ['messages'],
          message: 'The final message must have role user.',
        });
      }
    }),
});

module.exports = { assistantChatSchema, MAX_TRANSCRIPT_LENGTH };
