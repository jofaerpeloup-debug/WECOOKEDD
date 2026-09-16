process.env.NODE_ENV = 'test';
process.env.PORT = '4041';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const imageProvider = require('../src/modules/uploads/cloudinary-image.provider');
const recipeImageService = require('../src/modules/uploads/recipe-image.service');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();
const MODERATOR = {
  id: '507f1f77bcf86cd799439001',
  sessionId: '507f1f77bcf86cd799439002',
  role: 'moderator',
};
const USER = {
  id: '507f1f77bcf86cd799439003',
  sessionId: '507f1f77bcf86cd799439004',
  role: 'user',
};

const FILES = {
  jpeg: { name: 'dish.jpg', type: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]) },
  png: {
    name: 'dish.png',
    type: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  },
  webp: { name: 'dish.webp', type: 'image/webp', buffer: Buffer.from('RIFF0000WEBPdata') },
};

function mockAuth(t, identity) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: identity.sessionId,
    userId: identity.id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: identity.id,
    role: identity.role,
    status: 'active',
  }));
}

function tokenFor(identity) {
  return signAccessToken({
    userId: identity.id,
    role: identity.role,
    sessionId: identity.sessionId,
  });
}

function mockSuccessfulProvider(t, overrides = {}) {
  t.mock.method(imageProvider, 'isConfigured', () => true);
  t.mock.method(imageProvider, 'uploadImage', async () => ({
    secure_url: 'https://res.cloudinary.com/demo/image/upload/dish.jpg',
    asset_id: 'opaque-asset-id',
    format: 'jpg',
    ...overrides,
  }));
}

function moderatorUpload(file = FILES.jpeg) {
  return request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .set('Authorization', `Bearer ${tokenFor(MODERATOR)}`)
    .attach('image', file.buffer, { filename: file.name, contentType: file.type });
}

test('upload denies an unauthenticated caller before accepting an image', async () => {
  const response = await request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .attach('image', FILES.jpeg.buffer, { filename: FILES.jpeg.name, contentType: FILES.jpeg.type });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('upload denies an authenticated normal user', async (t) => {
  mockAuth(t, USER);
  const response = await request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .set('Authorization', `Bearer ${tokenFor(USER)}`)
    .attach('image', FILES.jpeg.buffer, { filename: FILES.jpeg.name, contentType: FILES.jpeg.type });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

for (const [format, file] of Object.entries(FILES)) {
  test(`authenticated moderator can upload a valid ${format.toUpperCase()} file`, async (t) => {
    mockAuth(t, MODERATOR);
    mockSuccessfulProvider(t, { format: format === 'jpeg' ? 'jpg' : format });
    const response = await moderatorUpload(file);
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, {
      success: true,
      data: {
        image: {
          url: 'https://res.cloudinary.com/demo/image/upload/dish.jpg',
          assetId: 'opaque-asset-id',
        },
      },
    });
  });
}

test('upload endpoint without Cloudinary configuration returns safe 503', async (t) => {
  mockAuth(t, MODERATOR);
  t.mock.method(imageProvider, 'isConfigured', () => false);
  const response = await moderatorUpload();
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'UPLOADS_NOT_CONFIGURED');
  assert.equal(JSON.stringify(response.body).includes('API_SECRET'), false);
});

for (const file of [
  { name: 'dish.svg', type: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
  { name: 'dish.gif', type: 'image/gif', buffer: Buffer.from('GIF89a') },
]) {
  test(`${file.name.split('.').pop().toUpperCase()} is rejected`, async (t) => {
    mockAuth(t, MODERATOR);
    const response = await moderatorUpload(file);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'IMAGE_FILE_UNSUPPORTED');
  });
}

test('fake JPEG MIME carrying HTML is rejected before provider upload', async (t) => {
  mockAuth(t, MODERATOR);
  let providerCalled = false;
  t.mock.method(imageProvider, 'isConfigured', () => true);
  t.mock.method(imageProvider, 'uploadImage', async () => { providerCalled = true; });
  const response = await moderatorUpload({
    name: 'fake.jpg',
    type: 'image/jpeg',
    buffer: Buffer.from('<html>not an image</html>'),
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'IMAGE_FILE_INVALID');
  assert.equal(providerCalled, false);
});

test('extension/signature mismatch is rejected', async (t) => {
  mockAuth(t, MODERATOR);
  const response = await moderatorUpload({ ...FILES.png, name: 'dish.jpg', type: 'image/jpeg' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'IMAGE_FILE_INVALID');
});

test('missing file is rejected', async (t) => {
  mockAuth(t, MODERATOR);
  const response = await request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .set('Authorization', `Bearer ${tokenFor(MODERATOR)}`);
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'IMAGE_FILE_REQUIRED');
});

test('multiple files are rejected', async (t) => {
  mockAuth(t, MODERATOR);
  const response = await request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .set('Authorization', `Bearer ${tokenFor(MODERATOR)}`)
    .attach('image', FILES.jpeg.buffer, { filename: 'one.jpg', contentType: 'image/jpeg' })
    .attach('image', FILES.jpeg.buffer, { filename: 'two.jpg', contentType: 'image/jpeg' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'IMAGE_FILE_MULTIPLE');
});

test('file over 5 MiB is rejected', async (t) => {
  mockAuth(t, MODERATOR);
  const oversized = Buffer.alloc(recipeImageService.MAX_IMAGE_FILE_SIZE + 1, 0xff);
  oversized[0] = 0xff;
  oversized[1] = 0xd8;
  oversized[2] = 0xff;
  const response = await moderatorUpload({ name: 'large.jpg', type: 'image/jpeg', buffer: oversized });
  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'IMAGE_FILE_TOO_LARGE');
});

test('malformed multipart is handled with a safe application error', async (t) => {
  mockAuth(t, MODERATOR);
  const response = await request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .set('Authorization', `Bearer ${tokenFor(MODERATOR)}`)
    .set('Content-Type', 'multipart/form-data; boundary=broken')
    .send('--broken\r\nContent-Disposition: form-data; name="image"; filename="x.jpg"\r\n');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'IMAGE_FILE_INVALID');
  assert.equal(JSON.stringify(response.body).includes('Unexpected end'), false);
});

test('provider failure returns a safe error without raw internals', async (t) => {
  mockAuth(t, MODERATOR);
  t.mock.method(console, 'error', () => {});
  t.mock.method(imageProvider, 'isConfigured', () => true);
  t.mock.method(imageProvider, 'uploadImage', async () => {
    throw new Error('api_secret=hunter2 signed-request=abc');
  });
  const response = await moderatorUpload();
  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, 'IMAGE_UPLOAD_FAILED');
  assert.equal(JSON.stringify(response.body).includes('hunter2'), false);
  assert.equal(JSON.stringify(response.body).includes('signed-request'), false);
});

test('unexpected provider format/result is rejected and its asset is best-effort deleted', async (t) => {
  mockAuth(t, MODERATOR);
  t.mock.method(imageProvider, 'isConfigured', () => true);
  t.mock.method(imageProvider, 'uploadImage', async () => ({
    secure_url: 'https://res.cloudinary.com/demo/image/upload/dish.gif',
    asset_id: 'bad-output-asset',
    format: 'gif',
  }));
  let deleted;
  t.mock.method(imageProvider, 'deleteByAssetId', async (assetId) => { deleted = assetId; });
  const response = await moderatorUpload();
  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, 'IMAGE_UPLOAD_FAILED');
  assert.equal(deleted, 'bad-output-asset');
});
