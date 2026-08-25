const { Router } = require('express');
const healthRoutes = require('../modules/health/health.routes');
const authRoutes = require('../modules/auth/auth.routes');
const userRoutes = require('../modules/users/user.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

module.exports = router;
