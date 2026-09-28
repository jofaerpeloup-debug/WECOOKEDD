const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const {
  CATEGORIES,
  ALLERGEN_TAGS,
  MAX_NAME_LENGTH,
  MAX_ALIAS_LENGTH,
  MAX_ALIASES,
} = require('./ingredient.model');

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(MAX_NAME_LENGTH, `Name must be ${MAX_NAME_LENGTH} characters or fewer.`);

const aliasItemSchema = z
  .string()
  .trim()
  .min(1, 'Alias cannot be empty.')
  .max(MAX_ALIAS_LENGTH, `Each alias must be ${MAX_ALIAS_LENGTH} characters or fewer.`);

// No .default([]) here — this base is reused by both create (where an
// omitted key should become []) and patch (where an omitted key must leave
// the stored aliases untouched, not reset them). Each usage site opts into
// the behavior it needs.
const aliasesArraySchema = z
  .array(aliasItemSchema)
  .max(MAX_ALIASES, `A maximum of ${MAX_ALIASES} aliases is allowed.`);

const categorySchema = z.enum(CATEGORIES, 'Invalid category.');

const allergenTagSchema = z.enum(ALLERGEN_TAGS, 'Invalid allergen tag.');

// Same default-avoidance reasoning as aliasesArraySchema.
const allergenTagsArraySchema = z
  .array(allergenTagSchema)
  .max(ALLERGEN_TAGS.length, 'Too many allergen tags.');

const statusSchema = z.enum(['active', 'inactive', 'all'], 'Invalid status.').default('active');
const sortSchema = z
  .enum(['nameAsc', 'nameDesc', 'newest', 'oldest'], 'Invalid sort value.')
  .default('nameAsc');
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
const ingredientResolutionSchema = z.object({
  body: z
    .object({
      lines: z.array(z.string().max(500).refine((line) => line.trim().length > 0, {
        message: 'Ingredient line cannot be blank.',
      })).min(1).max(50),
    })
    .strict(),
});

const ingredientParamsSchema = z.object({
  params: z.object({ ingredientId: objectIdSchema }).strict(),
});

const listIngredientsSchema = z.object({
  query: z
    .object({
      search: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
      category: categorySchema.optional(),
      allergen: allergenTagSchema.optional(),
      status: statusSchema,
      page: pageSchema,
      limit: limitSchema,
      sort: sortSchema,
    })
    .strict(),
});

const createIngredientSchema = z.object({
  body: z
    .object({
      name: nameSchema,
      aliases: aliasesArraySchema.default([]),
      category: categorySchema,
      allergenTags: allergenTagsArraySchema.default([]),
    })
    .strict(),
});

const updateIngredientSchema = z.object({
  params: z.object({ ingredientId: objectIdSchema }).strict(),
  body: z
    .object({
      name: nameSchema.optional(),
      aliases: aliasesArraySchema.optional(),
      category: categorySchema.optional(),
      allergenTags: allergenTagsArraySchema.optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

module.exports = {
  ingredientParamsSchema,
  listIngredientsSchema,
  createIngredientSchema,
  updateIngredientSchema,
  ingredientResolutionSchema,
};
