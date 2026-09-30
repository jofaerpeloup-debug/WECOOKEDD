const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { isPublicHttpsUrl } = require('../../shared/validation/public-https-url');
const { RECIPE_REGIONS, RECIPE_CATEGORIES } = require('@wecooked/contracts');
const {
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
  MAX_IMAGE_ASSET_ID_LENGTH,
} = require('./recipe.model');

function collapseWhitespace(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

function unicodeLetterCount(value) {
  return (value.match(/\p{L}/gu) || []).length;
}

const titleSchema = z
  .string('Title must be a string.')
  .transform(collapseWhitespace)
  .pipe(
    z
      .string()
      .min(2, 'Title must be at least 2 characters.')
      .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`)
  )
  .refine((value) => unicodeLetterCount(value) >= 2, 'Title must contain at least 2 letters.');

// Existing stored recipes were accepted with any non-empty title. Keep that
// historical completeness rule for consumer visibility, restore, and audit
// tooling; all authoring request schemas below use the stricter titleSchema.
const legacyTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required.')
  .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);

const descriptionSchema = z
  .string()
  .trim()
  .min(1, 'Description is required.')
  .max(MAX_DESCRIPTION_LENGTH, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);

// Exact shared enums: legacy aliases belong only in the one-time migration.
const regionSchema = z.enum(RECIPE_REGIONS, 'Invalid recipe region.');
const categorySchema = z.enum(RECIPE_CATEGORIES, 'Invalid recipe category.');
const legacyStoredRegionSchema = z.enum(
  [...RECIPE_REGIONS, 'tondo', 'bicol', 'mangaldan'],
  'Invalid stored recipe region.',
);
const legacyStoredCategorySchema = z.enum(
  [...RECIPE_CATEGORIES, 'fine-dining-restaurant', 'medium'],
  'Invalid stored recipe category.',
);

const difficultySchema = z.enum(DIFFICULTIES, 'Invalid difficulty.');
const unitSchema = z.enum(UNITS, 'Invalid unit.');
const dietaryTagSchema = z.enum(DIETARY_TAGS, 'Invalid dietary tag.');

const prepTimeMinutesSchema = z
  .number()
  .int(`Prep time must be a whole number from 1 to ${MAX_PREP_TIME_MINUTES}.`)
  .min(1, `Prep time must be a whole number from 1 to ${MAX_PREP_TIME_MINUTES}.`)
  .max(MAX_PREP_TIME_MINUTES, `Prep time must be a whole number from 1 to ${MAX_PREP_TIME_MINUTES}.`);

const cookTimeMinutesSchema = z
  .number()
  .int(`Cook time must be a whole number from 3 to ${MAX_COOK_TIME_MINUTES}.`)
  .min(3, `Cook time must be a whole number from 3 to ${MAX_COOK_TIME_MINUTES}.`)
  .max(MAX_COOK_TIME_MINUTES, `Cook time must be a whole number from 3 to ${MAX_COOK_TIME_MINUTES}.`);

const legacyPrepTimeMinutesSchema = z.number().int().min(0).max(MAX_PREP_TIME_MINUTES);
const legacyCookTimeMinutesSchema = z.number().int().min(0).max(MAX_COOK_TIME_MINUTES);

const servingsSchema = z
  .number()
  .int(`Servings must be a whole number from 1 to ${MAX_SERVINGS}.`)
  .min(1, `Servings must be a whole number from 1 to ${MAX_SERVINGS}.`)
  .max(MAX_SERVINGS, `Servings must be a whole number from 1 to ${MAX_SERVINGS}.`);

const instructionItemSchema = z
  .string('Instruction must be a string.')
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(3, 'Instruction must be at least 3 characters.')
      .max(MAX_INSTRUCTION_LENGTH, `Instruction must be ${MAX_INSTRUCTION_LENGTH} characters or fewer.`)
  )
  .refine((value) => /\p{L}/u.test(value), 'Instruction must contain text.');

const legacyInstructionItemSchema = z
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

const draftInstructionsArraySchema = z
  .array(instructionItemSchema)
  .max(MAX_INSTRUCTIONS, `A maximum of ${MAX_INSTRUCTIONS} instruction steps is allowed.`);

const legacyInstructionsArraySchema = z
  .array(legacyInstructionItemSchema)
  .min(1, 'At least one instruction step is required.')
  .max(MAX_INSTRUCTIONS, `A maximum of ${MAX_INSTRUCTIONS} instruction steps is allowed.`);

// Structured cooking-steps input. Mongo still persists `instructions:
// string[]` as the source of truth (see recipe.model.js /
// docs/architecture/recipes.md) — the service normalizes a valid `steps`
// array down to ordered instruction text. `order` must form a contiguous
// 1..N sequence so the persisted order is deterministic and unambiguous.
const stepItemSchema = z
  .object({
    order: z
      .number('step order must be a number.')
      .int('step order must be an integer.')
      .positive('step order must be a positive integer.'),
    text: instructionItemSchema,
  })
  .strict();

const legacyStepItemSchema = z
  .object({
    order: z.number().int().positive(),
    text: legacyInstructionItemSchema,
  })
  .strict();

const stepsArraySchema = z
  .array(stepItemSchema)
  .min(1, 'At least one step is required.')
  .max(MAX_INSTRUCTIONS, `A maximum of ${MAX_INSTRUCTIONS} steps is allowed.`)
  .superRefine((steps, ctx) => {
    const orders = steps.map((step) => step.order);
    if (new Set(orders).size !== orders.length) {
      ctx.addIssue({ code: 'custom', message: 'step order values must be unique.' });
    }
    const sorted = [...orders].sort((a, b) => a - b);
    if (!sorted.every((value, index) => value === index + 1)) {
      ctx.addIssue({ code: 'custom', message: 'step order values must be contiguous starting at 1.' });
    }
  });

const draftStepsArraySchema = z
  .array(stepItemSchema)
  .max(MAX_INSTRUCTIONS, `A maximum of ${MAX_INSTRUCTIONS} steps is allowed.`)
  .superRefine((steps, ctx) => {
    const orders = steps.map((step) => step.order);
    if (new Set(orders).size !== orders.length) {
      ctx.addIssue({ code: 'custom', message: 'step order values must be unique.' });
    }
    const sorted = [...orders].sort((a, b) => a - b);
    if (!sorted.every((value, index) => value === index + 1)) {
      ctx.addIssue({ code: 'custom', message: 'step order values must be contiguous starting at 1.' });
    }
  });

const legacyStepsArraySchema = z
  .array(legacyStepItemSchema)
  .min(1, 'At least one step is required.')
  .max(MAX_INSTRUCTIONS, `A maximum of ${MAX_INSTRUCTIONS} steps is allowed.`)
  .superRefine((steps, ctx) => {
    const orders = steps.map((step) => step.order);
    if (new Set(orders).size !== orders.length) {
      ctx.addIssue({ code: 'custom', message: 'step order values must be unique.' });
    }
    const sorted = [...orders].sort((a, b) => a - b);
    if (!sorted.every((value, index) => value === index + 1)) {
      ctx.addIssue({ code: 'custom', message: 'step order values must be contiguous starting at 1.' });
    }
  });

// Rule when both `instructions` and `steps` are supplied: they must describe
// the exact same ordered text sequence. Equivalent input is accepted (the
// service uses `steps`); a mismatch is rejected rather than silently picking
// one. See docs/architecture/recipes.md.
function stepsMatchInstructions(steps, instructions) {
  const orderedStepText = [...steps].sort((a, b) => a.order - b.order).map((step) => step.text);
  return (
    orderedStepText.length === instructions.length &&
    orderedStepText.every((text, index) => text === instructions[index])
  );
}

function refineStepConsistency(body, ctx) {
  if (body.instructions !== undefined && body.steps !== undefined && !stepsMatchInstructions(body.steps, body.instructions)) {
    ctx.addIssue({
      code: 'custom',
      path: ['steps'],
      message: 'instructions and steps must describe the same ordered steps when both are provided.',
    });
  }
}

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
      .finite('Quantity must be greater than 0.')
      .positive('Quantity must be greater than 0.')
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

const draftIngredientsArraySchema = z
  .array(recipeIngredientUsageSchema)
  .max(MAX_INGREDIENTS, `A maximum of ${MAX_INGREDIENTS} ingredients is allowed.`);

const imageUrlSchema = z
  .string()
  .trim()
  .max(MAX_IMAGE_URL_LENGTH, `imageUrl must be ${MAX_IMAGE_URL_LENGTH} characters or fewer.`)
  .refine(isPublicHttpsUrl, 'imageUrl must be a public HTTPS URL without credentials.')
  .nullable()
  .optional();

const imageAssetIdSchema = z
  .string()
  .trim()
  .min(1, 'imageAssetId cannot be empty.')
  .max(
    MAX_IMAGE_ASSET_ID_LENGTH,
    `imageAssetId must be ${MAX_IMAGE_ASSET_ID_LENGTH} characters or fewer.`
  )
  .nullable()
  .optional();

function refineImageConsistency(body, ctx, { update = false } = {}) {
  if (body.imageAssetId != null && body.imageUrl == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['imageAssetId'],
      message: 'imageAssetId requires a non-null imageUrl.',
    });
  }
  if (update && body.imageAssetId !== undefined && body.imageUrl === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['imageUrl'],
      message: 'imageUrl must be provided when imageAssetId is changed.',
    });
  }
}

