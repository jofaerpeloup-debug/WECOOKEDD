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
  removeMealPlanEntrySchema,
  putReminderSchema,
  deleteReminderSchema,
} = require('./meal-plan.validation');

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', authenticate, validate(listMealPlanSchema), mealPlanController.listEntries);
router.post('/', authenticate, validate(createMealPlanEntrySchema), mealPlanController.createEntry);
router.patch('/:entryId', authenticate, validate(moveMealPlanEntrySchema), mealPlanController.moveEntry);
router.get('/:entryId', authenticate, validate(entryParamsSchema), mealPlanController.getEntry);
router.put('/:entryId/reminder', authenticate, validate(putReminderSchema), mealPlanController.putReminder);
router.delete('/:entryId/reminder', authenticate, validate(deleteReminderSchema), mealPlanController.deleteReminder);
router.delete('/', authenticate, validate(clearMealPlanSchema), mealPlanController.clearRange);
router.delete('/:entryId', authenticate, validate(removeMealPlanEntrySchema), mealPlanController.removeEntry);

module.exports = router;
