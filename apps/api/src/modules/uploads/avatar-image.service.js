const path = require('node:path');
const sharp = require('sharp');
const { AppError } = require('../../shared/errors/app-error');
const userRepository = require('../users/user.repository');
const userService = require('../users/user.service');
const imageProvider = require('./cloudinary-image.provider');

const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 25_000_000;
const AVATAR_SIZE = 512;
const ALLOWED_FORMATS = Object.freeze({
  jpeg: { extensions: ['.jpg', '.jpeg'], mimeType: 'image/jpeg' },
  png: { extensions: ['.png'], mimeType: 'image/png' },
  webp: { extensions: ['.webp'], mimeType: 'image/webp' },
});

function avatarError(code, message, statusCode = 400) {
  return new AppError(message, { statusCode, code });
}

function detectedSignature(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function declaredFormat(file) {
  const extension = path.extname(file?.originalname || '').toLowerCase();
  return Object.entries(ALLOWED_FORMATS).find(([, rule]) => (
    rule.extensions.includes(extension) && rule.mimeType === file?.mimetype
  ))?.[0] || null;
}

function hasExactContainerLength(buffer, format) {
  if (format === 'jpeg') return buffer.length >= 2
    && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  if (format === 'webp') return buffer.length >= 12 && buffer.readUInt32LE(4) + 8 === buffer.length;
  if (format === 'png') {
    const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    return buffer.length >= iend.length && buffer.subarray(-iend.length).equals(iend);
  }
  return false;
}

async function sanitizeAvatar(file) {
  if (!file) throw avatarError('AVATAR_FILE_REQUIRED', 'Choose an avatar image to upload.');
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw avatarError('AVATAR_FILE_INVALID', 'The avatar image is invalid.');
  }
  if (file.buffer.length > MAX_AVATAR_FILE_SIZE) {
    throw avatarError('AVATAR_FILE_TOO_LARGE', 'The avatar must be 5 MiB or smaller.', 413);
  }
  const declared = declaredFormat(file);
  if (!declared) {
    throw avatarError('AVATAR_FILE_UNSUPPORTED', 'Only matching JPEG, PNG, or WebP files are supported.');
  }
  if (detectedSignature(file.buffer) !== declared || !hasExactContainerLength(file.buffer, declared)) {
    throw avatarError('AVATAR_FILE_INVALID', 'The avatar contents do not match the selected file type.');
  }

  try {
    const input = sharp(file.buffer, { failOn: 'error', limitInputPixels: MAX_PIXELS });
    const metadata = await input.metadata();
    if (metadata.format !== declared || !metadata.width || !metadata.height) throw new Error('format');
    if ((metadata.pages || 1) !== 1) throw new Error('animated');
    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION
      || metadata.width * metadata.height > MAX_PIXELS) throw new Error('dimensions');
    const output = await input
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ animated: false })
      .toBuffer({ resolveWithObject: true });
    if (output.info.format !== 'webp' || output.info.width !== AVATAR_SIZE
      || output.info.height !== AVATAR_SIZE) throw new Error('output');
    return output.data;
  } catch {
    throw avatarError('AVATAR_FILE_INVALID', 'The avatar image is malformed or unsupported.');
  }
}

function validProviderResult(result) {
  if (!result || typeof result !== 'object' || typeof result.asset_id !== 'string'
    || !result.asset_id.trim() || String(result.format).toLowerCase() !== 'webp'
    || typeof result.secure_url !== 'string') return false;
  try { return new URL(result.secure_url).protocol === 'https:'; } catch { return false; }
}

async function bestEffortDelete(assetId) {
  if (!assetId) return;
  try { await imageProvider.deleteByAssetId(assetId); }
  catch { console.warn('Managed avatar cleanup failed.'); }
}

async function getSnapshot(userId) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new AppError('Session is no longer valid.', { statusCode: 401, code: 'AUTH_SESSION_INVALID' });
  }
  return {
    avatar: user.avatar ? { url: user.avatar.url, assetId: user.avatar.assetId } : null,
    avatarRevision: Number.isInteger(user.avatarRevision) ? user.avatarRevision : 0,
  };
}

async function uploadAvatar(userId, file) {
  const sanitized = await sanitizeAvatar(file);
  const snapshot = await getSnapshot(userId);
  if (!imageProvider.isConfigured()) {
    throw avatarError('AVATAR_UPLOADS_NOT_CONFIGURED', 'Avatar uploads are temporarily unavailable.', 503);
  }
  let result;
  try { result = await imageProvider.uploadAvatarImage({ buffer: sanitized }); }
  catch {
    console.error('Avatar image provider upload failed.');
    throw avatarError('AVATAR_UPLOAD_FAILED', 'The avatar could not be uploaded. Please try again.', 502);
  }
  if (!validProviderResult(result)) {
    await bestEffortDelete(result?.asset_id);
    throw avatarError('AVATAR_UPLOAD_FAILED', 'The avatar could not be uploaded. Please try again.', 502);
  }
  let updated;
  try {
    updated = await userService.persistAvatarIfCurrent({
      userId,
      observedRevision: snapshot.avatarRevision,
      avatar: { url: result.secure_url, assetId: result.asset_id },
    });
  } catch (error) {
    await bestEffortDelete(result.asset_id);
    if (error instanceof AppError) throw error;
    console.error('Avatar persistence failed.');
    throw avatarError('INTERNAL_SERVER_ERROR', 'The avatar could not be updated. Please try again.', 500);
  }
  await bestEffortDelete(snapshot.avatar?.assetId);
  return updated;
}

async function resetAvatar(userId) {
  const snapshot = await getSnapshot(userId);
  let updated;
  try {
    updated = await userService.persistAvatarIfCurrent({
      userId,
      observedRevision: snapshot.avatarRevision,
      avatar: null,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Avatar persistence failed.');
    throw avatarError('INTERNAL_SERVER_ERROR', 'The avatar could not be reset. Please try again.', 500);
  }
  await bestEffortDelete(snapshot.avatar?.assetId);
  return updated;
}

module.exports = {
  MAX_AVATAR_FILE_SIZE,
  MAX_DIMENSION,
  MAX_PIXELS,
  AVATAR_SIZE,
  detectedSignature,
  hasExactContainerLength,
  sanitizeAvatar,
  validProviderResult,
  uploadAvatar,
  resetAvatar,
};
