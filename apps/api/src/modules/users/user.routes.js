const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { authorize } = require('../../middleware/authorize.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { noStore } = require('../../middleware/no-store.middleware');
const userController = require('./user.controller');
const {
  listUsersSchema,
  updateUserSchema,
  updateCurrentUserSchema,
} = require('./user.validation');

const router = Router();

// Declared first so it can never be shadowed by /:userId.
router.get('/me', authenticate, noStore, userController.getCurrentUser);

// Self-profile mutation. authenticate ONLY (no authorize) — any active user may
// edit their own name/preferences; role/status stay admin-only on PATCH /:userId.
// MUST be declared before PATCH /:userId, or the ':userId' param route captures
// 'me' (a normal user would then get 403 from authorize, an admin 400 from the
// ObjectId param validator).
router.patch(
  '/me',
  authenticate,
  validate(updateCurrentUserSchema),
  userController.updateCurrentUser
);

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
