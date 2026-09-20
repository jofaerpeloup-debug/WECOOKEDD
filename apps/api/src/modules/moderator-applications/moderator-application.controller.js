const service = require('./moderator-application.service');
const { toApplication, toApplicantState, toAdminApplication } = require('./moderator-application.serializer');
const { toAdminUserSummary } = require('../users/user.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function pagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const apply = asyncHandler(async (req, res) => {
  const application = await service.apply(req.auth.userId);
  sendSuccess(res, { application: toApplication(application) }, 201);
});

const me = asyncHandler(async (req, res) => {
  const state = await service.getStaffState(req.auth.userId);
  sendSuccess(res, {
    mode: state.mode,
    application: state.application ? toApplicantState(state.application) : null,
  });
});

const list = asyncHandler(async (req, res) => {
  const result = await service.list(req.validated.query);
  sendSuccess(res, {
    applications: result.items.map(toAdminApplication),
    pagination: pagination(result),
  });
});

const approve = asyncHandler(async (req, res) => {
  const result = await service.approve({
    applicationId: req.params.applicationId,
    reviewedBy: req.auth.userId,
    actorRole: req.auth.role,
  });
  sendSuccess(res, {
    application: toApplication(result.application),
    user: toAdminUserSummary(result.user),
  });
});

const reject = asyncHandler(async (req, res) => {
  const application = await service.reject({
    applicationId: req.params.applicationId,
    reviewedBy: req.auth.userId,
    actorRole: req.auth.role,
    reason: req.body.reason,
  });
  sendSuccess(res, { application: toApplication(application) });
});

const demote = asyncHandler(async (req, res) => {
  const user = await service.demote({
    userId: req.params.userId,
    actorUserId: req.auth.userId,
    actorRole: req.auth.role,
  });
  sendSuccess(res, { user: toAdminUserSummary(user) });
});

module.exports = { apply, me, list, approve, reject, demote };
