const authService = require('./auth.service');
const { toPublicUser } = require('../users/user.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const { user, accessToken, refreshToken } = await authService.register({ name, email, password });
  sendSuccess(res, { user: toPublicUser(user), accessToken, refreshToken }, 201);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, accessToken, refreshToken } = await authService.login({ email, password });
  sendSuccess(res, { user: toPublicUser(user), accessToken, refreshToken });
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const tokens = await authService.refresh(refreshToken);
  sendSuccess(res, tokens);
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.auth.sessionId);
  sendSuccess(res, { loggedOut: true });
});

const logoutAll = asyncHandler(async (req, res) => {
  const { revokedCount } = await authService.logoutAll(req.auth.userId);
  sendSuccess(res, { revokedCount });
});

// Identity is the authenticated, DB-verified req.auth.userId only — never an
// email or a body field. On success every session (this one included) is
// revoked, so no user object and no fresh token are returned: the caller must
// sign in again.
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await authService.changePassword({
    userId: req.auth.userId,
    currentPassword,
    newPassword,
  });
  sendSuccess(res, result);
});

const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body.email);
  sendSuccess(res, result);
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword({
    rawToken: req.body.token,
    newPassword: req.body.newPassword,
  });
  sendSuccess(res, result);
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  changePassword,
  forgotPassword,
  resetPassword,
};
