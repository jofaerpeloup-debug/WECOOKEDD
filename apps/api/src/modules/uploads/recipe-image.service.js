const path = require('node:path');
const { AppError } = require('../../shared/errors/app-error');
const imageProvider = require('./cloudinary-image.provider');

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_FORMATS = Object.freeze({
  jpeg: { extensions: ['.jpg', '.jpeg'], mimeType: 'image/jpeg' },
  png: { extensions: ['.png'], mimeType: 'image/png' },
  webp: { extensions: ['.webp'], mimeType: 'image/webp' },
});

function uploadError(code, message, statusCode = 400) {
  return new AppError(message, { statusCode, code });
}

function detectFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function validateImageFile(file) {
  if (!file) {
    throw uploadError('IMAGE_FILE_REQUIRED', 'Choose an image file to upload.');
  }
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw uploadError('IMAGE_FILE_INVALID', 'The image file is invalid.');
  }

  const extension = path.extname(file.originalname || '').toLowerCase();
  const declared = Object.entries(ALLOWED_FORMATS).find(
    ([, rule]) => rule.extensions.includes(extension) && rule.mimeType === file.mimetype
  );
  if (!declared) {
    throw uploadError(
      'IMAGE_FILE_UNSUPPORTED',
      'Only matching JPEG, PNG, or WebP image files are supported.'
    );
  }

  const detectedFormat = detectFormat(file.buffer);
  if (!detectedFormat || detectedFormat !== declared[0]) {
    throw uploadError('IMAGE_FILE_INVALID', 'The image contents do not match the selected file type.');
  }

  return detectedFormat;
}

function isValidProviderResult(result) {
  if (!result || typeof result !== 'object') return false;
  if (typeof result.asset_id !== 'string' || !result.asset_id.trim()) return false;
  if (typeof result.secure_url !== 'string') return false;
  try {
    if (new URL(result.secure_url).protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return ['jpg', 'jpeg', 'png', 'webp'].includes(String(result.format || '').toLowerCase());
}

async function bestEffortDelete(assetId) {
  if (!assetId) return;
  try {
    await imageProvider.deleteByAssetId(assetId);
  } catch {
    console.warn('Managed recipe image cleanup failed.');
  }
}

async function uploadRecipeImage(file) {
  validateImageFile(file);
  if (!imageProvider.isConfigured()) {
    throw uploadError(
      'UPLOADS_NOT_CONFIGURED',
      'Recipe image uploads are temporarily unavailable.',
      503
    );
  }

  let result;
  try {
    result = await imageProvider.uploadImage({ buffer: file.buffer });
  } catch {
    console.error('Recipe image provider upload failed.');
    throw uploadError('IMAGE_UPLOAD_FAILED', 'The image could not be uploaded. Please try again.', 502);
  }

  if (!isValidProviderResult(result)) {
    await bestEffortDelete(result?.asset_id);
    throw uploadError('IMAGE_UPLOAD_FAILED', 'The image could not be uploaded. Please try again.', 502);
  }

  return { url: result.secure_url, assetId: result.asset_id };
}

module.exports = {
  MAX_IMAGE_FILE_SIZE,
  detectFormat,
  validateImageFile,
  uploadRecipeImage,
};
