const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  hasCapability,
} = require('../src/shared/security/capabilities');

test('capability definitions and role mappings are immutable', () => {
  assert.equal(Object.isFrozen(CAPABILITIES), true);
  assert.equal(Object.isFrozen(ROLE_CAPABILITIES), true);
  for (const capabilities of Object.values(ROLE_CAPABILITIES)) {
    assert.equal(Object.isFrozen(capabilities), true);
  }
});

test('user has consumer capability only', () => {
  assert.deepEqual(ROLE_CAPABILITIES.user, [CAPABILITIES.CONSUMER]);
});

test('moderator has target catalog capabilities and no staff-management capabilities', () => {
  assert.deepEqual(ROLE_CAPABILITIES.moderator, [
    CAPABILITIES.CONSUMER,
    CAPABILITIES.CATALOG_READ_ALL,
    CAPABILITIES.CATALOG_WRITE,
    CAPABILITIES.RECIPE_IMAGE_UPLOAD,
  ]);
  assert.equal(hasCapability('moderator', CAPABILITIES.USERS_MANAGE), false);
  assert.equal(hasCapability('moderator', CAPABILITIES.STAFF_MANAGE), false);
  assert.equal(hasCapability('moderator', CAPABILITIES.MONITORING_READ), false);
});

test('admin has target management capabilities but no catalog-write or image-upload capability', () => {
  assert.deepEqual(ROLE_CAPABILITIES.admin, [
    CAPABILITIES.CONSUMER,
    CAPABILITIES.CATALOG_READ_ALL,
    CAPABILITIES.USERS_MANAGE,
    CAPABILITIES.STAFF_MANAGE,
    CAPABILITIES.MONITORING_READ,
  ]);
  assert.equal(hasCapability('admin', CAPABILITIES.CATALOG_WRITE), false);
  assert.equal(hasCapability('admin', CAPABILITIES.RECIPE_IMAGE_UPLOAD), false);
});

test('unknown roles and capabilities safely have no capability', () => {
  assert.equal(hasCapability('superadmin', CAPABILITIES.CONSUMER), false);
  assert.equal(hasCapability(undefined, CAPABILITIES.CONSUMER), false);
  assert.equal(hasCapability('admin', 'unknown.capability'), false);
  assert.equal(hasCapability('admin', undefined), false);
});
