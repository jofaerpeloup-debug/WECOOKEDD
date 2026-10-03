const userService = require('./user.service');
const { toPublicUser, toAdminUserSummary } = require('./user.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');
const { AppError } = require('../../shared/errors/app-error');
const avatarImageService = require('../uploads/avatar-image.service');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.auth.userId);
  if (!user) {
    throw new AppError('Session is no longer valid.', {
      statusCode: 401,
      code: 'AUTH_SESSION_INVALID',
    });
  }
  sendSuccess(res, { user: toPublicUser(user) });
});

const listUsers = asyncHandler(async (req, res) => {
  const { search, role, status, sort, page, limit } = req.validated.query;

  const { items, total } = await userService.listUsers({ search, role, status, sort, page, limit });

  sendSuccess(res, {
    users: items.map(toAdminUserSummary),
    pagination: toPagination({ page, limit, total }),
  });
});

const updateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const updated = await userService.adminUpdateUser({
    actingUserId: req.auth.userId,
    actingUserRole: req.auth.role,
    targetUserId: userId,
    patch: req.body,
  });

  sendSuccess(res, { user: toAdminUserSummary(updated) });
});

const updateCurrentUser = asyncHandler(async (req, res) => {
  const updated = await userService.updateOwnProfile({
    userId: req.auth.userId,
    patch: req.body,
  });

  sendSuccess(res, { user: toPublicUser(updated) });
});

const uploadAvatar = asyncHandler(async (req, res) => {
  const updated = await avatarImageService.uploadAvatar(req.auth.userId, req.file);
  sendSuccess(res, { user: toPublicUser(updated) });
});

const resetAvatar = asyncHandler(async (req, res) => {
  const updated = await avatarImageService.resetAvatar(req.auth.userId);
  sendSuccess(res, { user: toPublicUser(updated) });
});

module.exports = {
  getCurrentUser,
  listUsers,
  updateUser,
  updateCurrentUser,
  uploadAvatar,
  resetAvatar,
};
