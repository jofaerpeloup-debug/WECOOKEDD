import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCatalogPolicy,
  getAllowedNavigation,
  getPortalDestination,
  getSafeNavigation,
} from '../src/portalPolicy.js';

test('catalog presentation policy matches the locked authority model', () => {
  assert.deepEqual(getCatalogPolicy('admin'), {
    canReadCatalog: true,
    canWriteCatalog: false,
    canUploadRecipeImage: false,
  });
  assert.deepEqual(getCatalogPolicy('moderator'), {
    canReadCatalog: true,
    canWriteCatalog: true,
    canUploadRecipeImage: true,
  });
  for (const mode of ['consumer', 'pending', 'rejected', 'verify_email', undefined]) {
    assert.deepEqual(getCatalogPolicy(mode), {
      canReadCatalog: false,
      canWriteCatalog: false,
      canUploadRecipeImage: false,
    });
  }
});

test('staff modes resolve to explicit portal destinations', () => {
  assert.equal(getPortalDestination('admin'), 'admin');
  assert.equal(getPortalDestination('moderator'), 'moderator');
  assert.equal(getPortalDestination('consumer'), 'consumer');
  assert.equal(getPortalDestination('verify_email'), 'verify-email');
  assert.equal(getPortalDestination('pending'), 'pending');
  assert.equal(getPortalDestination('rejected'), 'rejected');
});

test('navigation is role-specific and stale tabs are replaced safely', () => {
  assert.ok(getAllowedNavigation('admin').includes('users'));
  assert.ok(getAllowedNavigation('admin').includes('staff'));
  assert.deepEqual(getAllowedNavigation('moderator'), [
    'moderator-home', 'recipes', 'ingredients', 'substitutions',
  ]);
  assert.equal(getSafeNavigation('admin', 'users'), 'users');
  assert.equal(getSafeNavigation('moderator', 'users'), 'moderator-home');
  assert.equal(getSafeNavigation('consumer', 'recipes'), null);
  assert.equal(getSafeNavigation('pending', 'staff'), null);
});

test('unknown modes fail closed and never resolve to a staff workspace', () => {
  for (const mode of [undefined, '', 'superadmin', 'arbitrary-unknown-mode']) {
    const destination = getPortalDestination(mode);
    assert.notEqual(destination, 'admin');
    assert.notEqual(destination, 'moderator');
    assert.equal(destination, 'loading');
    assert.deepEqual(getAllowedNavigation(mode), []);
    assert.equal(getSafeNavigation(mode, 'staff'), null);
  }
});