const statusSchema = z.enum(['active', 'inactive', 'all'], 'Invalid status.').default('active');
const sortSchema = z
  .enum(['titleAsc', 'titleDesc', 'newest', 'oldest', 'prepTimeAsc', 'prepTimeDesc'], 'Invalid sort value.')
  .default('titleAsc');
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
const expectedUpdatedAtSchema = z
  .string()
  .datetime({ offset: true, message: 'expectedUpdatedAt must be an ISO-8601 timestamp.' });

const recipeParamsSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
});

const importRecipeUrlSchema = z.object({
  body: z
    .object({
      url: z
        .string('URL must be a string.')
        .trim()
        .min(1, 'URL is required.')
        .max(2048, 'URL must be 2,048 characters or fewer.'),
    })
    .strict(),
});

const listRecipesSchema = z.object({
  query: z
    .object({
      search: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
      region: regionSchema.optional(),
      category: categorySchema.optional(),
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

const filipinoCuisineConfirmationSchema = z.literal(true, {
  error: 'confirmFilipinoCuisine must be true to publish a recipe.',
});

const duplicateReviewAcknowledgementSchema = z
  .object({
    resultDigest: z.string().regex(/^[0-9a-f]{64}$/, 'resultDigest must be a lowercase SHA-256 digest.').optional(),
    confirmDistinctRecipe: z.boolean().optional(),
  })
  .strict();

const publishedRecipeFields = {
  title: titleSchema,
  description: descriptionSchema,
  region: regionSchema.optional(),
  category: categorySchema.optional(),
  difficulty: difficultySchema,
  prepTimeMinutes: prepTimeMinutesSchema.optional(),
  cookTimeMinutes: cookTimeMinutesSchema,
  servings: servingsSchema,
  ingredients: ingredientsArraySchema,
  // Steps may arrive as legacy `instructions: string[]` or as structured
  // `steps: [{ order, text }]`. At least one is required on create; when
  // both are given they must be equivalent (refineStepConsistency).
  instructions: instructionsArraySchema.optional(),
  steps: stepsArraySchema.optional(),
  dietaryTags: dietaryTagsArraySchema.default([]),
  imageUrl: imageUrlSchema,
  imageAssetId: imageAssetIdSchema,
};

function refinePublishedRecipe(body, ctx) {
  if (body.instructions === undefined && body.steps === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['instructions'],
      message: 'Provide either instructions (string[]) or steps ([{ order, text }]).',
    });
  }
  refineStepConsistency(body, ctx);
  refineImageConsistency(body, ctx);
}

// Authoritative completeness contract reused by Publish, Published edits,
// migration assessment, and consumer eligibility. Policy acknowledgement is
// deliberately not part of persisted recipe structure.
const publishedRecipeBodySchema = z
  .object(publishedRecipeFields)
  .strict()
  .superRefine(refinePublishedRecipe);

const legacyPublishedRecipeBodySchema = z
  .object({
    ...publishedRecipeFields,
    title: legacyTitleSchema,
    // Read-time completeness remains compatible with the five frozen legacy
    // values until migration. Request schemas and the Mongoose enums continue
    // to use regionSchema/categorySchema, so these are not write aliases.
    region: legacyStoredRegionSchema.optional(),
    category: legacyStoredCategorySchema.optional(),
    prepTimeMinutes: legacyPrepTimeMinutesSchema.optional(),
    cookTimeMinutes: legacyCookTimeMinutesSchema,
    instructions: legacyInstructionsArraySchema.optional(),
    steps: legacyStepsArraySchema.optional(),
  })
  .strict()
  .superRefine(refinePublishedRecipe);

// Temporary M20B compatibility route contract. POST /recipes still accepts
// the current complete Staff Portal form and stores it as published while the
// next milestone moves that UI to POST /recipes/drafts + explicit publish.
const createRecipeSchema = z.object({
  body: z
    .object({
      ...publishedRecipeFields,
      confirmFilipinoCuisine: filipinoCuisineConfirmationSchema,
      duplicateReview: duplicateReviewAcknowledgementSchema.optional(),
    })
    .strict()
    .superRefine(refinePublishedRecipe),
});

const createDraftSchema = z.object({
  body: z
    .object({
      title: titleSchema,
      description: descriptionSchema.optional(),
      region: regionSchema.optional(),
      category: categorySchema.optional(),
      difficulty: difficultySchema.optional(),
      prepTimeMinutes: prepTimeMinutesSchema.optional(),
      cookTimeMinutes: cookTimeMinutesSchema.optional(),
      servings: servingsSchema.optional(),
      ingredients: draftIngredientsArraySchema.optional(),
      instructions: draftInstructionsArraySchema.optional(),
      steps: draftStepsArraySchema.optional(),
      dietaryTags: dietaryTagsArraySchema.optional(),
      imageUrl: imageUrlSchema,
      imageAssetId: imageAssetIdSchema,
    })
    .strict()
    .superRefine((body, ctx) => {
      refineStepConsistency(body, ctx);
      refineImageConsistency(body, ctx);
    }),
});

const updateRecipeSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  body: z
    .object({
      title: titleSchema.optional(),
      // Draft-optional scalar fields use an explicit nullable PATCH contract:
      // omitted means unchanged, null means intentionally unset, and a
      // concrete value replaces the stored value. The service enforces the
      // effective publication state's completeness after merging.
      description: descriptionSchema.nullable().optional(),
      // On PATCH, an explicit `null` clears (unsets) the field — the only way
      // to correct a bad classification. A canonical value replaces it; an
      // empty string or unknown value is rejected (never silently unset).
      region: regionSchema.nullable().optional(),
      category: categorySchema.nullable().optional(),
      difficulty: difficultySchema.nullable().optional(),
      prepTimeMinutes: prepTimeMinutesSchema.nullable().optional(),
      cookTimeMinutes: cookTimeMinutesSchema.nullable().optional(),
      servings: servingsSchema.nullable().optional(),
      ingredients: draftIngredientsArraySchema.optional(),
      instructions: draftInstructionsArraySchema.optional(),
      steps: draftStepsArraySchema.optional(),
      dietaryTags: dietaryTagsArraySchema.optional(),
      imageUrl: imageUrlSchema,
      imageAssetId: imageAssetIdSchema,
      expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
    })
    .strict()
    .superRefine((body, ctx) => {
      refineStepConsistency(body, ctx);
      refineImageConsistency(body, ctx, { update: true });
    })
    .refine((body) => Object.keys(body).some((field) => field !== 'expectedUpdatedAt'), {
      message: 'At least one recipe content field must be provided.',
    }),
});

const publishRecipeSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  body: z
    .object({
      confirmFilipinoCuisine: filipinoCuisineConfirmationSchema,
      expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
      duplicateReview: duplicateReviewAcknowledgementSchema.optional(),
    })
    .strict(),
});

const publishReadinessSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  body: z
    .object({
      expectedUpdatedAt: expectedUpdatedAtSchema,
      duplicateReview: duplicateReviewAcknowledgementSchema.optional(),
    })
    .strict(),
});

const duplicateCheckSchema = z.object({
  body: z.union([
    z.object({
      recipeId: objectIdSchema,
      expectedUpdatedAt: expectedUpdatedAtSchema,
    }).strict(),
    z.object({ candidate: publishedRecipeBodySchema }).strict(),
  ]),
});

const lifecycleRecipeSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  body: z.object({ expectedUpdatedAt: expectedUpdatedAtSchema.optional() }).strict(),
});

module.exports = {
  recipeParamsSchema,
  listRecipesSchema,
  createRecipeSchema,
  createDraftSchema,
  updateRecipeSchema,
  publishRecipeSchema,
  publishReadinessSchema,
  lifecycleRecipeSchema,
  duplicateCheckSchema,
  importRecipeUrlSchema,
  publishedRecipeBodySchema,
  legacyPublishedRecipeBodySchema,
  prepTimeMinutesSchema,
  cookTimeMinutesSchema,
  titleSchema,
  draftInstructionsArraySchema,
  draftStepsArraySchema,
};
