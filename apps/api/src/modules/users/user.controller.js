const userService = require('./user.service');
const { toPublicUser } = require('./user.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');
const { AppError } = require('../../shared/errors/app-error');

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

module.exports = { getCurrentUser };
