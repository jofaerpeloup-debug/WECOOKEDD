const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { authorize } = require('../../middleware/authorize.middleware');
const { validate } = require('../../middleware/validate.middleware');
const userController = require('./user.controller');
const { listUsersSchema, updateUserSchema } = require('./user.validation');

const router = Router();

// Declared first so it can never be shadowed by /:userId.
router.get('/me', authenticate, userController.getCurrentUser);

// Admin user management. authorize('admin') is on the route itself (unlike
// GET /ingredients or GET /recipes, which any authenticated user may read) —
// listing and mutating users is admin-only.
router.get('/', authenticate, authorize('admin'), validate(listUsersSchema), userController.listUsers);

router.patch(
  '/:userId',
  authenticate,
  authorize('admin'),
  validate(updateUserSchema),
  userController.updateUser
);

module.exports = router;
