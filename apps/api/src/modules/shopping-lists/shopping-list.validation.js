const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { UNITS } = require('../../shared/constants/measurement-units');
const { normalizeCustomLabel } = require('./shopping-list.custom-label');

const unitSchema = z.enum(UNITS, 'Invalid unit.');

// quantity accepts an explicit null as equivalent to omitted, same
// convention as recipe.validation.js#recipeIngredientUsageSchema.
const quantitySchema = z
  .number()
  .finite('quantity must be a finite number.')
  .positive('quantity must be greater than zero.')
  .nullable()
  .optional();

const itemParamsSchema = z.object({
  params: z.object({ itemId: objectIdSchema }).strict(),
});

const recipeParamsSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
});

const createItemSchema = z.object({
  body: z
    .object({
      ingredientId: objectIdSchema,
      quantity: quantitySchema,
      unit: unitSchema,
    })
    .strict()
    .refine(
      (body) => {
        const hasQuantity = body.quantity !== undefined && body.quantity !== null;
        return body.unit === 'toTaste' ? !hasQuantity : hasQuantity;
      },
      {
        message: 'quantity is required for measurable units and must be omitted (or null) when unit is "toTaste".',
        path: ['quantity'],
      }
    ),
});

// Deliberately excludes ingredientId — PATCH never allows ownership or
// ingredient-identity changes; delete + add is the supported way to change
// which ingredient an item refers to. The prospective-state check (does
// this quantity/unit combination together make sense, given what the item
// currently has) happens in shopping-list.service.js, not here — Zod alone
// cannot see the item's current stored state.
const patchItemSchema = z.object({
  params: z.object({ itemId: objectIdSchema }).strict(),
  body: z
    .object({
      quantity: quantitySchema,
      unit: unitSchema.optional(),
      isChecked: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

const noSelectors = { query: z.object({}).strict() };
const noBody = { body: z.union([z.undefined(), z.object({}).strict()]), ...noSelectors };
const v2GetSchema = z.object(noBody);
const v2ItemParamsSchema = z.object({ ...noBody, params: z.object({ itemId: objectIdSchema }).strict() });
const selectedRecipeImportBody = z.object({
  servings: z.number().int().min(1).max(100),
  expectedRecipeUpdatedAt: z.string().datetime({ offset: true }),
  spiceLevel: z.enum(['none', 'mild', 'medium', 'hot', 'extra_hot']).optional(),
}).strict();
const v2RecipeParamsSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  body: z.union([z.undefined(), z.object({}).strict(), selectedRecipeImportBody]),
  ...noSelectors,
});
const customLabelSchema = z.string().refine((value) => normalizeCustomLabel(value) !== null, {
  message: 'Invalid custom item label.',
}).transform(normalizeCustomLabel);
const ingredientCreate = createItemSchema.shape.body.safeExtend({ type: z.literal('ingredient') }).strict();
const customCreate = z.object({ type: z.literal('custom'), label: customLabelSchema }).strict();
const v2CreateItemSchema = z.object({
  body: z.discriminatedUnion('type', [ingredientCreate, customCreate]), ...noSelectors,
});
const ingredientPatch = patchItemSchema.shape.body.safeExtend({ type: z.literal('ingredient') }).strict()
  .refine((body) => Object.keys(body).length > 1, { message: 'At least one mutable field is required.' });
const customPatch = z.object({ type: z.literal('custom'), isChecked: z.boolean() }).strict();
const v2PatchItemSchema = z.object({
  params: z.object({ itemId: objectIdSchema }).strict(),
  body: z.union([ingredientPatch, customPatch]), ...noSelectors,
});

module.exports = {
  itemParamsSchema,
  recipeParamsSchema,
  createItemSchema,
  patchItemSchema,
  v2GetSchema,
  v2ItemParamsSchema,
  v2RecipeParamsSchema,
  v2CreateItemSchema,
  v2PatchItemSchema,
};
