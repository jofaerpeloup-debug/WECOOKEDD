const notificationService = require('./notification.service');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

const listNotifications = asyncHandler(async (req, res) => {
  sendSuccess(res, await notificationService.listNotifications({
    recipientId: req.auth.userId,
    limit: req.validated.query.limit,
    cursor: req.validated.query.cursor,
  }));
});

const markRead = asyncHandler(async (req, res) => {
  sendSuccess(res, await notificationService.markRead({
    recipientId: req.auth.userId,
    notificationId: req.params.notificationId,
  }));
});

const markAllRead = asyncHandler(async (req, res) => {
  sendSuccess(res, await notificationService.markAllRead({
    recipientId: req.auth.userId,
    throughNotificationId: req.body.throughNotificationId,
  }));
});

const archiveAll = asyncHandler(async (req, res) => {
  sendSuccess(res, await notificationService.archiveAll({
    recipientId: req.auth.userId,
    throughNotificationId: req.body.throughNotificationId,
  }));
});

module.exports = { listNotifications, markRead, markAllRead, archiveAll };
