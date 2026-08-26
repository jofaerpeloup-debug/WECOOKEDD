const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const {
  CUISINES,
  DIFFICULTIES,
  UNITS,
  DIETARY_TAGS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_PREP_TIME_MINUTES,
  MAX_COOK_TIME_MINUTES,
  MAX_SERVINGS,
  MAX_INGREDIENTS,
  MAX_INSTRUCTIONS,
  MAX_INSTRUCTION_LENGTH,
  MAX_INGREDIENT_NOTE_LENGTH,
  MAX_IMAGE_URL_LENGTH,
} = require('./recipe.model');

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required.')
  .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);

const descriptionSchema = z
  .string()
  .trim()
  .min(1, 'Description is required.')
  .max(MAX_DESCRIPTION_LENGTH, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);

const cuisineSchema = z.enum(CUISINES, 'Invalid cuisine.');
const difficultySchema = z.enum(DIFFICULTIES, 'Invalid difficulty.');
const unitSchema = z.enum(UNITS, 'Invalid unit.');
const dietaryTagSchema = z.enum(DIETARY_TAGS, 'Invalid dietary tag.');

const prepTimeMinutesSchema = z
  .number()
  .int('prepTimeMinutes must be an integer.')
  .min(0, 'prepTimeMinutes must be zero or greater.')
  .max(MAX_PREP_TIME_MINUTES, `prepTimeMinutes must be ${MAX_PREP_TIME_MINUTES} or fewer.`);

const cookTimeMinutesSchema = z
  .number()
  .int('cookTimeMinutes must be an integer.')
  .min(0, 'cookTimeMinutes must be zero or greater.')
  .max(MAX_COOK_TIME_MINUTES, `cookTimeMinutes must be ${MAX_COOK_TIME_MINUTES} or fewer.`);

const servingsSchema = z
  .number()
  .int('servings must be an integer.')
  .min(1, 'servings must be at least 1.')
  .max(MAX_SERVINGS, `servings must be ${MAX_SERVINGS} or fewer.`);

const instructionItemSchema = z
  .string()
  .trim()
  .min(1, 'Instruction step cannot be empty.')
  .max(MAX_INSTRUCTION_LENGTH, `Each instruction step must be ${MAX_INSTRUCTION_LENGTH} characters or fewer.`);

// No .default([]) at the base — see the identical note on ingredients
// below and in ingredient.validation.js. Not that it matters for
// instructions specifically (a recipe always requires at least one), but
// the create/patch schemas are still built from a shared base for
// consistency.
const instructionsArraySchema = z
  .array(instructionItemSchema)
  .min(1, 'At least one instruction step is required.')
  .max(MAX_INSTRUCTIONS, `A maximum of ${MAX_INSTRUCTIONS} instruction steps is allowed.`);

const dietaryTagsArraySchema = z
  .array(dietaryTagSchema)
  .max(DIETARY_TAGS.length, 'Too many dietary tags.');

const ingredientNoteSchema = z
  .string()
  .trim()
  .max(MAX_INGREDIENT_NOTE_LENGTH, `note must be ${MAX_INGREDIENT_NOTE_LENGTH} characters or fewer.`);

// quantity/note both accept an explicit null as equivalent to omitted —
// the create payload convention elsewhere in this module (e.g. imageUrl)
// already uses null for "no value", so embedded ingredient usage follows
// the same shape rather than introducing a second "absent" convention.
const recipeIngredientUsageSchema = z
  .object({
    ingredientId: objectIdSchema,
    quantity: z
      .number()
      .finite('quantity must be a finite number.')
      .positive('quantity must be greater than zero.')
      .nullable()
      .optional(),
    unit: unitSchema,
    note: ingredientNoteSchema.nullable().optional(),
    optional: z.boolean().default(false),
  })
  .strict()
  .refine(
    (entry) => {
      const hasQuantity = entry.quantity !== undefined && entry.quantity !== null;
      return entry.unit === 'toTaste' ? !hasQuantity : hasQuantity;
    },
    {
      message: 'quantity is required for measurable units and must be omitted (or null) when unit is "toTaste".',
      path: ['quantity'],
    }
  );

// No .default([]) here — this base is reused by both create (where the
// field is always required anyway) and patch (where an omitted key must
// leave the stored ingredients untouched, not reset them to []).
const ingredientsArraySchema = z
  .array(recipeIngredientUsageSchema)
  .min(1, 'At least one ingredient is required.')
  .max(MAX_INGREDIENTS, `A maximum of ${MAX_INGREDIENTS} ingredients is allowed.`);

const imageUrlSchema = z
  .string()
  .trim()
  .url('imageUrl must be a valid URL.')
  .max(MAX_IMAGE_URL_LENGTH, `imageUrl must be ${MAX_IMAGE_URL_LENGTH} characters or fewer.`)
  .nullable()
  .optional();

const statusSchema = z.enum(['active', 'inactive', 'all'], 'Invalid status.').default('active');
const sortSchema = z
  .enum(['titleAsc', 'titleDesc', 'newest', 'oldest', 'prepTimeAsc', 'prepTimeDesc'], 'Invalid sort value.')
  .default('titleAsc');
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

const recipeParamsSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
});

const listRecipesSchema = z.object({
  query: z
    .object({
      search: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
      cuisine: cuisineSchema.optional(),
      difficulty: difficultySchema.optional(),
      dietaryTag: dietaryTagSchema.optional(),
      ingredientId: objectIdSchema.optional(),
      maxPrepTimeMinutes: z.coerce.number().int().min(0).max(MAX_PREP_TIME_MINUTES).optional(),
      status: statusSchema,
      page: pageSchema,
      limit: limitSchema,
      sort: sortSchema,
    })
    .strict(),
});

const createRecipeSchema = z.object({
  body: z
    .object({
      title: titleSchema,
      description: descriptionSchema,
      cuisine: cuisineSchema,
      difficulty: difficultySchema,
      prepTimeMinutes: prepTimeMinutesSchema,
      cookTimeMinutes: cookTimeMinutesSchema,
      servings: servingsSchema,
      ingredients: ingredientsArraySchema,
      instructions: instructionsArraySchema,
      dietaryTags: dietaryTagsArraySchema.default([]),
      imageUrl: imageUrlSchema,
    })
    .strict(),
});

const updateRecipeSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  body: z
    .object({
      title: titleSchema.optional(),
      description: descriptionSchema.optional(),
      cuisine: cuisineSchema.optional(),
      difficulty: difficultySchema.optional(),
      prepTimeMinutes: prepTimeMinutesSchema.optional(),
      cookTimeMinutes: cookTimeMinutesSchema.optional(),
      servings: servingsSchema.optional(),
      ingredients: ingredientsArraySchema.optional(),
      instructions: instructionsArraySchema.optional(),
      dietaryTags: dietaryTagsArraySchema.optional(),
      imageUrl: imageUrlSchema,
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

module.exports = {
  recipeParamsSchema,
  listRecipesSchema,
  createRecipeSchema,
  updateRecipeSchema,
};