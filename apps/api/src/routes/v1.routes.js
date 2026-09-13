const { Router } = require('express');
const healthRoutes = require('../modules/health/health.routes');
const authRoutes = require('../modules/auth/auth.routes');
const userRoutes = require('../modules/users/user.routes');
const ingredientRoutes = require('../modules/ingredients/ingredient.routes');
const substitutionRoutes = require('../modules/substitutions/substitution.routes');
const recipeRoutes = require('../modules/recipes/recipe.routes');
const favoriteRoutes = require('../modules/favorites/favorite.routes');
const shoppingListRoutes = require('../modules/shopping-lists/shopping-list.routes');
const collectionRoutes = require('../modules/collections/collection.routes');
const reviewRoutes = require('../modules/reviews/review.routes');
const cookHistoryRoutes = require('../modules/cook-history/cook-history.routes');
const mealPlanRoutes = require('../modules/meal-plan/meal-plan.routes');
const communityRoutes = require('../modules/community/community.routes');
const uploadRoutes = require('../modules/uploads/upload.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/ingredients', ingredientRoutes);
router.use('/substitutions', substitutionRoutes);
router.use('/recipes', recipeRoutes);
router.use('/favorites', favoriteRoutes);
router.use('/shopping-list', shoppingListRoutes);
router.use('/collections', collectionRoutes);
// Registers its own full paths (/recipes/:recipeId/reviews, /reviews/:reviewId)
// rather than a single prefix — see review.routes.js.
router.use(reviewRoutes);
router.use('/cook-history', cookHistoryRoutes);
router.use('/meal-plan', mealPlanRoutes);
router.use('/community', communityRoutes);
router.use('/admin/uploads', uploadRoutes);

module.exports = router;
