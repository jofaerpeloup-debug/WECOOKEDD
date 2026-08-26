const substitutionService = require('./substitution.service');
const { toPublicSubstitution } = require('./substitution.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listSubstitutions = asyncHandler(async (req, res) => {
  const { sourceIngredientId, substituteIngredientId, context, status, page, limit, sort } =
    req.validated.query;
  const isAdmin = req.auth.role === 'admin';

  const { items, total } = await substitutionService.listSubstitutions({
    sourceIngredientId,
    substituteIngredientId,
    context,
    status,
    page,
    limit,
    sort,
    isAdmin,
  });

  sendSuccess(res, {
    substitutions: items.map(toPublicSubstitution),
    pagination: toPagination({ page, limit, total }),
  });
});

const getSubstitution = asyncHandler(async (req, res) => {
  const { substitutionId } = req.params;
  const isAdmin = req.auth.role === 'admin';

  const substitution = await substitutionService.getSubstitutionById(substitutionId, { isAdmin });
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