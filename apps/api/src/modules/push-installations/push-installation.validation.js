const { z } = require('zod');

const installationId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const credential = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const generation = z.number().int().safe().min(1);
const emptyQuery = z.object({}).strict();

const putPushInstallationSchema = z.object({
  params: z.object({ installationId }).strict(),
  query: emptyQuery,
  body: z.object({
    platform: z.enum(['ios', 'android']),
    expoPushToken: z.string().max(255).regex(/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,200}\]$/),
    bindingCredential: credential,
    bindingGeneration: generation,
  }).strict(),
});

const deletePushInstallationSchema = z.object({
  params: z.object({ installationId }).strict(),
  query: emptyQuery,
  body: z.object({ bindingCredential: credential, bindingGeneration: generation }).strict(),
});

module.exports = { putPushInstallationSchema, deletePushInstallationSchema };
