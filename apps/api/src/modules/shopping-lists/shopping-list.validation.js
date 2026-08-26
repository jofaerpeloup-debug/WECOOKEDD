const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { UNITS } = require('../../shared/constants/measurement-units');

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

module.exports = {
  itemParamsSchema,
  recipeParamsSchema,
  createItemSchema,
  patchItemSchema,
};