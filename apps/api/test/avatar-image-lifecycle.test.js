process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const repository = require('../src/modules/users/user.repository');
const provider = require('../src/modules/uploads/cloudinary-image.provider');
const lifecycle = require('../src/modules/uploads/avatar-image.service');

async function file() {
  return { originalname: 'avatar.png', mimetype: 'image/png', buffer: await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).png().toBuffer() };
}

function installState(t, initial) {
  let state = structuredClone(initial);
  const assets = new Set(state.avatar ? [state.avatar.assetId] : []);
  t.mock.method(repository, 'findById', async () => state ? structuredClone(state) : null);
  t.mock.method(repository, 'replaceAvatarIfRevision', async (id, revision, avatar) => {
    if (!state || (state.avatarRevision ?? 0) !== revision) return null;
    state = { ...state, avatar: avatar ? { ...avatar } : null, avatarRevision: revision + 1 };
    return structuredClone(state);
  });
  t.mock.method(provider, 'isConfigured', () => true);
  t.mock.method(provider, 'deleteByAssetId', async (assetId) => { assets.delete(assetId); });
  return { assets, state: () => structuredClone(state) };
}

test('upload/upload has one CAS winner; loser deletes only its new asset and final active asset survives', async (t) => {
  const model = installState(t, { _id: 'u1', avatar: { url: 'https://cdn/old.webp', assetId: 'old' }, avatarRevision: 0 });
  let serial = 0;
  const waiting = [];
  t.mock.method(provider, 'uploadAvatarImage', () => new Promise((resolve) => {
    serial += 1; const assetId = `new-${serial}`; model.assets.add(assetId);
    waiting.push(() => resolve({ asset_id: assetId, secure_url: `https://cdn/${assetId}.webp`, format: 'webp' }));
  }));
  const first = lifecycle.uploadAvatar('u1', await file());
  const second = lifecycle.uploadAvatar('u1', await file());
  while (waiting.length < 2) await new Promise((resolve) => setImmediate(resolve));
  waiting.forEach((resolve) => resolve());
  const [a, b] = await Promise.allSettled([first, second]);
  assert.equal([a, b].filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal([a, b].find((result) => result.status === 'rejected').reason.code, 'AVATAR_UPDATE_CONFLICT');
  assert.deepEqual([...model.assets], [model.state().avatar.assetId]);
  assert.notEqual(model.state().avatar.assetId, 'old');
});

test('upload/reset overlap leaves reset authoritative and cleans the losing upload without deleting final state', async (t) => {
  const model = installState(t, { _id: 'u1', avatar: { url: 'https://cdn/old.webp', assetId: 'old' }, avatarRevision: 0 });
  let resolveUpload;
  t.mock.method(provider, 'uploadAvatarImage', () => new Promise((resolve) => { resolveUpload = resolve; }));
  const uploading = lifecycle.uploadAvatar('u1', await file());
  while (!resolveUpload) await new Promise((resolve) => setImmediate(resolve));
  await lifecycle.resetAvatar('u1');
  model.assets.add('new');
  resolveUpload({ asset_id: 'new', secure_url: 'https://cdn/new.webp', format: 'webp' });
  await assert.rejects(uploading, (error) => error.code === 'AVATAR_UPDATE_CONFLICT');
  assert.equal(model.state().avatar, null);
  assert.deepEqual([...model.assets], []);
});

test('reset/upload overlap can leave upload authoritative without the losing reset deleting it', async (t) => {
  let state = { _id: 'u1', avatar: { url: 'https://cdn/old.webp', assetId: 'old' }, avatarRevision: 0 };
  const assets = new Set(['old']);
  const reads = [];
  let initialReadsReleased = false;
  t.mock.method(repository, 'findById', () => initialReadsReleased
    ? Promise.resolve(structuredClone(state))
    : new Promise((resolve) => {
    reads.push(() => resolve(structuredClone(state)));
    if (reads.length === 2) {
      initialReadsReleased = true;
      reads.splice(0).forEach((release) => release());
    }
  }));
  let releaseReset;
  t.mock.method(repository, 'replaceAvatarIfRevision', (id, revision, avatar) => {
    if (avatar === null) return new Promise((resolve) => { releaseReset = () => resolve(null); });
    state = { ...state, avatar: { ...avatar }, avatarRevision: revision + 1 };
    releaseReset();
    return Promise.resolve(structuredClone(state));
  });
  t.mock.method(provider, 'isConfigured', () => true);
  t.mock.method(provider, 'uploadAvatarImage', async () => {
    assets.add('new');
    return { asset_id: 'new', secure_url: 'https://cdn/new.webp', format: 'webp' };
  });
  t.mock.method(provider, 'deleteByAssetId', async (assetId) => { assets.delete(assetId); });
  const resetting = lifecycle.resetAvatar('u1');
  const uploading = lifecycle.uploadAvatar('u1', await file());
  const [resetResult, uploadResult] = await Promise.allSettled([resetting, uploading]);
  assert.equal(resetResult.status, 'rejected');
  assert.equal(resetResult.reason.code, 'AVATAR_UPDATE_CONFLICT');
  assert.equal(uploadResult.status, 'fulfilled');
  assert.equal(state.avatar.assetId, 'new');
  assert.deepEqual([...assets], ['new']);
});

test('reset/reset has one winner and the loser never repeats predecessor cleanup', async (t) => {
  const model = installState(t, { _id: 'u1', avatar: { url: 'https://cdn/old.webp', assetId: 'old' }, avatarRevision: 0 });
  let deletes = 0;
  provider.deleteByAssetId.mock.restore();
  t.mock.method(provider, 'deleteByAssetId', async (assetId) => { deletes += 1; model.assets.delete(assetId); });
  const results = await Promise.allSettled([lifecycle.resetAvatar('u1'), lifecycle.resetAvatar('u1')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'AVATAR_UPDATE_CONFLICT');
  assert.equal(model.state().avatar, null);
  assert.equal(deletes, 1);
});

test('provider and persistence failures never delete the observed predecessor; persistence failure cleans new asset', async (t) => {
  const model = installState(t, { _id: 'u1', avatar: { url: 'https://cdn/old.webp', assetId: 'old' }, avatarRevision: 0 });
  t.mock.method(provider, 'uploadAvatarImage', async () => { throw new Error('secret provider detail'); });
  await assert.rejects(lifecycle.uploadAvatar('u1', await file()), (error) => error.code === 'AVATAR_UPLOAD_FAILED' && !error.message.includes('secret'));
  assert.deepEqual([...model.assets], ['old']);

  provider.uploadAvatarImage.mock.restore();
  t.mock.method(provider, 'uploadAvatarImage', async () => { model.assets.add('new'); return { asset_id: 'new', secure_url: 'https://cdn/new.webp', format: 'webp' }; });
  repository.replaceAvatarIfRevision.mock.restore();
  t.mock.method(repository, 'replaceAvatarIfRevision', async () => { throw new Error('database detail'); });
  await assert.rejects(lifecycle.uploadAvatar('u1', await file()), (error) => error.code === 'INTERNAL_SERVER_ERROR' && !error.message.includes('database'));
  assert.deepEqual([...model.assets], ['old']);
});

test('cleanup failure does not roll back a winning reset', async (t) => {
  const model = installState(t, { _id: 'u1', avatar: { url: 'https://cdn/old.webp', assetId: 'old' }, avatarRevision: 0 });
  provider.deleteByAssetId.mock.restore();
  t.mock.method(provider, 'deleteByAssetId', async () => { throw new Error('cleanup'); });
  const updated = await lifecycle.resetAvatar('u1');
  assert.equal(updated.avatar, null);
  assert.equal(model.state().avatar, null);
});
