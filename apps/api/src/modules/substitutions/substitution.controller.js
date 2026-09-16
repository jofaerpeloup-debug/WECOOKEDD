const substitutionService = require('./substitution.service');
const { toPublicSubstitution } = require('./substitution.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');
const { CAPABILITIES, hasCapability } = require('../../shared/security/capabilities');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listSubstitutions = asyncHandler(async (req, res) => {
  const { sourceIngredientId, substituteIngredientId, context, status, page, limit, sort } =
    req.validated.query;
  const canReadAll = hasCapability(req.auth.role, CAPABILITIES.CATALOG_READ_ALL);

  const { items, total } = await substitutionService.listSubstitutions({
    sourceIngredientId,
    substituteIngredientId,
    context,
    status,
    page,
    limit,
    sort,
    isAdmin: canReadAll,
  });

  sendSuccess(res, {
    substitutions: items.map(toPublicSubstitution),
    pagination: toPagination({ page, limit, total }),
  });
});

const getSubstitution = asyncHandler(async (req, res) => {
  const { substitutionId } = req.params;
  const canReadAll = hasCapability(req.auth.role, CAPABILITIES.CATALOG_READ_ALL);

  const substitution = await substitutionService.getSubstitutionById(substitutionId, {
    isAdmin: canReadAll,
  });
  sendSuccess(res, { substitution: toPublicSubstitution(substitution) });
});

const createSubstitution = asyncHandler(async (req, res) => {
  const substitution = await substitutionService.createSubstitution(req.body);
  sendSuccess(res, { substitution: toPublicSubstitution(substitution) }, 201);
});

const updateSubstitution = asyncHandler(async (req, res) => {
  const { substitutionId } = req.params;
  const substitution = await substitutionService.updateSubstitution(substitutionId, req.body);
  sendSuccess(res, { substitution: toPublicSubstitution(substitution) });
});

const archiveSubstitution = asyncHandler(async (req, res) => {
  const { substitutionId } = req.params;
  const substitution = await substitutionService.archiveSubstitution(substitutionId);
  sendSuccess(res, { substitution: toPublicSubstitution(substitution) });
});

module.exports = {
  listSubstitutions,
  getSubstitution,
  createSubstitution,
  updateSubstitution,
  archiveSubstitution,
};
