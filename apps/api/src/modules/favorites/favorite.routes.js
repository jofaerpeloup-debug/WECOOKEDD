const { Router } = require('express');
const favoriteController = require('./favorite.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { favoriteParamsSchema, listFavoritesSchema } = require('./favorite.validation');

const router = Router();

router.get('/', authenticate, validate(listFavoritesSchema), favoriteController.listFavorites);
router.post('/:recipeId', authenticate, validate(favoriteParamsSchema), favoriteController.addFavorite);
router.delete('/:recipeId', authenticate, validate(favoriteParamsSchema), favoriteController.removeFavorite);

module.exports = router;