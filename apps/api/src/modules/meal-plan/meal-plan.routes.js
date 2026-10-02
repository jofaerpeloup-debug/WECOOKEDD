const { Router } = require('express');
const mealPlanController = require('./meal-plan.controller');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { validate } = require('../../middleware/validate.middleware');
const {
  listMealPlanSchema,
  createMealPlanEntrySchema,
  moveMealPlanEntrySchema,
  entryParamsSchema,
  clearMealPlanSchema,
} = require('./meal-plan.validation');

const router = Router();

router.get('/', authenticate, validate(listMealPlanSchema), mealPlanController.listEntries);
router.post('/', authenticate, validate(createMealPlanEntrySchema), mealPlanController.createEntry);
router.patch('/:entryId', authenticate, validate(moveMealPlanEntrySchema), mealPlanController.moveEntry);
router.delete('/', authenticate, validate(clearMealPlanSchema), mealPlanController.clearRange);
router.delete('/:entryId', authenticate, validate(entryParamsSchema), mealPlanController.removeEntry);

module.exports = router;
