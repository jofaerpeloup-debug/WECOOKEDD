const { randomUUID } = require('node:crypto');
const { v2: cloudinary } = require('cloudinary');
const { loadEnv } = require('../../config/env');

const UPLOAD_TIMEOUT_MS = 30_000;

function getConfig() {
  return loadEnv().cloudinary;
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.cloudName && config.apiKey && config.apiSecret);
}

function configureClient() {
  const config = getConfig();
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });
  return config;
}

function uploadImage({ buffer }) {
  const config = configureClient();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        folder: config.recipeFolder,
        public_id: randomUUID(),
        use_filename: false,
        unique_filename: false,
        overwrite: false,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [
          {
            width: 2400,
            height: 2400,
            crop: 'limit',
            quality: 'auto',
            flags: 'strip_profile',
          },
        ],
        timeout: UPLOAD_TIMEOUT_MS,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// Cloudinary immutable asset IDs are deliberately not treated as public IDs.
// This Admin API is the provider-supported deletion path for asset_id values.
async function deleteByAssetId(assetId) {
  configureClient();
  return cloudinary.api.delete_resources_by_asset_ids([assetId], {
    resource_type: 'image',
    type: 'upload',
  });
}

module.exports = { isConfigured, uploadImage, deleteByAssetId };
