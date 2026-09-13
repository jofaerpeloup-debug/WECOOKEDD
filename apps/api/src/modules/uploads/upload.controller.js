const recipeImageService = require('./recipe-image.service');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

const uploadRecipeImage = asyncHandler(async (req, res) => {
  const image = await recipeImageService.uploadRecipeImage(req.file);
  sendSuccess(res, { image }, 201);
});

module.exports = { uploadRecipeImage };
