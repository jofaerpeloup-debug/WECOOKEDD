process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const service = require('../src/modules/uploads/avatar-image.service');

async function fixture(format = 'jpeg', width = 18, height = 12) {
  let image = sharp({ create: { width, height, channels: 3, background: '#8aa17b' } });
  if (format === 'jpeg') image = image.jpeg();
  if (format === 'png') image = image.png();
  if (format === 'webp') image = image.webp();
  return image.toBuffer();
}

async function animatedWebpFixture() {
  const header = '47494638396101000100800000000000ffffff';
  const firstFrame = '21f904000a0000002c0000000001000100000202440100';
  const secondFrame = '21f904000a0000002c00000000010001000002024c0100';
  const gif = Buffer.from(`${header}${firstFrame}${secondFrame}3b`, 'hex');
  return sharp(gif, { animated: true }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
}

test('real JPEG, PNG, and WebP inputs decode and become fresh metadata-free 512px WebP', async () => {
  for (const [format, extension, mimeType] of [
    ['jpeg', '.jpg', 'image/jpeg'], ['png', '.png', 'image/png'], ['webp', '.webp', 'image/webp'],
  ]) {
    const output = await service.sanitizeAvatar({
      originalname: `avatar${extension}`,
      mimetype: mimeType,
      buffer: await fixture(format),
    });
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
  }
});

test('missing, unsupported, mismatched, truncated, and oversized decoded inputs fail safely', async () => {
  await assert.rejects(() => service.sanitizeAvatar(), (error) => error.code === 'AVATAR_FILE_REQUIRED');
  const jpeg = await fixture('jpeg');
  await assert.rejects(
    () => service.sanitizeAvatar({ originalname: 'a.png', mimetype: 'image/png', buffer: jpeg }),
    (error) => error.code === 'AVATAR_FILE_INVALID'
  );
  await assert.rejects(
    () => service.sanitizeAvatar({ originalname: 'a.gif', mimetype: 'image/gif', buffer: Buffer.from('GIF89a') }),
    (error) => error.code === 'AVATAR_FILE_UNSUPPORTED'
  );
  await assert.rejects(
    () => service.sanitizeAvatar({ originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: jpeg.subarray(0, 20) }),
    (error) => error.code === 'AVATAR_FILE_INVALID'
  );
  await assert.rejects(
    () => service.sanitizeAvatar({ originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.concat([jpeg, Buffer.from('<script>')]) }),
    (error) => error.code === 'AVATAR_FILE_INVALID'
  );
  const tooWide = await fixture('png', 8193, 1);
  await assert.rejects(
    () => service.sanitizeAvatar({ originalname: 'a.png', mimetype: 'image/png', buffer: tooWide }),
    (error) => error.code === 'AVATAR_FILE_INVALID'
  );
});

test('animated images and images under the dimension cap but over the pixel cap are rejected', async () => {
  const animated = await animatedWebpFixture();
  await assert.rejects(
    () => service.sanitizeAvatar({ originalname: 'animated.webp', mimetype: 'image/webp', buffer: animated }),
    (error) => error.code === 'AVATAR_FILE_INVALID'
  );

  const overPixelCap = await fixture('png', 8192, 3052);
  await assert.rejects(
    () => service.sanitizeAvatar({ originalname: 'dense.png', mimetype: 'image/png', buffer: overPixelCap }),
    (error) => error.code === 'AVATAR_FILE_INVALID'
  );
});

test('metadata-bearing input is stripped and the provider receives processed WebP bytes', async (t) => {
  const source = await sharp({ create: { width: 18, height: 12, channels: 3, background: '#8aa17b' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'must-not-survive' } } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(source).metadata()).exif, 'fixture must contain metadata');

  const userRepository = require('../src/modules/users/user.repository');
  const imageProvider = require('../src/modules/uploads/cloudinary-image.provider');
  const userService = require('../src/modules/users/user.service');
  let providerBytes;
  t.mock.method(userRepository, 'findById', async () => ({ _id: 'u1', avatar: null, avatarRevision: 0 }));
  t.mock.method(imageProvider, 'isConfigured', () => true);
  t.mock.method(imageProvider, 'uploadAvatarImage', async ({ buffer }) => {
    providerBytes = buffer;
    return { asset_id: 'new-asset', secure_url: 'https://cdn/new.webp', format: 'webp' };
  });
  t.mock.method(userService, 'persistAvatarIfCurrent', async () => ({ _id: 'u1' }));

  await service.uploadAvatar('u1', { originalname: 'avatar.jpg', mimetype: 'image/jpeg', buffer: source });

  assert.ok(Buffer.isBuffer(providerBytes));
  assert.notDeepEqual(providerBytes, source);
  const processed = await sharp(providerBytes).metadata();
  assert.equal(processed.format, 'webp');
  assert.equal(processed.width, 512);
  assert.equal(processed.height, 512);
  assert.equal(processed.exif, undefined);
  assert.equal(processed.icc, undefined);
});

test('provider result validation requires immutable id, HTTPS URL, and sanitized WebP format', () => {
  assert.equal(service.validProviderResult({ asset_id: 'a', secure_url: 'https://cdn/a.webp', format: 'webp' }), true);
  for (const value of [
    null,
    { asset_id: '', secure_url: 'https://cdn/a.webp', format: 'webp' },
    { asset_id: 'a', secure_url: 'http://cdn/a.webp', format: 'webp' },
    { asset_id: 'a', secure_url: 'https://cdn/a.jpg', format: 'jpg' },
  ]) assert.equal(service.validProviderResult(value), false);
});
