const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const userController = require('./user.controller');

const router = Router();

router.get('/me', authenticate, userController.getCurrentUser);

module.exports = router;