const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { validate } = require('../../middleware/validate.middleware');
const schemas = require('./assistant-history.validation');
const controller = require('./assistant-history.controller');
const { assistantUserRateLimiter, assistantIpRateLimiter } = require('../../middleware/rate-limiter');

const router = Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(authenticate);
router.post('/', validate(schemas.createConversationSchema), controller.create);
router.get('/', validate(schemas.listConversationsSchema), controller.list);
router.get('/:conversationId', validate(schemas.openConversationSchema), controller.open);
router.delete('/:conversationId', validate(schemas.deleteConversationSchema), controller.remove);
router.post('/:conversationId/messages', assistantUserRateLimiter, assistantIpRateLimiter,
  validate(schemas.sendMessageSchema), controller.send);

module.exports = router;
