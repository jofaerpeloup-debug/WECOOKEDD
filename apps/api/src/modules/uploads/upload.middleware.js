const multer = require('multer');
const { AppError } = require('../../shared/errors/app-error');
const { MAX_IMAGE_FILE_SIZE } = require('./recipe-image.service');

const parseSingleImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_FILE_SIZE,
    files: 1,
    fields: 0,
  },
}).single('image');

const parseSingleAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_FILE_SIZE, files: 1, fields: 0, parts: 1 },
}).single('image');

function multipartError(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError('The image must be 5 MiB or smaller.', {
        statusCode: 413,
        code: 'IMAGE_FILE_TOO_LARGE',
      });
    }
    if (
      err.code === 'LIMIT_FILE_COUNT' ||
      err.code === 'LIMIT_PART_COUNT' ||
      err.code === 'LIMIT_UNEXPECTED_FILE'
    ) {
      return new AppError('Upload exactly one image file.', {
        statusCode: 400,
        code: 'IMAGE_FILE_MULTIPLE',
      });
    }
  }
  return new AppError('The multipart image upload request is invalid.', {
    statusCode: 400,
    code: 'IMAGE_FILE_INVALID',
  });
}

function parseRecipeImage(req, res, next) {
  parseSingleImage(req, res, (err) => {
    if (err) return next(multipartError(err));
    next();
  });
}

function avatarMultipartError(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError('The avatar must be 5 MiB or smaller.', {
        statusCode: 413,
        code: 'AVATAR_FILE_TOO_LARGE',
      });
    }
    if (['LIMIT_FILE_COUNT', 'LIMIT_PART_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(err.code)) {
      return new AppError('Upload exactly one avatar image.', {
        statusCode: 400,
        code: 'AVATAR_FILE_MULTIPLE',
      });
    }
  }
  return new AppError('The multipart avatar request is invalid.', {
    statusCode: 400,
    code: 'AVATAR_FILE_INVALID',
  });
}

function parseAvatarImage(req, res, next) {
  parseSingleAvatar(req, res, (err) => {
    if (err) return next(avatarMultipartError(err));
    next();
  });
}

module.exports = { parseRecipeImage, parseAvatarImage };
