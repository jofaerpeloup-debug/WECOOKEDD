const { Router } = require('express');
const healthRoutes = require('../modules/health/health.routes');
const authRoutes = require('../modules/auth/auth.routes');
const userRoutes = require('../modules/users/user.routes');
const ingredientRoutes = require('../modules/ingredients/ingredient.routes');
const substitutionRoutes = require('../modules/substitutions/substitution.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/ingredients', ingredientRoutes);
router.use('/substitutions', substitutionRoutes);

module.exports = router;
