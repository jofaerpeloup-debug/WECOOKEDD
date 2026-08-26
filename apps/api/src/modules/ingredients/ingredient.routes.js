const { Router } = require('express');
const ingredientController = require('./ingredient.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { authorize } = require('../../middleware/authorize.middleware');
const {
  ingredientParamsSchema,
  listIngredientsSchema,
  createIngredientSchema,
  updateIngredientSchema,
} = require('./ingredient.validation');

const router = Router();

router.get('/', authenticate, validate(listIngredientsSchema), ingredientController.listIngredients);
router.get(
  '/:ingredientId',
  authenticate,
  validate(ingredientParamsSchema),
  ingredientController.getIngredient
);

router.post(
  '/',
  authenticate,
  authorize('admin'),
  validate(createIngredientSchema),
  ingredientController.createIngredient
);
router.patch(
  '/:ingredientId',
  authenticate,
  authorize('admin'),
  validate(updateIngredientSchema),
  ingredientController.updateIngredient
);
router.delete(
  '/:ingredientId',
  authenticate,
  authorize('admin'),
  validate(ingredientParamsSchema),
  ingredientController.archiveIngredient
);

module.exports = router;