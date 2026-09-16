const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { noStore } = require('../../middleware/no-store.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
const userController = require('./user.controller');
const {
  listUsersSchema,
  updateUserSchema,
  updateCurrentUserSchema,
} = require('./user.validation');

const router = Router();
const userManager = requireCapability(CAPABILITIES.USERS_MANAGE);

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

// User management is capability-gated. In the locked role map only Admin has
// users.manage; route authority does not depend on a role literal.
router.get('/', authenticate, userManager, validate(listUsersSchema), userController.listUsers);

router.patch(
  '/:userId',
  authenticate,
  userManager,
  validate(updateUserSchema),
  userController.updateUser
);

module.exports = router;
