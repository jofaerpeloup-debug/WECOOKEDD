process.env.NODE_ENV = 'test';
process.env.PORT = '4043';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
process.env.CLOUDINARY_RECIPE_FOLDER = 'test/recipes';
process.env.CLOUDINARY_AVATAR_FOLDER = 'test/avatars';

const test = require('node:test');
const assert = require('node:assert/strict');
const { v2: cloudinary } = require('cloudinary');
const provider = require('../src/modules/uploads/cloudinary-image.provider');

test('provider is configured only through server environment values', () => {
  assert.equal(provider.isConfigured(), true);
});

test('upload uses a random server-owned ID and constrained image transformation', async (t) => {
  let options;
  let receivedBuffer;
  t.mock.method(cloudinary.uploader, 'upload_stream', (uploadOptions, callback) => {
    options = uploadOptions;
    return {
      end(buffer) {
        receivedBuffer = buffer;
        callback(null, {
          secure_url: 'https://res.cloudinary.com/test/image/upload/result.jpg',
          asset_id: 'asset-id',
          format: 'jpg',
        });
      },
    };
  });

  const buffer = Buffer.from('image bytes');
  const result = await provider.uploadImage({ buffer });
  assert.equal(receivedBuffer, buffer);
  assert.equal(result.asset_id, 'asset-id');
  assert.match(options.public_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(options.folder, 'test/recipes');
  assert.equal(options.resource_type, 'image');
  assert.deepEqual(options.allowed_formats, ['jpg', 'jpeg', 'png', 'webp']);
  assert.deepEqual(options.transformation, [{
    width: 2400,
    height: 2400,
    crop: 'limit',
    quality: 'auto',
    flags: 'strip_profile',
  }]);
});

test('deletion uses Cloudinary immutable asset IDs rather than public IDs', async (t) => {
  let args;
  t.mock.method(cloudinary.api, 'delete_resources_by_asset_ids', async (...values) => {
    args = values;
    return { deleted: { 'immutable-asset-id': 'deleted' } };
  });
  await provider.deleteByAssetId('immutable-asset-id');
  assert.deepEqual(args, [
    ['immutable-asset-id'],
    { resource_type: 'image', type: 'upload' },
  ]);
});

test('avatar upload sends only a fresh server-owned WebP to the avatar folder', async (t) => {
  let options;
  let receivedBuffer;
  t.mock.method(cloudinary.uploader, 'upload_stream', (uploadOptions, callback) => {
    options = uploadOptions;
    return { end: (buffer) => { receivedBuffer = buffer; callback(null, { secure_url: 'https://cdn/avatar.webp', asset_id: 'a1', format: 'webp' }); } };
  });
  const sanitized = Buffer.from('sanitized WebP bytes');
  await provider.uploadAvatarImage({ buffer: sanitized });
  assert.equal(receivedBuffer, sanitized);
  assert.equal(options.folder, 'test/avatars');
  assert.equal(options.format, 'webp');
  assert.deepEqual(options.allowed_formats, ['webp']);
  assert.match(options.public_id, /^[0-9a-f-]{36}$/i);
  assert.equal(options.transformation, undefined);
});
