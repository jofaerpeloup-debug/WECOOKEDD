const { Router } = require('express');
const cookHistoryController = require('./cook-history.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const {
  createCookHistorySchema,
  listCookHistorySchema,
  cookHistoryStatsSchema,
  cookHistoryRecipeStatusSchema,
} = require('./cook-history.validation');

const router = Router();

router.get('/stats', authenticate, validate(cookHistoryStatsSchema), cookHistoryController.getStats);
router.get(
  '/recipes/:recipeId/status',
  authenticate,
  validate(cookHistoryRecipeStatusSchema),
  cookHistoryController.getRecipeStatus
);
router.get('/', authenticate, validate(listCookHistorySchema), cookHistoryController.listHistory);
router.post('/', authenticate, validate(createCookHistorySchema), cookHistoryController.recordCompletion);

module.exports = router;
