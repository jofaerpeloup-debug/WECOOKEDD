const { Router } = require('express');
const notificationController = require('./notification.controller');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { noStore } = require('../../middleware/no-store.middleware');
const pushInstallationRoutes = require('../push-installations/push-installation.routes');
const {
  listNotificationsSchema,
  readNotificationSchema,
  readAllNotificationsSchema,
  archiveAllNotificationsSchema,
} = require('./notification.validation');

const router = Router();

router.use(noStore);
router.use('/push-installations', pushInstallationRoutes);
router.get('/', authenticate, validate(listNotificationsSchema), notificationController.listNotifications);
router.patch('/read-all', authenticate, validate(readAllNotificationsSchema), notificationController.markAllRead);
router.post('/archive-all', authenticate, validate(archiveAllNotificationsSchema), notificationController.archiveAll);
router.patch('/:notificationId/read', authenticate, validate(readNotificationSchema), notificationController.markRead);

module.exports = router;
